/**
 * Shared constant defining the strict output format for all taxonomy generation.
 * This version uses ALL CAPS for emphasis, provides a concrete example, and avoids markdown.
 */
const TAXONOMY_OUTPUT_FORMAT_INSTRUCTIONS = `
YOUR OUTPUT MUST BE A SINGLE BLOCK OF PLAINTEXT.

Follow this format PRECISELY for every theme. EVERY THEME GETS ITS OWN LINE. EVERY LINE MUST START AT THE BEGINNING (NO INDENTATION).

THE REQUIRED FORMAT IS:
[Number]. [Label]. [Description]. "[Quote 1] [comment-id-1]". "[Quote 2] [comment-id-2]".

A breakdown of the format:
NUMBER: Use hierarchical numbering like 1, 1.1, or 1.1.1.
LABEL: A concise theme name, ideally under 8 words, but anyway under 12.
DESCRIPTION: A brief, one-sentence explanation of the theme's meaning.
QUOTES: Include one or more direct quotations that perfectly illustrate the theme. Each quote must be in double quotes and followed immediately by its source ID in square brackets, for example "[comment-id-123]".

EXAMPLE OF CORRECT FORMATTING:
1. Concerns about Timing. A theme discussing issues related to the proposed schedule. "The deadline is too soon for us to comply [comment-abc]".
1.1. Requests for Extension. A sub-theme specifically asking for a longer implementation period. "We would need at least six more months [comment-xyz]". "Please consider extending the date [comment-ghi]".
2. Suggestions for Communication. A theme about how the changes should be announced to the public. "A public webinar would be helpful for stakeholders [comment-def]".
`;

/**
 * A prompt for discovering a MECE hierarchical taxonomy from a body of text.
 * It instructs the model to produce a detailed, quote-supported hierarchy in pure plaintext.
 * The {COMMENTS} placeholder is where the text/comment data should be injected.
 */
export const THEME_DISCOVERY_PROMPT = `As an expert policy analyst, your task is to derive a MECE (Mutually Exclusive, Collectively Exhaustive) hierarchical taxonomy from the public comments provided below.

Analyze every comment to identify all distinct themes, arguments, concerns, and suggestions. Organize these into a logical hierarchy, with broad topics at the highest level and increasingly specific sub-themes at lower levels. The structure should be as deep and broad as necessary to capture the full range of input.

--- FORMATTING REQUIREMENTS ---
${TAXONOMY_OUTPUT_FORMAT_INSTRUCTIONS}
--- END OF FORMATTING REQUIREMENTS ---

--- START OF COMMENTS ---
{COMMENTS}
--- END OF COMMENTS ---

You have now reviewed all the comments. Proceed with generating the complete, MECE hierarchical taxonomy, strictly following the formatting requirements provided above.
`;

/**
 * A prompt for merging two existing theme taxonomies into a single, unified hierarchy.
 * This version encourages intelligent reconciliation and frames restructuring as an optional refinement step.
 * It enforces the same strict plaintext output format as the discovery prompt.
 */
export const THEME_MERGE_PROMPT = `You are a senior analyst tasked with synthesizing research. Your goal is to merge, reconcile, and refine two separate theme taxonomies into a single, cohesive, and logically superior MECE (Mutually Exclusive, Collectively Exhaustive) hierarchy.

Your process should be:
1.  IDENTIFY OVERLAP: Find themes that are identical or highly similar across both taxonomies.
2.  MERGE AND REFINE: When merging, select the clearest label. Combine all relevant quotes and sub-themes from the source themes into the new, unified theme.
3.  INTEGRATE UNIQUE THEMES: Place themes that only appear in one taxonomy into the most logical position within the new structure, preserving their quotes.
4.  ASSESS AND REORGANIZE IF NEEDED: Review the combined structure for clarity and logic. If the hierarchy can be made more intuitive, you have the flexibility to reorganize. For example, you might promote a sub-theme to a top-level theme if it makes more sense. This step is about making smart refinements where they add value, not about changing the structure unnecessarily.

--- INPUT TAXONOMY 1 ---
{TAXONOMY1}
--- END OF INPUT TAXONOMY 1 ---

--- INPUT TAXONOMY 2 ---
{TAXONOMY2}
--- END OF INPUT TAXONOMY 2 ---

Now, generate the final, merged, and refined theme taxonomy.

--- FORMATTING REQUIREMENTS ---
${TAXONOMY_OUTPUT_FORMAT_INSTRUCTIONS}
--- END OF FORMATTING REQUIREMENTS ---

=== UNIFIED THEME TAXONOMY ===
`;
