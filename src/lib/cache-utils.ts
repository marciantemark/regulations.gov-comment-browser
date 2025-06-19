import { Database } from "bun:sqlite";

// Clear cache for specific task type
export function clearCache(db: Database, taskType: string, level?: number) {
  if (level !== undefined) {
    const stmt = db.prepare("DELETE FROM llm_cache WHERE task_type = ? AND task_level = ?");
    const result = stmt.run(taskType, level);
    console.log(`🗑️  Cleared ${result.changes} cached entries for ${taskType} level ${level}`);
  } else {
    const stmt = db.prepare("DELETE FROM llm_cache WHERE task_type = ?");
    const result = stmt.run(taskType);
    console.log(`🗑️  Cleared ${result.changes} cached entries for ${taskType}`);
  }
}

// Clear all cache
export function clearAllCache(db: Database) {
  const stmt = db.prepare("DELETE FROM llm_cache");
  const result = stmt.run();
  console.log(`🗑️  Cleared all ${result.changes} cached entries`);
}

// Get cache statistics
export function getCacheStats(db: Database) {
  const stats = db.prepare(`
    SELECT 
      task_type,
      task_level,
      COUNT(*) as count,
      MIN(created_at) as oldest,
      MAX(created_at) as newest
    FROM llm_cache
    GROUP BY task_type, task_level
    ORDER BY task_type, task_level
  `).all() as Array<{
    task_type: string;
    task_level: number;
    count: number;
    oldest: string;
    newest: string;
  }>;
  
  const total = db.prepare("SELECT COUNT(*) as count FROM llm_cache").get() as { count: number };
  
  return { stats, total: total.count };
}

// Get cache size in bytes
export function getCacheSize(db: Database) {
  const result = db.prepare(`
    SELECT 
      SUM(LENGTH(prompt_hash) + LENGTH(task_type) + LENGTH(task_params) + LENGTH(result) + LENGTH(model)) as total_bytes
    FROM llm_cache
  `).get() as { total_bytes: number | null };
  
  return result.total_bytes || 0;
}

// Clear old cache entries
export function clearOldCache(db: Database, daysOld: number) {
  const stmt = db.prepare(`
    DELETE FROM llm_cache 
    WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
  `);
  const result = stmt.run(daysOld);
  console.log(`🗑️  Cleared ${result.changes} cached entries older than ${daysOld} days`);
}