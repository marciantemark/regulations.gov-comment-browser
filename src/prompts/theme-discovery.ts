/**
 * Shared constant defining the strict output format for all taxonomy generation.
 * This version uses ALL CAPS for emphasis, provides a concrete example, and avoids markdown.
 */
const TAXONOMY_OUTPUT_FORMAT_INSTRUCTIONS = `
YOUR OUTPUT MUST BE A SINGLE BLOCK OF PLAINTEXT.

Follow this format PRECISELY for every theme. EVERY THEME GETS ITS OWN LINE. EVERY LINE MUST START AT THE BEGINNING (NO INDENTATION).

THE REQUIRED FORMAT IS:
[Number]. [Label]. [Description].

A breakdown of the format:
NUMBER: Use hierarchical numbering like 1, 1.1, or 1.1.1.
LABEL: A concise theme name, ideally under 8 words, but anyway under 12.
DESCRIPTION: A brief, one-sentence explanation of the theme's meaning and scope.

EXAMPLE OF CORRECT FORMATTING:
1. Concerns about XYZ. What will XYZ mean for ... etc.
1.1. Requests for Foo. Addressing Foo would... etc.
2. Suggestions for Bar. Bar could result in... etc.
2.1. Public Webinar Requests. Description here... etc.

`;

/**
 * A prompt for discovering a MECE hierarchical taxonomy from structured comment sections.
 * Focuses specifically on core positions, recommendations, and concerns to identify policy themes.
 * The {COMMENTS} placeholder is where the structured comment data should be injected.
 */
export const THEME_DISCOVERY_PROMPT = `As an expert policy analyst, your task is to derive a MECE (Mutually Exclusive, Collectively Exhaustive) hierarchical taxonomy from the structured public comments provided below.

You are analyzing the most substantive parts of each comment: their commenter profiles, core positions, key recommendations, and main concerns. These structured sections capture the essential policy arguments and positions taken by commenters.

Your analysis should:
1. IDENTIFY POLICY POSITIONS: Look for distinct policy stances, arguments, and viewpoints expressed in core positions
2. CATEGORIZE RECOMMENDATIONS: Group similar policy suggestions, implementation approaches, and proposed changes
3. ORGANIZE CONCERNS: Cluster related worries, objections, and potential problems raised by commenters
4. CONSIDER COMMENTER CONTEXT: Use commenter profiles to understand the perspective and stakeholder group behind each position
5. CREATE LOGICAL HIERARCHY: Organize themes from broad policy areas down to specific sub-issues

Focus on substantive policy content rather than procedural comments or general statements. Each theme should capture a meaningful policy position, recommendation, or concern that appears across multiple comments or represents a significant stakeholder viewpoint.

--- FORMATTING REQUIREMENTS ---
${TAXONOMY_OUTPUT_FORMAT_INSTRUCTIONS}
--- END OF FORMATTING REQUIREMENTS ---

--- START OF STRUCTURED COMMENTS ---
{COMMENTS}
--- END OF STRUCTURED COMMENTS ---

You have now reviewed all the structured comment sections. Proceed with generating the complete, MECE hierarchical taxonomy of policy themes, strictly following the formatting requirements provided above.
`;

/**
 * A prompt for merging two existing theme taxonomies into a single, unified hierarchy.
 * This version encourages intelligent reconciliation and frames restructuring as an optional refinement step.
 * It enforces the same strict plaintext output format as the discovery prompt.
 */
export const THEME_MERGE_PROMPT = `You are a senior analyst tasked with synthesizing research. Your goal is to merge, reconcile, and refine two separate theme taxonomies into a single, cohesive, and logically superior MECE (Mutually Exclusive, Collectively Exhaustive) hierarchy.

Your process should be:
1.  IDENTIFY OVERLAP: Find themes that are identical or highly similar across both taxonomies.
2.  MERGE AND REFINE: When merging, select the clearest label and combine the most comprehensive description from the source themes.
3.  INTEGRATE UNIQUE THEMES: Place themes that only appear in one taxonomy into the most logical position within the new structure.
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
