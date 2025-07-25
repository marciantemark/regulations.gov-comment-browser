// Comment types from regulations.gov
export interface RawComment {
  id: string;
  attributes_json: string;
}

export interface CommentAttributes {
  agencyId?: string;
  docketId?: string;
  documentType?: string;
  title?: string;
  postedDate?: string;
  comment?: string;
  firstName?: string;
  lastName?: string;
  organization?: string;
  submitterRep?: string;
  category?: string;
  stateProvinceRegion?: string;
  country?: string;
  receiveDate?: string;
  pageCount?: number;
  [key: string]: any;
}

export interface Attachment {
  id: string;
  comment_id: string;
  format: string;
  file_name: string;
  url: string;
  size: number | null;
  blob_data: Uint8Array | null;
}

// Structured sections produced by the condense step
export interface StructuredSections {
  detailedContent?: string;
  oneLineSummary?: string;
  commenterProfile?: string;
  corePosition?: string;
  keyRecommendations?: string;
  mainConcerns?: string;
  notableExperiences?: string;
  keyQuotations?: string;
  [key: string]: unknown; // allow for future fields while avoiding 'any'
}

// Enriched comment with metadata and content
export interface EnrichedComment {
  id: string;
  content: string;
  wordCount: number;
  metadata: {
    submitter: string;
    submitterType: string;
    organization?: string;
    location?: string;
    date?: string;
  };
  structuredSections?: StructuredSections; // Parsed structured sections
}

// Theme discovery parsed theme row
export interface ParsedTheme {
  code: string;
  description: string;
  level: number;
  parent_code: string | null;
  detailed_guidelines?: string;
}

// Entity discovery types
export interface EntityTaxonomy {
  [category: string]: Array<{
    label: string;
    definition: string;
    terms: string[];
  }>;
}

// Processing status
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

// Batch processing
export interface Batch<T> {
  items: T[];
  wordCount: number;
  number: number;
}
