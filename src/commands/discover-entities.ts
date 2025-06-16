import { Command } from "commander";
import { openDb, withTransaction } from "../lib/database";
import type { Database } from "bun:sqlite";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { loadCondensedComments, parseEntityTaxonomy } from "../lib/comment-processing";
import { createEvenBatches, DEFAULT_BATCH_OPTIONS } from "../lib/batch-processor";
import { ENTITY_DISCOVERY_PROMPT, ENTITY_MERGE_PROMPT } from "../prompts/entity-discovery";
import type { EntityTaxonomy } from "../types";
import { runPool } from "../lib/worker-pool";

export const discoverEntitiesCommand = new Command("discover-entities")
  .description("Discover named entities from condensed comments")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-l, --limit <n>", "Process only N comments", parseInt)
  .option("--batch-limit <n>", "Word limit to trigger batching (default: 200000)", parseInt)
  .option("--batch-size <n>", "Target words per batch (default: 150000)", parseInt)
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel batch API calls (default: 3)", parseInt)
  .action(discoverEntities);

async function discoverEntities(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  const ai = new AIClient();
  
  console.log(`🔍 Discovering entities for document ${documentId}`);
  
  // Check if entities already exist in the final taxonomy
  const existingEntities = db.prepare("SELECT COUNT(*) as count FROM entity_taxonomy").get() as { count: number };
  if (existingEntities.count > 0) {
    console.log(`⚠️  Entities already discovered (${existingEntities.count} entities)`);
    console.log("   To re-run, clear entity_taxonomy and entity_batches tables first");
    return;
  }
  
  // Check for existing batches
  const existingBatches = db.prepare(`
    SELECT batch_number, word_count, comment_count, entities_json 
    FROM entity_batches 
    ORDER BY batch_number
  `).all() as {
    batch_number: number;
    word_count: number;
    comment_count: number;
    entities_json: string;
  }[];
  
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
  
  // Check if we have any existing batch results
  let batchResults: EntityTaxonomy[] = [];
  let processedBatchNumbers = new Set<number>();
  
  if (existingBatches.length > 0) {
    console.log(`🔄 Found ${existingBatches.length} existing batch results`);
    
    // Load existing batch results
    for (const batch of existingBatches) {
      try {
        const entities = JSON.parse(batch.entities_json);
        batchResults.push(entities);
        processedBatchNumbers.add(batch.batch_number);
      } catch (error) {
        console.error(`   Error loading batch ${batch.batch_number}:`, error);
      }
    }
    
    console.log(`   Successfully loaded ${batchResults.length} batch results`);
  }
  
  // Filter out already processed batches
  const batchesToProcess = batches.filter(batch => !processedBatchNumbers.has(batch.number));
  
  if (batchesToProcess.length > 0) {
    console.log(`📦 ${batchesToProcess.length} batches remaining to process`);
    
    const concurrency = options.concurrency || 3;
    
    // Prepare batch statement outside of parallel processing
    const batchStmt = db.prepare(`
      INSERT INTO entity_batches (batch_number, word_count, comment_count, entities_json)
      VALUES (?, ?, ?, ?)
    `);
    
    // Use worker pool for parallel processing of remaining batches
    await runPool(
      batchesToProcess,
      concurrency,
      async (batch, index, total) => {
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
          batchResults.push(entities);
          
        } catch (error) {
          console.error(`   [Batch ${batch.number}] ❌ Error:`, error);
          throw error;
        }
      }
    );
  } else {
    console.log("✅ All batches already processed");
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
  
  // Check if theme summaries exist and add any organizations to the taxonomy
  const themeSummariesExist = (db.prepare("SELECT COUNT(*) as count FROM theme_summaries").get() as { count: number }).count > 0;
  if (themeSummariesExist) {
    console.log("\n🏢 Found existing theme summaries - extracting organizations...");
    finalEntities = await addOrganizationsToTaxonomy(db, finalEntities);
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
  
  // De-duplicate entities within each category before saving
  const deduplicatedTaxonomy: EntityTaxonomy = {};
  
  for (const [category, entities] of Object.entries(taxonomy)) {
    const seenLabels = new Set<string>();
    const uniqueEntities = [];
    
    for (const entity of entities) {
      // Use lowercase for comparison to catch case variations
      const labelKey = entity.label.toLowerCase();
      if (!seenLabels.has(labelKey)) {
        seenLabels.add(labelKey);
        uniqueEntities.push(entity);
      } else {
        console.log(`   Skipping duplicate entity: ${entity.label} in category ${category}`);
      }
    }
    
    if (uniqueEntities.length > 0) {
      deduplicatedTaxonomy[category] = uniqueEntities;
    }
  }
  
  // Build search index
  type SearchEntry = {
    category: string;
    label: string;
    regex: RegExp;
  };
  
  const searchIndex: SearchEntry[] = [];
  
  withTransaction(db, () => {
    // Save deduplicated entities
    for (const [category, entities] of Object.entries(deduplicatedTaxonomy)) {
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

// Add organizations from theme summaries to the taxonomy
async function addOrganizationsToTaxonomy(
  db: Database,
  existingTaxonomy: EntityTaxonomy
): Promise<EntityTaxonomy> {
  // Get all theme summaries
  const summaries = db.prepare(`
    SELECT theme_code, structured_sections 
    FROM theme_summaries
  `).all() as { theme_code: string; structured_sections: string }[];
  
  // Extract all unique organizations
  const organizationsFound = new Set<string>();
  
  for (const summary of summaries) {
    try {
      const sections = JSON.parse(summary.structured_sections);
      
      // Check consensus points
      if (sections.consensusPoints) {
        for (const point of sections.consensusPoints) {
          if (point.organizations && Array.isArray(point.organizations)) {
            point.organizations.forEach((org: string) => organizationsFound.add(org));
          }
        }
      }
      
      // Check areas of debate
      if (sections.areasOfDebate) {
        for (const debate of sections.areasOfDebate) {
          if (debate.positions) {
            for (const position of debate.positions) {
              if (position.organizations && Array.isArray(position.organizations)) {
                position.organizations.forEach((org: string) => organizationsFound.add(org));
              }
            }
          }
        }
      }
      
      // Check stakeholder perspectives
      if (sections.stakeholderPerspectives) {
        for (const stakeholder of sections.stakeholderPerspectives) {
          if (stakeholder.organizations && Array.isArray(stakeholder.organizations)) {
            stakeholder.organizations.forEach((org: string) => organizationsFound.add(org));
          }
        }
      }
    } catch (error) {
      console.error(`   Error parsing theme summary ${summary.theme_code}:`, error);
    }
  }
  
  console.log(`   Found ${organizationsFound.size} unique organizations in theme summaries`);
  
  // Find which existing category has the most organizations
  const categoryMatches: Record<string, number> = {};
  const existingOrgs = new Set<string>();
  
  for (const [category, entities] of Object.entries(existingTaxonomy)) {
    let matchCount = 0;
    for (const entity of entities) {
      // Check if any term matches an organization we found
      for (const term of entity.terms) {
        if (organizationsFound.has(term)) {
          matchCount++;
          existingOrgs.add(term);
          break;
        }
      }
    }
    categoryMatches[category] = matchCount;
  }
  
  // Find the category with most matches
  let bestCategory = "Organizations"; // Default
  let maxMatches = 0;
  
  for (const [category, count] of Object.entries(categoryMatches)) {
    if (count > maxMatches) {
      maxMatches = count;
      bestCategory = category;
    }
  }
  
  console.log(`   Best matching category: "${bestCategory}" (${maxMatches} matches)`);
  
  // Find organizations not already in entities
  const newOrgs = Array.from(organizationsFound).filter(org => !existingOrgs.has(org));
  
  if (newOrgs.length === 0) {
    console.log("   All organizations already exist in entity taxonomy");
    return existingTaxonomy;
  }
  
  console.log(`   Adding ${newOrgs.length} new organizations to "${bestCategory}" category`);
  
  // Add new organizations to the existing taxonomy
  const updatedTaxonomy = { ...existingTaxonomy };
  
  // Ensure the category exists
  if (!updatedTaxonomy[bestCategory]) {
    updatedTaxonomy[bestCategory] = [];
  }
  
  // Add the new organizations
  const newOrgEntities = newOrgs.map(org => ({
    label: org,
    definition: `Organization mentioned in theme summaries`,
    terms: [org]
  }));
  
  updatedTaxonomy[bestCategory] = [...updatedTaxonomy[bestCategory], ...newOrgEntities];
  
  return updatedTaxonomy;
}
