import { openDb, withTransaction } from '../lib/database';
import { loadComments, enrichComment } from '../lib/comment-processing';

// Usage: bun run src/commands/backfill-condensed-wordcount.ts <document-id>

async function main() {
  const documentId = process.argv[2];
  if (!documentId) {
    console.error('Usage: bun run src/commands/backfill-condensed-wordcount.ts <document-id>');
    process.exit(1);
  }
  const db = openDb(documentId);
  const { comments, attachments } = loadComments(db);

  // Map for fast lookup
  const commentMap = new Map(comments.map(c => [c.id, c]));

  // Find all condensed_comments (overwrite all)
  const rows = db.prepare(`
    SELECT comment_id
    FROM condensed_comments
  `).all() as { comment_id: string }[];

  let updated = 0;
  for (const row of rows) {
    const rawComment = commentMap.get(row.comment_id);
    if (!rawComment) {
      console.warn(`No raw comment found for ${row.comment_id}`);
      continue;
    }
    let wordCount = 0;
    try {
      const enriched = await enrichComment(rawComment, attachments, { includePdfs: true });
      if (!enriched) {
        console.warn(`enrichComment returned null for ${row.comment_id}`);
        continue;
      }
      wordCount = enriched.wordCount;
      console.log(wordCount, row.comment_id, enriched.content)
    } catch (e) {
      console.warn(`Failed to enrich for ${row.comment_id}:`, e);
      continue;
    }
    withTransaction(db, () => {
      db.prepare('UPDATE condensed_comments SET word_count = ? WHERE comment_id = ?').run(wordCount, row.comment_id);
    });
    updated++;
    if (updated % 25 === 0) console.log(`Updated ${updated}...`);
  }
  console.log(`Backfilled word_count for ${updated} comments.`);
  db.close();
}

main(); 