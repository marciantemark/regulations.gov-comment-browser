import { Database } from "bun:sqlite";

const db = new Database("dbs/CMS-2025-0050-0031.db");

console.log("=== ALL TABLES IN DATABASE ===");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.table(tables);

console.log("\n=== DATABASE FILE INFO ===");
const fileInfo = db.prepare("PRAGMA table_list").all();
console.table(fileInfo);

db.close();
