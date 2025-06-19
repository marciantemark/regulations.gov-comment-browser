import { Command } from "commander";
import { openDb, withTransaction } from "../lib/database";
import type { Database } from "bun:sqlite";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { loadCondensedCommentsForEntities } from "../lib/comment-processing";
import { createEvenBatches } from "../lib/batch-processor";
import { 
  ENTITY_CATEGORY_DISCOVERY_PROMPT, 
  ENTITY_CATEGORY_MERGE_PROMPT,
  ENTITY_EXTRACTION_JSON_PROMPT 
} from "../prompts/entity-discovery";
import type { EntityTaxonomy, EnrichedComment } from "../types";
import { runPool } from "../lib/worker-pool";
import { parseJsonResponse } from "../lib/json-parser";
import { TaskQueue, buildHierarchicalTasks, type Task } from "../lib/task-queue";
import { getTaskConfig, getStageConfig, getBatchOptions, getTaskModel } from "../lib/batch-config";

export const discoverEntitiesCommand = new Command("discover-entities")
  .description("Discover named entities using two-stage approach (categories first)")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-l, --limit <n>", "Process only N comments", parseInt)
  .option("--batch-limit <n>", "Word limit to trigger batching (default: 50000)", parseInt)
  .option("--batch-size <n>", "Target words per batch (default: 50000 for entity extraction)", parseInt)
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel batch API calls (default: 3)", parseInt)
  .option("-m, --model <model>", "AI model to use (overrides config)")
  .option("--merge-width <n>", "Number of category lists to merge at once (default: 10)", parseInt)
  .action(discoverEntities);

interface CategoryInfo {
  categories: string[];
  examples: Record<string, Array<{name: string, definition: string}>>;
}

async function discoverEntities(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  
  // Get the effective model from config
  const effectiveModel = getTaskModel('discoverEntities', options.model);
  const ai = new AIClient(effectiveModel, db);
  
  console.log(`🔍 Discovering entities for document ${documentId}`);
  console.log(`   Using model: ${effectiveModel}`);
  
  // Check if entities already exist
  const existingEntities = db.prepare("SELECT COUNT(*) as count FROM entity_taxonomy").get() as { count: number };
  if (existingEntities.count > 0) {
    console.log(`⚠️  Entities already discovered (${existingEntities.count} entities)`);
    console.log("   To re-run, clear entity_taxonomy table first");
    return;
  }
  
  // Load condensed comments with enriched metadata
  const comments = loadCondensedCommentsForEntities(db, options.limit);
  if (comments.length === 0) {
    console.log("❌ No condensed comments found. Run 'condense' command first.");
    return;
  }
  
  console.log(`📊 Loaded ${comments.length} condensed comments`);
  
  // Load task configuration
  const taskConfig = getTaskConfig('discoverEntities', effectiveModel);
  const concurrency = options.concurrency || taskConfig.concurrency;
  console.log(`   Using concurrency: ${concurrency}`);
  
  // Get stage-specific configurations
  const categoryStageConfig = getStageConfig('discoverEntities', 'categoryDiscovery');
  const categoryBatchOptions = getBatchOptions('discoverEntities', 'categoryDiscovery');
  
  // Create batches for category discovery
  const categoryBatches = createEvenBatches(comments, {
    totalWordLimit: options.batchLimit || categoryBatchOptions?.triggerWordLimit || 50000,
    batchWordLimit: categoryBatchOptions?.batchWordLimit || 50000
  });
  console.log(`📦 Created ${categoryBatches.length} batch(es) for category discovery`);
  
  // STAGE 1: Discover categories using TaskQueue
  console.log("\n🏷️  STAGE 1: Discovering entity categories...");
  
  // Get stage-specific model for category discovery
  const categoryModel = categoryStageConfig?.model || effectiveModel;
  const categoryAi = categoryModel !== effectiveModel ? new AIClient(categoryModel, db) : ai;
  if (categoryModel !== effectiveModel) {
    console.log(`   Using stage model: ${categoryModel}`);
  }
  
  // Build tasks for category discovery with N-way merging
  const mergeWidth = options.mergeWidth || categoryStageConfig?.mergeWidth || 10;
  const categoryTasks: Task[] = buildHierarchicalTasks(
    categoryBatches,
    (_, i) => `cat_batch_${i}`,
    'cat_merge',
    mergeWidth
  );
  
  if (mergeWidth !== 10) {
    console.log(`🔀 Using ${mergeWidth}-way merges for categories`);
  }
  
  // Update batch tasks with actual data
  categoryTasks.forEach(task => {
    if (task.data.type === 'initial') {
      task.data = task.data.item; // The batch data
    }
  });
  
  const totalCategoryTasks = categoryTasks.length;
  const categoryMergeTasks = totalCategoryTasks - categoryBatches.length;
  console.log(`📊 Category tasks: ${totalCategoryTasks} (batches: ${categoryBatches.length}, merges: ${categoryMergeTasks})`);
  
  // Find the final task
  const finalCategoryTaskId = categoryTasks[categoryTasks.length - 1].id;
  
  // Process using TaskQueue
  const categoryQueue = new TaskQueue(categoryTasks, {
    concurrency,
    onTaskStart: (task) => {
      const queueInfo = `${categoryQueue['running'].size}/${concurrency} workers`;
      console.log(`   🚀 [${task.id}] Starting (${queueInfo} active)`);
    },
    onTaskComplete: (task) => {
      const progress = `${categoryQueue.getCompleted().size}/${totalCategoryTasks}`;
      console.log(`   ✅ [${task.id}] Completed (${progress} total)`);
    },
    onTaskError: (task, error) => {
      console.error(`   ❌ [${task.id}] Failed:`, error);
    }
  });
  
  const categoryResults = await categoryQueue.process(async (task, getResult) => {
    if (task.id.startsWith('cat_batch_')) {
      // Process category discovery batch
      const batch = task.data;
      console.log(`   🔄 [${task.id}] Processing batch (${batch.items.length} comments, ${batch.wordCount} words)`);
      
      // Build prompt
      const commentBlocks = batch.items.map((c: any) => 
        `<comment id="${c.id}">\n${c.content}\n</comment>`
      ).join("\n\n");
      
      const prompt = ENTITY_CATEGORY_DISCOVERY_PROMPT.replace("{COMMENTS}", commentBlocks);
      
      // Generate categories with caching
      const response = await categoryAi.generateContent(
        prompt,
        options.debug ? `categories_batch_${batch.number}` : undefined,
        `categories_v2_batch_${batch.number}`,
        {
          taskType: 'discover-entity-categories',
          taskLevel: 0,
          params: { 
            batchNumber: batch.number,
            wordCount: batch.wordCount,
            commentCount: batch.items.length
          }
        }
      );
      
      // Parse response
      const categoryInfo = parseCategoryResponse(response);
      if (options.debug) {
        await debugSave(`categories_batch_${batch.number}_parsed.json`, categoryInfo);
      }
      
      return categoryInfo;
    } else {
      // Merge task - handle N-way merges
      const inputResults = task.data.inputs.map((id: string) => {
        const result = getResult(id);
        if (!result) {
          throw new Error(`Missing dependency ${id} for ${task.id}`);
        }
        return result as CategoryInfo;
      });
      
      return await mergeCategoriesNWay(task, inputResults, categoryAi, options.debug);
    }
  });
  
  // Get final category list
  const finalCategoryInfo = categoryResults.get(finalCategoryTaskId) as CategoryInfo;
  const finalCategories = finalCategoryInfo.categories;
  
  console.log(`✅ Final category list: ${finalCategories.length} categories`);
  if (options.debug) {
    await debugSave(`categories_final.json`, finalCategories);
  }
  
  // STAGE 2: Extract entities using standardized categories with smaller batches
  console.log("\n📝 STAGE 2: Extracting entities using standardized categories...");
  
  // Get entity extraction stage configuration
  const entityStageConfig = getStageConfig('discoverEntities', 'entityExtraction');
  const entityBatchOptions = getBatchOptions('discoverEntities', 'entityExtraction');
  
  // Get stage-specific model for entity extraction
  const entityModel = entityStageConfig?.model || effectiveModel;
  const entityAi = entityModel !== effectiveModel ? new AIClient(entityModel, db) : ai;
  if (entityModel !== effectiveModel) {
    console.log(`   Using stage model: ${entityModel}`);
  }
  
  // Create smaller batches for entity extraction
  const entityBatches = createEvenBatches(comments, {
    totalWordLimit: entityBatchOptions?.triggerWordLimit || 5000,
    batchWordLimit: options.batchSize || entityBatchOptions?.batchWordLimit || 5000
  });
  console.log(`📦 Created ${entityBatches.length} smaller batch(es) for entity extraction`);
  
  const entityResults: EntityTaxonomy[] = [];
  const failedBatches: number[] = [];
  const timeoutPerBatch = entityStageConfig?.timeoutPerBatch || 60000;
  const maxFailures = entityStageConfig?.maxFailures || 3;
  
  await runPool(
    entityBatches,
    concurrency,
    async (batch) => {
      console.log(`\n🔄 Processing batch ${batch.number}/${entityBatches.length} for entity extraction`);
      console.log(`   Comments: ${batch.items.length}, Words: ${batch.wordCount}`);
      
      try {
        // Build prompt with categories
        const commentBlocks = batch.items.map((c: any) => 
          `<comment id="${c.id}">\n${c.content}\n</comment>`
        ).join("\n\n");
        
        const categoryList = finalCategories.map((cat, i) => `${i + 1}. ${cat}`).join("\n");
        
        const prompt = ENTITY_EXTRACTION_JSON_PROMPT
          .replace("{CATEGORIES}", categoryList)
          .replace("{COMMENTS}", commentBlocks);
        
        // Generate entities with caching and timeout
        const entities = await entityAi.generateContent<EntityTaxonomy>(
          prompt,
          options.debug ? `entities_v2_batch_${batch.number}` : undefined,
          `entities_v2_json_batch_${batch.number}`,
          {
            taskType: 'extract-entities-v2-json',
            taskLevel: 0,
            params: { 
              batchNumber: batch.number,
              wordCount: batch.wordCount,
              commentCount: batch.items.length,
              categoryCount: finalCategories.length
            }
          },
          parseJsonResponse,  // postProcess function
          timeoutPerBatch     // timeout in milliseconds
        );
        if (options.debug) {
          await debugSave(`entities_v2_batch_${batch.number}_parsed.json`, entities);
        }
        
        // Validate and fix entities with missing definitions
        for (const [category, categoryEntities] of Object.entries(entities)) {
          for (const entity of categoryEntities) {
            if (!entity.definition || entity.definition.trim() === '') {
              console.warn(`   ⚠️  Entity "${entity.label}" in category "${category}" has no definition, using default`);
              entity.definition = `A ${category.toLowerCase()} entity mentioned in comments`;
            }
          }
        }
        
        // Count entities
        const entityCount = Object.values(entities).flat().length;
        console.log(`   [Batch ${batch.number}] ✅ Extracted ${entityCount} entities`);
        entityResults.push(entities);
        
      } catch (error) {
        console.error(`   [Batch ${batch.number}] ❌ Error:`, error);
        failedBatches.push(batch.number);
        
        // Check if we've exceeded max failures
        if (failedBatches.length > maxFailures) {
          console.error(`\n❌ Too many failures (${failedBatches.length}/${maxFailures}). Aborting entity extraction.`);
          throw new Error(`Entity extraction failed for too many batches: ${failedBatches.join(', ')}`);
        }
        
        console.warn(`   ⚠️  Continuing despite failure (${failedBatches.length}/${maxFailures} failures allowed)`);
      }
    }
  );
  
  // Summary of extraction results
  if (failedBatches.length > 0) {
    console.log(`\n⚠️  Entity extraction completed with ${failedBatches.length} failed batch(es): ${failedBatches.join(', ')}`);
    console.log(`   ✅ Successfully processed: ${entityResults.length}/${entityBatches.length} batches`);
  }
  
  // Merge entities automatically (no LLM needed)
  console.log("\n🔄 Deduplicating entities across batches...");
  const finalEntities = automaticallyMergeEntities(entityResults);
  if (options.debug) {
    await debugSave(`entities_v2_final.json`, finalEntities);
  }
  
  // Save entities and annotate comments
  console.log("\n💾 Saving entity taxonomy and annotating comments...");
  await saveAndAnnotateEntities(db, finalEntities, comments);
  
  // Summary
  const entityCount = db.prepare("SELECT COUNT(*) as count FROM entity_taxonomy").get() as { count: number };
  const annotationCount = db.prepare("SELECT COUNT(*) as count FROM comment_entities").get() as { count: number };
  
  console.log("\n✅ Entity discovery complete!");
  console.log(`   Categories: ${finalCategories.length}`);
  console.log(`   Entities: ${entityCount.count}`);
  console.log(`   Annotations: ${annotationCount.count}`);
  
  db.close();
}

// Parse category discovery response
function parseCategoryResponse(response: string): CategoryInfo {
  const lines = response.split('\n');
  const categories: string[] = [];
  const examples: Record<string, Array<{name: string, definition: string}>> = {};
  
  let currentCategory = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Category line
    const categoryMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[2];
      categories.push(currentCategory);
      examples[currentCategory] = [];
      continue;
    }
    
    // Example line
    const exampleMatch = trimmed.match(/^\*\s+([^:]+):\s*(.*)$/);
    if (exampleMatch && currentCategory) {
      examples[currentCategory].push({
        name: exampleMatch[1].trim(),
        definition: exampleMatch[2].trim()
      });
    }
  }
  
  return { categories, examples };
}

// Merge N category lists using TaskQueue's merge task
async function mergeCategoriesNWay(
  task: Task,
  categoryInfos: CategoryInfo[],
  ai: AIClient,
  debug: boolean
): Promise<CategoryInfo> {
  console.log(`   🔄 [${task.id}] Merging ${categoryInfos.length} category lists`);
  
  // Collect all unique categories for stats
  const allCategories = new Set<string>();
  for (const info of categoryInfos) {
    info.categories.forEach(cat => allCategories.add(cat));
  }
  
  console.log(`   Total unique categories across inputs: ${allCategories.size}`);
  
  // Build category lists section for prompt
  const categoryListsSection = categoryInfos.map((info, i) => {
    const lines = [`=== CATEGORY LIST ${i + 1} (${info.categories.length} categories) ===`];
    info.categories.forEach((cat, j) => {
      lines.push(`${j + 1}. ${cat}`);
      // Include one example if available
      const example = info.examples[cat]?.[0];
      if (example) {
        lines.push(`   Example: ${example.name}`);
      }
    });
    return lines.join('\n');
  }).join('\n\n');
  
  const prompt = ENTITY_CATEGORY_MERGE_PROMPT.replace("{CATEGORY_LISTS}", categoryListsSection);
  
  // Extract level from task id
  const levelMatch = task.id.match(/_L(\d+)_/);
  const level = levelMatch ? parseInt(levelMatch[1]) : 0;
  
  const mergedCategories = await ai.generateContent<string[]>(
    prompt,
    debug ? `categories_${task.id}` : undefined,
    task.id,
    {
      taskType: 'merge-entity-categories',
      taskLevel: level,
      params: { 
        taskId: task.id,
        inputCount: categoryInfos.length,
        totalUniqueCategories: allCategories.size
      }
    },
    parseJsonResponse  // postProcess function
  );
  
  // Clean up any markdown bold markers that may be present
  const cleanedCategories = mergedCategories.map(cat => cat.replace(/\*\*/g, '').trim());
  
  // Merge examples from all inputs
  const mergedExamples: Record<string, Array<{name: string, definition: string}>> = {};
  for (const cat of cleanedCategories) {
    mergedExamples[cat] = [];
    // Find matching categories from inputs (case-insensitive)
    for (const info of categoryInfos) {
      for (const [origCat, examples] of Object.entries(info.examples)) {
        if (origCat.toLowerCase().includes(cat.toLowerCase()) || cat.toLowerCase().includes(origCat.toLowerCase())) {
          mergedExamples[cat].push(...examples);
        }
      }
    }
    // Deduplicate examples by name
    const seen = new Set<string>();
    mergedExamples[cat] = mergedExamples[cat].filter(ex => {
      const key = ex.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  
  return {
    categories: cleanedCategories,
    examples: mergedExamples
  };
}


/* ───────────────────────── helpers ────────────────────────────── */
const autoNormalize = (s: string) =>
  s.normalize("NFD")                       // é → é
   .replace(/[\u0300-\u036f]/g, "")        // strip diacritics
   .toLowerCase()
   .replace(/[^a-z0-9]+/g, " ")            // keep alphanumerics
   .trim();

const setsIntersect = <T>(a: Set<T>, b: Set<T>) =>
  [...a].some(x => b.has(x));

/* ───────────────────── category-level merge ───────────────────── */
interface TaxonomyEntity {
  label: string;
  definition: string;
  terms: string[];
}

function mergeCategory(entities: TaxonomyEntity[]) {
  // build signature set for every entity
  const sig = entities.map(e =>
    new Set([autoNormalize(e.label), ...e.terms.map(autoNormalize)])
  );

  let changed = true;
  while (changed) {
    changed = false;

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        if (!setsIntersect(sig[i], sig[j])) continue;

        // merge j → i
        const a = entities[i], b = entities[j];
        a.label      = a.label.length <= b.label.length ? a.label : b.label;
        
        // Handle potentially null/undefined definitions
        if (!a.definition && !b.definition) {
          a.definition = "No definition available";
        } else if (!a.definition) {
          a.definition = b.definition;
        } else if (!b.definition) {
          // a.definition is already set, keep it
        } else {
          // Both have definitions, keep the longer one
          a.definition = a.definition.length >= b.definition.length ? a.definition : b.definition;
        }
        
        a.terms.push(...b.terms);

        // update signature i with everything from j
        b.terms.forEach(t => sig[i].add(autoNormalize(t)));
        sig[j].forEach(t => sig[i].add(t));

        // remove j
        entities.splice(j, 1);
        sig.splice(j, 1);
        changed = true;
        j--; // stay at the same index after removal
      }
    }
  }

  // final tidying
  for (const e of entities) e.terms = [...new Set(e.terms)].sort();
  entities.sort((a, b) => a.label.localeCompare(b.label));
}

/* ─────────────────── automaticallyMergeEntities ───────────────── */
export function automaticallyMergeEntities(
  taxonomies: EntityTaxonomy[]
): EntityTaxonomy {
  // 1️⃣ aggregate
  const bucket = new Map<string, any[]>();
  for (const taxonomy of taxonomies) {
    for (const [cat, ents] of Object.entries(taxonomy)) {
      bucket.has(cat) ? bucket.get(cat)!.push(...ents)
                      : bucket.set(cat, [...ents]);
    }
  }

  // 2️⃣ & 3️⃣ merge per category
  const final: EntityTaxonomy = {};
  for (const [cat, ents] of bucket) {
    mergeCategory(ents);
    final[cat] = ents;
  }

  return final;
}

// Save entities and annotate comments
async function saveAndAnnotateEntities(
  db: Database,
  taxonomy: EntityTaxonomy,
  comments: EnrichedComment[]
) {
  // ──────────────────── preparation ────────────────────
  const insertEntity = db.prepare(
    `INSERT INTO entity_taxonomy (category, label, definition, terms)
     VALUES (?, ?, ?, ?)`
  );

  const insertAnnotation = db.prepare(
    `INSERT OR IGNORE INTO comment_entities (comment_id, category, entity_label)
     VALUES (?, ?, ?)`
  );

  // Build regex index per term so we can scan comments efficiently
  type SearchEntry = {
    entityKey: string;        // "{category}|{label}"
    category: string;
    label: string;
    regex: RegExp;
  };

  const searchEntries: SearchEntry[] = [];

  // Track occurrences per entity (unique comments mentioning it)
  const entityHits: Map<string, Set<string>> = new Map();

  for (const [category, entities] of Object.entries(taxonomy)) {
    for (const { label, terms } of entities) {
      const entityKey = `${category}|${label}`;
      entityHits.set(entityKey, new Set());
      for (const term of terms) {
        // Word-boundary, case-sensitive match
        const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "g");
        searchEntries.push({ entityKey, category, label, regex });
      }
    }
  }

  // ───────────────────── scan comments ─────────────────────
  console.log("\n📚 Loading comment content for analysis (detailedContent only)...");
  const upperThreshold = Math.floor(comments.length * 0.5);
  const lowerThreshold = Math.max(1, Math.floor(comments.length * 0.01));

  for (const comment of comments) {
    // structuredSections should already be parsed in EnrichedComment
    const sections = comment.structuredSections ?? {};
    const detailedContent = sections.detailedContent ?? "";
    if (!detailedContent) continue;

    for (const entry of searchEntries) {
      if (entry.regex.test(detailedContent)) {
        entityHits.get(entry.entityKey)!.add(comment.id);
      }
    }
    console.log(comment.id, `(${detailedContent.length} chars)`);
  }

  // ─────────────── decide which entities to keep ───────────────
  const entitiesToRemove = new Set<string>();
  for (const [entityKey, hits] of entityHits.entries()) {
    const count = hits.size;
    if (count < lowerThreshold || count > upperThreshold) {
      entitiesToRemove.add(entityKey);
    }
  }

  console.log(
    `\n⚖️  Filtering entities outside [1%, 50%] occurrence thresholds.`
  );
  console.log(`   Total entities: ${entityHits.size}`);
  console.log(`   To remove:      ${entitiesToRemove.size}`);

  // ─────────────────── insert kept entities ───────────────────
  withTransaction(db, () => {
    let saved = 0;
    for (const [category, entities] of Object.entries(taxonomy)) {
      for (const entity of entities) {
        const key = `${category}|${entity.label}`;
        if (entitiesToRemove.has(key)) continue; // skip
        
        // Final safeguard: ensure definition is not null/empty
        const definition = entity.definition && entity.definition.trim() 
          ? entity.definition 
          : `A ${category.toLowerCase()} entity mentioned in comments`;
          
        insertEntity.run(
          category,
          entity.label,
          definition,
          JSON.stringify(entity.terms)
        );
        saved++;
      }
    }
    console.log(`   ✅ Saved ${saved} entities to database`);
  });

  // ─────────────────── annotate comments ───────────────────
  console.log("\n💾 Saving entity annotations...");
  let annotationCount = 0;

  for (const comment of comments) {
    const sections = comment.structuredSections ?? {};
    const detailedContent = sections.detailedContent ?? "";
    if (!detailedContent) continue;

    const alreadyAdded = new Set<string>();
    for (const entry of searchEntries) {
      if (entitiesToRemove.has(entry.entityKey)) continue; // skip filtered
      if (alreadyAdded.has(entry.entityKey)) continue;     // only once per entity per comment
      if (entry.regex.test(detailedContent)) {
        insertAnnotation.run(comment.id, entry.category, entry.label);
        alreadyAdded.add(entry.entityKey);
        annotationCount++;
      }
    }
  }

  console.log(`   💡 Created ${annotationCount} entity annotations`);

  // ─────────────────── summary ───────────────────
  if (entitiesToRemove.size > 0) {
    console.log("\n⚠️  Entities removed due to frequency thresholds (showing up to 10):");
    [...entitiesToRemove].slice(0, 10).forEach(key => {
      const hits = entityHits.get(key)?.size ?? 0;
      const percent = ((hits / comments.length) * 100).toFixed(2);
      console.log(`      - ${key} (${hits} comments, ${percent}%)`);
    });
    if (entitiesToRemove.size > 10) {
      console.log(`      ... and ${entitiesToRemove.size - 10} more`);
    }
  }
}

// Escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}