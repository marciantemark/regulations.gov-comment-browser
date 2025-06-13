import type { Database } from 'sql.js';

export interface DatabaseStats {
  totalComments: number;
  totalPerspectives: number;
  totalThemes: number;
  attributeBreakdowns: Record<string, Array<{ value: string; count: number }>>;
}

export interface Theme {
  code: string;
  description: string;
  level: number;
  parent_code: string | null;
  perspective_count: number;
  document_count: number;
}

export interface Perspective {
  id: number;
  abstraction_id: number;
  taxonomy_code: string;
  perspective: string;
  excerpt: string;
  sentiment: string | null;
  submitter_type: string;
  organization_name: string | null;
  comment_filename: string;
  content_word_count: number;
  original_category?: string;
  original_organization?: string;
  original_firstName?: string;
  original_lastName?: string;
  stakeholder_group?: string;
}

export interface ThemeNarrative {
  theme_code: string;
  narrative_summary: string;
  consensus_points: any[]; // keep flexible
  debate_points: any[];
  stakeholder_dynamics: any;
  supporting_stats: any;
}

export interface ThemeAnalysisRaw {
  narrative_summary?: string;
  consensus_points?: any[];
  debate_points?: any[];
  stakeholder_dynamics?: any;
  supporting_stats?: any;
  stances?: any[];
  perspective_mapping?: any[];
  mapping_notes?: string;
}

// Get overall database statistics
export function getDatabaseStats(db: Database): DatabaseStats {
  const statsResult = db.exec(`
    SELECT 
      (SELECT COUNT(DISTINCT id) FROM abstractions) as total_comments,
      (SELECT COUNT(DISTINCT id) FROM perspectives) as total_perspectives,
      (SELECT COUNT(DISTINCT code) FROM taxonomy_ref) as total_themes
  `)[0];

  const stats = statsResult.values[0];

  // Get all attributes breakdown including submitter_type
  const attributeBreakdowns: Record<string, Array<{ value: string; count: number }>> = {};
  
  // First, get submitter_type breakdown (LLM-detected)
  const submitterTypesResult = db.exec(`
    SELECT submitter_type, COUNT(*) as count 
    FROM abstractions 
    WHERE submitter_type IS NOT NULL
    GROUP BY submitter_type 
    ORDER BY count DESC
  `)[0];
  
  if (submitterTypesResult) {
    attributeBreakdowns['submitter_type'] = submitterTypesResult.values.map(row => ({
      value: row[0] as string,
      count: Number(row[1])
    }));
  }
  
  // Get original category breakdown from regulations.gov
  const originalCategoryResult = db.exec(`
    SELECT 
      json_extract(original_metadata_json, '$.category') as category, 
      COUNT(*) as count 
    FROM abstractions 
    WHERE json_extract(original_metadata_json, '$.category') IS NOT NULL
    GROUP BY json_extract(original_metadata_json, '$.category')
    ORDER BY count DESC
  `)[0];
  
  if (originalCategoryResult) {
    attributeBreakdowns['original_category'] = originalCategoryResult.values.map(row => ({
      value: row[0] as string,
      count: Number(row[1])
    }));
  }
  
  // Then get LLM-abstracted attributes breakdown
  const abstractionsResult = db.exec(`
    SELECT attributes_json FROM abstractions WHERE attributes_json IS NOT NULL
  `)[0];
  
  if (abstractionsResult) {
    const attributeCounts: Record<string, Record<string, number>> = {};
    
    abstractionsResult.values.forEach(row => {
      try {
        const attributes = JSON.parse(row[0] as string);
        Object.entries(attributes).forEach(([key, value]) => {
          // Skip null or empty values
          if (value === null || value === undefined || value === '') return;
          
          if (!attributeCounts[key]) {
            attributeCounts[key] = {};
          }
          // Handle both single values and semicolon-separated values
          const values = String(value).split(';').map(v => v.trim()).filter(v => v && v !== 'null');
          values.forEach(v => {
            attributeCounts[key][v] = (attributeCounts[key][v] || 0) + 1;
          });
        });
      } catch (e) {
        // Skip invalid JSON
      }
    });
    
    // Convert to the expected format and sort by count
    Object.entries(attributeCounts).forEach(([key, valueCounts]) => {
      attributeBreakdowns[key] = Object.entries(valueCounts)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    });
  }

  return {
    totalComments: Number(stats[0]),
    totalPerspectives: Number(stats[1]),
    totalThemes: Number(stats[2]),
    attributeBreakdowns
  };
}

// Get all themes with hierarchy and counts (including descendants)
export function getThemeHierarchy(db: Database): Theme[] {
  const result = db.exec(`
    SELECT 
      t.code,
      t.description,
      t.level,
      t.parent_code,
      (SELECT COUNT(DISTINCT p.id) FROM perspectives p WHERE p.taxonomy_code = t.code OR p.taxonomy_code LIKE t.code || '.%') as perspective_count,
      (SELECT COUNT(DISTINCT p.abstraction_id) FROM perspectives p WHERE p.taxonomy_code = t.code OR p.taxonomy_code LIKE t.code || '.%') as document_count
    FROM taxonomy_ref t
    GROUP BY t.code, t.description, t.level, t.parent_code
    ORDER BY t.code
  `)[0];

  if (!result) return [];

  return result.values.map(row => ({
    code: row[0] as string,
    description: row[1] as string,
    level: Number(row[2]),
    parent_code: row[3] as string | null,
    perspective_count: Number(row[4]),
    document_count: Number(row[5])
  }));
}

// Get perspectives for a specific theme and its descendants
export function getPerspectivesByTheme(
  db: Database, 
  themeCode: string
): Perspective[] {
  const result = db.exec(`
    SELECT 
      p.id,
      p.abstraction_id,
      p.taxonomy_code,
      p.perspective,
      p.excerpt,
      p.sentiment,
      a.submitter_type,
      a.organization_name,
      a.filename,
      0 as word_count,
      json_extract(a.original_metadata_json, '$.category') as original_category,
      json_extract(a.original_metadata_json, '$.organization') as original_organization,
      json_extract(a.original_metadata_json, '$.firstName') as original_firstName,
      json_extract(a.original_metadata_json, '$.lastName') as original_lastName,
      json_extract(a.attributes_json, '$.stakeholder_group') as stakeholder_group
    FROM perspectives p
    JOIN abstractions a ON p.abstraction_id = a.id
    WHERE p.taxonomy_code = ? OR p.taxonomy_code LIKE ? || '.%'
  `, [themeCode, themeCode])[0];

  if (!result) return [];

  const perspectives = result.values.map(row => ({
    id: Number(row[0]),
    abstraction_id: Number(row[1]),
    taxonomy_code: row[2] as string,
    perspective: row[3] as string,
    excerpt: row[4] as string,
    sentiment: row[5] as string | null,
    submitter_type: row[6] as string,
    organization_name: row[7] as string | null,
    comment_filename: row[8] as string,
    content_word_count: Number(row[9]),
    original_category: row[10] ? String(row[10]) : undefined,
    original_organization: row[11] ? String(row[11]) : undefined,
    original_firstName: row[12] ? String(row[12]) : undefined,
    original_lastName: row[13] ? String(row[13]) : undefined,
    stakeholder_group: row[14] ? String(row[14]) : undefined
  }));

  return perspectives;
}

// Get a single theme by code with descendant counts
export function getThemeByCode(db: Database, code: string): Theme | null {
  try {
    const result = db.exec(`
      SELECT 
        t.code,
        t.description,
        t.level,
        t.parent_code,
        (SELECT COUNT(DISTINCT p.id) FROM perspectives p WHERE p.taxonomy_code = ? OR p.taxonomy_code LIKE ? || '.%') as perspective_count,
        (SELECT COUNT(DISTINCT p.abstraction_id) FROM perspectives p WHERE p.taxonomy_code = ? OR p.taxonomy_code LIKE ? || '.%') as document_count
      FROM taxonomy_ref t
      WHERE t.code = ?
    `, [code, code, code, code, code]);

    if (!result || result.length === 0 || !result[0] || result[0].values.length === 0) {
      return null;
    }

    const row = result[0].values[0];
    return {
      code: row[0] as string,
      description: row[1] as string,
      level: Number(row[2]),
      parent_code: row[3] as string | null,
      perspective_count: Number(row[4]),
      document_count: Number(row[5])
    };
  } catch (error) {
    console.error('Error in getThemeByCode:', error);
    return null;
  }
}

// Get child themes with descendant counts
export function getChildThemes(db: Database, parentCode: string): Theme[] {
  const result = db.exec(`
    SELECT 
      t.code,
      t.description,
      t.level,
      t.parent_code,
      (SELECT COUNT(DISTINCT p.id) FROM perspectives p WHERE p.taxonomy_code = t.code OR p.taxonomy_code LIKE t.code || '.%') as perspective_count,
      (SELECT COUNT(DISTINCT p.abstraction_id) FROM perspectives p WHERE p.taxonomy_code = t.code OR p.taxonomy_code LIKE t.code || '.%') as document_count
    FROM taxonomy_ref t
    WHERE t.parent_code = ?
    GROUP BY t.code, t.description, t.level, t.parent_code
    ORDER BY t.code
  `, [parentCode])[0];

  if (!result) return [];

  return result.values.map(row => ({
    code: row[0] as string,
    description: row[1] as string,
    level: Number(row[2]),
    parent_code: row[3] as string | null,
    perspective_count: Number(row[4]),
    document_count: Number(row[5])
  }));
}

// Get theme ancestry for breadcrumbs (from root to current theme)
export function getThemeAncestry(db: Database, code: string): Theme[] {
  const ancestry: Theme[] = [];
  let currentCode: string | null = code;
  
  // Traverse up the hierarchy
  while (currentCode) {
    const theme = getThemeByCode(db, currentCode);
    if (!theme) break;
    
    ancestry.unshift(theme); // Add to beginning to maintain order from root to current
    currentCode = theme.parent_code;
  }
  
  return ancestry;
}

export function getThemeNarrative(db: Database, code: string): ThemeNarrative | null {
  const result = db.exec(`
    SELECT theme_code, narrative_summary, consensus_points, debate_points, stakeholder_dynamics, supporting_stats
    FROM theme_narratives
    WHERE theme_code = ?
  `, [code])[0];

  if (!result || result.values.length === 0) return null;
  const row = result.values[0];
  return {
    theme_code: row[0] as string,
    narrative_summary: row[1] as string,
    consensus_points: JSON.parse(row[2] as string ?? '[]'),
    debate_points: JSON.parse(row[3] as string ?? '[]'),
    stakeholder_dynamics: JSON.parse(row[4] as string ?? '{}'),
    supporting_stats: JSON.parse(row[5] as string ?? '{}')
  };
}

export function getThemeAnalysis(db: Database, code: string): ThemeAnalysisRaw | null {
  const res = db.exec(`SELECT analysis_json FROM theme_analysis_raw WHERE theme_code = ?`, [code])[0];
  if (!res || res.values.length === 0) return null;
  return JSON.parse(res.values[0][0] as string);
}
