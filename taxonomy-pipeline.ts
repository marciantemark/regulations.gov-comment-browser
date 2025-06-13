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
import { analyzeThemes } from './theme-analysis.js';

const WORD_LIMIT = 20000; // 20k words per batch
const DEFAULT_BATCH_COUNT = 3; // Default number of independent batches to taxonomize

// Command parsing
const command = process.argv[2];
const inputPath = process.argv[3];
let batchCount = DEFAULT_BATCH_COUNT;
let debugMode = false;
let themeCodes: string[] | null = null; // for analyze-themes

// Abstract command specific options
let limitComments = 1000; // Default limit for abstract command
let randomSelection = false;
let retryFailed = false;
let filters: Array<{key: string, value: string}> = [];

// Determine where flag parsing should begin
const flagStartIndex = (command === 'generate' || command === 'abstract') ? 4 : 3;

// Parse remaining arguments (flags)
for (let i = flagStartIndex; i < process.argv.length; i++) {
  const arg = process.argv[i];
  
  if (arg === '--debug') {
    debugMode = true;
  } else if (arg === '--random') {
    randomSelection = true;
  } else if (arg === '--retry-failed') {
    retryFailed = true;
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
  } else if (command === 'analyze-themes' && arg === '--themes' && i + 1 < process.argv.length) {
    themeCodes = process.argv[i + 1].split(',').map(s => s.trim()).filter(Boolean);
    i++;
  }
}

if (!command || !['generate', 'abstract', 'setup-db', 'analyze-themes'].includes(command)) {
  console.log(`
Taxonomy Pipeline - Core Commands

Usage:
  bun run taxonomy-pipeline.ts generate <comments-db-file> [batch-count] [--debug]
  bun run taxonomy-pipeline.ts abstract <comments-db-file> [--limit N] [--random] [--filter key=value] [--debug]
  bun run taxonomy-pipeline.ts setup-db [--debug]
  bun run taxonomy-pipeline.ts analyze-themes [--themes code1,code2] [--debug]
  
Generate Command:
  Creates a hierarchical taxonomy by processing comments in independent batches,
  then merging the results. Requires taxonomy generation before abstraction.
  
  Arguments:
    batch-count: Number of independent batches to taxonomize (default: ${DEFAULT_BATCH_COUNT})
  
Abstract Command:
  Analyzes individual comments using existing taxonomy to extract themes and perspectives.
  Stores results in abstractions database for further analysis.
  
  Note: Use the original comments database file (e.g., cms-rfi.sqlite), NOT the abstractions.db file.
  
  Arguments:
    --limit N: Maximum number of comments to process (default: 1000)
    --random: Randomly select comments from the filtered set
    --retry-failed: Only process comments that previously failed processing
    --filter key=value: Filter comments by JSON attribute (can use multiple times)
                       Examples: --filter category=Individual --filter stateProvinceRegion=CA
  
Setup-DB Command:
  Initializes the abstractions database with taxonomy reference tables.
  Run after 'generate' and before 'abstract'.
  
Global Arguments:
  --debug: Save all intermediate prompts, responses, and parsed values to ./progress/
  
Workflow:
  1. bun run taxonomy-pipeline.ts generate comments.db 3
  2. bun run taxonomy-pipeline.ts setup-db
  3. bun run taxonomy-pipeline.ts abstract comments.db --limit 500 --random
  
Examples:
  # Generate taxonomy from 2 batches
  bun run taxonomy-pipeline.ts generate comments.db 2
  
  # Setup database with taxonomy
  bun run taxonomy-pipeline.ts setup-db
  
  # Abstract 500 random comments
  bun run taxonomy-pipeline.ts abstract comments.db --limit 500 --random
  
  # Abstract comments from individuals in California
  bun run taxonomy-pipeline.ts abstract comments.db --filter category=Individual --filter stateProvinceRegion=CA
  `);
  process.exit(1);
}

if ((command === 'generate' || command === 'abstract') && !inputPath) {
    console.error(`Error: Input database file is required for '${command}' command.`);
    if (command === 'generate') {
        console.log(`Usage: bun run taxonomy-pipeline.ts generate <comments-db-file> [batch-count] [--debug]`);
    } else {
        console.log(`Usage: bun run taxonomy-pipeline.ts abstract <comments-db-file> [--limit N] [--random] [--filter key=value] [--debug]`);
    }
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
const initDB = async () => {
  const db = new Database('./output/abstractions.db');
  const schema = await readFile('./database-schema.sql', 'utf-8');
  db.exec(schema);
  return db;
};

// Shared JSON output format template
const ABSTRACT_JSON_OUTPUT_FORMAT = `{
  "submitter": {
    "type": "from supplied list of types",
    "confidence": "Explicit|High|Medium|Low",
    "organization": "name or null"
  },
  "attributes": { // ONLY if you see these explicitly mentioned / high confidence
    "market_segment": "from supplied list; semicolon sepaerated for multiple",
    "geographic_scope": "from supplied list; semicolon sepaerated",
    "[other categories]": "from supplied list; semicolon sepaerated"
  },
  "brainstorming": "Use this slot to think about every theme that this comment touches upon -- be thorough and granular; at this stage split don't lump.",
  "perspectives": {
    "[theme code, e.g. '1.1']": {
      "perspective": ["array of pithy viewpoint descriptions, each <10 words when possible"],
      "excerpts": ["direct quote 1", "direct quote 2", "etc", "showing full context", "supporting the perspectives", "..."]
    }
  }
}`;

const abstract_prompt = `Analyze this comment using the provided taxonomy and attributes.

THEME TAXONOMY:
{TAXONOMY}

OBSERVED ATTRIBUTES:
{ATTRIBUTES}

<comment>
{CONTENT}
</comment>

Think about every individual viewpoint the commenter has expressed; we call these "perspectives." Be thorough and find all perspectives expressed by the commenter, which could include multiple perspectives for a single theme! Be complete. For each perspective, extract:
1. taxonomy code where the perspecitve best fits (use higher level codes if leaf nodes don't work), a brief articulation of the perspective, and any excerpt(s) that support it.
2. Submitter identification using observed types (with confidence level)
3. Attributes using the observed categories and values (only with high confidence)

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
  const db = await initDB();
  
  // Load taxonomy and attributes from the database
  const taxonomyRows = db.prepare('SELECT code, description, level, parent_code FROM taxonomy_ref ORDER BY code').all();
  const attributeRows = db.prepare('SELECT attribute_type, value FROM observed_attributes').all();
  
  if (taxonomyRows.length === 0) {
    console.error('Error: No taxonomy found in the database. Run "bun run setup-db" command first.');
    process.exit(1);
  }
  
  // Reconstruct the taxonomy and attributes objects
  const themes = (taxonomyRows as any[]).map(row => {
    const indent = '  '.repeat(row.level - 1);
    return `${indent}${row.code} ${row.description}`;
  }).join('\n');
  
  const attributes = (attributeRows as any[]).reduce((acc, row) => {
    if (!acc[row.attribute_type]) {
      acc[row.attribute_type] = [];
    }
    acc[row.attribute_type].push(row.value);
    return acc;
  }, {} as Record<string, string[]>);
  
  const taxonomyData: TaxonomyOutput = { themes, attributes };
  
  // Process comments from DB using core library - add error handling for wrong database
  let allComments, totalComments;
  try {
    ({ comments: allComments, totalComments } = loadCommentsFromDb(dbPath));
    console.log(`📊 Loaded ${allComments.length} submissions from ${totalComments} total comments`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table: comments')) {
      console.error(`Error: The database file '${dbPath}' does not contain a 'comments' table.`);
      console.error(`This appears to be the wrong database file for the abstract command.`);
      console.error(`Use the original comments database file (e.g., cms-rfi.sqlite), NOT the abstractions.db file.`);
      console.error(`The abstractions.db file is where results are stored, not where comments are read from.`);
      process.exit(1);
    }
    throw error; // Re-throw if it's a different error
  }
  
  // Apply filters if specified
  let filteredComments = allComments;
  if (filters.length > 0) {
    filteredComments = filterComments(allComments, filters);
    console.log(`🔍 Applied ${filters.length} filter(s), ${filteredComments.length} comments match`);
    filters.forEach(f => console.log(`   - ${f.key}=${f.value}`));
  }
  
  // Progress tracking: filter by processing status
  let statusFilteredComments = filteredComments;
  if (retryFailed) {
    // Only process previously failed comments, ordered by attempt count (lowest first)
    const failedResults = db.prepare('SELECT filename, attempt_count FROM abstractions WHERE status = ? ORDER BY attempt_count ASC').all('failed') as Array<{filename: string, attempt_count: number}>;
    const failedIds = failedResults.map(row => row.filename);
    statusFilteredComments = filteredComments.filter(comment => failedIds.includes(comment.id));
    
    // Sort statusFilteredComments to match the attempt_count ordering from the database
    const attemptCountMap = new Map(failedResults.map(row => [row.filename, row.attempt_count]));
    statusFilteredComments.sort((a, b) => {
      const attemptsA = attemptCountMap.get(a.id) || 0;
      const attemptsB = attemptCountMap.get(b.id) || 0;
      return attemptsA - attemptsB;
    });
    
    console.log(`🔄 Retry mode: ${statusFilteredComments.length} failed comments available for retry (ordered by attempt count)`);
    if (statusFilteredComments.length > 0) {
      const minAttempts = attemptCountMap.get(statusFilteredComments[0].id) || 0;
      const maxAttempts = attemptCountMap.get(statusFilteredComments[statusFilteredComments.length - 1].id) || 0;
      console.log(`   Attempt counts range: ${minAttempts} to ${maxAttempts} (processing lowest first)`);
    }
  } else {
    // Exclude already completed or in-progress comments
    const processedIds = db.prepare('SELECT filename FROM abstractions WHERE status IN (?, ?)').all('completed', 'in_progress').map((row: any) => row.filename);
    statusFilteredComments = filteredComments.filter(comment => !processedIds.includes(comment.id));
    console.log(`📋 Progress tracking: ${statusFilteredComments.length} not-yet-processed comments available (${filteredComments.length - statusFilteredComments.length} already processed)`);
  }
  
  // Apply limit and random selection
  const selectedComments = selectComments(statusFilteredComments, limitComments, randomSelection);
  console.log(`📝 Selected ${selectedComments.length} comments for processing${randomSelection ? ' (random selection)' : ''}${retryFailed ? ' (retry failed)' : ''}`);
  
  if (selectedComments.length === 0) {
    console.warn('No comments to process after filtering and selection.');
    return;
  }

  const insertAbstraction = db.prepare(`
    INSERT INTO abstractions (
      filename, content, status, attempt_count, last_attempt_at,
      submitter_type, submitter_type_confidence, organization_name, 
      attributes_json, primary_themes, original_metadata_json
    ) VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)
  `);
  
  const updateAbstractionSuccess = db.prepare(`
    UPDATE abstractions SET 
      status = 'completed',
      submitter_type = ?, submitter_type_confidence = ?, organization_name = ?,
      attributes_json = ?, primary_themes = ?, original_metadata_json = ?
    WHERE filename = ?
  `);
  
  const updateAbstractionFailure = db.prepare(`
    UPDATE abstractions SET 
      status = 'failed',
      error_message = ?,
      attempt_count = attempt_count + 1,
      last_attempt_at = datetime('now')
    WHERE filename = ?
  `);
  
  const insertPerspective = db.prepare(`
    INSERT INTO perspectives (
      abstraction_id, taxonomy_code, perspective, excerpt, sentiment
    ) VALUES (?, ?, ?, ?, ?)
  `);
  
  const deleteAbstraction = db.prepare('DELETE FROM abstractions WHERE filename = ?');
  const deletePerspectives = db.prepare('DELETE FROM perspectives WHERE abstraction_id IN (SELECT id FROM abstractions WHERE filename = ?)');
  
  let successCount = 0;
  let errorCount = 0;
  
  // Load attachments from DB for PDF processing
  const { attachments } = loadCommentsFromDb(dbPath);
  
  for (const [idx, comment] of selectedComments.entries()) {
    const file = comment.id; // Use comment ID as the filename identifier
    console.log(`Abstracting ${idx + 1}/${selectedComments.length}: ${file}`);
    
    try {
      // Use enrichComment to get full content including PDF attachments
      const enrichedComment = await enrichComment(comment, attachments);
      if (!enrichedComment) {
        console.warn(`Skipping comment ${file} due to empty content.`);
        continue;
      }
      
      const content = enrichedComment.content;
      const attributes = JSON.parse(comment.attributes_json);
      
      // Get the current attempt count if this is a retry
      const existingRecord = db.prepare('SELECT attempt_count FROM abstractions WHERE filename = ?').get(file) as {attempt_count: number} | undefined;
      const currentAttemptCount = existingRecord ? existingRecord.attempt_count + 1 : 1;
      
      // Clear out any previous abstractions and perspectives for this specific comment
      deletePerspectives.run(file);
      deleteAbstraction.run(file);
      
      // Mark as in-progress with correct attempt count
      const inProgressResult = insertAbstraction.run(
        file, content, 'in_progress', currentAttemptCount, null, null, null, null, null, null
      );
      const abstractionId = inProgressResult.lastInsertRowid;
      
      const prompt = abstract_prompt
        .replace('{TAXONOMY}', taxonomyData.themes)
        .replace('{ATTRIBUTES}', formatAttributes(taxonomyData.attributes))
        .replace('{CONTENT}', content);
      
      await debugLog(`abstract_${idx + 1}_${file}_prompt.txt`, prompt);
      
      const response = await generateContent(ai, prompt);
      
      await debugLog(`abstract_${idx + 1}_${file}_response.txt`, response);
      
      let data;
      try {
        const cleanedResponse = response.replace(/```[^\n]*\n?/g, '').trim();
        data = JSON.parse(cleanedResponse);
        await debugLog(`abstract_${idx + 1}_${file}_parsed.json`, JSON.stringify(data, null, 2));
      } catch (parseError) {
        console.error(`⚠️  JSON parse error for ${file}:`, parseError);
        console.error('Response preview:', response.substring(0, 500));
        
        // Mark as failed due to JSON parse error
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        updateAbstractionFailure.run(`JSON parse error: ${errorMessage}`, file);
        console.log(`Continuing with next comment...`);
        errorCount++;
        continue;
      }
      
      // Extract original metadata from regulations.gov
      const originalMetadata = {
        category: attributes.category || null,
        organization: attributes.organization || null,
        firstName: attributes.firstName || null,
        lastName: attributes.lastName || null,
        country: attributes.country || null,
        stateProvinceRegion: attributes.stateProvinceRegion || null,
        receiveDate: attributes.receiveDate || null,
        postedDate: attributes.postedDate || null,
        trackingNbr: attributes.trackingNbr || null,
        documentType: attributes.documentType || null,
        subtype: attributes.subtype || null
      };

      // Extract primary themes from perspectives object
      const primaryThemes = Object.keys(data.perspectives);
      
      // Update with successful results
      updateAbstractionSuccess.run(
        data.submitter.type,
        data.submitter.confidence,
        data.submitter.organization || null,
        JSON.stringify(data.attributes),
        primaryThemes.join(', '),
        JSON.stringify(originalMetadata),
        file
      );
      
      // Insert perspectives - new structure with theme codes as keys
      for (const [themeCode, themeData] of Object.entries(data.perspectives) as [string, any][]) {
        // Get arrays of perspectives and excerpts
        const perspectives = Array.isArray(themeData.perspective) ? themeData.perspective : [themeData.perspective];
        const excerpts = Array.isArray(themeData.excerpts) ? themeData.excerpts : [themeData.excerpts];
        
        // Create one row per perspective
        for (let i = 0; i < perspectives.length; i++) {
          const perspective = perspectives[i];
          // Get corresponding excerpt or use all excerpts if there's only one perspective
          const excerpt = perspectives.length === 1 ? excerpts.join('; ') : (excerpts[i] || '');
          
          insertPerspective.run(
            abstractionId,
            themeCode,
            String(perspective || ''),
            String(excerpt || ''),
            null // sentiment is not in the new structure
          );
        }
      }
      
      successCount++;
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
      
      // Mark as failed due to general error
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateAbstractionFailure.run(`General error: ${errorMessage}`, file);
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

async function populateTaxonomyTables(db: Database, final: TaxonomyOutput) {
  // Parse and populate taxonomy reference
  const taxonomyEntries = parseTaxonomyForDB(final.themes);
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
  
  for (const [attrType, values] of Object.entries(final.attributes)) {
    if (Array.isArray(values)) {
      for (const value of values) {
        insertAttr.run(attrType, value);
      }
    }
  }
  
  console.log(`\n✅ Taxonomy populated in database!`);
  console.log(`- Loaded ${taxonomyEntries.length} taxonomy entries`);
  console.log(`- Loaded ${Object.keys(final.attributes).length} attribute types`);
}

async function setupDatabase() {
  const db = await initDB();
  
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
    // Match lines like "1. Theme Name" or "1.2.3 Theme Name" or "1.1. Theme Name"
    const match = line.match(/^\s*(\d+(?:\.\d+)*)\.?\s+(.+)$/);
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
} else if (command === 'analyze-themes') {
  console.log('Running theme-level narrative and stance analysis...');
  analyzeThemes(themeCodes, 10, debugMode)
    .catch(console.error);
}
