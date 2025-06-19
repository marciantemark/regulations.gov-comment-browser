/**
 * Shared constant defining the strict output format for all taxonomy generation.
 * This version uses ALL CAPS for emphasis, provides a concrete example, and avoids markdown.
 */
const TAXONOMY_OUTPUT_FORMAT_INSTRUCTIONS = `
YOUR OUTPUT MUST BE A SINGLE BLOCK OF PLAINTEXT.

Follow this format PRECISELY for every theme. EVERY THEME GETS ONE PARAGRAPH. EVERY PARAGRAPH MUST START AT THE BEGINNING (NO INDENTATION).

THE REQUIRED FORMAT IS:
[Number]. [Label]. [Brief Description] || [Detailed Guidelines].

A breakdown of the format:
NUMBER: Use hierarchical numbering. In discovery: go deep (1, 1.1, 1.1.1, etc.). In merge: exactly 2 levels (1, 1.1, 2, 2.1, etc.).
LABEL: A concise theme name, ideally under 8 words, but anyway under 12.
BRIEF DESCRIPTION: A single sentence explaining what this theme is about.
|| : A double pipe delimiter (EXACTLY two pipe characters with a space before and after)
DETAILED GUIDELINES: A comprehensive 3-5 sentence explanation that MUST include:
  - What specific topics, concerns, or positions ARE included in this theme (with examples)
  - What related topics ARE NOT included in this theme (boundary setting)
  - Key distinguishing features that separate this theme from similar ones
  - Why this theme matters to commenters

CRITICAL: You MUST use the double pipe || delimiter between the brief description and detailed guidelines. This is not optional.

EXAMPLE OF CORRECT FORMATTING:
1. Administrative Burden Concerns. This theme encompasses all concerns about increased paperwork, reporting requirements, and compliance costs that the proposed rule would impose on healthcare providers and facilities. || It includes specific worries about staff time spent on documentation, costs of new software systems, complexity of reporting metrics, and burden on small practices with limited administrative resources. This theme does NOT include general opposition to the rule, clinical workflow disruptions, or patient care quality concerns - those belong in separate themes. The defining characteristic is focus on administrative and bureaucratic challenges rather than clinical or financial impacts. This matters because administrative burden is cited as a major barrier to rule implementation.

1.1. Small Practice Impact. This sub-theme specifically addresses how administrative burdens would disproportionately affect small medical practices, solo practitioners, and rural healthcare facilities with limited staff. || It includes concerns about lack of dedicated compliance personnel, inability to afford new systems, and risk of closure due to administrative overload. This excludes large hospital system concerns or general workforce issues. The key distinction is the focus on practice size and resource constraints as the primary vulnerability factor. This matters because small practices serve vulnerable populations who may lose access to care.

2. Quality Measurement Validity. This theme captures all comments questioning whether the proposed quality metrics accurately measure care quality or could have unintended consequences. || It includes critiques of specific metrics, concerns about gaming the system, worries about cherry-picking patients, and arguments that metrics don't capture care complexity. This theme does NOT include implementation challenges or cost concerns - only validity and accuracy issues. The central focus is on whether the measurements themselves are meaningful and beneficial. This matters because invalid metrics could worsen rather than improve patient care.

`;

/**
 * A prompt for discovering a MECE hierarchical taxonomy from structured comment sections.
 * Focuses specifically on core positions, recommendations, and concerns to identify policy themes.
 * The {COMMENTS} placeholder is where the structured comment data should be injected.
 */
export const THEME_DISCOVERY_PROMPT = `As an expert policy analyst, your task is to derive a comprehensive, deeply detailed hierarchical taxonomy from the structured public comments provided below.

You are analyzing the most substantive parts of each comment: their commenter profiles, core positions, key recommendations, and main concerns. These structured sections capture the essential policy arguments and positions taken by commenters.

Your analysis should:
1. IDENTIFY POLICY POSITIONS: Look for distinct policy stances, arguments, and viewpoints expressed in core positions
2. CATEGORIZE RECOMMENDATIONS: Group similar policy suggestions, implementation approaches, and proposed changes
3. ORGANIZE CONCERNS: Cluster related worries, objections, and potential problems raised by commenters
4. CONSIDER COMMENTER CONTEXT: Use commenter profiles to understand the perspective and stakeholder group behind each position
5. CREATE DEEP HIERARCHY: Go as deep as needed to capture all nuances. If a theme has sub-aspects, create sub-themes. If those have further distinctions, create sub-sub-themes. Don't artificially limit depth.
6. BE COMPREHENSIVE: Capture every distinct viewpoint, concern, or recommendation. It's better to have too many specific themes than to lose important distinctions.
7. PRIORITIZE SPECIFICITY: When in doubt, create a more specific sub-theme rather than lumping concepts together.

Focus on substantive policy content rather than procedural comments or general statements. Each theme should capture a meaningful policy position, recommendation, or concern that appears across multiple comments or represents a significant stakeholder viewpoint.

IMPORTANT: Do not limit yourself to 2 or 3 levels. Go as deep as the content requires - 4, 5, or even 6 levels if needed to fully capture the nuances in the comments.

CRITICAL FORMATTING RULE: You MUST use the double pipe delimiter ( || ) to separate the brief description from the detailed guidelines. This is essential for proper parsing. Do not omit this delimiter.

--- FORMATTING REQUIREMENTS ---
${TAXONOMY_OUTPUT_FORMAT_INSTRUCTIONS}
--- END OF FORMATTING REQUIREMENTS ---

--- START OF STRUCTURED COMMENTS ---
{COMMENTS}
--- END OF STRUCTURED COMMENTS ---

You have now reviewed all the structured comment sections. Proceed with generating the complete, MECE hierarchical taxonomy of policy themes, strictly following the formatting requirements provided above.
`;

/**
 * A prompt for merging multiple existing theme taxonomies into a single, unified hierarchy.
 * This version handles N taxonomies instead of just 2, encouraging intelligent reconciliation.
 * It enforces the same strict plaintext output format as the discovery prompt.
 */
export const THEME_MERGE_PROMPT = `You are a senior analyst tasked with synthesizing research. Your goal is to merge multiple theme taxonomies into a single, comprehensive two-level hierarchy that preserves the richness and specificity of important topics.

Your input taxonomies:
{TAXONOMIES}

Your process should be:

1. **EXTRACT ALL SUBSTANTIVE TOPICS**: Identify every topic from the source taxonomies that could warrant a focused one-page explainer. This includes:
   - Specific policy proposals (e.g., "Require all new buildings over 5 stories to include rooftop gardens")
   - Key tensions or debates (e.g., "Bike Lane Expansion vs. Street Parking Preservation")
   - Specific problem areas (e.g., "Textbook Publishers' Bundling Practices")
   - Distinct stakeholder concerns (e.g., "Small Farmers' Barriers to Organic Certification")
   - Concrete technical issues (e.g., "Legacy COBOL Systems in State Unemployment Offices")

2. **CREATE DEPTH-TWO NODES LIBERALLY**: Each important topic gets its own depth-two node. Ask yourself: "Would someone write a policy brief about this specific issue?" If yes, it deserves its own node. Aim for 50-100 depth-two nodes total rather than 20-30.

3. **GROUP INTO LOGICAL DEPTH-ONE CATEGORIES**: Create 10-15 top-level themes that serve as logical groupings. These should be broad enough to house related issues but not so broad they become meaningless. Examples:
   - "Zoning Reform Proposals & Opposition"
   - "Student Assessment Methods & Validity"  
   - "Industrial Emissions Monitoring & Enforcement"
   - "Open Source Licensing Models & Compliance"

4. **ORDER YOUR CATEGORIES STRATEGICALLY**:
   - **Start with foundational/infrastructure themes**: Put technical standards, frameworks, or enabling conditions first
   - **Follow with implementation/application themes**: How the foundations are put into practice
   - **Then stakeholder-specific themes**: Organized by who is most affected (users, implementers, regulators)
   - **End with cross-cutting concerns**: Privacy, equity, governance issues that affect everything
   - **Alternative: Order by urgency/importance**: If clear from the source material, put the most critical or time-sensitive issues first

5. **ORDER SUB-THEMES WITHIN CATEGORIES**:
   - **Problem → Solution ordering**: Start with issues/barriers, follow with proposed fixes
   - **General → Specific**: Broad concerns before narrow edge cases
   - **Frequency/Impact**: Most commonly mentioned or highest-impact issues first
   - **Logical workflow**: If there's a natural sequence (e.g., "Design Standards" → "Implementation Requirements" → "Compliance Monitoring")

6. **PRESERVE SPECIFICITY IN DESCRIPTIONS**: 
   - Keep concrete examples, specific company names, particular technologies
   - Include numbers, dates, specific regulations when mentioned
   - Maintain stakeholder attributions ("teachers report...", "neighborhood associations demand...")
   - Preserve memorable phrases and "sticky" language from the source

7. **SPLITTING IS BETTER THAN LUMPING**: When in doubt:
   - Split compound themes (e.g., "Noise & Air Pollution" → "Aircraft Noise Impacts" and "Diesel Particulate Exposure")
   - Keep distinct issues separate even if related
   - Create multiple specific nodes rather than one generic node

8. **MAINTAIN TENSIONS AND CONTRADICTIONS**: If stakeholders disagree:
   - Create separate nodes for opposing viewpoints
   - Or clearly capture both perspectives within a single node
   - Don't smooth over conflicts into generic statements

9. **USE ISSUE-FOCUSED TITLES**: Each depth-two node should have a specific, descriptive title that immediately conveys what the issue is. Examples:
   - Not: "Transit Challenges" 
   - But: "Bus Drivers Face Split Shifts Without Overtime Pay"
   - Not: "Rural Issues"
   - But: "Rural Schools Cannot Afford Broadband for Remote Learning"

CRITICAL: Remember that each depth-two node should be substantial enough that someone could write a focused, one-page issue brief about it. If you find yourself creating nodes like "Other Concerns" or "General Issues," you're being too generic.

--- FORMATTING REQUIREMENTS ---
${TAXONOMY_OUTPUT_FORMAT_INSTRUCTIONS}
--- END OF FORMATTING REQUIREMENTS ---`;
