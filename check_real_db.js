import { Database } from "bun:sqlite";

const db = new Database("dbs/CMS-2025-0050-0031.sqlite");

console.log("=== DATABASE FILE SIZE ===");
const fs = require('fs');
const stats = fs.statSync("dbs/CMS-2025-0050-0031.sqlite");
console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

console.log("\n=== ALL TABLES ===");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.table(tables);

console.log("\n=== COMMENTS COUNT ===");
try {
  const comments = db.prepare("SELECT COUNT(*) as count FROM comments").get();
  console.log(`Total comments: ${comments.count}`);
} catch (e) {
  console.log("No comments table found");
}

console.log("\n=== CONDENSED COMMENTS COUNT ===");
try {
  const condensed = db.prepare("SELECT COUNT(*) as count FROM condensed_comments WHERE status = 'completed'").get();
  console.log(`Condensed comments: ${condensed.count}`);
} catch (e) {
  console.log("No condensed_comments table found");
}

db.close();
