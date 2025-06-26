import { Database } from "bun:sqlite";

const db = new Database("dbs/CMS-2025-0050-0031.db");

console.log("=== DATABASE SCHEMA ===");
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='condensed_comments'").get();
console.log(schema?.sql || "Table not found");

console.log("\n=== CONDENSED COMMENTS COUNT ===");
const count = db.prepare("SELECT COUNT(*) as count FROM condensed_comments WHERE status = 'completed'").get();
console.log(`Completed comments: ${count.count}`);

console.log("\n=== SAMPLE DATA ===");
const samples = db.prepare("SELECT comment_id, status, LENGTH(structured_sections) as content_length FROM condensed_comments LIMIT 3").all();
console.table(samples);

db.close();
