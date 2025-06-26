import { Database } from "bun:sqlite";

try {
  const db = new Database("dbs/CMS-2025-0050-0031.db");
  
  console.log("=== DATABASE FILE SIZE ===");
  const fs = require('fs');
  const stats = fs.statSync("dbs/CMS-2025-0050-0031.db");
  console.log(`File size: ${stats.size} bytes`);
  
  console.log("\n=== ALL TABLES ===");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log("Tables found:", tables);
  
  console.log("\n=== ALL OBJECTS IN DATABASE ===");
  const allObjects = db.prepare("SELECT type, name, sql FROM sqlite_master").all();
  console.table(allObjects);
  
  db.close();
} catch (error) {
  console.error("Database error:", error);
}
