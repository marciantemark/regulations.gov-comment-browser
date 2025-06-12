-- Complete database schema for taxonomy and position analysis

-- Core tables for document abstraction
CREATE TABLE IF NOT EXISTS abstractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  submitter_type TEXT,
  submitter_type_confidence TEXT CHECK(submitter_type_confidence IN ('Explicit', 'High', 'Medium', 'Low')),
  organization_name TEXT,
  market_segment TEXT,
  stakeholder_category TEXT CHECK(stakeholder_category IN ('Patient', 'Provider', 'Payer', 'Vendor', 'Regulator', 'Other')),
  geographic_scope TEXT,
  technical_sophistication TEXT CHECK(technical_sophistication IN ('High', 'Medium', 'Low')),
  regulatory_stance TEXT,
  primary_themes TEXT, -- Comma-separated theme codes
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

-- Axes of disagreement within themes
CREATE TABLE IF NOT EXISTS theme_axes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_code TEXT NOT NULL,
  axis_name TEXT NOT NULL,
  axis_question TEXT NOT NULL,
  min_perspectives INTEGER DEFAULT 5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (theme_code) REFERENCES taxonomy_ref(code)
);

-- Possible positions on each axis
CREATE TABLE IF NOT EXISTS axis_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  axis_id INTEGER NOT NULL,
  position_key TEXT NOT NULL,
  position_label TEXT NOT NULL,
  position_description TEXT,
  example_count INTEGER DEFAULT 0,
  FOREIGN KEY (axis_id) REFERENCES theme_axes(id) ON DELETE CASCADE
);

-- How each perspective maps to positions
CREATE TABLE IF NOT EXISTS perspective_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  perspective_id INTEGER NOT NULL,
  axis_id INTEGER NOT NULL,
  position_id INTEGER NOT NULL,
  confidence TEXT CHECK(confidence IN ('high', 'medium', 'low')),
  reasoning TEXT,
  FOREIGN KEY (perspective_id) REFERENCES perspectives(id) ON DELETE CASCADE,
  FOREIGN KEY (axis_id) REFERENCES theme_axes(id) ON DELETE CASCADE,
  FOREIGN KEY (position_id) REFERENCES axis_positions(id) ON DELETE CASCADE,
  UNIQUE(perspective_id, axis_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_perspectives_taxonomy ON perspectives(taxonomy_code);
CREATE INDEX IF NOT EXISTS idx_perspectives_abstraction ON perspectives(abstraction_id);
CREATE INDEX IF NOT EXISTS idx_perspective_positions_axis ON perspective_positions(axis_id);
CREATE INDEX IF NOT EXISTS idx_perspective_positions_position ON perspective_positions(position_id);
CREATE INDEX IF NOT EXISTS idx_abstractions_submitter ON abstractions(submitter_type);
CREATE INDEX IF NOT EXISTS idx_abstractions_stakeholder ON abstractions(stakeholder_category);

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

-- Debate summary
CREATE VIEW IF NOT EXISTS debate_summary AS
SELECT 
  ta.theme_code,
  t.description as theme_desc,
  ta.axis_name,
  ta.axis_question,
  COUNT(DISTINCT pp.perspective_id) as total_perspectives,
  COUNT(DISTINCT ap.id) as position_count,
  MAX(ap.example_count) - MIN(ap.example_count) as balance_score
FROM theme_axes ta
JOIN taxonomy_ref t ON ta.theme_code = t.code
JOIN axis_positions ap ON ta.id = ap.axis_id
LEFT JOIN perspective_positions pp ON ap.id = pp.position_id
GROUP BY ta.id;

-- Stakeholder alignment by position
CREATE VIEW IF NOT EXISTS stakeholder_alignment AS
SELECT 
  a.submitter_type,
  ta.theme_code,
  ta.axis_name,
  ap.position_label,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (
    PARTITION BY a.submitter_type, ta.id
  ), 1) as percent
FROM perspective_positions pp
JOIN perspectives p ON pp.perspective_id = p.id
JOIN abstractions a ON p.abstraction_id = a.id
JOIN theme_axes ta ON pp.axis_id = ta.id
JOIN axis_positions ap ON pp.position_id = ap.id
WHERE pp.confidence IN ('high', 'medium')
GROUP BY a.submitter_type, ta.id, ap.id;

-- Position dominance (consensus finder)
CREATE VIEW IF NOT EXISTS position_dominance AS
SELECT 
  ta.theme_code,
  ta.axis_name,
  ap.position_label,
  COUNT(DISTINCT pp.perspective_id) as supporter_count,
  COUNT(DISTINCT a.id) as org_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY ta.id), 1) as percent
FROM perspective_positions pp
JOIN axis_positions ap ON pp.position_id = ap.id
JOIN theme_axes ta ON ap.axis_id = ta.id
JOIN perspectives p ON pp.perspective_id = p.id
JOIN abstractions a ON p.abstraction_id = a.id
GROUP BY ta.id, ap.id;
