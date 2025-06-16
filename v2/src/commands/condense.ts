import { Command } from "commander";
import { openDb, withTransaction, getProcessingStatus } from "../lib/database";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { loadComments, enrichComment } from "../lib/comment-processing";
import { CONDENSE_PROMPT } from "../prompts/condense";
import { parseCondensedSections } from "../lib/parse-condensed-sections";
import type { RawComment } from "../types";

export const condenseCommand = new Command("condense")
  .description("Generate condensed versions of comments")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-l, --limit <n>", "Process only N comments", parseInt)
  .option("--retry-failed", "Retry previously failed comments")
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel API calls (default: 5)", parseInt)
  .action(condenseComments);

async function condenseComments(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  const ai = new AIClient();
  
  console.log(`📝 Condensing comments for document ${documentId}`);
  
  // Get processing status
  const status = getProcessingStatus(db, "condensed_comments");
  console.log(`📊 Status: ${status.completed} completed, ${status.failed} failed, ${status.pending} pending`);
  
  // Build query based on options
  let query: string;
  let params: any[] = [];
  
  if (options.retryFailed) {
    query = `
      SELECT c.id, c.attributes_json 
      FROM comments c
      LEFT JOIN condensed_comments cc ON c.id = cc.comment_id
      WHERE cc.status = 'failed'
      ORDER BY cc.attempt_count ASC, c.id
    `;
  } else {
    query = `
      SELECT c.id, c.attributes_json 
      FROM comments c
      LEFT JOIN condensed_comments cc ON c.id = cc.comment_id
      WHERE cc.comment_id IS NULL OR cc.status IN ('pending', 'processing')
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
  
  // Load attachments
  const { attachments } = loadComments(db);
  
  // Prepare statements
  const insertCondensed = db.prepare(`
    INSERT INTO condensed_comments (comment_id, condensed_text, structured_sections, status)
    VALUES (?, ?, ?, 'completed')
    ON CONFLICT(comment_id) DO UPDATE SET 
      condensed_text = excluded.condensed_text,
      structured_sections = excluded.structured_sections,
      status = 'completed',
      error_message = NULL,
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  const updateFailed = db.prepare(`
    INSERT INTO condensed_comments (comment_id, condensed_text, status, error_message, attempt_count)
    VALUES (?, '', 'failed', ?, 1)
    ON CONFLICT(comment_id) DO UPDATE SET 
      status = 'failed',
      error_message = excluded.error_message,
      attempt_count = attempt_count + 1,
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  const markProcessing = db.prepare(`
    INSERT INTO condensed_comments (comment_id, condensed_text, status)
    VALUES (?, '', 'processing')
    ON CONFLICT(comment_id) DO UPDATE SET 
      status = 'processing',
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  
  const concurrency = options.concurrency || 5;
  
  // Process comments in parallel batches
  async function processComment(comment: any) {
    const localProcessed = ++processed;
    console.log(`\n[${localProcessed}/${comments.length}] Processing comment ${comment.id}`);
    
    try {
      // Mark as processing
      markProcessing.run(comment.id);
      
      // Enrich comment with attachments
      const enriched = await enrichComment(comment, attachments);
      if (!enriched) {
        console.log(`  [${comment.id}] ⚠️  Skipped (empty content)`);
        updateFailed.run(comment.id, "Empty comment content");
        failed++;
        return;
      }
      
      // Build prompt using the enriched content only (already contains a concise metadata block)
      const prompt = CONDENSE_PROMPT.replace("{COMMENT_TEXT}", enriched.content);
      
      // Generate condensed version
      const response = await ai.generateContent(
        prompt,
        options.debug ? `condense_${comment.id}` : undefined
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
          response,
          JSON.stringify(sections)
        );
      });
      
      successful++;
      console.log(`  [${comment.id}] ✅ Condensed successfully${errors.length > 0 ? ' (with warnings)' : ''}`);
      
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  [${comment.id}] ❌ Error: ${errorMsg}`);
      
      updateFailed.run(comment.id, errorMsg);
    }
  }
  
  // Process in chunks
  for (let i = 0; i < comments.length; i += concurrency) {
    const chunk = comments.slice(i, i + concurrency);
    await Promise.all(chunk.map(processComment));
  }
  
  // Final summary
  console.log("\n📊 Condensing complete:");
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
