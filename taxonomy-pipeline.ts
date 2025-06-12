import { GoogleGenAI } from '@google/genai';
import { readFile, mkdir } from 'fs/promises';
import { Database } from 'bun:sqlite';
import { 
  loadCommentsFromDb, 
  enrichComment, 
  createWordLimitedBatches,
  generateInitialTaxonomyPrompt,
  generateContent,
  parseGeneratorOutput,
  formatOutput,
  formatAttributes,
  prompts,
  type EnrichedComment,
  type TaxonomyOutput
} from './lib/comment-processing.js';

const WORD_LIMIT = 20000; // 20k words per batch
const DEFAULT_BATCH_COUNT = 3; // Default number of independent batches to taxonomize
const MODEL = 'gemini-2.5-pro-preview-06-05';

// Command parsing
const command = process.argv[2];
const inputPath = process.argv[3];
let batchCount = DEFAULT_BATCH_COUNT;
let debugMode = false;

// Abstract command specific options
let limitComments = 1000; // Default limit for abstract command
let randomSelection = false;
let filters: Array<{key: string, value: string}> = [];

// Parse remaining arguments
for (let i = 4; i < process.argv.length; i++) {
  const arg = process.argv[i];
  
  if (arg === '--debug') {
    debugMode = true;
  } else if (arg === '--random') {
    randomSelection = true;
  } else if (arg === '--limit' && i + 1 < process.argv.length) {
    const limitValue = parseInt(process.argv[i + 1]);
    if (!isNaN(limitValue)) {
      limitComments = limitValue;
      i++; // Skip the next argument since we consumed it
    }
  } else if (arg === '--filter' && i + 1 < process.argv.length) {
    const filterArg = process.argv[i + 1];
    const [key, value] = filterArg.split('=');
    if (key && value) {
      filters.push({ key: key.trim(), value: value.trim() });
      i++; // Skip the next argument since we consumed it
    }
  } else if (!isNaN(parseInt(arg)) && command === 'generate') {
    // Batch count only applies to generate command
    batchCount = parseInt(arg);
  }
}

if (!command || !['generate', 'abstract', 'setup-db'].includes(command)) {
  console.log(`
Taxonomy Pipeline - Core Commands

Usage:
  bun run taxonomy-pipeline.ts generate <comments-db-file> [batch-count] [--debug]
  bun run taxonomy-pipeline.ts abstract <comments-db-file> [--limit N] [--random] [--filter key=value] [--debug]
  bun run taxonomy-pipeline.ts setup-db [--debug]
  
Generate Arguments:
  batch-count: Number of independent batches to taxonomize (default: ${DEFAULT_BATCH_COUNT})
  
Abstract Arguments:
  --limit N: Maximum number of comments to process (default: 1000)
  --random: Randomly select comments from the filtered set
  --filter key=value: Filter comments by JSON attribute (can use multiple times)
                     Examples: --filter category=Individual --filter country=US
  
Global Arguments:
  --debug: Save all intermediate prompts, responses, and parsed values to ./progress/
  
Examples:
  # Generate taxonomy from 2 batches
  bun run taxonomy-pipeline.ts generate comments.db 2
  
  # Abstract 500 random comments
  bun run taxonomy-pipeline.ts abstract comments.db --limit 500 --random
  
  # Abstract comments from individuals in California
  bun run taxonomy-pipeline.ts abstract comments.db --filter category=Individual --filter stateProvinceRegion=CA
  `);
  process.exit(1);
}

if ((command === 'generate' || command === 'abstract') && !inputPath) {
    console.error(`Error: Input database file is required for '${command}' command.`);
    console.log(`Usage: bun run taxonomy-pipeline.ts ${command} <comments-db-file> [batch-count] [--debug]`);
    process.exit(1);
}

// Debug logging helper
async function debugLog(fileName: string, content: string) {
  if (debugMode) {
    await mkdir('./progress', { recursive: true });
    await Bun.write(`./progress/${fileName}`, content);
  }
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

// Shared JSON output format template
const ABSTRACT_JSON_OUTPUT_FORMAT = `{
  "submitter": {
    "type": "[from observed types]",
    "confidence": "Explicit|High|Medium|Low",
    "organization": "name or null"
  },
  "attributes": {
    "market_segment": "[from observed]",
    "geographic_scope": "[from observed]",
    "[other categories]": "[from additonal categories]"
  },
  "primary_themes": ["[theme_code]", "[theme_code]", "..."],
  "perspectives": [
    {
      "taxonomy_code": "[theme_code]",
      "perspective": "[pithy viewpoint description]",
      "excerpts": "[direct quotes, semicolon-separated]"
    }
  ]
}`;

const abstract_prompt = `Analyze this comment using the provided taxonomy and attributes.

THEME TAXONOMY:
{TAXONOMY}

OBSERVED ATTRIBUTES:
{ATTRIBUTES}

COMMENT:
{CONTENT}


Think about every viewpoint the commenter has expressed; we call these "perspectives." For each perspective, extract:
1. taxonomy code where the perspecitve best fits (use higher level codes if leaf nodes don't work), a brief articulation of the perspective, and any excerpt(s) that support it.
2. Submitter identification using observed types (with confidence level)
3. Attributes using the observed categories and values

Output as JSON:
${ABSTRACT_JSON_OUTPUT_FORMAT}`;

// Helper function to filter comments based on JSON attributes
function filterComments(comments: any[], filters: Array<{key: string, value: string}>): any[] {
  if (filters.length === 0) return comments;
  
  return comments.filter(comment => {
    try {
      const attributes = JSON.parse(comment.attributes_json);
      
      return filters.every(filter => {
        // Support nested key access with dot notation (e.g., "submitter.type")
        const value = filter.key.split('.').reduce((obj, key) => obj?.[key], attributes);
        
        // Case-insensitive comparison
        if (typeof value === 'string') {
          return value.toLowerCase().includes(filter.value.toLowerCase());
        }
        
        // Exact match for non-strings
        return value === filter.value;
      });
    } catch (e) {
      // If JSON parsing fails, exclude the comment
      return false;
    }
  });
}

// Helper function to select comments (with optional random sampling)
function selectComments(comments: any[], limit: number, random: boolean): any[] {
  if (comments.length <= limit) {
    return random ? comments.sort(() => Math.random() - 0.5) : comments;
  }
  
  if (random) {
    // Fisher-Yates shuffle and take first N
    const shuffled = [...comments];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, limit);
  } else {
    // Take first N comments
    return comments.slice(0, limit);
  }
}

async function generateTaxonomy(dbPath: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  if (debugMode) {
    console.log('🐛 Debug mode enabled - saving all intermediate artifacts to ./progress/');
    await mkdir('./progress', { recursive: true });
  }
  
  // Load comments and attachments using core library
  const { comments, attachments, totalComments } = loadCommentsFromDb(dbPath);
  console.log(`📊 Filtered ${comments.length} submissions from ${totalComments} total comments`);

  await mkdir('./output', { recursive: true });
  
  // Enrich comments with metadata and PDF attachments
  const enrichedComments = await Promise.all(
    comments.map(c => enrichComment(c, attachments))
  );
  
  const validComments = enrichedComments.filter(c => c !== null) as EnrichedComment[];
  
  console.log(`Total comments available: ${validComments.length}`);
  console.log(`Creating ${batchCount} independent batches with ~${WORD_LIMIT} words each...`);
  
  // Create word-limited batches using core library
  const allBatches = createWordLimitedBatches(validComments, WORD_LIMIT, true);
  
  if (allBatches.length < batchCount) {
    console.warn(`⚠️  Warning: Only ${allBatches.length} batches available, but ${batchCount} requested. Using all available batches.`);
  }
  
  const batchesToProcess = allBatches.slice(0, batchCount);
  
  console.log(`Processing ${batchesToProcess.length} batches`);
  batchesToProcess.forEach((batch, idx) => {
    const totalWords = batch.reduce((sum, c) => sum + c.wordCount, 0);
    console.log(`  Batch ${idx + 1}: ${batch.length} comments, ~${totalWords} words`);
  });

  // Process each batch to create independent taxonomies (no refinement)
  const taxonomies: TaxonomyOutput[] = [];
  
  for (let i = 0; i < batchesToProcess.length; i++) {
    console.log(`\nProcessing batch ${i + 1}/${batchesToProcess.length} (${batchesToProcess[i].length} comments)...`);
    
    const prompt = generateInitialTaxonomyPrompt(batchesToProcess[i]);
    await debugLog(`batch_${i + 1}_prompt.txt`, prompt);
    
    const response = await generateContent(ai, prompt);
    await debugLog(`batch_${i + 1}_response.txt`, response);
    
    const taxonomy = parseGeneratorOutput(response);
    await debugLog(`batch_${i + 1}_parsed.json`, JSON.stringify(taxonomy, null, 2));
    
    taxonomies.push(taxonomy);
    await Bun.write(`./output/batch_${i + 1}_taxonomy.md`, formatOutput(taxonomy));
    console.log(`✓ Taxonomy ${i + 1} created`);
  }

  // Merge taxonomies pairwise until we have one final taxonomy
  let currentTaxonomies = [...taxonomies];
  let mergeLevel = 1;
  
  while (currentTaxonomies.length > 1) {
    console.log(`\nMerge level ${mergeLevel}: merging ${currentTaxonomies.length} taxonomies`);
    const newTaxonomies: TaxonomyOutput[] = [];
    
    for (let i = 0; i < currentTaxonomies.length; i += 2) {
      if (i + 1 < currentTaxonomies.length) {
        console.log(`Merging taxonomies ${i + 1} and ${i + 2}...`);
        
        const mergePrompt = prompts.mergeThemes
          .replace('{TAXONOMY1}', currentTaxonomies[i].themes)
          .replace('{TAXONOMY2}', currentTaxonomies[i + 1].themes);
        
        await debugLog(`merge_L${mergeLevel}_${Math.floor(i/2) + 1}_prompt.txt`, mergePrompt);
        
        const mergedResponse = await generateContent(ai, mergePrompt);
        await debugLog(`merge_L${mergeLevel}_${Math.floor(i/2) + 1}_response.txt`, mergedResponse);
        
        const mergedTaxonomy = parseGeneratorOutput(mergedResponse);
        
        // Merge attributes from both taxonomies (programmatically)
        const mergedAttributes: Record<string, string[]> = {};
        
        // Get all unique keys from both taxonomies
        const allKeys = new Set([
          ...Object.keys(currentTaxonomies[i].attributes),
          ...Object.keys(currentTaxonomies[i + 1].attributes)
        ]);
        
        // Merge values for each key using set operations
        for (const key of allKeys) {
          const values1 = currentTaxonomies[i].attributes[key] || [];
          const values2 = currentTaxonomies[i + 1].attributes[key] || [];
          mergedAttributes[key] = [...new Set([...values1, ...values2])];
        }
        
        mergedTaxonomy.attributes = mergedAttributes;
        
        await debugLog(`merge_L${mergeLevel}_${Math.floor(i/2) + 1}_parsed.json`, JSON.stringify(mergedTaxonomy, null, 2));
        
        newTaxonomies.push(mergedTaxonomy);
        
        await Bun.write(`./output/merge_L${mergeLevel}_${Math.floor(i/2) + 1}.md`, formatOutput(mergedTaxonomy));
      } else {
        // Odd one out, carry forward
        newTaxonomies.push(currentTaxonomies[i]);
      }
    }
    
    currentTaxonomies = newTaxonomies;
    mergeLevel++;
  }

  // Final step: Refine attributes using AI
  const preFinalTaxonomy = currentTaxonomies[0];
  console.log(`\n🔧 Refining final attributes...`);
  
  const attributePrompt = prompts.refineAttributes.replace('{ATTRIBUTES}', formatAttributes(preFinalTaxonomy.attributes));
  await debugLog('final_attribute_refinement_prompt.txt', attributePrompt);
  
  const refinedAttributesResponse = await generateContent(ai, attributePrompt);
  await debugLog('final_attribute_refinement_response.txt', refinedAttributesResponse);
  
  // Parse the refined attributes response
  const refinedAttributes = parseGeneratorOutput(`=== THEME TAXONOMY ===\n\n${refinedAttributesResponse}`);
  await debugLog('final_attribute_refinement_parsed.json', JSON.stringify(refinedAttributes.attributes, null, 2));
  
  // Create final taxonomy with refined attributes
  const final: TaxonomyOutput = {
    themes: preFinalTaxonomy.themes,
    attributes: refinedAttributes.attributes
  };

  // Save final taxonomy (themes only, no bold formatting)
  const cleanThemes = final.themes.replace(/\*\*/g, ''); // Remove all ** bold markers
  await Bun.write('./output/taxonomy.md', cleanThemes);
  await Bun.write('./output/observed_attributes.json', JSON.stringify(final.attributes, null, 2));
  
  if (debugMode) {
    await debugLog('final_taxonomy_complete.json', JSON.stringify(final, null, 2));
  }
  
  console.log(`\n✅ Taxonomy generation complete!`);
  console.log(`- Processed ${validComments.length} comments across ${batchesToProcess.length} initial batches`);
  console.log(`- Performed ${mergeLevel - 1} levels of merging`);
  console.log(`- Applied final attribute refinement`);
  console.log(`- Final taxonomy saved to ./output/taxonomy.md`);
  console.log(`- Observed attributes saved to ./output/observed_attributes.json`);
  if (debugMode) {
    console.log(`- Debug artifacts saved to ./progress/`);
  }
  
  return final;
}

async function abstractComments(dbPath: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const db = initDB();
  
  // Load taxonomy and attributes
  let taxonomyData: TaxonomyOutput;
  try {
    const themes = await readFile('./output/taxonomy.md', 'utf-8');
    const attributes = JSON.parse(await readFile('./output/observed_attributes.json', 'utf-8'));
    taxonomyData = { themes, attributes };
  } catch (error) {
    console.error('Error: No taxonomy found. Run "generate" command first.');
    process.exit(1);
  }
  
  // Process comments from DB using core library
  const { comments: allComments, totalComments } = loadCommentsFromDb(dbPath);
  console.log(`📊 Loaded ${allComments.length} submissions from ${totalComments} total comments`);
  
  // Apply filters if specified
  let filteredComments = allComments;
  if (filters.length > 0) {
    filteredComments = filterComments(allComments, filters);
    console.log(`🔍 Applied ${filters.length} filter(s), ${filteredComments.length} comments match`);
    filters.forEach(f => console.log(`   - ${f.key}=${f.value}`));
  }
  
  // Apply limit and random selection
  const selectedComments = selectComments(filteredComments, limitComments, randomSelection);
  console.log(`📝 Selected ${selectedComments.length} comments for processing${randomSelection ? ' (random selection)' : ''}`);
  
  if (selectedComments.length === 0) {
    console.warn('No comments to process after filtering and selection.');
    return;
  }

  const insertAbstraction = db.prepare(`
    INSERT INTO abstractions (
      filename, content, submitter_type, submitter_type_confidence,
      organization_name, market_segment, stakeholder_category,
      geographic_scope, technical_sophistication,
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
  
  for (const [idx, comment] of selectedComments.entries()) {
    const file = comment.id; // Use comment ID as the filename identifier
    console.log(`Abstracting ${idx + 1}/${selectedComments.length}: ${file}`);
    
    try {
      const attributes = JSON.parse(comment.attributes_json);
      const content = attributes.comment || '';
      if (!content) {
        console.warn(`Skipping comment ${file} due to empty content.`);
        continue;
      }
      
      const response = await generateContent(ai, 
        abstract_prompt
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
    const taxonomyText = await readFile('./output/taxonomy.md', 'utf-8');
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
  console.log(`Generating taxonomy from ${inputPath} using ${batchCount} independent batches${debugMode ? ' (debug mode)' : ''}`);
  generateTaxonomy(inputPath)
    .then(() => console.log('\nTaxonomy generation complete!'))
    .catch(console.error);
} else if (command === 'abstract') {
  const filterDesc = filters.length > 0 ? ` with ${filters.length} filter(s)` : '';
  const limitDesc = limitComments !== 1000 ? ` (limit: ${limitComments})` : '';
  const randomDesc = randomSelection ? ' (random selection)' : '';
  console.log(`Abstracting comments from ${inputPath}${filterDesc}${limitDesc}${randomDesc}`);
  abstractComments(inputPath)
    .catch(console.error);
} else if (command === 'setup-db') {
  console.log('Setting up database with taxonomy...');
  setupDatabase()
    .catch(console.error);
}
