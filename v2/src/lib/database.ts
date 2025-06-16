import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import { join } from "path";

export const DB_DIR = "dbs";

// Ensure dbs directory exists
await mkdir(DB_DIR, { recursive: true });

export function getDbPath(documentId: string): string {
  return join(DB_DIR, `${documentId}.sqlite`);
}

export function openDb(documentId: string): Database {
  const path = getDbPath(documentId);
  const db = new Database(path);
  
  // Enable WAL mode for better concurrent access
  db.exec("PRAGMA journal_mode = WAL");
  
  // Initialize schema
  initSchema(db);
  
  // Run migrations
  runMigrations(db);
  
  return db;
}

function runMigrations(db: Database) {
  // Migration 1: Update comment_themes table to allow score 3
  try {
    // Check if we need to migrate by trying to insert a score 3
    const testStmt = db.prepare("INSERT INTO comment_themes (comment_id, theme_code, score) VALUES (?, ?, ?)");
    try {
      testStmt.run("__test__", "__test__", 3);
      // If this succeeds, we already support score 3
      db.prepare("DELETE FROM comment_themes WHERE comment_id = ? AND theme_code = ?").run("__test__", "__test__");
    } catch (e) {
      if (e instanceof Error && e.message.includes("CHECK constraint failed")) {
        console.log("🔄 Migrating database to support score 3...");
        
        // SQLite doesn't support ALTER TABLE to modify constraints, so we need to recreate the table
        db.exec(`
          -- Create new table with updated constraint
          CREATE TABLE comment_themes_new (
            comment_id TEXT NOT NULL,
            theme_code TEXT NOT NULL,
            score INTEGER NOT NULL CHECK(score IN (1, 2, 3)),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (comment_id, theme_code),
            FOREIGN KEY (comment_id) REFERENCES comments(id),
            FOREIGN KEY (theme_code) REFERENCES theme_hierarchy(code)
          );
          
          -- Copy existing data
          INSERT INTO comment_themes_new (comment_id, theme_code, score, created_at)
          SELECT comment_id, theme_code, score, created_at FROM comment_themes;
          
          -- Drop old table and rename new one
          DROP TABLE comment_themes;
          ALTER TABLE comment_themes_new RENAME TO comment_themes;
          
          -- Recreate index if it existed
          CREATE INDEX IF NOT EXISTS idx_comment_themes_comment ON comment_themes(comment_id);
          CREATE INDEX IF NOT EXISTS idx_comment_themes_theme ON comment_themes(theme_code);
        `);
        
        console.log("✅ Database migration completed");
      } else {
        throw e;
      }
    }
  } catch (e) {
    // If table doesn't exist yet, that's fine - it will be created with the correct constraint
    if (!(e instanceof Error && e.message.includes("no such table"))) {
      console.warn("Migration warning:", e);
    }
  }
  
  // Migration 2: Add structured_sections column to condensed_comments
  try {
    // Check if column exists by trying to select it
    db.prepare("SELECT structured_sections FROM condensed_comments LIMIT 1").get();
  } catch (e) {
    if (e instanceof Error && e.message.includes("no such column")) {
      console.log("🔄 Adding structured_sections column to condensed_comments...");
      db.exec("ALTER TABLE condensed_comments ADD COLUMN structured_sections TEXT");
      console.log("✅ Added structured_sections column");
    }
  }
}

export function initSchema(db: Database) {
  db.exec(`
    -- Raw comments from regulations.gov
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      attributes_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Attachments for comments
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT,
      comment_id TEXT NOT NULL,
      format TEXT,
      file_name TEXT,
      url TEXT,
      size INTEGER,
      blob_data BLOB,
      PRIMARY KEY (id, format),
      FOREIGN KEY (comment_id) REFERENCES comments(id)
    );
    
    -- Condensed versions of comments
    CREATE TABLE IF NOT EXISTS condensed_comments (
      comment_id TEXT PRIMARY KEY,
      condensed_text TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      error_message TEXT,
      attempt_count INTEGER DEFAULT 0,
      last_attempt_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (comment_id) REFERENCES comments(id)
    );
    
    -- Theme discovery results (per batch)
    CREATE TABLE IF NOT EXISTS theme_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_number INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      comment_count INTEGER NOT NULL,
      themes_text TEXT NOT NULL,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Merged theme hierarchy
    CREATE TABLE IF NOT EXISTS theme_hierarchy (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      level INTEGER NOT NULL,
      parent_code TEXT,
      quotes_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_code) REFERENCES theme_hierarchy(code)
    );
    
    -- Checkpoint for long-running merge operations in theme discovery
    CREATE TABLE IF NOT EXISTS theme_merge_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      merged_up_to INTEGER NOT NULL,
      merged_text TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Entity discovery results (per batch)
    CREATE TABLE IF NOT EXISTS entity_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_number INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      comment_count INTEGER NOT NULL,
      entities_json TEXT NOT NULL,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Merged entity taxonomy
    CREATE TABLE IF NOT EXISTS entity_taxonomy (
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      definition TEXT,
      terms TEXT NOT NULL, -- JSON array of search terms
      PRIMARY KEY (category, label)
    );
    
    -- Per-comment entity annotations
    CREATE TABLE IF NOT EXISTS comment_entities (
      comment_id TEXT NOT NULL,
      category TEXT NOT NULL,
      entity_label TEXT NOT NULL,
      PRIMARY KEY (comment_id, category, entity_label),
      FOREIGN KEY (comment_id) REFERENCES comments(id),
      FOREIGN KEY (category, entity_label) REFERENCES entity_taxonomy(category, label)
    );
    
    -- Theme analysis results (placeholder for future)
    CREATE TABLE IF NOT EXISTS theme_analysis (
      theme_code TEXT PRIMARY KEY,
      narrative_summary TEXT,
      consensus_points TEXT, -- JSON
      debate_points TEXT, -- JSON
      stakeholder_dynamics TEXT, -- JSON
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (theme_code) REFERENCES theme_hierarchy(code)
    );
    
    -- Theme scoring for comments
    CREATE TABLE IF NOT EXISTS comment_themes (
      comment_id TEXT NOT NULL,
      theme_code TEXT NOT NULL,
      score INTEGER NOT NULL CHECK(score IN (1, 2, 3)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (comment_id, theme_code),
      FOREIGN KEY (comment_id) REFERENCES comments(id),
      FOREIGN KEY (theme_code) REFERENCES theme_hierarchy(code)
    );
    
    -- Processing status for theme scoring
    CREATE TABLE IF NOT EXISTS theme_scoring_status (
      comment_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      error_message TEXT,
      attempt_count INTEGER DEFAULT 0,
      last_attempt_at DATETIME,
      FOREIGN KEY (comment_id) REFERENCES comments(id)
    );
    
    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);
    CREATE INDEX IF NOT EXISTS idx_condensed_status ON condensed_comments(status);
    CREATE INDEX IF NOT EXISTS idx_condensed_attempts ON condensed_comments(attempt_count);
    CREATE INDEX IF NOT EXISTS idx_attachments_comment ON attachments(comment_id);
    CREATE INDEX IF NOT EXISTS idx_comment_themes_comment ON comment_themes(comment_id);
    CREATE INDEX IF NOT EXISTS idx_comment_themes_theme ON comment_themes(theme_code);
  `);
}

// Helper to get processing status
export function getProcessingStatus(db: Database, table: string): {
  total: number;
  completed: number;
  failed: number;
  pending: number;
} {
  const query = `
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status IN ('pending', 'processing') THEN 1 ELSE 0 END) as pending
    FROM ${table}
  `;
  
  return db.prepare(query).get() as any;
}

// Transaction helper
export function withTransaction<T>(db: Database, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}
