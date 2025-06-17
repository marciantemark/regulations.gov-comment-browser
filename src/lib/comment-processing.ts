import { Database } from "bun:sqlite";
import type { RawComment, CommentAttributes, Attachment, EnrichedComment, ParsedTheme } from "../types";
import { countWords } from "./batch-processor";
// Importing via the top-level entry of pdf-parse triggers a built-in debug block
// that attempts to read a non-existent fixture file when the module has no parent
// (the case for Bun + ESM). Instead, import the actual implementation directly.
// @ts-ignore – sub-path has no typings, but runtime API is identical.
import { PDFExtract } from 'pdf.js-extract';

// Load comments and attachments from database
export function loadComments(db: Database, limit?: number): {
  comments: RawComment[];
  attachments: Map<string, Attachment[]>;
  total: number;
} {
  // Get total count
  const { count: total } = db.prepare("SELECT COUNT(*) as count FROM comments").get() as { count: number };
  
  // Load comments
  const query = limit 
    ? "SELECT id, attributes_json FROM comments LIMIT ?"
    : "SELECT id, attributes_json FROM comments";
  
  const comments = limit
    ? db.prepare(query).all(limit) as RawComment[]
    : db.prepare(query).all() as RawComment[];
  
  // Load attachments grouped by comment
  const attachments = new Map<string, Attachment[]>();
  const attachmentRows = db.prepare(`
    SELECT * FROM attachments 
    WHERE comment_id IN (${comments.map(() => '?').join(',')})
  `).all(...comments.map(c => c.id)) as Attachment[];
  
  for (const att of attachmentRows) {
    if (!attachments.has(att.comment_id)) {
      attachments.set(att.comment_id, []);
    }
    attachments.get(att.comment_id)!.push(att);
  }
  
  return { comments, attachments, total };
}

// Load condensed comments
export function loadCondensedComments(db: Database, limit?: number): EnrichedComment[] {
  const query = limit
    ? `SELECT c.id, cc.structured_sections, c.attributes_json 
       FROM comments c 
       JOIN condensed_comments cc ON c.id = cc.comment_id 
       WHERE cc.status = 'completed' 
       LIMIT ?`
    : `SELECT c.id, cc.structured_sections, c.attributes_json 
       FROM comments c 
       JOIN condensed_comments cc ON c.id = cc.comment_id 
       WHERE cc.status = 'completed'`;
  
  const rows = limit
    ? db.prepare(query).all(limit)
    : db.prepare(query).all();
  
  return rows.map((row: any) => {
    const attrs = JSON.parse(row.attributes_json) as CommentAttributes;
    const sections = JSON.parse(row.structured_sections || '{}');
    
    // Use detailedContent as the main content, or fall back to concatenating key sections
    const content = sections.detailedContent || [
      sections.oneSummary || '',
      sections.commenterProfile || '',
      sections.corePosition || '',
      sections.keyRecommendations || '',
      sections.mainConcerns || ''
    ].filter(Boolean).join('\n\n');
    
    return {
      id: row.id,
      content,
      wordCount: countWords(content),
      metadata: extractMetadata(attrs),
      structuredSections: sections
    };
  });
}

// Enrich a comment with its full content including PDFs
export async function enrichComment(
  comment: RawComment,
  attachments: Map<string, Attachment[]>,
  options: { includePdfs?: boolean } = { includePdfs: true }
): Promise<EnrichedComment | null> {
  const attrs = JSON.parse(comment.attributes_json) as CommentAttributes;
  
  // Build comment text parts
  const parts: string[] = [];
  
  // Add metadata header
  parts.push("=== COMMENT METADATA ===");
  parts.push(`ID: ${comment.id}`);
  parts.push(`Date: ${attrs.postedDate || attrs.receiveDate || "Unknown"}`);
  
  const metadata = extractMetadata(attrs);
  parts.push(`Submitter: ${metadata.submitter}`);
  parts.push(`Type: ${metadata.submitterType}`);
  if (metadata.organization) parts.push(`Organization: ${metadata.organization}`);
  if (metadata.location) parts.push(`Location: ${metadata.location}`);
  
  // Add comment text
  parts.push("\n=== COMMENT TEXT ===");
  const commentText = attrs.comment || attrs.text || "";
  if (!commentText || commentText.trim().length === 0) {
    return null; // Skip empty comments
  }
  parts.push(commentText);
  
  // Add PDF content if requested
  if (options.includePdfs) {
    const commentAttachments = attachments.get(comment.id) || [];
    const pdfAttachments = commentAttachments.filter(a => 
      a.format.toLowerCase() === "pdf" && a.blob_data
    );
    
    if (pdfAttachments.length > 0) {
      parts.push("\n=== PDF ATTACHMENTS ===");
      
      for (const pdf of pdfAttachments) {
        try {
          const extractedText = (await extractPdfText(Buffer.from(pdf.blob_data!))).trim();
          if (extractedText.length > 0) {
            parts.push(`\nPDF: ${pdf.file_name}`);
            parts.push(extractedText);
          } else {
            parts.push(`\nPDF: ${pdf.file_name} (no extractable text)`);
          }
        } catch (err) {
          parts.push(`\nPDF: ${pdf.file_name} (error reading)`);
        }
      }
    }
  }
  
  const content = parts.join("\n");
  
  return {
    id: comment.id,
    content,
    wordCount: countWords(content),
    metadata
  };
}

// Extract metadata from comment attributes
function extractMetadata(attrs: CommentAttributes) {
  // Determine submitter name
  let submitter = "Anonymous";
  if (attrs.organization) {
    submitter = attrs.organization;
  } else if (attrs.firstName && attrs.lastName) {
    submitter = `${attrs.firstName} ${attrs.lastName}`;
  } else if (attrs.firstName || attrs.lastName) {
    submitter = attrs.firstName || attrs.lastName || submitter;
  }
  
  // Determine submitter type
  let submitterType = attrs.category;
  if (!submitterType) {
    submitterType = attrs.organization ? "Organization" : "Individual";
  }
  
  // Build location
  const locationParts: string[] = [];
  if (attrs.city) locationParts.push(attrs.city);
  if (attrs.stateProvinceRegion) locationParts.push(attrs.stateProvinceRegion);
  if (attrs.country && attrs.country !== "United States") locationParts.push(attrs.country);
  const location = locationParts.join(", ") || undefined;
  
  return {
    submitter,
    submitterType,
    organization: attrs.organization,
    location,
    date: attrs.postedDate || attrs.receiveDate
  };
}

// Parse theme hierarchy text into structured format
export function parseThemeHierarchy(text: string): ParsedTheme[] {
  const themes: ParsedTheme[] = [];
  
  const lines = text.split("\n");
  
  for (const line of lines) {
    // Match lines like "1. Theme Label. Description text."
    const m = line.match(/^(\s*)(\d+(?:\.\d+)*)(?:\.)?\s+([^.]+)\.\s*(.+)$/);
    if (!m) continue;

    const [ , indent, codeRaw, label, description ] = m;
    const code = codeRaw; // without trailing dot
    const level = code.split(".").length;
    
    // Determine parent code
    let parent_code: string | null = null;
    if (level > 1) {
      const parts = code.split(".");
      parts.pop();
      parent_code = parts.join(".");
    }
    
    // Clean up description (remove trailing period if present)
    let desc = description.trim();
    if (desc.endsWith('.')) desc = desc.slice(0, -1);
    
    // Combine label and description for the full description field
    const fullDescription = `${label.trim()}. ${desc}`;

    themes.push({
      code,
      description: fullDescription,
      level,
      parent_code
    });
  }
  
  return themes;
}

// Parse entity taxonomy
export function parseEntityTaxonomy(text: string): Record<string, Array<{
  label: string;
  definition: string;
  terms: string[];
}>> {
  const result: Record<string, Array<{
    label: string;
    definition: string;
    terms: string[];
  }>> = {};
  
  let currentCategory: string | null = null;
  let currentEntity: { label: string; definition: string; terms: string[] } | null = null;
  
  const lines = text.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Category line: "1. Category Name"
    const categoryMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1];
      if (!result[currentCategory]) {
        result[currentCategory] = [];
      }
      currentEntity = null;
      continue;
    }
    
    // Entity line: "* Entity Name: Definition"
    const entityMatch = trimmed.match(/^\*\s+([^:]+):\s+(.+)$/);
    if (entityMatch && currentCategory) {
      currentEntity = {
        label: entityMatch[1].trim(),
        definition: entityMatch[2].trim(),
        terms: []
      };
      result[currentCategory].push(currentEntity);
      continue;
    }
    
    // Term line: '  * "term"' or '  * term'
    const termMatch = trimmed.match(/^\*\s+"?([^"]+)"?$/);
    if (termMatch && currentEntity) {
      currentEntity.terms.push(termMatch[1].trim());
    }
  }
  
  return result;
}

async function extractPdfText(buffer: Buffer | Uint8Array): Promise<string> {
  const pdfExtract = new PDFExtract();
  const options = { normalizeWhitespace: true, disableCombineTextItems: false };
  return new Promise((resolve, reject) => {
    pdfExtract.extractBuffer(buffer, options, (err, data) => {
      if (err) return reject(err);
      const allText = data.pages
        .map(page => page.content.map(item => item.str).join(' '))
        .join('\n\n');
      resolve(allText);
    });
  });
}
