import { Database } from 'bun:sqlite';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface CommentData {
  id: string;
  attributes_json: string;
}

export interface AttachmentData {
  id: string;
  comment_id: string;
  format: string;
  file_name: string;
  url: string;
  blob_data: Uint8Array | null;
}

export interface EnrichedComment {
  id: string;
  content: string;
  wordCount: number;
  metadata: {
    id: string;
    submitter: string;
    submitterType: string;
    city: string;
    state: string;
    country: string;
    postedDate: string;
    title: string;
  };
}

/**
 * Extract text from PDF blob using pdftotext
 */
export async function extractPdfText(pdfBlob: Uint8Array, fileName: string): Promise<string> {
  const tempDir = tmpdir();
  const tempPdfPath = join(tempDir, `temp_${Date.now()}_${fileName}`);
  
  try {
    writeFileSync(tempPdfPath, pdfBlob);
    const textOutput = execSync(`pdftotext "${tempPdfPath}" -`, { 
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    return textOutput;
  } catch (error) {
    throw new Error(`Failed to extract PDF text: ${error}`);
  } finally {
    if (existsSync(tempPdfPath)) {
      try {
        unlinkSync(tempPdfPath);
      } catch (cleanupError) {
        console.warn(`Failed to cleanup temp file ${tempPdfPath}:`, cleanupError);
      }
    }
  }
}

/**
 * Count words in text
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Load comments and attachments from database, filtering for submissions only
 */
export function loadCommentsFromDb(dbPath: string): {
  comments: CommentData[];
  attachments: AttachmentData[];
  totalComments: number;
} {
  const commentsDb = new Database(dbPath);
  const allComments = commentsDb.prepare("SELECT id, attributes_json FROM comments").all() as CommentData[];
  
  // Filter for submissions only
  const comments = allComments.filter(c => {
    try {
      const attributes = JSON.parse(c.attributes_json);
      return attributes.documentType === 'Public Submission';
    } catch (e) {
      console.warn(`Could not parse JSON for comment ${c.id}, skipping`);
      return false;
    }
  });
  
  const attachments = commentsDb.prepare("SELECT id, comment_id, format, file_name, url, blob_data FROM attachments WHERE format = 'pdf'").all() as AttachmentData[];
  commentsDb.close();

  return {
    comments,
    attachments,
    totalComments: allComments.length
  };
}

/**
 * Enrich a single comment with metadata and PDF attachments
 */
export async function enrichComment(
  comment: CommentData, 
  attachments: AttachmentData[],
  options: { includePdfs?: boolean; maxPdfLength?: number } = {}
): Promise<EnrichedComment | null> {
  const { includePdfs = true, maxPdfLength } = options;
  
  try {
    const attributes = JSON.parse(comment.attributes_json);
    const commentText = attributes.comment || '';
    if (!commentText) return null;
    
    // Extract relevant metadata
    const metadata = {
      id: comment.id,
      submitter: attributes.organization || `${attributes.firstName || ''} ${attributes.lastName || ''}`.trim() || 'Anonymous',
      submitterType: attributes.category || 'Unknown',
      city: attributes.city,
      state: attributes.stateProvinceRegion,
      country: attributes.country,
      postedDate: attributes.postedDate,
      title: attributes.title
    };
    
    // Get PDF attachments for this comment
    const commentAttachments = attachments.filter(a => a.comment_id === comment.id);
    const attachmentTexts: string[] = [];
    
    if (includePdfs) {
      for (const attachment of commentAttachments) {
        if (attachment.blob_data) {
          try {
            const pdfText = await extractPdfText(attachment.blob_data, attachment.file_name);
            if (pdfText.trim()) {
              const finalText = maxPdfLength && pdfText.length > maxPdfLength 
                ? pdfText.substring(0, maxPdfLength) + '\n\n[... PDF content truncated for sample ...]'
                : pdfText;
              attachmentTexts.push(`--- PDF Attachment: ${attachment.file_name} ---\n${finalText}`);
            }
          } catch (error) {
            console.warn(`Failed to extract PDF text from ${attachment.file_name}:`, error);
          }
        }
      }
    }
    
    // Combine comment text and attachments
    const fullContent = [
      `=== COMMENT ${comment.id} ===`,
      `Submitter: ${metadata.submitter}`,
      `Type: ${metadata.submitterType}`,
      `Location: ${[metadata.city, metadata.state, metadata.country].filter(Boolean).join(', ') || 'Not specified'}`,
      `Posted: ${metadata.postedDate || 'Unknown'}`,
      `Title: ${metadata.title || 'No title'}`,
      '',
      '--- Comment Text ---',
      commentText,
      ...attachmentTexts
    ].join('\n');
    
    const wordCount = countWords(fullContent);
    
    return {
      id: comment.id,
      content: fullContent,
      wordCount,
      metadata
    };
  } catch (e) {
    console.warn(`Could not process comment ${comment.id}:`, e);
    return null;
  }
}

/**
 * Create word-limited batches from enriched comments with optimal packing
 */
export function createWordLimitedBatches(
  comments: EnrichedComment[], 
  wordLimit: number,
  shuffle: boolean = true
): EnrichedComment[][] {
  const workingComments = shuffle ? [...comments].sort(() => Math.random() - 0.5) : [...comments];
  
  const batches: EnrichedComment[][] = [];
  const remaining = [...workingComments];
  
  while (remaining.length > 0) {
    const currentBatch: EnrichedComment[] = [];
    let currentWordCount = 0;
    
    // Keep trying to find comments that fit in the current batch
    let foundFit = true;
    while (foundFit && remaining.length > 0) {
      foundFit = false;
      
      // Look for a comment that fits in the remaining space
      for (let i = 0; i < remaining.length; i++) {
        const comment = remaining[i];
        if (currentWordCount + comment.wordCount <= wordLimit) {
          // This comment fits! Add it to the batch
          currentBatch.push(comment);
          currentWordCount += comment.wordCount;
          remaining.splice(i, 1);
          foundFit = true;
          break;
        }
      }
    }
    
    // If we couldn't fit anything and the batch is empty, 
    // take the first remaining comment even if it exceeds the limit
    if (currentBatch.length === 0 && remaining.length > 0) {
      const comment = remaining.shift()!;
      currentBatch.push(comment);
      currentWordCount = comment.wordCount;
    }
    
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }
  }
  
  return batches;
}

/**
 * Create a single random batch up to specified word limit
 */
export function createRandomBatch(
  comments: EnrichedComment[],
  wordLimit: number
): EnrichedComment[] {
  const shuffled = [...comments].sort(() => Math.random() - 0.5);
  
  const batch: EnrichedComment[] = [];
  let currentWordCount = 0;
  
  for (const comment of shuffled) {
    if (currentWordCount + comment.wordCount > wordLimit) {
      break;
    }
    
    batch.push(comment);
    currentWordCount += comment.wordCount;
  }
  
  return batch;
}

/**
 * Get batch statistics
 */
export function getBatchStats(batch: EnrichedComment[]): {
  commentCount: number;
  totalWords: number;
  withPdfs: number;
  submitterTypes: string[];
} {
  return {
    commentCount: batch.length,
    totalWords: batch.reduce((sum, c) => sum + c.wordCount, 0),
    withPdfs: batch.filter(c => c.content.includes('PDF Attachment')).length,
    submitterTypes: [...new Set(batch.map(c => c.metadata.submitterType))].filter(t => t !== 'Unknown')
  };
}

/**
 * Generate the initial taxonomy prompt
 */
export function generateInitialTaxonomyPrompt(comments: EnrichedComment[]): string {
  const batchContent = comments.map(c => c.content).join('\n\n');
  
  return `Analyze these documents and synthesize a hierarchical taxonomy of descriptive themes.

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

FORMATTING RULES:
- Use only plain text - NO bold formatting (**), italics, or markdown
- Keep theme names and perspectives as simple numbered lists
- For attributes, use flat comma-separated lists - no grouping or subcategories

Documents:
${batchContent}

OUTPUT FORMAT - Provide two clearly separated sections:

=== THEME TAXONOMY ===
[Your hierarchical numbered taxonomy with embedded perspectives - plain text only]

${OBSERVED_ATTRIBUTES_OUTPUT_FORMAT_BLOCK}`;
}

// Data structures
export interface TaxonomyOutput {
  themes: string;
  attributes: Record<string, string[]>;
}

// LLM and parsing utilities
import { GoogleGenAI } from '@google/genai';

const MODEL = 'gemini-2.5-pro-preview-06-05';

export async function generateContent(ai: GoogleGenAI, prompt: string): Promise<string> {
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

export function parseGeneratorOutput(response: string): TaxonomyOutput {
  // Skip any preamble before the first === section
  const taxonomyStart = response.indexOf('=== THEME TAXONOMY ===');
  const cleanedResponse = taxonomyStart !== -1 ? response.substring(taxonomyStart) : response;
  
  // Split into taxonomy and attributes sections
  const parts = cleanedResponse.split(/=== OBSERVED ATTRIBUTES ===/i);
  
  // Extract themes, removing the header and any trailing content
  let themes = parts[0].replace(/=== THEME TAXONOMY ===/i, '').trim();
  
  // For refinement responses that might not follow exact format, 
  // also remove any trailing markers or extra content
  themes = themes.replace(/\n\s*===.*$/s, '').trim();
  
  // Parse attributes if present, otherwise use empty structure
  const attributes = parts[1] ? parseAttributes(parts[1]) : {};
  
  return { themes, attributes };
}

export function parseAttributes(text: string): TaxonomyOutput['attributes'] {
  const result: TaxonomyOutput['attributes'] = {};
  
  const lines = text.trim().split('\n');
  for (const line of lines) {
    const match = line.match(/^(.+?):\s*(.+)$/);
    if (match) {
      const [_, key, valuesStr] = match;
      const values = valuesStr.split(',').map(v => v.trim()).filter(v => v);
      
      // Normalize key but keep original case for display
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
      result[normalizedKey] = values;
    }
  }
  
  return result;
}

export function formatAttributes(attrs: TaxonomyOutput['attributes']): string {
  let result = '';
  
  // Convert normalized keys back to proper case for display
  const keyOrder = ['submitter_types', 'market_segments', 'geographic_scopes', 'sentiment_types'];
  const keyLabels: Record<string, string> = {
    submitter_types: 'Submitter Types',
    market_segments: 'Market Segments', 
    geographic_scopes: 'Geographic Scopes',
    sentiment_types: 'Sentiment Types'
  };
  
  // First output the standard keys in order
  for (const key of keyOrder) {
    if (attrs[key] && attrs[key].length > 0) {
      result += `${keyLabels[key]}: ${attrs[key].join(', ')}\n`;
    }
  }
  
  // Then output any other keys
  for (const [key, values] of Object.entries(attrs)) {
    if (!keyOrder.includes(key) && values && values.length > 0) {
      // Convert key back to proper case (capitalize words, replace underscores with spaces)
      const displayKey = key.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      result += `${displayKey}: ${values.join(', ')}\n`;
    }
  }
  
  return result.trim();
}

export function formatOutput(output: TaxonomyOutput): string {
  return `=== THEME TAXONOMY ===\n${output.themes}\n\n=== OBSERVED ATTRIBUTES ===\n${formatAttributes(output.attributes)}`;
}

export function formatForRefinement(output: TaxonomyOutput): string {
  // For refinement, we only pass the themes to avoid transcription errors
  // Attributes will be preserved separately
  return output.themes;
}

// Shared attribute format template
const OBSERVED_ATTRIBUTES_OUTPUT_FORMAT_BLOCK = `=== OBSERVED ATTRIBUTES ===
Submitter Types: [clean, deduplicated flat list]
Market Segments: [clean, deduplicated flat list]
Geographic Scopes: [clean, deduplicated flat list]
Sentiment Types: [clean, deduplicated flat list]
[Any other attribute types]: [clean, deduplicated flat list]`;

// Prompt templates
export const prompts = {
  refine: `Refine this taxonomy to be mutually exclusive and collectively exhaustive (MECE).

Current taxonomy:
{TAXONOMY}

Requirements:
1. Each theme/perspective should appear in exactly ONE location
2. Verify nothing is lost - all perspectives must be preserved
3. Use consistent depth and parallel construction for siblings
4. Maintain the numeric coding system

OUTPUT FORMAT:

=== THEME TAXONOMY ===
[Your refined MECE taxonomy with ALL perspectives and excerpts preserved]`,

  mergeThemes: `Merge these theme taxonomies into a unified structure.

RULES:
1. Combine similar themes, ensuring there's a home for each perspective.
2. Preserve a representative sample of perspectives (multiple per category is encouraged to show diversity), but strip any excerpts from your output.
3. Maintain numeric coding, renumbering for consistency.
4. Restructure liberally to avoid redundancies in the taxonomy
5. Avoid overly abstract categories; we don't want coherent perspectives to be stretched thin across the "rack" of artificial separation at top-level.

FORMATTING RULES:
- Use only plain text - NO bold formatting (**), italics, or markdown
- Keep theme names and perspectives as simple numbered lists
- No special formatting around theme titles or perspective labels

Taxonomy 1:
=== THEME TAXONOMY ===
{TAXONOMY1}

Taxonomy 2:
=== THEME TAXONOMY ===
{TAXONOMY2}

OUTPUT FORMAT:

=== THEME TAXONOMY ===
[Your merged taxonomy with representative perspectives but no excerpts - plain text only]`,

  refineAttributes: `Review and refine these observed attributes from the final merged taxonomy.

CURRENT ATTRIBUTES:
{ATTRIBUTES}

REFINEMENT TASKS:
1. Flatten any grouped or nested categories into simple lists
2. Remove duplicates and near-duplicates
3. Standardize naming (e.g., "Health Care Provider" vs "Healthcare Provider")
4. Ensure each attribute type has a clean, flat comma-separated list
5. Remove any formatting artifacts or groupings

FORMATTING RULES:
- Use only plain text - NO bold formatting (**), italics, or markdown
- Each attribute type should be a simple flat list
- No subcategories or groupings within attribute values

OUTPUT FORMAT:

${OBSERVED_ATTRIBUTES_OUTPUT_FORMAT_BLOCK}`
};
