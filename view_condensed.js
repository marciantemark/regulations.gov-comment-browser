import { Database } from "bun:sqlite";

const db = new Database("dbs/CMS-2025-0050-0031.sqlite");

console.log("=== CONDENSED COMMENTS SAMPLE ===");
const samples = db.prepare(`
  SELECT 
    comment_id, 
    status,
    LENGTH(structured_sections) as content_length,
    SUBSTR(structured_sections, 1, 200) as preview
  FROM condensed_comments 
  WHERE status = 'completed' 
  LIMIT 3
`).all();

samples.forEach((comment, i) => {
  console.log(`\n--- Comment ${i + 1} ---`);
  console.log(`ID: ${comment.comment_id}`);
  console.log(`Content Length: ${comment.content_length} chars`);
  console.log(`Preview: ${comment.preview}...`);
});

db.close();
