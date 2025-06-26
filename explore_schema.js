import { Database } from "bun:sqlite";

const db = new Database("dbs/CMS-2025-0050-0031.sqlite");

console.log("=== ALL TABLES ===");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.table(tables);

console.log("\n=== TABLE SCHEMAS ===");
tables.forEach(table => {
  console.log(`\n--- ${table.name.toUpperCase()} ---`);
  const schema = db.prepare(`PRAGMA table_info(${table.name})`).all();
  console.table(schema);
  
  // Show sample data
  try {
    const sample = db.prepare(`SELECT * FROM ${table.name} LIMIT 2`).all();
    if (sample.length > 0) {
      console.log(`\nSample data from ${table.name}:`);
      console.log(JSON.stringify(sample[0], null, 2));
    }
  } catch (e) {
    console.log(`Could not fetch sample data: ${e.message}`);
  }
});

db.close();
