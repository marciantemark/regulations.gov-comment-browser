import { Command } from "commander";
import { openDb, withTransaction, getProcessingStatus } from "../lib/database";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { CONDENSE_PROMPT } from "../prompts/condense";
import { parseCondensedSections } from "../lib/parse-condensed-sections";
import type { RawComment } from "../types";
import { runPool } from "../lib/worker-pool";
import { getTaskConfig, getTaskModel } from "../lib/batch-config";

export const analyzeCommand = new Command("analyze")
  .description("Analyze comment structure using AI (8-section breakdown)")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-l, --limit <n>", "Process only N comments", parseInt)
  .option("--retry-failed", "Retry previously failed comments")
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel API calls (default: 5)", parseInt)
  .option("-m, --model <model>", "AI model to use (overrides config)")
  .action(analyzeComments);

async function analyzeComments(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  
  // Get the effective model from config
  const effectiveModel = getTaskModel('condense', options.model);
  const ai = new AIClient(effectiveModel, db);
  
  console.log(`🧠 Analyzing comments for document ${documentId}`);
  console.log(`   Using model: ${effectiveModel}`);
  
  // Get processing status
  const status = getProcessingStatus(db, "condensed_comments");
  console.log(`📊 Status: ${status.completed} completed, ${status.failed} failed, ${status.pending} pending`);
  
  // Build query based on options - only process comments that have been text-extracted
  let query: string;
  let params: any[] = [];
  
  if (options.retryFailed) {
    query = `
      SELECT c.id, c.attributes_json 
      FROM comments c
      JOIN text_extraction_status tes ON c.id = tes.comment_id
      LEFT JOIN condensed_comments cc ON c.id = cc.comment_id
      WHERE tes.status = 'completed' AND cc.status = 'failed'
      ORDER BY cc.attempt_count ASC, c.id
    `;
  } else {
    query = `
      SELECT c.id, c.attributes_json 
      FROM comments c
      JOIN text_extraction_status tes ON c.id = tes.comment_id
      LEFT JOIN condensed_comments cc ON c.id = cc.comment_id
      WHERE tes.status = 'completed' AND (cc.comment_id IS NULL OR cc.status IN ('pending', 'processing'))
      ORDER BY c.id
    `;
  }
  
  if (options.limit) {
    query += " LIMIT ?";
    params.push(options.limit);
  }
  
  const comments = db.prepare(query).all(...params) as RawComment[];
  console.log(`🎯 Found ${comments.length} comments to process`);
  
  if (comments.length === 0) {
    console.log("✅ No comments to process");
    return;
  }
  
  // Prepare statements
  const insertCondensed = db.prepare(`
    INSERT INTO condensed_comments (comment_id, structured_sections, word_count, status)
    VALUES (?, ?, ?, 'completed')
    ON CONFLICT(comment_id) DO UPDATE SET 
      structured_sections = excluded.structured_sections,
      word_count = excluded.word_count,
      status = 'completed',
      error_message = NULL,
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  const updateFailed = db.prepare(`
    INSERT INTO condensed_comments (comment_id, structured_sections, status, error_message, attempt_count)
    VALUES (?, '{}', 'failed', ?, 1)
    ON CONFLICT(comment_id) DO UPDATE SET 
      status = 'failed',
      error_message = excluded.error_message,
      attempt_count = attempt_count + 1,
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  const markProcessing = db.prepare(`
    INSERT INTO condensed_comments (comment_id, structured_sections, status)
    VALUES (?, '{}', 'processing')
    ON CONFLICT(comment_id) DO UPDATE SET 
      status = 'processing',
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  
  const taskConfig = getTaskConfig('condense', options.model);
  const concurrency = options.concurrency || taskConfig.concurrency;
  
  const activeWorkers = new Set<string>();
  
  // Process a single comment
  async function processComment(comment: any): Promise<void> {
    const localProcessed = ++processed;
    console.log(`\n[${localProcessed}/${comments.length}] Analyzing comment ${comment.id} (${activeWorkers.size} workers active)`);
    
    try {
      // Mark as processing
      markProcessing.run(comment.id);
      
      // Get enriched content from the comment's attributes (added by extract-text)
      const attrs = JSON.parse(comment.attributes_json);
      const enrichedContent = attrs.enrichedContent;
      
      if (!enrichedContent) {
        console.log(`  [${comment.id}] ⚠️  Skipped (no enriched content - run extract-text first)`);
        updateFailed.run(comment.id, "No enriched content found");
        failed++;
        return;
      }
      
      // Build prompt using the pre-extracted content
      const prompt = CONDENSE_PROMPT.replace("{COMMENT_TEXT}", enrichedContent);
      
      // Generate analysis with caching metadata
      const response = await ai.generateContent(
        prompt,
        options.debug ? `analyze_${comment.id}` : undefined,
        `analyze_${comment.id}`,
        {
          taskType: 'condense',
          taskLevel: 0,
          params: { commentId: comment.id }
        }
      );
      
      // Parse the response into sections
      const { sections, errors } = parseCondensedSections(response);
      
      // Log any parsing errors
      if (errors.length > 0) {
        console.warn(`  [${comment.id}] ⚠️  Parsing issues:`);
        errors.forEach(err => console.warn(`    - ${err}`));
      }
      
      // Save result with structured sections
      withTransaction(db, () => {
        insertCondensed.run(
          comment.id, 
          JSON.stringify(sections),
          enrichedContent.trim().split(/\s+/).length
        );
      });
      
      successful++;
      console.log(`  [${comment.id}] ✅ Analyzed successfully${errors.length > 0 ? ' (with warnings)' : ''}`);
      
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  [${comment.id}] ❌ Error: ${errorMsg}`);
      
      updateFailed.run(comment.id, errorMsg);
    }
  }
  
  // Run pool
  await runPool(comments, concurrency, async (comment, index) => {
    activeWorkers.add(comment.id);
    await processComment(comment);
    activeWorkers.delete(comment.id);
  });
  
  // Final summary
  console.log("\n📊 Analysis complete:");
  console.log(`  ✅ Successful: ${successful}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📄 Total processed: ${processed}`);
  
  // Show updated status
  const finalStatus = getProcessingStatus(db, "condensed_comments");
  console.log("\n📈 Overall progress:");
  console.log(`  ✅ Completed: ${finalStatus.completed}`);
  console.log(`  ❌ Failed: ${finalStatus.failed}`);
  console.log(`  ⏳ Remaining: ${finalStatus.pending}`);
  
  db.close();
}