import { Command } from "commander";
import { openDb, withTransaction, getProcessingStatus } from "../lib/database";
import { initDebug } from "../lib/debug";
import { loadComments, enrichComment } from "../lib/comment-processing";
import type { RawComment } from "../types";
import { runPool } from "../lib/worker-pool";

export const extractTextCommand = new Command("extract-text")
  .description("Extract PDF text and append to comment content")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-l, --limit <n>", "Process only N comments", parseInt)
  .option("--retry-failed", "Retry previously failed comments")
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel PDF extractions (default: 10)", parseInt)
  .option("--skip-pdfs", "Skip PDF extraction (text only)")
  .action(extractTextFromComments);

async function extractTextFromComments(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  
  console.log(`📄 Extracting text for document ${documentId}`);
  console.log(`   PDF extraction: ${options.skipPdfs ? 'DISABLED' : 'ENABLED'}`);
  
  // Get processing status
  const status = getProcessingStatus(db, "text_extraction_status");
  console.log(`📊 Status: ${status.completed} completed, ${status.failed} failed, ${status.pending} pending`);
  
  // Build query based on options
  let query: string;
  let params: any[] = [];
  
  if (options.retryFailed) {
    query = `
      SELECT c.id, c.attributes_json 
      FROM comments c
      LEFT JOIN text_extraction_status tes ON c.id = tes.comment_id
      WHERE tes.status = 'failed'
      ORDER BY tes.attempt_count ASC, c.id
    `;
  } else {
    query = `
      SELECT c.id, c.attributes_json 
      FROM comments c
      LEFT JOIN text_extraction_status tes ON c.id = tes.comment_id
      WHERE tes.comment_id IS NULL OR tes.status IN ('pending', 'processing')
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
  
  // Load attachments once
  const { attachments } = loadComments(db);
  
  // Prepare statements
  const updateComment = db.prepare(`
    UPDATE comments 
    SET attributes_json = ?
    WHERE id = ?
  `);
  
  const insertStatus = db.prepare(`
    INSERT INTO text_extraction_status (comment_id, pdf_count, status)
    VALUES (?, ?, 'completed')
    ON CONFLICT(comment_id) DO UPDATE SET 
      pdf_count = excluded.pdf_count,
      status = 'completed',
      error_message = NULL,
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  const updateFailed = db.prepare(`
    INSERT INTO text_extraction_status (comment_id, status, error_message, attempt_count, pdf_count)
    VALUES (?, 'failed', ?, 1, 0)
    ON CONFLICT(comment_id) DO UPDATE SET 
      status = 'failed',
      error_message = excluded.error_message,
      attempt_count = attempt_count + 1,
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  const markProcessing = db.prepare(`
    INSERT INTO text_extraction_status (comment_id, status, pdf_count)
    VALUES (?, 'processing', 0)
    ON CONFLICT(comment_id) DO UPDATE SET 
      status = 'processing',
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  
  const concurrency = options.concurrency || 10;
  
  // Process a single comment
  async function processComment(comment: any): Promise<void> {
    const localProcessed = ++processed;
    console.log(`\n[${localProcessed}/${comments.length}] Extracting text for comment ${comment.id}`);
    
    try {
      // Mark as processing
      markProcessing.run(comment.id);
      
      // Enrich comment with attachments
      const enriched = await enrichComment(comment, attachments, { 
        includePdfs: !options.skipPdfs 
      });
      
      if (!enriched) {
        console.log(`  [${comment.id}] ⚠️  Skipped (empty content)`);
        updateFailed.run(comment.id, "Empty comment content");
        failed++;
        return;
      }
      
      // Count PDFs processed
      const commentAttachments = attachments.get(comment.id) || [];
      const pdfCount = options.skipPdfs ? 0 : commentAttachments.filter(a => 
        a.format.toLowerCase() === "pdf" && a.blob_data
      ).length;
      
      // Update the original comment with enriched content
      const originalAttrs = JSON.parse(comment.attributes_json);
      const updatedAttrs = {
        ...originalAttrs,
        enrichedContent: enriched.content  // Add enriched content as new field
      };
      
      // Save updated comment and status
      withTransaction(db, () => {
        updateComment.run(JSON.stringify(updatedAttrs), comment.id);
        insertStatus.run(comment.id, pdfCount);
      });
      
      successful++;
      const pdfInfo = pdfCount > 0 ? ` (${pdfCount} PDFs)` : '';
      console.log(`  [${comment.id}] ✅ Text extracted successfully${pdfInfo}`);
      
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  [${comment.id}] ❌ Error: ${errorMsg}`);
      
      updateFailed.run(comment.id, errorMsg);
    }
  }
  
  // Run pool
  await runPool(comments, concurrency, processComment);
  
  // Final summary
  console.log("\n📊 Text extraction complete:");
  console.log(`  ✅ Successful: ${successful}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📄 Total processed: ${processed}`);
  
  // Show updated status
  const finalStatus = getProcessingStatus(db, "text_extraction_status");
  console.log("\n📈 Overall progress:");
  console.log(`  ✅ Completed: ${finalStatus.completed}`);
  console.log(`  ❌ Failed: ${finalStatus.failed}`);
  console.log(`  ⏳ Remaining: ${finalStatus.pending}`);
  
  db.close();
}