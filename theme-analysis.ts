import { GoogleGenAI } from '@google/genai';
import { Database } from 'bun:sqlite';
import { mkdir } from 'fs/promises';
import { generateContent } from './lib/comment-processing.js';

const MODEL = 'gemini-2.5-pro-preview-06-05';

// ===== Prompt Templates =====================================================
export const THEME_NARRATIVE_PROMPT = `Analyze perspectives for theme {THEME_CODE}: {THEME_DESCRIPTION}

Context:
- {TOTAL_PERSPECTIVES} perspectives from {TOTAL_DOCUMENTS} documents, covering {UNIQUE_STAKEHOLDERS} stakeholder types.

PERSPECTIVES:
{PERSPECTIVES_LIST}

TASKS
1. Synthesize a 2–3 paragraph narrative that covers consensus, disagreements (and why), and any surprising alignments or conflicts between stakeholder groups.
2. Populate the structured data fields described below.
- When referencing specific viewpoints or examples in the narrative, cite the perspective ID(s) in parentheses using the format "(ID: 123)" or "(ID: 123, 456)" so they can be linked in the UI.

IMPORTANT OUTPUT RULES
- Return ONLY a single valid JSON object, no markdown, no headings, no additional commentary.
- Do NOT repeat the narrative outside of the JSON – put it only in the "narrative_summary" field.

OUTPUT TEMPLATE (fill all fields; arrays may be empty if not applicable):
{
  "narrative_summary": "The full narrative (2–3 paragraphs, separate paragraphs with blank lines)",
  "consensus_points": [
    {
      "statement": "What they agree on",
      "strength": "universal|strong|moderate",
      "stakeholders": ["all"],
      "example_quote": "A representative quote"
    }
  ],
  "debate_points": [
    {
      "topic": "What they disagree about",
      "positions": [
        {
          "stance": "One position",
          "held_by": ["stakeholder types"],
          "reasoning": "Why they believe this"
        }
      ],
      "core_tension": "The fundamental disagreement"
    }
  ],
  "stakeholder_dynamics": {
    "aligned_groups": [["GroupA", "GroupB"]],
    "opposing_groups": [["GroupC", "GroupD"]],
    "bridge_builders": ["Stakeholders proposing compromises"]
  },
  "supporting_stats": {
    "total_perspectives": {TOTAL_PERSPECTIVES},
    "total_stakeholders": {UNIQUE_STAKEHOLDERS},
    "consensus_ratio": 0.0
  }
}`;

export const STANCE_DETECTION_PROMPT = `Analyze commenter submissions on theme {THEME_CODE}: {THEME_DESCRIPTION}

We collected {COUNT} unique commenters. Each XML block shows one <commenter> and all of their on-theme perspectives.

Review these commenters and identify a set of "different stances" they take -- a good set of stances means that an individual commenter fits quite cleanly into exactly 1 stance, so the stances should help classify the different commentors.



COMMENTERS:
{COMMENTER_LIST}

Task: define 3-5 distinct **stances**.  A good stance is mutually exclusive: a commenter should fit cleanly into exactly one stance with no internal contradictions.
Identify distinct STANCES.  Good stances are mutually exclusive - each commenter should clearly fit one stance without conradiction across their perspectives.

Return only JSON using the schema below (no markdown).

OUTPUT:
{
  "notes": "Brief explanation of how stances were identified",
  "stances": [
    {
      "stance_key": "short_snake_case_id",
      "stance_label": "Human Readable Label", 
      "stance_description": "1-2 sentences explaining this position",
      "typical_arguments": [
        "Main argument 1",
        "Main argument 2"
      ],
      "example_quotes": [
        "Representative quote from perspectives"
      ]
    }
  ],
  "commenter_mapping": [
    {
      "commenter_id": 1,
      "stance_key": "immediate_mandate",
      "confidence": 0.95
    }
  ]
}`;

// ===== Helper Utilities =====================================================

function getThemeDescription(db: Database, themeCode: string): string {
  const row = db.prepare('SELECT description FROM taxonomy_ref WHERE code = ?').get(themeCode) as {description: string} | undefined;
  return row ? row.description : '';
}

function groupBy<T extends Record<string, any>>(items: T[], key: keyof T) {
  return items.reduce((acc: Record<string, T[]>, item: T) => {
    const k = String(item[key]);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// Simple debug writer
async function debugSave(fileName: string, content: string, debug: boolean) {
  if (!debug) return;
  await mkdir('./progress', { recursive: true });
  await Bun.write(`./progress/${fileName}`, content);
}

// Extract the first JSON object from an LLM response (ignores surrounding prose)
function extractJson(text: string): any {
  let jsonStr = '';
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const cleaned = text.trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      throw new Error('No JSON object found');
    }
    jsonStr = cleaned.slice(first, last + 1);
  }
  return JSON.parse(jsonStr);
}

// Merge partial analysis data into theme_analysis_raw row
function mergeAndSaveAnalysis(db: Database, themeCode: string, fragment: any) {
  const existingRow = db.prepare('SELECT analysis_json FROM theme_analysis_raw WHERE theme_code = ?').get(themeCode) as {analysis_json: string}|undefined;
  const existing = existingRow ? JSON.parse(existingRow.analysis_json) : {};
  const merged = { ...existing, ...fragment };
  db.prepare(`
    INSERT OR REPLACE INTO theme_analysis_raw (theme_code, analysis_json)
    VALUES (?, ?)
  `).run(themeCode, JSON.stringify(merged));
}

// ===== Narrative Generation =================================================

export async function generateThemeNarrative(db: Database, themeCode: string, debug = false) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // 1. Gather all perspectives for this theme and its children
  const perspectives = db.prepare(`
    SELECT 
      p.id,
      p.perspective,
      p.excerpt,
      p.abstraction_id,
      a.submitter_type,
      a.organization_name,
      a.original_metadata_json
    FROM perspectives p
    JOIN abstractions a ON p.abstraction_id = a.id
    WHERE p.taxonomy_code = ? OR p.taxonomy_code LIKE ? || '.%'
    ORDER BY a.submitter_type, p.id
  `).all(themeCode, themeCode) as Array<{id: number; perspective: string; excerpt: string; abstraction_id: number; submitter_type: string; organization_name: string; original_metadata_json: string}>;

  if (perspectives.length === 0) {
    console.warn(`No perspectives found for theme ${themeCode}, skipping narrative generation.`);
    return;
  }

  // 2. Group by stakeholder type
  const grouped = groupBy(perspectives, 'submitter_type');

  // Helper to build commenter display name (mirrors browser util)
  function commenterDisplay(p: any): string {
    const meta = p.original_metadata_json ? JSON.parse(p.original_metadata_json) : {};
    if (p.organization_name) return p.organization_name;
    if (meta.organization) return meta.organization;
    if (meta.firstName && meta.lastName) return `${meta.firstName} ${meta.lastName}`;
    return p.submitter_type;
  }

  // 3. Format grouped perspectives for prompt (limit to first 10 per stakeholder)
  const groupedText = Object.entries(grouped)
    .map(([type, list]) => {
      const arr = list as any[];
      return `\n${type} (${arr.length} perspectives):\n` +
        arr.slice(0, 10).map(p => `- ${commenterDisplay(p)}`).join('\n') +
        (arr.length > 10 ? `\n... and ${arr.length - 10} more` : '');
    })
    .join('\n');

  // 4. Build prompt
  const perspectivesListFull = perspectives.map(p => {
    const meta = p.original_metadata_json ? JSON.parse(p.original_metadata_json) : {};
    const display = commenterDisplay(p);
    const category = meta.category ? ` | originalCategory:${meta.category}` : '';
    return `[ID:${p.id}] ${display} (${p.submitter_type}${category})\nPerspective: ${p.perspective}\nExcerpt: "${p.excerpt}"`;
  }).join('\n\n');

  const prompt = THEME_NARRATIVE_PROMPT
    .replace(/\{THEME_CODE\}/g, themeCode)
    .replace(/\{THEME_DESCRIPTION\}/g, getThemeDescription(db, themeCode))
    .replace(/\{TOTAL_PERSPECTIVES\}/g, perspectives.length.toString())
    .replace(/\{TOTAL_DOCUMENTS\}/g, new Set(perspectives.map(p => p.abstraction_id)).size.toString())
    .replace(/\{UNIQUE_STAKEHOLDERS\}/g, Object.keys(grouped).length.toString())
    .replace(/\{PERSPECTIVES_LIST\}/g, perspectivesListFull);

  await debugSave(`narrative_${themeCode}_prompt.txt`, prompt, debug);

  const response = await generateContent(ai, prompt);
  await debugSave(`narrative_${themeCode}_response.txt`, response, debug);

  let narrative;
  try {
    narrative = extractJson(response);
  } catch (err) {
    console.error(`Failed to parse narrative JSON for theme ${themeCode}:`, err);
    console.error('Response snippet:', response.slice(0, 500));
    return;
  }

  // 5. Persist to DB
  db.prepare(`
    INSERT OR REPLACE INTO theme_narratives (
      theme_code, narrative_summary, consensus_points, debate_points, 
      stakeholder_dynamics, supporting_stats)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    themeCode,
    narrative.narrative_summary,
    JSON.stringify(narrative.consensus_points || []),
    JSON.stringify(narrative.debate_points || []),
    JSON.stringify(narrative.stakeholder_dynamics || {}),
    JSON.stringify(narrative.supporting_stats || {})
  );

  console.log(`  ✓ Narrative stored for ${themeCode}`);

  // Save full narrative part to raw table
  mergeAndSaveAnalysis(db, themeCode, {
    narrative_summary: narrative.narrative_summary,
    consensus_points: narrative.consensus_points,
    debate_points: narrative.debate_points,
    stakeholder_dynamics: narrative.stakeholder_dynamics,
    supporting_stats: narrative.supporting_stats
  });

  return narrative;
}

// ===== Stance Detection =====================================================

export async function detectThemeStances(db: Database, themeCode: string, debug = false) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // Group all perspectives by commenter (abstraction)
  const rows = db.prepare(`
    SELECT 
      a.id                AS commenter_id,
      a.submitter_type    AS submitter_type,
      COALESCE(a.organization_name, json_extract(a.original_metadata_json,'$.organization'), a.submitter_type) AS display_name,
      COALESCE(json_extract(a.attributes_json,'$.stakeholder_group'), a.submitter_type, 'Other')             AS stakeholder_group,
      json_group_array(json_object('id', p.id, 'text', p.perspective, 'excerpt', p.excerpt)) AS perspectives_json
    FROM abstractions a
    JOIN perspectives p ON p.abstraction_id = a.id
    WHERE p.taxonomy_code = ? OR p.taxonomy_code LIKE ? || '.%'
    GROUP BY a.id
  `).all(themeCode, themeCode) as Array<{commenter_id:number; submitter_type:string; display_name:string; stakeholder_group:string; perspectives_json:string}>;

  if (rows.length === 0) {
    console.warn(`No perspectives for theme ${themeCode}, skipping stance detection.`);
    return;
  }

  // Build map commenter -> perspective ids for later expansion
  const commenterToPersp: Record<number, number[]> = {};
  rows.forEach(r => {
    const pers = JSON.parse(r.perspectives_json) as Array<{id:number}>;
    commenterToPersp[r.commenter_id] = pers.map(p=>p.id);
  });

  const perspectivesList = rows.map(r => {
    const stakeAttr = r.stakeholder_group.replace(/"/g,'');
    const nameAttr = r.display_name.replace(/"/g,'');
    const perspectives = JSON.parse(r.perspectives_json) as Array<{id:number;text:string;excerpt:string}>;
    const inner = perspectives.map(p=>`  <perspective id="${p.id}">
    <text>${p.text}</text>
    <excerpt>${p.excerpt}</excerpt>
  </perspective>`).join('\n');
    return `<commenter id="${r.commenter_id}" stakeholder="${stakeAttr}" name="${nameAttr}">\n${inner}\n</commenter>`;
  }).join('\n\n');

  const prompt = STANCE_DETECTION_PROMPT
    .replace(/\{THEME_CODE\}/g, themeCode)
    .replace(/\{THEME_DESCRIPTION\}/g, getThemeDescription(db, themeCode))
    .replace(/\{COUNT\}/g, rows.length.toString())
    .replace(/\{COMMENTER_LIST\}/g, perspectivesList);

  await debugSave(`stances_${themeCode}_prompt.txt`, prompt, debug);

  const response = await generateContent(ai, prompt);
  await debugSave(`stances_${themeCode}_response.txt`, response, debug);

  let result;
  try {
    result = extractJson(response);
  } catch (err) {
    console.error(`Failed to parse stances JSON for theme ${themeCode}:`, err);
    console.error('Response snippet:', response.slice(0, 500));
    return;
  }

  const insertStance = db.prepare(`
    INSERT OR REPLACE INTO theme_stances (theme_code, stance_key, stance_label, stance_description, typical_arguments, example_quotes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const stance of result.stances || []) {
    insertStance.run(
      themeCode,
      stance.stance_key,
      stance.stance_label,
      stance.stance_description,
      JSON.stringify(stance.typical_arguments || []),
      JSON.stringify(stance.example_quotes || [])
    );
  }

  if (Array.isArray(result.commenter_mapping)) {
    const insertMapping = db.prepare(`
      INSERT OR REPLACE INTO perspective_stances (perspective_id, theme_code, stance_key, confidence)
      VALUES (?, ?, ?, ?)
    `);

    const perspectiveMappings: {perspective_id: number; stance_key: string; confidence: number}[] = [];

    for (const mapping of result.commenter_mapping) {
      const commenterId = mapping.commenter_id; // treated as commenter id in new prompt
      const targetPersps = commenterToPersp[commenterId] || [];
      for (const pid of targetPersps) {
        insertMapping.run(
          pid,
          themeCode,
          mapping.stance_key,
          mapping.confidence || 1.0
        );
        perspectiveMappings.push({perspective_id: pid, stance_key: mapping.stance_key, confidence: mapping.confidence || 1.0});
      }
    }

    // ---------------- Store to raw analysis JSON ----------------
    mergeAndSaveAnalysis(db, themeCode, {
      stances: result.stances,
      commenter_mapping: result.commenter_mapping,
      perspective_mapping: perspectiveMappings,
      notes: result.notes
    });
  }

  console.log(`  ✓ Stored ${result.stances?.length || 0} stances for ${themeCode}`);
}

// ===== Batch Analysis Command ==============================================

export async function analyzeThemes(selectedThemes: string[] | null = null, minPerspectives = 10, debug = false) {
  const db = new Database('./output/abstractions.db');

  const themesQuery = db.prepare(`
    SELECT DISTINCT t.code, t.description
    FROM taxonomy_ref t
    JOIN perspectives p ON p.taxonomy_code = t.code OR p.taxonomy_code LIKE t.code || '.%'
    GROUP BY t.code
    HAVING COUNT(p.id) >= ?
    ORDER BY t.code`);

  const allThemes = themesQuery.all(minPerspectives) as Array<{code:string; description:string}>;
  const themes = selectedThemes && selectedThemes.length > 0 ?
    allThemes.filter(t => selectedThemes.includes(t.code)) : allThemes;

  console.log(`Analyzing ${themes.length} themes${selectedThemes && selectedThemes.length ? ` (requested: ${selectedThemes.join(', ')})` : ''}...`);

  for (const theme of themes) {
    const narrativeRow = db.prepare('SELECT narrative_summary FROM theme_narratives WHERE theme_code = ?').get(theme.code) as {narrative_summary?: string} | undefined;
    const narrativeDone = !!(narrativeRow && narrativeRow.narrative_summary && narrativeRow.narrative_summary.trim().length > 0);

    const stanceCountRow = db.prepare('SELECT COUNT(*) as cnt FROM theme_stances WHERE theme_code = ?').get(theme.code) as {cnt: number} | undefined;
    const stanceDone = !!(stanceCountRow && stanceCountRow.cnt >= 3); // require at least 3 stances to be considered complete

    if (narrativeDone && stanceDone) {
      console.log(`\nSkipping ${theme.code} – analysis already complete.`);
      continue;
    }

    console.log(`\nProcessing ${theme.code}: ${theme.description}`);

    if (!narrativeDone) {
      await generateThemeNarrative(db, theme.code, debug);
    } else {
      console.log('  • Narrative already present');
    }

    if (!stanceDone) {
      await detectThemeStances(db, theme.code, debug);
    } else {
      console.log('  • Stances already present');
    }
  }

  db.close();
  console.log('\n=== Theme analysis complete ===');
}
