-- Complete database schema for taxonomy and position analysis

-- Core tables for document abstraction
CREATE TABLE IF NOT EXISTS abstractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  
  -- Processing status tracking
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
  error_message TEXT, -- Store error details for failed items
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at DATETIME,
  
  -- LLM-generated fields
  submitter_type TEXT,
  submitter_type_confidence TEXT CHECK(submitter_type_confidence IN ('Explicit', 'High', 'Medium', 'Low')),
  organization_name TEXT,
  attributes_json TEXT, -- Store flexible LLM-generated attributes as a JSON string
  primary_themes TEXT, -- Comma-separated theme codes
  
  -- Condensed version of the full comment (bullet-point outline)
  condensed_comment TEXT,
  
  -- Original metadata from regulations.gov as JSON
  original_metadata_json TEXT, -- Store original regulations.gov metadata as JSON
  
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Perspectives extracted from each document
CREATE TABLE IF NOT EXISTS perspectives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abstraction_id INTEGER NOT NULL,
  taxonomy_code TEXT NOT NULL,
  perspective TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  sentiment TEXT,
  FOREIGN KEY (abstraction_id) REFERENCES abstractions(id) ON DELETE CASCADE
);

-- Hierarchical taxonomy reference
CREATE TABLE IF NOT EXISTS taxonomy_ref (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  level INTEGER NOT NULL,
  parent_code TEXT,
  FOREIGN KEY (parent_code) REFERENCES taxonomy_ref(code)
);

-- Discovered attributes from the corpus
CREATE TABLE IF NOT EXISTS observed_attributes (
  attribute_type TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (attribute_type, value)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_perspectives_taxonomy ON perspectives(taxonomy_code);
CREATE INDEX IF NOT EXISTS idx_perspectives_abstraction ON perspectives(abstraction_id);
CREATE INDEX IF NOT EXISTS idx_abstractions_submitter ON abstractions(submitter_type);
-- JSON-based indexes for original metadata
CREATE INDEX IF NOT EXISTS idx_abstractions_original_category ON abstractions(json_extract(original_metadata_json, '$.category'));
CREATE INDEX IF NOT EXISTS idx_abstractions_state ON abstractions(json_extract(original_metadata_json, '$.stateProvinceRegion'));
CREATE INDEX IF NOT EXISTS idx_abstractions_org ON abstractions(json_extract(original_metadata_json, '$.organization'));
CREATE INDEX IF NOT EXISTS idx_abstractions_receive_date ON abstractions(json_extract(original_metadata_json, '$.receiveDate'));
-- Status tracking indexes
CREATE INDEX IF NOT EXISTS idx_abstractions_status ON abstractions(status);
CREATE INDEX IF NOT EXISTS idx_abstractions_attempt_count ON abstractions(attempt_count);

-- Useful views for analysis

-- Theme coverage statistics
CREATE VIEW IF NOT EXISTS theme_coverage AS
SELECT 
  t.code,
  t.description,
  t.level,
  COUNT(DISTINCT p.id) as perspective_count,
  COUNT(DISTINCT p.abstraction_id) as document_count
FROM taxonomy_ref t
LEFT JOIN perspectives p ON t.code = p.taxonomy_code
GROUP BY t.code, t.description, t.level;

-- Theme-level narrative summaries for each taxonomy theme
CREATE TABLE IF NOT EXISTS theme_narratives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_code TEXT NOT NULL UNIQUE,
  narrative_summary TEXT NOT NULL,
  consensus_points TEXT,          -- JSON array
  debate_points TEXT,             -- JSON array
  stakeholder_dynamics TEXT,      -- JSON object as TEXT
  supporting_stats TEXT,          -- JSON object as TEXT
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  model_version TEXT DEFAULT 'v1',
  FOREIGN KEY (theme_code) REFERENCES taxonomy_ref(code)
);

-- Stances/positions defined per theme
CREATE TABLE IF NOT EXISTS theme_stances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_code TEXT NOT NULL,
  stance_key TEXT NOT NULL,
  stance_label TEXT NOT NULL,
  stance_description TEXT,
  typical_arguments TEXT,  -- JSON array
  example_quotes TEXT,     -- JSON array
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(theme_code, stance_key),
  FOREIGN KEY (theme_code) REFERENCES taxonomy_ref(code)
);

-- Mapping of individual perspectives to stances
CREATE TABLE IF NOT EXISTS perspective_stances (
  perspective_id INTEGER NOT NULL,
  theme_code TEXT NOT NULL,
  stance_key TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (perspective_id, stance_key),
  FOREIGN KEY (perspective_id) REFERENCES perspectives(id) ON DELETE CASCADE,
  FOREIGN KEY (theme_code, stance_key) REFERENCES theme_stances(theme_code, stance_key) ON DELETE CASCADE
);

-- Pre-calculated distribution of stances by stakeholder type
CREATE VIEW IF NOT EXISTS stance_distribution AS
SELECT 
  ts.theme_code,
  ts.stance_key,
  ts.stance_label,
  a.submitter_type,
  COUNT(*) AS count,
  GROUP_CONCAT(DISTINCT a.organization_name) AS organizations
FROM theme_stances ts
JOIN perspective_stances ps ON ts.theme_code = ps.theme_code AND ts.stance_key = ps.stance_key
JOIN perspectives p ON ps.perspective_id = p.id
JOIN abstractions a ON p.abstraction_id = a.id
GROUP BY ts.theme_code, ts.stance_key, a.submitter_type;

-- DROP defunct axis disagreement structures (if they exist)
DROP TABLE IF EXISTS theme_axes;
DROP TABLE IF EXISTS axis_positions;
DROP TABLE IF EXISTS perspective_positions;
DROP VIEW IF EXISTS debate_summary;
DROP VIEW IF EXISTS stakeholder_alignment;
DROP VIEW IF EXISTS original_stakeholder_alignment;
DROP VIEW IF EXISTS geographic_alignment;
DROP VIEW IF EXISTS position_dominance;
DROP VIEW IF EXISTS stance_distribution;

-- Raw JSON output for per-theme analysis (narrative + stances, etc.)
CREATE TABLE IF NOT EXISTS theme_analysis_raw (
  theme_code TEXT PRIMARY KEY,
  analysis_json TEXT NOT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Convenience view exposing headline narrative fields
CREATE VIEW IF NOT EXISTS theme_narrative_view AS
SELECT
  theme_code,
  json_extract(analysis_json, '$.narrative_summary')                       AS narrative_summary,
  json_extract(analysis_json, '$.supporting_stats.total_perspectives')    AS total_perspectives,
  json_extract(analysis_json, '$.supporting_stats.total_stakeholders')    AS total_stakeholders
FROM theme_analysis_raw;

-- New table for comments
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,               -- original regulations.gov comment ID
  condensed_comment TEXT NOT NULL,   -- LLM-generated condensed bullet-point version
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Taxonomy of named entities across the corpus
CREATE TABLE IF NOT EXISTS entity_taxonomy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taxonomy_json TEXT NOT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Per-comment entity tags
CREATE TABLE IF NOT EXISTS comment_entities (
  comment_id TEXT NOT NULL,
  category TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  PRIMARY KEY (comment_id, category, entity_label),
  FOREIGN KEY (comment_id) REFERENCES comments(id)
);
