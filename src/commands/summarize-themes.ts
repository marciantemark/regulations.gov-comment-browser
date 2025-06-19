import { Command } from "commander";
import { openDb, withTransaction } from "../lib/database";
import type { Database } from "bun:sqlite";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { createEvenBatches, DEFAULT_BATCH_OPTIONS } from "../lib/batch-processor";
import { THEME_SUMMARY_PROMPT, THEME_SUMMARY_MERGE_NWAY_PROMPT, THEME_SUMMARY_STRUCTURE_PROMPT } from "../prompts/theme-summary";
import { parseJsonResponse } from "../lib/json-parser";
import { runPool } from "../lib/worker-pool";
import { TaskQueue, buildHierarchicalTasks } from "../lib/task-queue";
import { getTaskConfig, getBatchOptions, getTaskModel } from "../lib/batch-config";

export const summarizeThemesCommand = new Command("summarize-themes")
  .description("Generate narrative summaries for themes based on relevant comments")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("--themes <codes>", "Comma-separated list of theme codes to analyze (default: all)")
  .option("--min-comments <n>", "Minimum comments required for a theme (default: 5)", parseInt)
  .option("--batch-limit <n>", "Word limit to trigger batching (default: 150000)", parseInt)
  .option("--batch-size <n>", "Target words per batch (default: 75000)", parseInt)
  .option("--depth <n>", "Maximum theme hierarchy depth to summarize (default: 2)", parseInt)
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel API calls (default: 3)", parseInt)
  .option("-m, --model <model>", "AI model to use (overrides config)")
  .option("--merge-width <n>", "Number of summaries to merge at once (default: 10)", parseInt)
  .action(summarizeThemes);

async function summarizeThemes(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  
  // Get the effective model from config
  const effectiveModel = getTaskModel('summarizeThemes', options.model);
  const ai = new AIClient(effectiveModel, db);
  
  console.log(`📝 Summarizing themes for document ${documentId}`);
  console.log(`   Using model: ${effectiveModel}`);
  
  // Load task configuration  
  const taskConfig = getTaskConfig('summarizeThemes', effectiveModel);
  
  // Get themes to analyze
  const maxDepth = options.depth || taskConfig.thresholds?.maxHierarchyDepth || 2;
  const minComments = options.minComments || taskConfig.thresholds?.minCommentsPerTheme || 5;
  
  // Build depth filter - e.g. for depth 2, match codes like "1", "1.1", but not "1.1.1"
  const depthFilter = `th.level <= ?`;
  
  let themeQuery = `
    SELECT 
      th.code,
      th.description,
      th.detailed_guidelines,
      COUNT(DISTINCT ct.comment_id) as comment_count
    FROM theme_hierarchy th
    LEFT JOIN comment_themes ct ON th.code = ct.theme_code AND ct.score = 1
    WHERE ${depthFilter}
    GROUP BY th.code, th.description, th.detailed_guidelines
    HAVING comment_count >= ?
  `;
  const queryParams: any[] = [maxDepth, minComments];
  
  if (options.themes) {
    const themeCodes = options.themes.split(',').map((t: string) => t.trim());
    const placeholders = themeCodes.map(() => '?').join(',');
    themeQuery += ` AND th.code IN (${placeholders})`;
    queryParams.push(...themeCodes);
  }
  
  themeQuery += ` ORDER BY comment_count DESC`;
  console.log(themeQuery, queryParams);
  
  const themes = db.prepare(themeQuery).all(...queryParams) as {
    code: string;
    description: string;
    detailed_guidelines?: string;
    comment_count: number;
  }[];
  
  if (themes.length === 0) {
    console.log("❌ No themes found matching criteria");
    return;
  }
  
  console.log(`📊 Found ${themes.length} themes to analyze`);
  
  // Check for existing summaries
  const existingSummaries = db.prepare("SELECT theme_code FROM theme_summaries").all() as { theme_code: string }[];
  const existingCodes = new Set(existingSummaries.map(s => s.theme_code));
  
  const themesToProcess = themes.filter(t => !existingCodes.has(t.code));
  
  if (themesToProcess.length === 0) {
    console.log("✅ All themes already summarized");
    return;
  }
  
  console.log(`🆕 ${themesToProcess.length} themes need summarization`);
  console.log(`📏 Max depth: ${maxDepth}`);
  
  // Log all themes to process
  console.log(`📋 Themes to process:`);
  themesToProcess.forEach((theme, idx) => {
    console.log(`   ${idx + 1}. ${theme.code}: ${theme.description} (${theme.comment_count} comments)`);
  });
  
  // Check for duplicates in themes to process
  const themeCodeSet = new Set<string>();
  const uniqueThemes = themesToProcess.filter(theme => {
    if (themeCodeSet.has(theme.code)) {
      console.warn(`⚠️  Duplicate theme found in query results: ${theme.code}`);
      return false;
    }
    themeCodeSet.add(theme.code);
    return true;
  });
  
  if (uniqueThemes.length !== themesToProcess.length) {
    console.warn(`⚠️  Removed ${themesToProcess.length - uniqueThemes.length} duplicate themes`);
    console.log(`📋 Unique themes after deduplication:`);
    uniqueThemes.forEach((theme, idx) => {
      console.log(`   ${idx + 1}. ${theme.code}: ${theme.description}`);
    });
  }
  
  // Use task configuration for concurrency
  const concurrency = options.concurrency || taskConfig.concurrency;
  console.log(`🔄 Using concurrency: ${concurrency}`);
  
  await runPool(
    uniqueThemes,
    concurrency,
    async (theme, index, total) => {
      const workerId = `worker-${index}`;
      console.log(`\n[${workerId}][${index}/${total}] Starting to process theme ${theme.code}: ${theme.description}`);
      console.log(`   [${workerId}] Comments: ${theme.comment_count}`);
      console.log(`   [${workerId}] Worker started at: ${new Date().toISOString()}`);
      
      try {
      // Get comments for this theme with structured sections
      const comments = db.prepare(`
        SELECT DISTINCT
          cc.comment_id,
          cc.structured_sections,
          ct.score
        FROM comment_themes ct
        JOIN condensed_comments cc ON ct.comment_id = cc.comment_id
        WHERE ct.theme_code = ? AND ct.score = 1
        ORDER BY ct.score ASC, cc.comment_id
      `).all(theme.code) as {
        comment_id: string;
        structured_sections: string;
        score: number;
      }[];
      
      // Calculate total word count
      const totalWords = comments.reduce((sum, c) => {
        const sections = JSON.parse(c.structured_sections || '{}');
        const relevantText = [
          sections.commenterProfile || '',
          sections.corePosition || '',
          sections.keyRecommendations || '',
          sections.mainConcerns || '',
          sections.keyQuotations || ''
        ].join(' ');
        return sum + relevantText.split(/\s+/).length;
      }, 0);
      
      console.log(`   Total word count: ${totalWords}`);
      
      // Determine if batching is needed
      const batchConfig = getBatchOptions('summarizeThemes');
      const batchOptions = {
        totalWordLimit: options.batchLimit || batchConfig?.triggerWordLimit || 200000,
        batchWordLimit: options.batchSize || batchConfig?.batchWordLimit || 125000
      };
      
      let finalSummaryText: string;
      
      if (totalWords <= batchOptions.totalWordLimit) {
        // Single batch
        console.log(`   Processing as single batch`);
        finalSummaryText = await generateThemeSummary(
          ai, theme, comments, options.debug, 1, 1
        );
      } else {
        // Multiple batches needed
        console.log(`   Large theme - using batching`);
        finalSummaryText = await processThemeInBatches(
          db, ai, theme, comments, batchOptions, 1, options.debug, options.mergeWidth || taskConfig.mergeWidth
        );
      }
      
      // Structure the final summary into JSON
      console.log(`   Structuring final summary...`);
      const fullThemeDescription = theme.detailed_guidelines 
        ? `${theme.description}. ${theme.detailed_guidelines}`
        : theme.description;
        
      const structurePrompt = THEME_SUMMARY_STRUCTURE_PROMPT
        .replace('{THEME_ANALYSIS}', finalSummaryText)
        .replace('{THEME_CODE}', theme.code)
        .replace('{THEME_DESCRIPTION}', fullThemeDescription);
      
      await debugSave(
        `theme_summary_structured_${theme.code}_final_prompt.txt`, 
        structurePrompt
      );

      const finalSections = await ai.generateContent<any>(
        structurePrompt,
        options.debug ? `theme_summary_structured_${theme.code}_final` : undefined,
        undefined,
        {
          taskType: 'theme_summary_structure',
          taskLevel: 0,
          params: {
            themeCode: theme.code,
            commentCount: comments.length,
            wordCount: totalWords
          }
        },
        parseJsonResponse  // postProcess function
      );
      
      // Save summary
      withTransaction(db, () => {
        // Log the write attempt
        console.log(`   📝 [${theme.code}] Attempting to write to theme_summaries (summarize-themes.ts:203)`);
        console.log(`      Caller: runPool worker processing theme ${theme.code}`);
        console.log(`      Comment count: ${comments.length}, Word count: ${totalWords}`);
        
        // Double-check if already exists
        const existing = db.prepare(
          "SELECT theme_code FROM theme_summaries WHERE theme_code = ?"
        ).get(theme.code);
        
        if (existing) {
          console.log(`   [${theme.code}] ⚠️  Theme already exists in database, skipping insert`);
          return;
        }
        
        try {
          db.prepare(`
            INSERT INTO theme_summaries (
              theme_code, structured_sections, 
              comment_count, word_count
            )
            VALUES (?, ?, ?, ?)
          `).run(
            theme.code,
            JSON.stringify(finalSections),
            comments.length,
            totalWords
          );
          console.log(`   ✅ [${theme.code}] Successfully wrote to theme_summaries`);
        } catch (insertError) {
          console.error(`   ❌ [${theme.code}] Failed to write to theme_summaries:`, insertError);
          throw insertError;
        }
      });
      
        console.log(`   [${workerId}][${theme.code}] ✅ Summary generated successfully`);
        console.log(`   [${workerId}] Worker completed at: ${new Date().toISOString()}`);
        
      } catch (error) {
        console.error(`   [${workerId}][${theme.code}] ❌ Error:`, error);
        console.log(`   [${workerId}] Worker failed at: ${new Date().toISOString()}`);
        // Don't rethrow - just log and continue
        // This prevents one theme's failure from affecting others
      }
    }
  );
  
  // Summary
  const summaryCount = db.prepare("SELECT COUNT(*) as count FROM theme_summaries").get() as { count: number };
  
  console.log("\n✅ Theme summarization complete!");
  console.log(`   Total summaries: ${summaryCount.count}`);
  
  db.close();
}

// Generate summary for a single batch of comments
async function generateThemeSummary(
  ai: AIClient,
  theme: { code: string; description: string; detailed_guidelines?: string },
  comments: any[],
  debug: boolean,
  batchNum?: number,
  totalBatches?: number
): Promise<string> {
  // Build comment blocks with relevant structured sections
  const commentBlocks = comments.map(c => {
    const sections = JSON.parse(c.structured_sections || '{}');
    
    let block = `<comment id="${c.comment_id}">`;
    
    if (sections.commenterProfile) {
      block += `\n<commenter_profile>\n${sections.commenterProfile}\n</commenter_profile>`;
    }
    
    if (sections.corePosition) {
      block += `\n<core_position>\n${sections.corePosition}\n</core_position>`;
    }
    
    if (sections.keyRecommendations && sections.keyRecommendations !== "No specific recommendations provided") {
      block += `\n<key_recommendations>\n${sections.keyRecommendations}\n</key_recommendations>`;
    }
    
    if (sections.mainConcerns && sections.mainConcerns !== "No specific concerns raised") {
      block += `\n<main_concerns>\n${sections.mainConcerns}\n</main_concerns>`;
    }
    
    if (sections.notableExperiences && sections.notableExperiences !== "No distinctive experiences shared") {
      block += `\n<notable_experiences>\n${sections.notableExperiences}\n</notable_experiences>`;
    }
    
    if (sections.keyQuotations && sections.keyQuotations !== "No key quotations provided") {
      block += `\n<key_quotations>\n${sections.keyQuotations}\n</key_quotations>`;
    }
    
    block += `\n</comment>`;
    
    return block;
  }).join('\n\n');
  
  // Combine description with detailed guidelines for the prompt
  const fullThemeDescription = theme.detailed_guidelines 
    ? `${theme.description}. ${theme.detailed_guidelines}`
    : theme.description;
    
  const prompt = THEME_SUMMARY_PROMPT
    .replace('{THEME_CODE}', theme.code)
    .replace('{THEME_DESCRIPTION}', fullThemeDescription)
    .replace('{COMMENTS}', commentBlocks);
  
  const debugId = batchNum 
    ? `theme_summary_${theme.code}_batch_${batchNum}-of-${totalBatches}` 
    : `theme_summary_${theme.code}`;

  const response = await ai.generateContent(
    prompt,
    debug ? debugId : undefined,
    undefined,
    {
      taskType: 'theme_summary',
      taskLevel: 0,
      params: {
        themeCode: theme.code,
        batchNum: batchNum || 1,
        totalBatches: totalBatches || 1,
        commentCount: comments.length
      }
    }
  );
  
  return response;
}

// Process large theme in batches
async function processThemeInBatches(
  _db: Database,
  ai: AIClient,
  theme: { code: string; description: string; detailed_guidelines?: string },
  comments: any[],
  batchOptions: any,
  concurrency: number,
  debug: boolean,
  mergeWidth: number = 20
): Promise<string> {
  // Create comment items with word counts
  const items = comments.map(c => {
    const sections = JSON.parse(c.structured_sections || '{}');
    const relevantText = [
      sections.commenterProfile || '',
      sections.corePosition || '',
      sections.keyRecommendations || '',
      sections.mainConcerns || '',
      sections.keyQuotations || ''
    ].join(' ');
    
    return {
      ...c,
      wordCount: relevantText.split(/\s+/).length
    };
  });
  
  // Create batches based on word count
  const batches = createEvenBatches(items, {
    batchWordLimit: batchOptions.batchWordLimit,
    totalWordLimit: 0 // Force batching
  });
  
  console.log(`   Split into ${batches.length} batches`);
  
  if (batches.length === 1) {
    // Single batch - no merging needed
    return await generateThemeSummary(ai, theme, batches[0].items, debug, 1, 1);
  }
  
  if (mergeWidth !== 20) {
    console.log(`   Using ${mergeWidth}-way merges`);
  }
  
  // Build tasks using the hierarchical helper
  const tasks = buildHierarchicalTasks(
    batches,
    (_, i) => `batch_${i}`,
    `summary_${theme.code}`,
    mergeWidth
  );
  
  // Update batch tasks with actual data
  tasks.forEach((task, i) => {
    if (task.data.type === 'initial') {
      task.data = {
        batch: task.data.item,
        batchNum: i + 1,
        totalBatches: batches.length,
        theme
      };
    }
  });
  
  const finalTaskId = tasks[tasks.length - 1].id;
  
  console.log(`   Using hierarchical merging with ${tasks.length} tasks`);
  
  // Process using TaskQueue
  const taskQueue = new TaskQueue(tasks, {
    concurrency,
    onTaskStart: (task) => {
      if (task.id.startsWith('batch_')) {
        console.log(`   🔄 Processing ${task.id}`);
      } else {
        console.log(`   🔄 Merging: ${task.id}`);
      }
    },
    onTaskComplete: (task) => {
      console.log(`   ✅ ${task.id} completed`);
    },
    onTaskError: (task, error) => {
      console.error(`   ❌ ${task.id} failed:`, error);
    }
  });
  
  const results = await taskQueue.process(async (task, getResult) => {
    if (task.id.startsWith('batch_')) {
      // Process batch
      const { batch, batchNum, totalBatches, theme } = task.data;
      return await generateThemeSummary(ai, theme, batch.items, debug, batchNum, totalBatches);
    } else {
      // Merge task - handle N-way merges
      const inputResults = task.data.inputs.map((id: string) => {
        const result = getResult(id);
        if (!result) {
          throw new Error(`Missing dependency ${id} for ${task.id}`);
        }
        return result;
      });
      
      // Check if we need to update the merge prompt for N-way merges
      let prompt: string;

      // Build N-way merge prompt
      const summariesSection = inputResults.map((summary: string, i: number) => 
        `=== SUMMARY ${i + 1} ===\n${summary}\n=== END OF SUMMARY ${i + 1} ===`
      ).join('\n\n');
      
      // Use N-way merge prompt
      const fullThemeDescription = theme.detailed_guidelines 
        ? `${theme.description}. ${theme.detailed_guidelines}`
        : theme.description;
      
      // First create the original prompt with substitutions
      const originalPromptWithSubstitutions = THEME_SUMMARY_PROMPT
        .replace(/{THEME_CODE}/g, theme.code)
        .replace(/{THEME_DESCRIPTION}/g, fullThemeDescription);
        
      prompt = THEME_SUMMARY_MERGE_NWAY_PROMPT
        .replace("{ORIGINAL_PROMPT}", originalPromptWithSubstitutions)
        .replace("{SUMMARIES}", summariesSection);
      
      const response = await ai.generateContent(
        prompt,
        debug ? `theme_summary_merge_${theme.code}_${task.id}` : undefined,
        undefined,
        {
          taskType: `theme_summary_merge`,
          taskLevel: 0,
          params: {
            themeCode: theme.code,
            taskId: task.id,
            inputCount: inputResults.length
          }
        }
      );
      
      return response.trim();
    }
  });
  
  // Get final merged result
  const finalResult = results.get(finalTaskId);
  if (!finalResult) {
    throw new Error("Failed to get final merged summary");
  }
  
  return finalResult;
} 