import { Database } from "bun:sqlite";

const db = new Database("dbs/CMS-2025-0050-0031.sqlite");

console.log("=== ENTITY TAXONOMY SAMPLE ===");
try {
  const entities = db.prepare("SELECT * FROM entity_taxonomy LIMIT 5").all();
  console.table(entities);
} catch (e) {
  console.log("No entity_taxonomy table yet");
}

console.log("\n=== COMMENT ENTITIES SAMPLE ===");
try {
  const commentEntities = db.prepare("SELECT * FROM comment_entities LIMIT 5").all();
  console.table(commentEntities);
} catch (e) {
  console.log("No comment_entities table yet");
}

console.log("\n=== CONDENSED COMMENTS WITH SENTIMENT ===");
const condensed = db.prepare(`
  SELECT 
    comment_id,
    status,
    structured_sections,
    created_at
  FROM condensed_comments 
  WHERE status = 'completed'
  LIMIT 3
`).all();

condensed.forEach(comment => {
  console.log(`\n--- ${comment.comment_id} ---`);
  try {
    const parsed = JSON.parse(comment.structured_sections);
    console.log("Sentiment:", parsed.sentiment || "Not available");
    console.log("Category:", parsed.category || "Not available");
    console.log("Key Points:", parsed.keyPoints || "Not available");
  } catch (e) {
    console.log("Could not parse structured sections");
  }
});

console.log("\n=== SENTIMENT DISTRIBUTION ===");
const sentiments = {};
condensed.forEach(comment => {
  try {
    const parsed = JSON.parse(comment.structured_sections);
    const sentiment = parsed.sentiment || "Unknown";
    sentiments[sentiment] = (sentiments[sentiment] || 0) + 1;
  } catch (e) {
    sentiments["Parse Error"] = (sentiments["Parse Error"] || 0) + 1;
  }
});
console.table(sentiments);

db.close();
