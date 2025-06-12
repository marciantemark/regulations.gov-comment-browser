import { GoogleGenAI } from '@google/genai';
import { readdir, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { Database } from 'bun:sqlite';

const BATCH_SIZE = 5;
const MODEL = 'gemini-2.5-pro-preview-06-05';

// Command parsing
const command = process.argv[2];
const inputPath = process.argv[3];

if (!command || !['generate', 'abstract', 'setup-db'].includes(command)) {
  console.log(`
Taxonomy Pipeline - Core Commands

Usage:
  bun run taxonomy-pipeline.ts generate <input-directory>  # Generate taxonomy
  bun run taxonomy-pipeline.ts abstract <input-directory>  # Abstract comments  
  bun run taxonomy-pipeline.ts setup-db                    # Setup database with taxonomy
  `);
  process.exit(1);
}

// Data structures
interface TaxonomyOutput {
  themes: string;
  attributes: {
    submitter_types: string[];
    market_segments: string[];
    geographic_scopes: string[];
    sentiment_types: string[];
    other_attributes: Record<string, string[]>;
  };
}

// Database initialization with all tables
const initDB = () => {
  const db = new Database('./output/abstractions.db');
  
  // Core tables
  db.run(`
    CREATE TABLE IF NOT EXISTS abstractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      submitter_type TEXT,
      submitter_type_confidence TEXT,
      organization_name TEXT,
      market_segment TEXT,
      stakeholder_category TEXT,
      geographic_scope TEXT,
      technical_sophistication TEXT,
      regulatory_stance TEXT,
      primary_themes TEXT,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS perspectives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      abstraction_id INTEGER NOT NULL,
      taxonomy_code TEXT NOT NULL,
      perspective TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      sentiment TEXT,
      FOREIGN KEY (abstraction_id) REFERENCES abstractions(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS taxonomy_ref (
      code TEXT PRIMARY KEY,
      description TEXT,
      level INTEGER,
      parent_code TEXT
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS observed_attributes (
      attribute_type TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (attribute_type, value)
    )
  `);
  
  // Extended tables for position analysis
  db.run(`
    CREATE TABLE IF NOT EXISTS theme_axes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_code TEXT NOT NULL,
      axis_name TEXT NOT NULL,
      axis_question TEXT NOT NULL,
      min_perspectives INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (theme_code) REFERENCES taxonomy_ref(code)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS axis_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      axis_id INTEGER NOT NULL,
      position_key TEXT NOT NULL,
      position_label TEXT NOT NULL,
      position_description TEXT,
      example_count INTEGER DEFAULT 0,
      FOREIGN KEY (axis_id) REFERENCES theme_axes(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS perspective_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perspective_id INTEGER NOT NULL,
      axis_id INTEGER NOT NULL,
      position_id INTEGER NOT NULL,
      confidence TEXT CHECK(confidence IN ('high', 'medium', 'low')),
      reasoning TEXT,
      FOREIGN KEY (perspective_id) REFERENCES perspectives(id),
      FOREIGN KEY (axis_id) REFERENCES theme_axes(id),
      FOREIGN KEY (position_id) REFERENCES axis_positions(id),
      UNIQUE(perspective_id, axis_id)
    )
  `);
  
  // Create useful indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_perspectives_taxonomy ON perspectives(taxonomy_code)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_perspectives_abstraction ON perspectives(abstraction_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_perspective_positions_axis ON perspective_positions(axis_id)`);
  
  return db;
};

const prompts = {
  initial: `Analyze these documents and synthesize a hierarchical taxonomy of descriptive themes.

TAXONOMY STRUCTURE:
- Create a multi-level hierarchy thinking in terms of storytelling narrative flow
- Use numeric coding:
  - Top level: 1, 2, 3, etc. (single digits only)
  - Second level: 1.1, 1.2, 1.3, etc.
  - Third level: 1.1.1, 1.1.2, 1.1.3, etc.
  - Continue as deep as needed
- If content doesn't fit established categories, attach it to the parent level

PERSPECTIVE EMBEDDING:
For each theme/sub-theme where perspectives are expressed:
• Perspective: [Viewpoint expressed in viewpoint-neutral framing]
  - Excerpt: "[Direct quote or close paraphrase]" (Organization/Author Name)
  - Excerpt: "[Another supporting quote]" (Different Author)

Documents:
{CONTENT}

OUTPUT FORMAT - Provide two clearly separated sections:

=== THEME TAXONOMY ===
[Your hierarchical numbered taxonomy with embedded perspectives]

=== OBSERVED ATTRIBUTES ===
Submitter Types: [comma-separated list]
Market Segments: [comma-separated list]  
Geographic Scopes: [comma-separated list]
Sentiment Types: [comma-separated list]
[Any other attribute types]: [comma-separated list]`,

  refine: `Refine this taxonomy to be mutually exclusive and collectively exhaustive (MECE).

Current taxonomy:
{TAXONOMY}

Requirements:
1. Each theme/perspective should appear in exactly ONE location
2. Verify nothing is lost - all perspectives must be preserved
3. Use consistent depth and parallel construction for siblings
4. Maintain the numeric coding system

OUTPUT FORMAT - Provide two clearly separated sections:

=== THEME TAXONOMY ===
[Your refined MECE taxonomy]

=== OBSERVED ATTRIBUTES ===
[Keep the exact same attributes from input]`,

  mergeThemes: `Merge these theme taxonomies into a unified structure.

RULES:
1. Combine similar themes, preserving ALL perspectives and excerpts
2. Maintain numeric coding, renumbering as needed
3. {PERSPECTIVE_RULE}

Taxonomy 1:
{TAXONOMY1}

Taxonomy 2:
{TAXONOMY2}

Output ONLY the merged theme taxonomy (not attributes).`,

  mergeAttributes: `Merge these observed attribute lists, removing duplicates.

Attributes 1:
{ATTRIBUTES1}

Attributes 2:
{ATTRIBUTES2}

Output the consolidated attributes in this exact format:
Submitter Types: [merged list]
Market Segments: [merged list]
Geographic Scopes: [merged list]
Sentiment Types: [merged list]
[Other types if any]: [merged list]`,

  finalMerge: `Create a high-level synthesis of these theme taxonomies.

CONSOLIDATION APPROACH:
1. Major themes at level 1 (use single digits: 1, 2, 3, etc.)
2. Sub-themes at level 2 (1.1, 1.2, etc.)  
3. Further detail at level 3+ as needed
4. At this consolidation level, preserve only representative perspectives that best illustrate each theme

Add at the top:
GUIDANCE FOR DATA ABSTRACTORS:
- Code to the most specific level (e.g., use 2.1.3 not just 2.1)
- Multiple codes may apply to a single comment
- [Add specific guidance based on the taxonomy structure]

Taxonomies to merge:
{TAXONOMIES}

Output the consolidated theme taxonomy with abstractor guidance.`,

  abstract: `Analyze this comment using the provided taxonomy and attributes.

THEME TAXONOMY:
{TAXONOMY}

OBSERVED ATTRIBUTES:
{ATTRIBUTES}

COMMENT:
{CONTENT}

Extract:
1. For each perspective: taxonomy code, viewpoint-neutral framing, exact excerpt, sentiment
2. Submitter identification using observed types (with confidence level)
3. Attributes using only the observed categories
4. Derived attributes: stakeholder category, technical sophistication, regulatory stance
5. Primary theme codes (top 3-5 by emphasis)

Output as JSON:
{
  "submitter": {
    "type": "[from observed types]",
    "confidence": "Explicit|High|Medium|Low",
    "organization": "name or null"
  },
  "attributes": {
    "market_segment": "[from observed]",
    "geographic_scope": "[from observed]",
    "stakeholder_category": "Patient|Provider|Payer|Vendor|Regulator|Other",
    "technical_sophistication": "High|Medium|Low",
    "regulatory_stance": "[from observed sentiments]"
  },
  "primary_themes": ["1.2", "3.1.4", "..."],
  "perspectives": [
    {
      "taxonomy_code": "2.1.3",
      "perspective": "...",
      "excerpt": "...",
      "sentiment": "[from observed]"
    }
  ]
}`
};

async function generateTaxonomy(dir: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const files = await readdir(dir);
  const batches: string[][] = [];
  
  await mkdir('./output', { recursive: true });
  
  // Create batches
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    batches.push(files.slice(i, i + BATCH_SIZE));
  }

  // Process each batch
  const batchOutputs: TaxonomyOutput[] = [];
  
  for (const [idx, batch] of batches.entries()) {
    console.log(`Processing batch ${idx + 1}/${batches.length}`);
    
    const contents = await Promise.all(
      batch.map(async f => {
        const content = await readFile(join(dir, f), 'utf-8');
        return `\n---FILE: ${f}---\n${content}`;
      })
    );
    
    // Generate initial taxonomy
    let response = await generateContent(ai, prompts.initial.replace('{CONTENT}', contents.join('\n')));
    
    // Parse output
    let output = parseGeneratorOutput(response);
    
    // Refine to MECE
    response = await generateContent(ai, prompts.refine.replace('{TAXONOMY}', formatForRefinement(output)));
    output = parseGeneratorOutput(response);
    
    batchOutputs.push(output);
    
    // Save intermediate
    await Bun.write(`./output/batch_${idx + 1}_taxonomy.md`, formatOutput(output));
  }

  // Merge process
  let currentOutputs = [...batchOutputs];
  let level = 1;
  
  while (currentOutputs.length > 1) {
    console.log(`Merge level ${level}, ${currentOutputs.length} taxonomies`);
    const newOutputs: TaxonomyOutput[] = [];
    
    for (let i = 0; i < currentOutputs.length; i += 2) {
      if (i + 1 < currentOutputs.length) {
        // Merge themes
        const perspectiveRule = level === 1 
          ? "Preserve ALL perspectives and excerpts from both taxonomies"
          : "Preserve representative perspectives that best illustrate each theme";
          
        const mergedThemes = await generateContent(ai, 
          prompts.mergeThemes
            .replace('{PERSPECTIVE_RULE}', perspectiveRule)
            .replace('{TAXONOMY1}', currentOutputs[i].themes)
            .replace('{TAXONOMY2}', currentOutputs[i + 1].themes)
        );
        
        // Merge attributes
        const mergedAttrs = await generateContent(ai,
          prompts.mergeAttributes
            .replace('{ATTRIBUTES1}', formatAttributes(currentOutputs[i].attributes))
            .replace('{ATTRIBUTES2}', formatAttributes(currentOutputs[i + 1].attributes))
        );
        
        const merged: TaxonomyOutput = {
          themes: mergedThemes,
          attributes: parseAttributes(mergedAttrs)
        };
        
        newOutputs.push(merged);
        await Bun.write(`./output/merge_L${level}_${Math.floor(i/2)}.md`, formatOutput(merged));
      } else {
        newOutputs.push(currentOutputs[i]);
      }
    }
    
    currentOutputs = newOutputs;
    level++;
  }

  // Final consolidation if needed
  if (level > 2) {
    const finalThemes = await generateContent(ai,
      prompts.finalMerge.replace('{TAXONOMIES}', currentOutputs[0].themes)
    );
    currentOutputs[0].themes = finalThemes;
  }

  // Save final taxonomy
  const final = currentOutputs[0];
  await Bun.write('./output/final_taxonomy.md', formatOutput(final));
  await Bun.write('./output/observed_attributes.json', JSON.stringify(final.attributes, null, 2));
  
  return final;
}

async function abstractComments(dir: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const db = initDB();
  
  // Load taxonomy and attributes
  let taxonomyData: TaxonomyOutput;
  try {
    const themes = await readFile('./output/final_taxonomy.md', 'utf-8');
    const attributes = JSON.parse(await readFile('./output/observed_attributes.json', 'utf-8'));
    taxonomyData = { themes, attributes };
  } catch (error) {
    console.error('Error: No taxonomy found. Run "generate" command first.');
    process.exit(1);
  }
  
  // Process files
  const files = await readdir(dir);
  const insertAbstraction = db.prepare(`
    INSERT INTO abstractions (
      filename, content, submitter_type, submitter_type_confidence,
      organization_name, market_segment, stakeholder_category,
      geographic_scope, technical_sophistication, regulatory_stance,
      primary_themes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertPerspective = db.prepare(`
    INSERT INTO perspectives (
      abstraction_id, taxonomy_code, perspective, excerpt, sentiment
    ) VALUES (?, ?, ?, ?, ?)
  `);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const [idx, file] of files.entries()) {
    console.log(`Abstracting ${idx + 1}/${files.length}: ${file}`);
    
    try {
      const content = await readFile(join(dir, file), 'utf-8');
      
      const response = await generateContent(ai, 
        prompts.abstract
          .replace('{TAXONOMY}', taxonomyData.themes)
          .replace('{ATTRIBUTES}', formatAttributes(taxonomyData.attributes))
          .replace('{CONTENT}', content)
      );
      
      let data;
      try {
        data = JSON.parse(response);
      } catch (parseError) {
        console.error(`JSON parse error for ${file}:`, parseError);
        console.error('Response preview:', response.substring(0, 500));
        errorCount++;
        continue;
      }
      
      const result = insertAbstraction.run(
        file,
        content,
        data.submitter.type,
        data.submitter.confidence,
        data.submitter.organization || null,
        data.attributes.market_segment,
        data.attributes.stakeholder_category,
        data.attributes.geographic_scope,
        data.attributes.technical_sophistication,
        data.attributes.regulatory_stance,
        data.primary_themes.join(', ')
      );
      
      const abstractionId = result.lastInsertRowid;
      
      for (const perspective of data.perspectives) {
        insertPerspective.run(
          abstractionId,
          perspective.taxonomy_code,
          perspective.perspective,
          perspective.excerpt,
          perspective.sentiment
        );
      }
      
      successCount++;
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
      errorCount++;
    }
  }
  
  db.close();
  
  // Print summary
  console.log(`\nAbstraction complete!`);
  console.log(`✓ Successfully processed: ${successCount} documents`);
  if (errorCount > 0) {
    console.log(`✗ Errors encountered: ${errorCount} documents`);
  }
  
  // Print statistics
  const statsDb = new Database('./output/abstractions.db');
  const stats = statsDb.prepare(`
    SELECT 
      COUNT(DISTINCT a.id) as total_docs,
      COUNT(DISTINCT p.id) as total_perspectives,
      COUNT(DISTINCT p.taxonomy_code) as unique_themes
    FROM abstractions a
    LEFT JOIN perspectives p ON a.id = p.abstraction_id
  `).get() as any;
  
  console.log(`\nDatabase Statistics:`);
  console.log(`- Total documents: ${stats.total_docs}`);
  console.log(`- Total perspectives: ${stats.total_perspectives}`);
  console.log(`- Unique themes referenced: ${stats.unique_themes}`);
  
  statsDb.close();
}

async function setupDatabase() {
  const db = initDB();
  
  try {
    // Load taxonomy
    const taxonomyText = await readFile('./output/final_taxonomy.md', 'utf-8');
    const attributes = JSON.parse(await readFile('./output/observed_attributes.json', 'utf-8'));
    
    // Parse and populate taxonomy reference
    const taxonomyEntries = parseTaxonomyForDB(taxonomyText);
    const insertTaxonomy = db.prepare(
      'INSERT OR REPLACE INTO taxonomy_ref (code, description, level, parent_code) VALUES (?, ?, ?, ?)'
    );
    
    for (const entry of taxonomyEntries) {
      insertTaxonomy.run(entry.code, entry.description, entry.level, entry.parent_code);
    }
    
    // Populate observed attributes
    const insertAttr = db.prepare(
      'INSERT OR REPLACE INTO observed_attributes (attribute_type, value) VALUES (?, ?)'
    );
    
    for (const [attrType, values] of Object.entries(attributes)) {
      if (Array.isArray(values)) {
        for (const value of values) {
          insertAttr.run(attrType, value);
        }
      }
    }
    
    console.log('Database setup complete!');
    console.log(`- Loaded ${taxonomyEntries.length} taxonomy entries`);
    console.log(`- Loaded ${Object.keys(attributes).length} attribute types`);
    
  } catch (error) {
    console.error('Error setting up database:', error);
  }
  
  db.close();
}

// Helper functions
async function generateContent(ai: GoogleGenAI, prompt: string): Promise<string> {
  const config = { responseMimeType: 'text/plain' };
  const contents = [{
    role: 'user' as const,
    parts: [{ text: prompt }]
  }];
  
  const response = await ai.models.generateContentStream({
    model: MODEL,
    config,
    contents,
  });
  
  let result = '';
  for await (const chunk of response) {
    result += chunk.text;
  }
  
  return result;
}

function parseGeneratorOutput(response: string): TaxonomyOutput {
  const parts = response.split(/=== OBSERVED ATTRIBUTES ===/i);
  const themes = parts[0].replace(/=== THEME TAXONOMY ===/i, '').trim();
  const attributes = parts[1] ? parseAttributes(parts[1]) : {
    submitter_types: [],
    market_segments: [],
    geographic_scopes: [],
    sentiment_types: [],
    other_attributes: {}
  };
  
  return { themes, attributes };
}

function parseAttributes(text: string): TaxonomyOutput['attributes'] {
  const result: TaxonomyOutput['attributes'] = {
    submitter_types: [],
    market_segments: [],
    geographic_scopes: [],
    sentiment_types: [],
    other_attributes: {}
  };
  
  const lines = text.trim().split('\n');
  for (const line of lines) {
    const match = line.match(/^(.+?):\s*(.+)$/);
    if (match) {
      const [_, key, valuesStr] = match;
      const values = valuesStr.split(',').map(v => v.trim()).filter(v => v);
      
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
      if (normalizedKey === 'submitter_types') {
        result.submitter_types = values;
      } else if (normalizedKey === 'market_segments') {
        result.market_segments = values;
      } else if (normalizedKey === 'geographic_scopes') {
        result.geographic_scopes = values;
      } else if (normalizedKey === 'sentiment_types') {
        result.sentiment_types = values;
      } else {
        result.other_attributes[key] = values;
      }
    }
  }
  
  return result;
}

function formatAttributes(attrs: TaxonomyOutput['attributes']): string {
  let result = '';
  if (attrs.submitter_types.length) {
    result += `Submitter Types: ${attrs.submitter_types.join(', ')}\n`;
  }
  if (attrs.market_segments.length) {
    result += `Market Segments: ${attrs.market_segments.join(', ')}\n`;
  }
  if (attrs.geographic_scopes.length) {
    result += `Geographic Scopes: ${attrs.geographic_scopes.join(', ')}\n`;
  }
  if (attrs.sentiment_types.length) {
    result += `Sentiment Types: ${attrs.sentiment_types.join(', ')}\n`;
  }
  for (const [key, values] of Object.entries(attrs.other_attributes)) {
    result += `${key}: ${values.join(', ')}\n`;
  }
  return result.trim();
}

function formatForRefinement(output: TaxonomyOutput): string {
  return `${output.themes}\n\n=== OBSERVED ATTRIBUTES ===\n${formatAttributes(output.attributes)}`;
}

function formatOutput(output: TaxonomyOutput): string {
  return `=== THEME TAXONOMY ===\n${output.themes}\n\n=== OBSERVED ATTRIBUTES ===\n${formatAttributes(output.attributes)}`;
}

function parseTaxonomyForDB(taxonomyText: string): Array<{
  code: string;
  description: string;
  level: number;
  parent_code: string | null;
}> {
  const entries: Array<{code: string; description: string; level: number; parent_code: string | null}> = [];
  const lines = taxonomyText.split('\n');
  
  for (const line of lines) {
    // Match lines like "1. Theme Name" or "1.2.3 Theme Name"
    const match = line.match(/^\s*(\d+(?:\.\d+)*)\s+(.+)$/);
    if (match) {
      const [_, code, description] = match;
      const level = code.split('.').length;
      
      // Determine parent code
      let parentCode = null;
      if (level > 1) {
        const parts = code.split('.');
        parts.pop();
        parentCode = parts.join('.');
      }
      
      entries.push({
        code,
        description: description.trim(),
        level,
        parent_code: parentCode
      });
    }
  }
  
  return entries;
}

// Main execution
if (command === 'generate') {
  console.log(`Generating taxonomy from ${inputPath || './comments'}`);
  generateTaxonomy(inputPath || './comments')
    .then(() => console.log('\nTaxonomy generation complete!'))
    .catch(console.error);
} else if (command === 'abstract') {
  console.log(`Abstracting comments from ${inputPath || './comments'}`);
  abstractComments(inputPath || './comments')
    .catch(console.error);
} else if (command === 'setup-db') {
  console.log('Setting up database with taxonomy...');
  setupDatabase()
    .catch(console.error);
}
