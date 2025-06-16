import { Command } from "commander";
import { openDb, withTransaction } from "../lib/database";
import type { Database } from "bun:sqlite";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { loadCondensedComments, parseThemeHierarchy } from "../lib/comment-processing";
import { createEvenBatches, DEFAULT_BATCH_OPTIONS } from "../lib/batch-processor";
import { THEME_DISCOVERY_PROMPT, THEME_MERGE_PROMPT } from "../prompts/theme-discovery";
import type { EnrichedComment } from "../types";

export const discoverThemesCommand = new Command("discover-themes")
  .description("Discover theme hierarchy from condensed comments")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-l, --limit <n>", "Process only N comments", parseInt)
  .option("--batch-limit <n>", "Word limit to trigger batching (default: 250000)", parseInt)
  .option("--batch-size <n>", "Target words per batch (default: 150000)", parseInt)
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel batch API calls (default: 3)", parseInt)
  .action(discoverThemes);

async function discoverThemes(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  const ai = new AIClient();
  
  console.log(`🔍 Discovering themes for document ${documentId}`);
  
  // Check if themes already exist
  const existingThemes = db.prepare("SELECT COUNT(*) as count FROM theme_hierarchy").get() as { count: number };
  if (existingThemes.count > 0) {
    console.log(`⚠️  Themes already discovered (${existingThemes.count} themes in hierarchy)`);
    console.log("   To re-run, clear theme_hierarchy and theme_batches tables first");
    return;
  }
  
  // Load condensed comments
  const comments = loadCondensedComments(db, options.limit);
  if (comments.length === 0) {
    console.log("❌ No condensed comments found. Run 'condense' command first.");
    return;
  }
  
  console.log(`📊 Loaded ${comments.length} condensed comments`);
  
  // Create batches based on word count
  const batchOptions = {
    totalWordLimit: options.batchLimit || DEFAULT_BATCH_OPTIONS.totalWordLimit,
    batchWordLimit: options.batchSize || DEFAULT_BATCH_OPTIONS.batchWordLimit
  };
  
  const batches = createEvenBatches(comments, batchOptions);
  console.log(`📦 Created ${batches.length} batch(es) for processing`);
  
  // Load any previously completed batch results
  const completedBatchRows = db.prepare(`SELECT batch_number, themes_text FROM theme_batches WHERE status = 'completed'`).all() as { batch_number: number; themes_text: string }[];
  const completedMap = new Map<number,string>();
  for (const row of completedBatchRows){
    completedMap.set(row.batch_number, row.themes_text);
  }
  
  // Process each batch
  const batchResults: string[] = [];
  const concurrency = options.concurrency || 3;
  
  // Prepare batch statement outside of parallel processing
  const batchStmt = db.prepare(`
    INSERT INTO theme_batches (batch_number, word_count, comment_count, themes_text)
    VALUES (?, ?, ?, ?)
  `);
  
  async function processBatch(batch: any): Promise<string> {
    console.log(`\n🔄 Processing batch ${batch.number}/${batches.length}`);
    console.log(`   Comments: ${batch.items.length}, Words: ${batch.wordCount}`);
    
    try {
      if (completedMap.has(batch.number)) {
        console.log(`   [Batch ${batch.number}] ✅ Previously completed – skipping`);
        return completedMap.get(batch.number)!;
      }
      
      // Build prompt with structured comment sections
      const commentBlocks = batch.items.map((c: any) => {
        const sections = c.structuredSections;
        const metadata = c.metadata || {};
        
        if (!sections) {
          return `<comment id="${c.id}">
<submitter>${metadata.submitter || 'Anonymous'}</submitter>
<submitter_type>${metadata.submitterType || 'Individual'}</submitter_type>
<note>No structured content available</note>
</comment>`;
        }
        
        let content = `<comment id="${c.id}">
<submitter>${metadata.submitter || 'Anonymous'}</submitter>
<submitter_type>${metadata.submitterType || 'Individual'}</submitter_type>`;
        
        if (sections.commenterProfile) {
          content += `
<commenter_profile>${sections.commenterProfile}</commenter_profile>`;
        }
        
        if (sections.corePosition) {
          content += `
<core_position>${sections.corePosition}</core_position>`;
        }
        
        if (sections.keyRecommendations && sections.keyRecommendations !== "No specific recommendations provided") {
          content += `
<key_recommendations>${sections.keyRecommendations}</key_recommendations>`;
        }
        
        if (sections.mainConcerns && sections.mainConcerns !== "No specific concerns raised") {
          content += `
<main_concerns>${sections.mainConcerns}</main_concerns>`;
        }
        
        content += `
</comment>`;
        
        return content;
      }).join("\n\n");
      
      const prompt = THEME_DISCOVERY_PROMPT.replace("{COMMENTS}", commentBlocks);
      
      // Generate themes
      const response = await ai.generateContent(
        prompt,
        options.debug ? `themes_batch_${batch.number}` : undefined
      );
      
      // Parse response
      const resultText = response.trim();
      if (options.debug) {
        await debugSave(`themes_batch_${batch.number}_text.txt`, resultText);
      }
      
      // Save batch result
      withTransaction(db, () => {
        batchStmt.run(
          batch.number,
          batch.wordCount,
          batch.items.length,
          resultText
        );
      });
      
      console.log(`   [Batch ${batch.number}] ✅ Processed successfully`);
      return resultText;
      
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
  
  // Merge results if multiple batches
  let finalThemesText: string;
  
  // Sort batch results by batch number
  const allBatchTexts: string[] = [];
  const batchNumToIndex = new Map<number, number>();
  
  // Collect all batch texts in order
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    batchNumToIndex.set(batch.number, i);
    if (completedMap.has(batch.number)) {
      allBatchTexts[i] = completedMap.get(batch.number)!;
    } else {
      // Find in batchResults - need to map back
      const newBatchIndex = batches.filter(b => !completedMap.has(b.number)).findIndex(b => b.number === batch.number);
      allBatchTexts[i] = batchResults[newBatchIndex];
    }
  }
  
  if (allBatchTexts.length === 1) {
    finalThemesText = allBatchTexts[0];
    console.log("\n✅ Single batch - no merging needed");
  } else {
    console.log("\n🔄 Merging batch results hierarchically...");
    finalThemesText = await hierarchicalMerge(ai, allBatchTexts, options.debug, concurrency);
  }
  
  // Save final hierarchy only if not already saved
  const existingFinal = db.prepare("SELECT COUNT(*) as count FROM theme_hierarchy").get() as { count:number };
  if (existingFinal.count ===0){
    console.log("\n💾 Saving theme hierarchy...");
    saveThemeHierarchy(db, finalThemesText);
  } else {
    console.log("\n⚠️  Theme hierarchy already exists – skipping save");
  }
  
  // Summary
  const themeCount = db.prepare("SELECT COUNT(*) as count FROM theme_hierarchy").get() as { count: number };
  
  console.log("\n✅ Theme discovery complete!");
  console.log(`   Themes: ${themeCount.count}`);
  
  db.close();
}

// Hierarchical parallel merge
async function hierarchicalMerge(
  ai: AIClient,
  texts: string[],
  debug: boolean,
  concurrency: number
): Promise<string> {
  let currentLevel = [...texts];
  let round = 0;
  
  while (currentLevel.length > 1) {
    round++;
    console.log(`   Round ${round}: Merging ${currentLevel.length} texts into ${Math.ceil(currentLevel.length / 2)}`);
    
    const nextLevel: string[] = [];
    const mergeTasks: Promise<string>[] = [];
    
    // Create merge tasks for pairs
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Merge pair
        const task = (async () => {
          const prompt = THEME_MERGE_PROMPT
            .replace("{TAXONOMY1}", currentLevel[i])
            .replace("{TAXONOMY2}", currentLevel[i + 1]);
          
          const response = await ai.generateContent(
            prompt,
            debug ? `themes_merge_r${round}_p${i/2}` : undefined
          );
          
          console.log(`     ✓ Merged pair ${i/2 + 1}`);
          return response.trim();
        })();
        
        mergeTasks.push(task);
      } else {
        // Odd one out, carry forward
        nextLevel.push(currentLevel[i]);
      }
    }
    
    // Execute merges in parallel batches
    for (let i = 0; i < mergeTasks.length; i += concurrency) {
      const batch = mergeTasks.slice(i, i + concurrency);
      const results = await Promise.all(batch);
      nextLevel.push(...results);
    }
    
    currentLevel = nextLevel;
  }
  
  return currentLevel[0];
}

// Save theme hierarchy to database
function saveThemeHierarchy(db: Database, themesText: string) {
  const themes = parseThemeHierarchy(themesText);
  
  const insertTheme = db.prepare(`
    INSERT INTO theme_hierarchy (code, description, level, parent_code)
    VALUES (?, ?, ?, ?)
  `);
  
  withTransaction(db, () => {
    for (const theme of themes) {
      insertTheme.run(
        theme.code,
        theme.description,
        theme.level,
        theme.parent_code
      );
    }
  });
}
