export interface CommenterInfo {
  submitter_type: string;
  organization_name?: string | null;
  original_metadata?: {
    organization?: string;
    firstName?: string;
    lastName?: string;
    category?: string;
  };
}

/**
 * Gets the display name for a commenter, prioritizing:
 * 1. LLM-detected organization name
 * 2. Original organization from regulations.gov
 * 3. First and last name from original metadata
 * 4. Submitter type as fallback
 */
export function getCommenterDisplayName(info: CommenterInfo): string {
  if (info.organization_name) {
    return info.organization_name;
  }
  
  if (info.original_metadata?.organization) {
    return info.original_metadata.organization;
  }
  
  if (info.original_metadata?.firstName && info.original_metadata?.lastName) {
    return `${info.original_metadata.firstName} ${info.original_metadata.lastName}`;
  }
  
  return info.submitter_type;
}

/**
 * Formats the commenter display with type information
 * Returns an object with the display name and type info for flexible rendering
 */
export function getCommenterDisplay(info: CommenterInfo): {
  displayName: string;
  submitterType: string;
  originalCategory?: string;
} {
  return {
    displayName: getCommenterDisplayName(info),
    submitterType: info.submitter_type,
    originalCategory: info.original_metadata?.category
  };
}
