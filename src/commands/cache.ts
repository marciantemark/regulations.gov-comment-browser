import { Command } from "commander";
import { openDb } from "../lib/database";
import { getCacheStats, getCacheSize, clearCache, clearAllCache, clearOldCache } from "../lib/cache-utils";

export const cacheCommand = new Command("cache")
  .description("Manage the LLM cache");

// Cache stats subcommand
cacheCommand
  .command("stats")
  .description("Show cache statistics")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .action((documentId) => {
    const db = openDb(documentId);
    const { stats, total } = getCacheStats(db);
    
    console.log(`📊 Cache Statistics for ${documentId}`);
    console.log(`   Total entries: ${total}`);
    
    const size = getCacheSize(db);
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    console.log(`   Total size: ${sizeMB} MB`);
    
    if (stats.length > 0) {
      console.log("\n   By task type:");
      for (const stat of stats) {
        console.log(`   - ${stat.task_type} (level ${stat.task_level}): ${stat.count} entries`);
        console.log(`     Oldest: ${new Date(stat.oldest).toLocaleDateString()}`);
        console.log(`     Newest: ${new Date(stat.newest).toLocaleDateString()}`);
      }
    }
    
    db.close();
  });

// Cache clear subcommand
cacheCommand
  .command("clear")
  .description("Clear cache entries")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("--task-type <type>", "Clear only specific task type")
  .option("--level <n>", "Clear only specific level", parseInt)
  .option("--all", "Clear all cache entries")
  .option("--old <days>", "Clear entries older than N days", parseInt)
  .action((documentId, options) => {
    const db = openDb(documentId);
    
    if (options.old) {
      clearOldCache(db, options.old);
    } else if (options.all) {
      clearAllCache(db);
    } else if (options.taskType) {
      clearCache(db, options.taskType, options.level);
    } else {
      console.log("❌ Please specify --all, --task-type, or --old");
    }
    
    db.close();
  });

// Cache verify subcommand  
cacheCommand
  .command("verify")
  .description("Verify cache integrity")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .action((documentId) => {
    const db = openDb(documentId);
    
    try {
      // Check for any entries with null or empty results
      const invalidEntries = db.prepare(`
        SELECT COUNT(*) as count 
        FROM llm_cache 
        WHERE result IS NULL OR result = ''
      `).get() as { count: number };
      
      if (invalidEntries.count > 0) {
        console.log(`⚠️  Found ${invalidEntries.count} invalid cache entries`);
      } else {
        console.log("✅ All cache entries are valid");
      }
      
      // Check for duplicate prompt hashes (should be impossible)
      const duplicates = db.prepare(`
        SELECT prompt_hash, COUNT(*) as count
        FROM llm_cache
        GROUP BY prompt_hash
        HAVING count > 1
      `).all() as Array<{ prompt_hash: string; count: number }>;
      
      if (duplicates.length > 0) {
        console.log(`❌ Found ${duplicates.length} duplicate prompt hashes!`);
      } else {
        console.log("✅ No duplicate entries found");
      }
      
    } catch (error) {
      console.error("❌ Error verifying cache:", error);
    }
    
    db.close();
  });