import { Database } from "bun:sqlite";

const db = new Database("dbs/CMS-2025-0050-0031.sqlite");

console.log("=== CHECKING ENTITY TABLES ===");

// Check if entity tables exist and have data
const tables = ['entity_taxonomy', 'comment_entities'];
tables.forEach(tableName => {
  try {
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
    console.log(`${tableName}: ${count.count} records`);
    
    if (count.count > 0) {
      console.log(`\nSample from ${tableName}:`);
      const sample = db.prepare(`SELECT * FROM ${tableName} LIMIT 3`).all();
      console.table(sample);
    }
  } catch (e) {
    console.log(`${tableName}: Table not found or empty`);
  }
});

console.log("\n=== CONDENSED COMMENTS STRUCTURE ===");
try {
  const sample = db.prepare(`
    SELECT comment_id, structured_sections 
    FROM condensed_comments 
    WHERE status = 'completed' 
    LIMIT 2
  `).all();
  
  sample.forEach(comment => {
    console.log(`\n--- ${comment.comment_id} ---`);
    try {
      const parsed = JSON.parse(comment.structured_sections);
      console.log("Available fields:", Object.keys(parsed));
      console.log("Sample content preview:", JSON.stringify(parsed, null, 2).substring(0, 300) + "...");
    } catch (e) {
      console.log("Could not parse structured sections");
    }
  });
} catch (e) {
  console.log("Error checking condensed comments:", e.message);
}

db.close();
