import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';

const command = process.argv[2];

if (!command || !['check-data', 'report', 'export-positions'].includes(command)) {
  console.log(`
Data Validator - Quality Check Utilities

Usage:
  bun run data-validator.ts check-data      # Validate data quality
  bun run data-validator.ts report          # Generate analysis report
  bun run data-validator.ts export-positions # Export position data
  `);
  process.exit(1);
}

function checkData() {
  if (!existsSync('./output/abstractions.db')) {
    console.error('❌ No database found. Run pipeline first.');
    process.exit(1);
  }

  const db = new Database('./output/abstractions.db');
  console.log('🔍 Pipeline Data Validation\n');

  // Check basic counts
  console.log('📊 Basic Statistics:');
  const stats = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM abstractions) as documents,
      (SELECT COUNT(*) FROM perspectives) as perspectives,
      (SELECT COUNT(DISTINCT taxonomy_code) FROM perspectives) as themes_used,
      (SELECT COUNT(*) FROM theme_axes) as axes,
      (SELECT COUNT(*) FROM perspective_positions) as classifications
  `).get() as any;
  
  console.log(`  Documents: ${stats.documents}`);
  console.log(`  Perspectives: ${stats.perspectives}`);
  console.log(`  Themes Referenced: ${stats.themes_used}`);
  console.log(`  Axes Discovered: ${stats.axes}`);
  console.log(`  Position Classifications: ${stats.classifications}`);

  // Check for issues
  console.log('\n⚠️  Potential Issues:');
  
  // Documents without perspectives
  const noPerspectives = db.prepare(`
    SELECT COUNT(*) as count FROM abstractions a
    WHERE NOT EXISTS (SELECT 1 FROM perspectives p WHERE p.abstraction_id = a.id)
  `).get() as any;
  
  if (noPerspectives.count > 0) {
    console.log(`  - ${noPerspectives.count} documents have no extracted perspectives`);
  }

  // Themes without axes (but have enough perspectives)
  const noAxes = db.prepare(`
    SELECT t.code, t.description, COUNT(p.id) as perspective_count
    FROM taxonomy_ref t
    JOIN perspectives p ON t.code = p.taxonomy_code
    LEFT JOIN theme_axes ta ON t.code = ta.theme_code
    WHERE ta.id IS NULL
    GROUP BY t.code
    HAVING perspective_count >= 5
  `).all() as any[];
  
  if (noAxes.length > 0) {
    console.log(`  - ${noAxes.length} themes ready for axis discovery:`);
    noAxes.forEach(theme => {
      console.log(`    ${theme.code}: ${theme.description} (${theme.perspective_count} perspectives)`);
    });
  }

  // Unclassified perspectives
  const unclassified = db.prepare(`
    SELECT COUNT(DISTINCT p.id) as count
    FROM perspectives p
    JOIN theme_axes ta ON p.taxonomy_code = ta.theme_code
    WHERE NOT EXISTS (
      SELECT 1 FROM perspective_positions pp 
      WHERE pp.perspective_id = p.id
    )
  `).get() as any;
  
  if (unclassified.count > 0) {
    console.log(`  - ${unclassified.count} perspectives not yet classified`);
  }

  // Classification confidence
  console.log('\n📈 Classification Quality:');
  const confidence = db.prepare(`
    SELECT confidence, COUNT(*) as count,
           ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as percent
    FROM perspective_positions
    GROUP BY confidence
  `).all() as any[];
  
  confidence.forEach(c => {
    const emoji = c.confidence === 'high' ? '✅' : c.confidence === 'medium' ? '⚡' : '⚠️';
    console.log(`  ${emoji} ${c.confidence}: ${c.count} (${c.percent}%)`);
  });

  // Missing attributes
  console.log('\n🏷️  Attribute Coverage:');
  const attrCoverage = db.prepare(`
    SELECT 
      SUM(CASE WHEN submitter_type IS NULL THEN 1 ELSE 0 END) as missing_type,
      SUM(CASE WHEN market_segment IS NULL THEN 1 ELSE 0 END) as missing_segment,
      SUM(CASE WHEN geographic_scope IS NULL THEN 1 ELSE 0 END) as missing_geo,
      COUNT(*) as total
    FROM abstractions
  `).get() as any;
  
  console.log(`  Submitter Type: ${((attrCoverage.total - attrCoverage.missing_type) / attrCoverage.total * 100).toFixed(1)}% complete`);
  console.log(`  Market Segment: ${((attrCoverage.total - attrCoverage.missing_segment) / attrCoverage.total * 100).toFixed(1)}% complete`);
  console.log(`  Geographic Scope: ${((attrCoverage.total - attrCoverage.missing_geo) / attrCoverage.total * 100).toFixed(1)}% complete`);

  db.close();
  console.log('\n✅ Validation complete!');
}

function generateReport() {
  const db = new Database('./output/abstractions.db');
  
  console.log('📋 Pipeline Analysis Report\n');
  console.log('=' .repeat(60));
  
  // Top themes by activity
  console.log('\n🎯 Most Active Themes:');
  const topThemes = db.prepare(`
    SELECT t.code, t.description, 
           COUNT(DISTINCT p.id) as perspectives,
           COUNT(DISTINCT a.id) as documents
    FROM taxonomy_ref t
    JOIN perspectives p ON t.code = p.taxonomy_code
    JOIN abstractions a ON p.abstraction_id = a.id
    GROUP BY t.code
    ORDER BY perspectives DESC
    LIMIT 10
  `).all() as any[];
  
  topThemes.forEach((theme, i) => {
    console.log(`${i+1}. ${theme.code} ${theme.description}`);
    console.log(`   ${theme.perspectives} perspectives from ${theme.documents} documents`);
  });

  // Most contested debates
  console.log('\n🔥 Most Contested Debates:');
  const debates = db.prepare(`
    WITH position_pairs AS (
      SELECT 
        ta.theme_code,
        ta.axis_name,
        ap1.position_label as pos1,
        ap2.position_label as pos2,
        ap1.example_count as count1,
        ap2.example_count as count2,
        ABS(ap1.example_count - ap2.example_count) as balance
      FROM theme_axes ta
      JOIN axis_positions ap1 ON ta.id = ap1.axis_id
      JOIN axis_positions ap2 ON ta.id = ap2.axis_id
      WHERE ap1.id < ap2.id
      AND ap1.example_count >= 5
      AND ap2.example_count >= 5
    )
    SELECT * FROM position_pairs
    ORDER BY balance ASC
    LIMIT 5
  `).all() as any[];
  
  debates.forEach(debate => {
    console.log(`\n${debate.theme_code}: ${debate.axis_name}`);
    console.log(`  "${debate.pos1}" (${debate.count1}) vs "${debate.pos2}" (${debate.count2})`);
  });

  // Stakeholder summary
  console.log('\n👥 Stakeholder Participation:');
  const stakeholders = db.prepare(`
    SELECT submitter_type, 
           COUNT(*) as documents,
           COUNT(DISTINCT organization_name) as orgs
    FROM abstractions
    GROUP BY submitter_type
    ORDER BY documents DESC
  `).all() as any[];
  
  stakeholders.forEach(s => {
    console.log(`  ${s.submitter_type}: ${s.documents} documents (${s.orgs} unique orgs)`);
  });

  db.close();
  console.log('\n' + '='.repeat(60));
}

function exportPositions() {
  const db = new Database('./output/abstractions.db');
  
  console.log('📤 Exporting position data...\n');
  
  // Export to JSON for visualization
  const positions = db.prepare(`
    SELECT 
      a.organization_name,
      a.submitter_type,
      ta.theme_code,
      ta.axis_name,
      ap.position_label,
      pp.confidence,
      p.excerpt
    FROM perspective_positions pp
    JOIN perspectives p ON pp.perspective_id = p.id
    JOIN abstractions a ON p.abstraction_id = a.id
    JOIN theme_axes ta ON pp.axis_id = ta.id
    JOIN axis_positions ap ON pp.position_id = ap.id
    WHERE pp.confidence IN ('high', 'medium')
    ORDER BY ta.theme_code, a.organization_name
  `).all();
  
  await Bun.write('./output/positions.json', JSON.stringify(positions, null, 2));
  console.log(`✅ Exported ${positions.length} position classifications to ./output/positions.json`);
  
  // Export debate summary
  const debates = db.prepare(`
    SELECT 
      ta.theme_code,
      t.description as theme_desc,
      ta.axis_name,
      ta.axis_question,
      GROUP_CONCAT(
        ap.position_label || ' (' || ap.example_count || ')',
        ' | '
      ) as positions
    FROM theme_axes ta
    JOIN taxonomy_ref t ON ta.theme_code = t.code
    JOIN axis_positions ap ON ta.id = ap.axis_id
    GROUP BY ta.id
    ORDER BY ta.theme_code
  `).all();
  
  await Bun.write('./output/debates.json', JSON.stringify(debates, null, 2));
  console.log(`✅ Exported ${debates.length} debate axes to ./output/debates.json`);
  
  db.close();
}

// Main execution
if (command === 'check-data') {
  checkData();
} else if (command === 'report') {
  generateReport();
} else if (command === 'export-positions') {
  exportPositions();
}
