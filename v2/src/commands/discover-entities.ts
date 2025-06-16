import { Command } from "commander";
import { openDb, withTransaction } from "../lib/database";
import type { Database } from "bun:sqlite";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { loadCondensedComments, parseEntityTaxonomy } from "../lib/comment-processing";
import { createEvenBatches, DEFAULT_BATCH_OPTIONS } from "../lib/batch-processor";
import { ENTITY_DISCOVERY_PROMPT, ENTITY_MERGE_PROMPT } from "../prompts/entity-discovery";
import type { EntityTaxonomy } from "../types";

export const discoverEntitiesCommand = new Command("discover-entities")
  .description("Discover named entities from condensed comments")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-l, --limit <n>", "Process only N comments", parseInt)
  .option("--batch-limit <n>", "Word limit to trigger batching (default: 200000)", parseInt)
  .option("--batch-size <n>", "Target words per batch (default: 100000)", parseInt)
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel batch API calls (default: 3)", parseInt)
  .action(discoverEntities);

async function discoverEntities(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  const ai = new AIClient();
  
  console.log(`🔍 Discovering entities for document ${documentId}`);
  
  // Check if entities already exist
  const existingEntities = db.prepare("SELECT COUNT(*) as count FROM entity_taxonomy").get() as { count: number };
  if (existingEntities.count > 0) {
    console.log(`⚠️  Entities already discovered (${existingEntities.count} entities)`);
    console.log("   To re-run, clear entity_taxonomy and entity_batches tables first");
    return;
  }
  
  // Load condensed comments
  const comments = loadCondensedComments(db, options.limit);
  if (comments.length === 0) {
    console.log("❌ No condensed comments found. Run 'condense' command first.");
    return;
  }
  
  console.log(`📊 Loaded ${comments.length} condensed comments`);
  
  // Create batches
  const batchOptions = {
    totalWordLimit: options.batchLimit || DEFAULT_BATCH_OPTIONS.totalWordLimit,
    batchWordLimit: options.batchSize || DEFAULT_BATCH_OPTIONS.batchWordLimit
  };
  
  const batches = createEvenBatches(comments, batchOptions);
  console.log(`📦 Created ${batches.length} batch(es) for processing`);
  
  // Process each batch
  const batchResults: EntityTaxonomy[] = [];
  const concurrency = options.concurrency || 3;
  
  // Prepare batch statement outside of parallel processing
  const batchStmt = db.prepare(`
    INSERT INTO entity_batches (batch_number, word_count, comment_count, entities_json)
    VALUES (?, ?, ?, ?)
  `);
  
  async function processBatch(batch: any): Promise<EntityTaxonomy> {
    console.log(`\n🔄 Processing batch ${batch.number}/${batches.length}`);
    console.log(`   Comments: ${batch.items.length}, Words: ${batch.wordCount}`);
    
    try {
      // Build prompt
      const commentBlocks = batch.items.map((c: any) => 
        `<comment id="${c.id}">\n${c.content}\n</comment>`
      ).join("\n\n");
      
      const prompt = ENTITY_DISCOVERY_PROMPT.replace("{COMMENTS}", commentBlocks);
      
      // Generate entities
      const response = await ai.generateContent(
        prompt,
        options.debug ? `entities_batch_${batch.number}` : undefined
      );
      
      // Parse response
      const entities = parseEntityResponse(response);
      if (options.debug) {
        await debugSave(`entities_batch_${batch.number}_parsed.json`, entities);
      }
      
      // Save batch result
      withTransaction(db, () => {
        batchStmt.run(
          batch.number,
          batch.wordCount,
          batch.items.length,
          JSON.stringify(entities)
        );
      });
      
      console.log(`   [Batch ${batch.number}] ✅ Processed successfully`);
      return entities;
      
    } catch (error) {
      console.error(`   [Batch ${batch.number}] ❌ Error:`, error);
      throw error;
    }
  }
  
  // Process batches in parallel chunks
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(processBatch));
    batchResults.push(...results);
  }
  
  // Merge if needed
  let finalEntities: EntityTaxonomy;
  
  if (batchResults.length === 1) {
    finalEntities = batchResults[0];
    console.log("\n✅ Single batch - no merging needed");
  } else {
    console.log("\n🔄 Merging entity taxonomies...");
    finalEntities = await mergeEntities(ai, batchResults, options.debug);
  }
  
  // Save entities and annotate comments
  console.log("\n💾 Saving entity taxonomy and annotating comments...");
  await saveAndAnnotateEntities(db, finalEntities, comments);
  
  // Summary
  const entityCount = db.prepare("SELECT COUNT(*) as count FROM entity_taxonomy").get() as { count: number };
  const annotationCount = db.prepare("SELECT COUNT(*) as count FROM comment_entities").get() as { count: number };
  
  console.log("\n✅ Entity discovery complete!");
  console.log(`   Entities: ${entityCount.count}`);
  console.log(`   Annotations: ${annotationCount.count}`);
  
  db.close();
}

// Parse entity discovery response  
function parseEntityResponse(response: string): EntityTaxonomy {
  // The response should be a narrative taxonomy, possibly with a header
  // Look for common markers
  const taxonomyMatch = response.match(/(?:=== ENTITY TAXONOMY ===|ENTITY TAXONOMY:?)\s*([\s\S]+?)(?:===|$)/i);
  
  if (taxonomyMatch) {
    return parseEntityTaxonomy(taxonomyMatch[1].trim());
  }
  
  // Otherwise try to parse the whole response as a taxonomy
  return parseEntityTaxonomy(response.trim());
}

// Merge entity taxonomies
async function mergeEntities(
  ai: AIClient,
  taxonomies: EntityTaxonomy[],
  debug: boolean
): Promise<EntityTaxonomy> {
  let current = taxonomies[0];
  
  for (let i = 1; i < taxonomies.length; i++) {
    console.log(`   Merging ${i}/${taxonomies.length - 1}...`);
    
    const prompt = ENTITY_MERGE_PROMPT
      .replace("{TAXONOMY1}", formatEntityTaxonomy(current))
      .replace("{TAXONOMY2}", formatEntityTaxonomy(taxonomies[i]));
    
    const response = await ai.generateContent(
      prompt,
      debug ? `entities_merge_${i}` : undefined
    );
    
    current = parseEntityResponse(response);
  }
  
  return current;
}

// Format entity taxonomy for prompts
function formatEntityTaxonomy(taxonomy: EntityTaxonomy): string {
  const lines: string[] = [];
  let categoryNum = 1;
  
  for (const [category, entities] of Object.entries(taxonomy)) {
    lines.push(`${categoryNum}. ${category}`);
    
    for (const entity of entities) {
      lines.push(`* ${entity.label}: ${entity.definition}`);
      for (const term of entity.terms) {
        lines.push(`  * "${term}"`);
      }
    }
    
    categoryNum++;
  }
  
  return lines.join("\n");
}

// Save entities and annotate comments
async function saveAndAnnotateEntities(
  db: Database,
  taxonomy: EntityTaxonomy,
  comments: any[]
) {
  const insertEntity = db.prepare(`
    INSERT INTO entity_taxonomy (category, label, definition, terms)
    VALUES (?, ?, ?, ?)
  `);
  
  const insertAnnotation = db.prepare(`
    INSERT OR IGNORE INTO comment_entities (comment_id, category, entity_label)
    VALUES (?, ?, ?)
  `);
  
  // Build search index
  type SearchEntry = {
    category: string;
    label: string;
    regex: RegExp;
  };
  
  const searchIndex: SearchEntry[] = [];
  
  withTransaction(db, () => {
    // Save entities
    for (const [category, entities] of Object.entries(taxonomy)) {
      for (const entity of entities) {
        insertEntity.run(
          category,
          entity.label,
          entity.definition,
          JSON.stringify(entity.terms)
        );
        
        // Build search patterns
        for (const term of entity.terms) {
          searchIndex.push({
            category,
            label: entity.label,
            regex: new RegExp(`\\b${escapeRegex(term)}\\b`, "i")
          });
        }
      }
    }
  });
  
  // Annotate comments
  let annotationCount = 0;
  
  for (const comment of comments) {
    const annotations = new Set<string>();
    
    for (const entry of searchIndex) {
      if (entry.regex.test(comment.content)) {
        const key = `${entry.category}|${entry.label}`;
        if (!annotations.has(key)) {
          annotations.add(key);
          insertAnnotation.run(comment.id, entry.category, entry.label);
          annotationCount++;
        }
      }
    }
    
    if (annotations.size > 0) {
      process.stdout.write(`\r💡 Annotated ${annotationCount} entities...`);
    }
  }
  
  console.log(`\r💡 Created ${annotationCount} entity annotations`);
}

// Escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
