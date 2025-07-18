import { Command } from "commander";
import { openDb, withTransaction } from "../lib/database";
import type { Database } from "bun:sqlite";
import { initDebug, debugSave } from "../lib/debug";
import { AIClient } from "../lib/ai-client";
import { loadCondensedComments } from "../lib/comment-processing";
import { THEME_SCORING_PROMPT } from "../prompts/theme-scoring";
import { parseJsonResponse } from "../lib/json-parser";
import { getTaskConfig, getTaskModel } from "../lib/batch-config";

export const scoreThemesCommand = new Command("score-themes")
  .description("Score comments against the theme hierarchy")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-l, --limit <n>", "Process only N comments", parseInt)
  .option("--retry-failed", "Retry previously failed comments")
  .option("-d, --debug", "Enable debug output")
  .option("-c, --concurrency <n>", "Number of parallel API calls (default: 5)", parseInt)
  .option("-m, --model <model>", "AI model to use (overrides config)")
  .action(scoreThemes);

async function scoreThemes(documentId: string, options: any) {
  await initDebug(options.debug);
  
  const db = openDb(documentId);
  
  // Get the effective model from config
  const effectiveModel = getTaskModel('scoreThemes', options.model);
  const ai = new AIClient(effectiveModel);
  
  console.log(`🎯 Scoring comments against themes for document ${documentId}`);
  console.log(`   Using model: ${effectiveModel}`);
  
  // Load theme hierarchy
  const themes = db.prepare("SELECT code, description, detailed_guidelines FROM theme_hierarchy ORDER BY code").all() as { code: string; description: string; detailed_guidelines?: string }[];
  if (themes.length === 0) {
    console.log("❌ No theme hierarchy found. Run 'discover-themes' first.");
    return;
  }
  console.log(`📊 Loaded ${themes.length} themes`);
  
  // Build hierarchy text for prompt
  const hierarchyText = themes.map(t => {
    const fullDescription = t.detailed_guidelines 
      ? `${t.description}. ${t.detailed_guidelines}`
      : t.description;
    return `${t.code}. ${fullDescription}`;
  }).join("\n");
  const themeCount = themes.length;
  
  // Get processing status
  const status = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN s.status IS NULL OR s.status IN ('pending', 'processing') THEN 1 ELSE 0 END) as pending
    FROM condensed_comments cc
    LEFT JOIN theme_scoring_status s ON cc.comment_id = s.comment_id
    WHERE cc.status = 'completed'
  `).get() as any;
  
  console.log(`📊 Status: ${status.completed} completed, ${status.failed} failed, ${status.pending} pending`);
  
  // Build query based on options
  let query: string;
  let params: any[] = [];
  
  if (options.retryFailed) {
    query = `
      SELECT cc.comment_id, cc.structured_sections 
      FROM condensed_comments cc
      JOIN theme_scoring_status s ON cc.comment_id = s.comment_id
      WHERE cc.status = 'completed' AND s.status = 'failed'
      ORDER BY s.attempt_count ASC, cc.comment_id
    `;
  } else {
    query = `
      SELECT cc.comment_id, cc.structured_sections 
      FROM condensed_comments cc
      LEFT JOIN theme_scoring_status s ON cc.comment_id = s.comment_id
      WHERE cc.status = 'completed' 
        AND (s.comment_id IS NULL OR s.status IN ('pending', 'processing'))
      ORDER BY cc.comment_id
    `;
  }
  
  if (options.limit) {
    query += " LIMIT ?";
    params.push(options.limit);
  }
  
  const comments = db.prepare(query).all(...params) as { comment_id: string; structured_sections: string }[];
  console.log(`🎯 Found ${comments.length} comments to process`);
  
  if (comments.length === 0) {
    console.log("✅ No comments to process");
    return;
  }
  
  // Prepare statements
  const markProcessing = db.prepare(`
    INSERT INTO theme_scoring_status (comment_id, status)
    VALUES (?, 'processing')
    ON CONFLICT(comment_id) DO UPDATE SET 
      status = 'processing',
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  const markCompleted = db.prepare(`
    UPDATE theme_scoring_status 
    SET status = 'completed', error_message = NULL
    WHERE comment_id = ?
  `);
  
  const markFailed = db.prepare(`
    INSERT INTO theme_scoring_status (comment_id, status, error_message, attempt_count)
    VALUES (?, 'failed', ?, 1)
    ON CONFLICT(comment_id) DO UPDATE SET 
      status = 'failed',
      error_message = excluded.error_message,
      attempt_count = attempt_count + 1,
      last_attempt_at = CURRENT_TIMESTAMP
  `);
  
  const insertScore = db.prepare(`
    INSERT OR REPLACE INTO comment_themes (comment_id, theme_code, score)
    VALUES (?, ?, ?)
  `);
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  
  const taskConfig = getTaskConfig('scoreThemes', options.model);
  const concurrency = options.concurrency || taskConfig.concurrency;
  
  // Create a queue of comments
  const queue = [...comments];
  const activeWorkers = new Set<string>();
  
  // Process a single comment
  async function processComment(comment: { comment_id: string; structured_sections: string }): Promise<void> {
    const localProcessed = ++processed;
    console.log(`\n[${localProcessed}/${comments.length}] Processing comment ${comment.comment_id} (${activeWorkers.size} workers active)`);
    
    try {
      // Mark as processing
      markProcessing.run(comment.comment_id);
      
      // Parse structured sections and use detailedContent
      const sections = JSON.parse(comment.structured_sections || '{}');
      const commentText = sections.detailedContent || JSON.stringify(sections);
      
      // Build prompt
      const prompt = THEME_SCORING_PROMPT
        .replace("{THEME_HIERARCHY}", hierarchyText)
        .replace("{THEME_COUNT}", themeCount.toString())
        .replace("{COMMENT}", commentText);
      
      // Get scores from LLM
      const scores = await ai.generateContent<Record<string, number>>(
        prompt,
        options.debug ? `score_themes_${comment.comment_id}` : undefined,
        undefined,  // jobId
        undefined,  // metadata
        parseJsonResponse  // postProcess function
      );
      
      // Validate scores
      const validScores = Object.entries(scores).filter(([_, score]) => score === 1 || score === 2 || score === 3);
      const totalThemes = themeCount;
      const scoredThemes = validScores.length;
      
      const GRACE = taskConfig.validation?.scoringGrace || 5;
      // Check if we got exactly the right number of scores
      if (scoredThemes < totalThemes - GRACE) {
        throw new Error(`Expected at least ${totalThemes-GRACE} theme scores, but got ${scoredThemes}. Missing themes: ${themes.map(t => t.code).filter(code => !(code in scores)).join(', ')}`);
      }
      
      // Validate all theme codes exist
      const missingThemes = themes.filter(t => !(t.code in scores));
      if (missingThemes.length > 0) {
        throw new Error(`Missing scores for themes: ${missingThemes.map(t => t.code).join(', ')}`);
      }
      
      // Count by score type
      const scoreBreakdown = { 1: 0, 2: 0, 3: 0 };
      for (const [_, score] of validScores) {
        scoreBreakdown[score as 1 | 2 | 3]++;
      }
      
      // Validate and save scores
      withTransaction(db, () => {
        // Clear any existing scores for this comment
        db.prepare("DELETE FROM comment_themes WHERE comment_id = ?").run(comment.comment_id);
        
        // Insert new scores
        for (const [themeCode, score] of validScores) {
          insertScore.run(comment.comment_id, themeCode, score);
        }
        
        markCompleted.run(comment.comment_id);
      });
      
      successful++;
      console.log(`  [${comment.comment_id}] ✅ Scored successfully (${totalThemes} themes: ${scoreBreakdown[1]} direct, ${scoreBreakdown[2]} touches, ${scoreBreakdown[3]} not addressed)`);
      
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  [${comment.comment_id}] ❌ Error: ${errorMsg}`);
      
      markFailed.run(comment.comment_id, errorMsg);
    }
  }
  
  // Worker function continuously processes comments from the queue
  async function worker(workerId: string): Promise<void> {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      activeWorkers.add(workerId);
      await processComment(next);
      activeWorkers.delete(workerId);
    }
  }
  
  // Start workers
  const workers = Array.from({ length: concurrency }, (_, i) => worker(`worker-${i + 1}`));
  
  // Wait for all workers
  await Promise.all(workers);
  
  // Final summary
  console.log("\n📊 Theme scoring complete:");
  console.log(`  ✅ Successful: ${successful}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📄 Total processed: ${processed}`);
  
  // Show theme coverage
  const coverage = db.prepare(`
    SELECT 
      t.code,
      t.description,
      COUNT(DISTINCT ct.comment_id) as comment_count,
      SUM(CASE WHEN ct.score = 1 THEN 1 ELSE 0 END) as direct_count,
      SUM(CASE WHEN ct.score = 2 THEN 1 ELSE 0 END) as touch_count,
      SUM(CASE WHEN ct.score = 3 THEN 1 ELSE 0 END) as not_addressed_count
    FROM theme_hierarchy t
    LEFT JOIN comment_themes ct ON t.code = ct.theme_code
    GROUP BY t.code
    ORDER BY (direct_count + touch_count) DESC
    LIMIT 10
  `).all() as any[];
  
  console.log("\n📈 Top themes by relevance (direct + touches):");
  for (const theme of coverage) {
    const relevant = theme.direct_count + theme.touch_count;
    console.log(`  ${theme.code}: ${relevant} relevant comments (${theme.direct_count} direct, ${theme.touch_count} touches, ${theme.not_addressed_count} not addressed)`);
  }
  
  db.close();
} 