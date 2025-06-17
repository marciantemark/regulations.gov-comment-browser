import { Command } from "commander";
import { openDb, withTransaction } from "../lib/database";
import type { Database } from "bun:sqlite";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { createEvenBatches, DEFAULT_BATCH_OPTIONS } from "../lib/batch-processor";
import { THEME_SUMMARY_PROMPT, THEME_SUMMARY_MERGE_PROMPT, THEME_SUMMARY_STRUCTURE_PROMPT } from "../prompts/theme-summary";
import { parseJsonResponse } from "../lib/json-parser";
import { runPool } from "../lib/worker-pool";

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
  .action(summarizeThemes);

async function summarizeThemes(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  const ai = new AIClient();
  
  console.log(`📝 Summarizing themes for document ${documentId}`);
  
  // Get themes to analyze
  const maxDepth = options.depth || 2;
  
  // Build depth filter - e.g. for depth 2, match codes like "1", "1.1", but not "1.1.1"
  const depthFilter = `LENGTH(th.code) - LENGTH(REPLACE(th.code, '.', '')) < ?`;
  
  let themeQuery = `
    SELECT 
      th.code,
      th.description,
      COUNT(DISTINCT ct.comment_id) as comment_count
    FROM theme_hierarchy th
    LEFT JOIN comment_themes ct ON th.code = ct.theme_code AND ct.score IN (1, 2)
    WHERE ${depthFilter}
    GROUP BY th.code
    HAVING comment_count >= ?
  `;
  
  const minComments = options.minComments || 5;
  const queryParams: any[] = [maxDepth, minComments];
  
  if (options.themes) {
    const themeCodes = options.themes.split(',').map((t: string) => t.trim());
    const placeholders = themeCodes.map(() => '?').join(',');
    themeQuery += ` AND th.code IN (${placeholders})`;
    queryParams.push(...themeCodes);
  }
  
  themeQuery += ` ORDER BY comment_count DESC`;
  
  const themes = db.prepare(themeQuery).all(...queryParams) as {
    code: string;
    description: string;
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
  
  // Process themes using worker pool
  const concurrency = options.concurrency || 3;
  
  await runPool(
    themesToProcess,
    concurrency,
    async (theme, index, total) => {
      console.log(`\n[${index}/${total}] Processing theme ${theme.code}: ${theme.description}`);
      console.log(`   Comments: ${theme.comment_count}`);
      
      try {
      // Get comments for this theme with structured sections
      const comments = db.prepare(`
        SELECT DISTINCT
          cc.comment_id,
          cc.structured_sections,
          ct.score
        FROM comment_themes ct
        JOIN condensed_comments cc ON ct.comment_id = cc.comment_id
        WHERE ct.theme_code = ? AND ct.score IN (1, 2)
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
      const batchOptions = {
        totalWordLimit: options.batchLimit || 150000,
        batchWordLimit: options.batchSize || 75000
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
          db, ai, theme, comments, batchOptions, options.debug
        );
      }
      
      // Structure the final summary into JSON
      console.log(`   Structuring final summary...`);
      const structurePrompt = THEME_SUMMARY_STRUCTURE_PROMPT
        .replace('{THEME_ANALYSIS}', finalSummaryText);
      
      await debugSave(
        `theme_summary_structured_${theme.code}_final_prompt.txt`, 
        structurePrompt
      );

      const structuredResponse = await ai.generateContent(
        structurePrompt,
        options.debug ? `theme_summary_structured_${theme.code}_final_response` : undefined
      );
      
      let finalSections: any;
      try {
        finalSections = parseJsonResponse(structuredResponse);
      } catch (error) {
        console.error(`Failed to parse structured response for theme ${theme.code}:`, error);
        throw error;
      }
      
      // Save summary
      withTransaction(db, () => {
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
      });
      
        console.log(`   [${theme.code}] ✅ Summary generated successfully`);
        
      } catch (error) {
        console.error(`   [${theme.code}] ❌ Error:`, error);
        throw error;
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
  theme: { code: string; description: string },
  comments: any[],
  debug: boolean,
  batchNum?: number,
  totalBatches?: number
): Promise<string> {
  // Build comment blocks with relevant structured sections
  const commentBlocks = comments.map(c => {
    const sections = JSON.parse(c.structured_sections || '{}');
    
    let block = `<comment id="${c.comment_id}" relevance="${c.score === 1 ? 'direct' : 'touches'}">`;
    
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
  
  const prompt = THEME_SUMMARY_PROMPT
    .replace('{THEME_CODE}', theme.code)
    .replace('{THEME_DESCRIPTION}', theme.description)
    .replace('{COMMENTS}', commentBlocks);
  
  const debugId = batchNum 
    ? `theme_summary_${theme.code}_batch_${batchNum}-of-${totalBatches}` 
    : `theme_summary_${theme.code}`;

  const response = await ai.generateContent(
    prompt,
    debug ? debugId : undefined
  );
  
  return response;
}

// Process large theme in batches
async function processThemeInBatches(
  db: Database,
  ai: AIClient,
  theme: { code: string; description: string },
  comments: any[],
  batchOptions: any,
  debug: boolean
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
  });
  
  console.log(`   Split into ${batches.length} batches`);
  
  const summaries: string[] = [];
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`   Processing batch ${i + 1}/${batches.length} (${batch.items.length} comments)`);
    const summary = await generateThemeSummary(ai, theme, batch.items, debug, i + 1, batches.length);
    summaries.push(summary);
  }
  
  // Merge summaries
  let currentSummary = summaries[0];
  if (summaries.length > 1) {
    for (let i = 1; i < summaries.length; i++) {
      console.log(`   Merging batch ${i + 1} into main summary`);
      const mergePrompt = THEME_SUMMARY_MERGE_PROMPT
        .replace('{SUMMARY1}', currentSummary)
        .replace('{SUMMARY2}', summaries[i]);
      
      currentSummary = await ai.generateContent(
        mergePrompt,
        debug ? `theme_summary_merge_${theme.code}_${i + 1}` : undefined
      );
    }
  }
  
  return currentSummary;
} 