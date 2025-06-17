import { Command } from "commander";
import { openDb } from "./lib/database";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export const buildWebsiteCommand = new Command("build-website")
  .description("Generate static data files for web dashboard")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-o, --output <dir>", "Output directory", "dist/data")
  .action(buildWebsite);

async function buildWebsite(documentId: string, options: any) {
  const db = openDb(documentId);
  const outputDir = options.output;
  
  console.log(`🏗️  Building website data for ${documentId}`);
  
  // Ensure output directories exist
  await mkdir(outputDir, { recursive: true });
  await mkdir(join(outputDir, "indexes"), { recursive: true });
  
  // 1. Generate metadata
  const meta = {
    documentId,
    generatedAt: new Date().toISOString(),
    stats: getStats(db),
  };
  await writeJson(join(outputDir, "meta.json"), meta);
  
  // 2. Export theme hierarchy with counts
  const themes = getThemeHierarchy(db);
  await writeJson(join(outputDir, "themes.json"), themes);
  
  // 3. Export theme summaries
  const themeSummaries = getThemeSummaries(db);
  await writeJson(join(outputDir, "theme-summaries.json"), themeSummaries);
  
  // 4. Export entity taxonomy with counts
  const entities = getEntityTaxonomy(db);
  await writeJson(join(outputDir, "entities.json"), entities);
  
  // 5. Export all comments as single file
  await exportAllComments(db, outputDir, documentId);
  
  // 6. Generate indexes for efficient lookups
  await generateIndexes(db, outputDir);
  
  console.log(`✅ Website data built in ${outputDir}`);
  db.close();
}

function getStats(db: any) {
  return {
    totalComments: db.prepare("SELECT COUNT(*) as count FROM comments").get().count,
    condensedComments: db.prepare("SELECT COUNT(*) as count FROM condensed_comments WHERE status = 'completed'").get().count,
    totalThemes: db.prepare("SELECT COUNT(*) as count FROM theme_hierarchy").get().count,
    totalEntities: db.prepare("SELECT COUNT(*) as count FROM entity_taxonomy").get().count,
    scoredComments: db.prepare("SELECT COUNT(DISTINCT comment_id) as count FROM comment_themes").get().count,
    themeSummaries: db.prepare("SELECT COUNT(*) as count FROM theme_summaries").get().count,
  };
}

function getThemeHierarchy(db: any) {
  const themes = db.prepare(`
    SELECT 
      t.*,
      COUNT(DISTINCT CASE WHEN ct.score = 1 THEN ct.comment_id END) as comment_count,
      COUNT(DISTINCT CASE WHEN ct.score = 1 THEN ct.comment_id END) as direct_count,
      0 as touch_count
    FROM theme_hierarchy t
    LEFT JOIN comment_themes ct ON t.code = ct.theme_code
    GROUP BY t.code
    ORDER BY t.code
  `).all();
  
  // Build hierarchy without quotes
  return themes.map((t: any) => ({
    ...t,
    children: themes.filter((child: any) => child.parent_code === t.code).map((c: any) => c.code)
  }));
}

function getThemeSummaries(db: any) {
  const summaries = db.prepare(`
    SELECT 
      ts.theme_code,
      ts.structured_sections,
      ts.comment_count,
      ts.word_count,
      th.description as theme_description
    FROM theme_summaries ts
    JOIN theme_hierarchy th ON ts.theme_code = th.code
    ORDER BY ts.theme_code
  `).all();
  
  // Parse structured sections and create a map
  const summaryMap: any = {};
  for (const summary of summaries) {
    const sections = JSON.parse(summary.structured_sections);
    
    summaryMap[summary.theme_code] = {
      themeDescription: summary.theme_description,
      commentCount: summary.comment_count,
      wordCount: summary.word_count,
      sections: sections
    };
  }
  
  return summaryMap;
}

function getEntityTaxonomy(db: any) {
  const entities = db.prepare(`
    SELECT 
      e.*,
      COUNT(DISTINCT ce.comment_id) as mention_count
    FROM entity_taxonomy e
    LEFT JOIN comment_entities ce ON e.category = ce.category AND e.label = ce.entity_label
    GROUP BY e.category, e.label
    ORDER BY e.category, mention_count DESC
  `).all();
  
  // Group by category
  const taxonomy: any = {};
  for (const entity of entities) {
    if (!taxonomy[entity.category]) {
      taxonomy[entity.category] = [];
    }
    taxonomy[entity.category].push({
      label: entity.label,
      definition: entity.definition,
      terms: JSON.parse(entity.terms),
      mentionCount: entity.mention_count
    });
  }
  
  return taxonomy;
}

async function exportAllComments(db: any, outputDir: string, documentId: string) {
  console.log("  📄 Exporting all comments...");
  
  const comments = db.prepare(`
    SELECT 
      c.id,
      c.attributes_json,
      cc.structured_sections,
      cc.word_count,
      GROUP_CONCAT(DISTINCT ct.theme_code || ':' || ct.score) as theme_scores,
      GROUP_CONCAT(DISTINCT ce.category || '|' || ce.entity_label) as entities,
      COUNT(DISTINCT a.id) as attachment_count
    FROM comments c
    LEFT JOIN condensed_comments cc ON c.id = cc.comment_id
    LEFT JOIN comment_themes ct ON c.id = ct.comment_id
    LEFT JOIN comment_entities ce ON c.id = ce.comment_id
    LEFT JOIN attachments a ON c.id = a.comment_id
    GROUP BY c.id
    ORDER BY c.id
  `).all();
  
  // Process comments
  const processedComments = comments.map((c: any) => {
    const attrs = JSON.parse(c.attributes_json);
    
    // Parse theme scores - only include scores of 1 (strongest)
    const themeScores: any = {};
    if (c.theme_scores) {
      for (const score of c.theme_scores.split(',')) {
        const [code, value] = score.split(':');
        const scoreValue = parseInt(value);
        if (scoreValue === 1) {  // Only export strongest scores
          themeScores[code] = scoreValue;
        }
      }
    }
    
    // Parse entities
    const entities: any[] = [];
    if (c.entities) {
      for (const entity of c.entities.split(',')) {
        const [category, label] = entity.split('|');
        if (category && label) {  // Only add if both category and label are defined
          entities.push({ category, label });
        }
      }
    }
    
    const wordCount = c.word_count ?? 0

    // Parse structured sections if available
    let structuredSections = null;
    if (c.structured_sections) {
      try {
        structuredSections = JSON.parse(c.structured_sections);
      } catch (e) {
        console.warn(`Failed to parse structured sections for comment ${c.id}:`, e);
      }
    }
    
    return {
      id: c.id,
      documentId,
      submitter: attrs.organization || `${attrs.firstName || ''} ${attrs.lastName || ''}`.trim() || 'Anonymous',
      submitterType: attrs.category || (attrs.organization ? 'Organization' : 'Individual'),
      date: attrs.postedDate || attrs.receiveDate,
      location: [attrs.city, attrs.stateProvinceRegion, attrs.country].filter(Boolean).join(', '),
      structuredSections,
      themeScores,
      entities,
      hasAttachments: c.attachment_count > 0,
      wordCount,
    };
  });
  
  await writeJson(join(outputDir, "comments.json"), processedComments);
  console.log(`  ✅ Exported ${processedComments.length} comments`);
}

async function generateIndexes(db: any, outputDir: string) {
  // Theme -> Comment index (only direct mentions with score = 1)
  const themeIndex = db.prepare(`
    SELECT theme_code, comment_id, score
    FROM comment_themes
    WHERE score = 1
    ORDER BY theme_code, comment_id
  `).all();
  
  const themeMap: any = {};
  for (const row of themeIndex) {
    if (!themeMap[row.theme_code]) {
      themeMap[row.theme_code] = { direct: [], touches: [] };
    }
    themeMap[row.theme_code].direct.push(row.comment_id);
  }
  
  await writeJson(join(outputDir, "indexes", "theme-comments.json"), themeMap);
  
  // Entity -> Comment index
  const entityIndex = db.prepare(`
    SELECT category, entity_label, comment_id
    FROM comment_entities
    ORDER BY category, entity_label, comment_id
  `).all();
  
  const entityMap: any = {};
  for (const row of entityIndex) {
    const key = `${row.category}|${row.entity_label}`;
    if (!entityMap[key]) {
      entityMap[key] = [];
    }
    entityMap[key].push(row.comment_id);
  }
  
  await writeJson(join(outputDir, "indexes", "entity-comments.json"), entityMap);
}

async function writeJson(path: string, data: any) {
  await writeFile(path, JSON.stringify(data, null, 2));
}
