export const THEME_SUMMARY_PROMPT = `# Theme Analysis Instructions

You will analyze public comments that address a specific theme. Your task is to create a comprehensive overview that captures areas of consensus, debate, and noteworthy insights while maintaining the authentic voices of commenters.

## Theme Being Analyzed
{THEME_CODE}: {THEME_DESCRIPTION}

## Output Structure

You MUST organize your analysis into these exact sections with these exact headers:

### EXECUTIVE SUMMARY
[A 2-3 sentence overview capturing the essence of public sentiment on this theme - what's the big picture?]

### CONSENSUS POINTS
[If no clear consensus exists, write "No clear consensus points identified"]
- [Each point where commenters broadly agree, regardless of their overall position]
- [Include the approximate proportion who agree, e.g., "Nearly all commenters agree..." or "A strong majority believe..."]
  - [Supporting evidence or common reasoning]
  - [Notable exceptions if any]

### AREAS OF DEBATE
[If no significant debates exist, write "No significant areas of debate identified"]
- **[Debate Topic]:** [Brief description of the disagreement]
  - **Position A:** [First perspective with approximate support level]
    - [Key arguments or evidence]
  - **Position B:** [Opposing perspective with approximate support level]
    - [Key arguments or evidence]
  - **Middle Ground:** [If applicable, describe any compromise positions]

### STAKEHOLDER PERSPECTIVES
[Group commenters by their type/role and summarize their distinct viewpoints]
- **[Stakeholder Type]:** [Their primary concerns and positions]
  - [Specific points unique to this group]
  - [How their experience shapes their view]

### NOTEWORTHY INSIGHTS
[Unique, surprising, or particularly well-articulated points that illuminate the issue]
- [Unexpected consequences or connections raised by commenters]
- [Creative solutions or alternatives proposed]
- [Compelling personal experiences that illustrate broader issues]
- [Data points or evidence that challenge assumptions]
- [Particularly eloquent articulations of complex issues]

### EMERGING PATTERNS
[Patterns or trends that become visible across multiple comments]
- [Geographic variations in perspectives]
- [Correlations between commenter types and positions]
- [Recurring concerns that may not be explicitly connected by commenters]
- [Gaps or blind spots - what's NOT being discussed?]

### KEY QUOTATIONS
[Extract 3-5 verbatim quotes that powerfully capture different aspects of the debate]
- "[Quote that crystallizes the main concern]" - [Commenter Type]
- "[Quote that offers unique insight]" - [Commenter Type]
- "[Quote that humanizes the policy impact]" - [Commenter Type]

### ANALYTICAL NOTES
[Your observations about the quality and nature of the discourse]
- **Discourse Quality:** [Professional/Emotional/Mixed, with explanation]
- **Evidence Base:** [Well-supported/Anecdotal/Mixed, with explanation]
- **Representation Gaps:** [Which voices might be missing from this discussion?]
- **Complexity Level:** [How nuanced are the arguments being made?]

## Analysis Guidelines

**Maintain Objectivity:**
- Present all significant viewpoints fairly
- Use neutral language when describing positions
- Let commenters' own words carry emotional weight
- Distinguish between majority and minority views clearly

**Preserve Authenticity:**
- Keep the genuine tone and concerns of commenters
- Use direct quotes to let voices shine through
- Don't sanitize passionate or frustrated language in quotes
- Maintain the human element of the comments

**Focus on Substance:**
- Prioritize substantive policy arguments over process complaints
- Extract concrete examples and specific evidence
- Identify cause-and-effect relationships described by commenters
- Surface unintended consequences mentioned

**Identify Patterns:**
- Look for recurring themes across different commenter types
- Note when similar concerns use different language
- Identify proxy debates (surface issue vs. underlying concern)
- Recognize when commenters talk past each other

**Quality over Quantity:**
- Better to have fewer, well-supported points than many weak ones
- Combine similar points rather than listing repetitively
- Focus on the most significant and well-articulated arguments

---

Here are the structured comment sections addressing this theme:

{COMMENTS}`;

export const THEME_SUMMARY_MERGE_PROMPT = `You have multiple theme summary analyses from different batches of comments. Create a unified, comprehensive analysis that preserves all important insights while eliminating redundancy.

When merging:
- Combine consensus points, noting if agreement levels differ between batches
- Merge debate positions, keeping all distinct arguments
- Consolidate stakeholder perspectives across batches
- Keep all unique noteworthy insights
- Select the most powerful quotations across all batches
- Update analytical notes to reflect the full dataset

Maintain the exact same section structure and formatting requirements as the original analysis.

SUMMARY 1:
{SUMMARY1}

SUMMARY 2:
{SUMMARY2}

Output the complete merged theme analysis.`;

export const THEME_SUMMARY_STRUCTURE_PROMPT = `Convert the theme analysis text into a structured JSON format. The input follows a specific markdown format with sections and bullet points.

Your task is to parse this into clean JSON that preserves all information while making it easy to process programmatically.

## JSON Output Schema

Return a JSON object with this exact structure:

\`\`\`typescript
{
  "executiveSummary": string,
  "consensusPoints": Array<{
    "text": string,
    "supportLevel": string | null,  // e.g., "Nearly all commenters", "A strong majority"
    "evidence": Array<string> | null,
    "exceptions": string | null,
    "organizations": Array<string> | null  // Extract mentioned org names
  }> | null,
  "areasOfDebate": Array<{
    "topic": string,
    "description": string,
    "positions": Array<{
      "label": string,  // e.g., "Position A", "Position B"
      "stance": string,
      "supportLevel": string | null,
      "keyArguments": Array<string>,
      "organizations": Array<string> | null
    }>,
    "middleGround": string | null
  }> | null,
  "stakeholderPerspectives": Array<{
    "stakeholderType": string,
    "primaryConcerns": string,
    "specificPoints": Array<string>,
    "organizations": Array<string> | null
  }> | null,
  "noteworthyInsights": Array<{
    "insight": string,
    "source": string | null  // Organization or stakeholder if mentioned
  }> | null,
  "emergingPatterns": Array<{
    "pattern": string,
    "category": string | null  // e.g., "Geographic", "Stakeholder Divide", "Gap"
  }> | null,
  "keyQuotations": Array<{
    "quote": string,
    "source": string,  // Commenter type/organization
    "sourceType": string | null  // e.g., "Healthcare Provider", "Business"
  }> | null,
  "analyticalNotes": {
    "discourseQuality": {
      "level": string,
      "explanation": string
    },
    "evidenceBase": {
      "level": string,
      "explanation": string
    },
    "representationGaps": string | null,
    "complexityLevel": string | null
  } | null
}
\`\`\`

## Parsing Guidelines

1. **Extract Organization Names**: When organizations are mentioned (e.g., "Advocate Health notes..." or "according to Greenway Health"), extract them into the organizations array.

2. **Clean Text**: Remove markdown formatting like ** for bold, but preserve emphasis through proper field usage.

3. **Handle Missing Sections**: If a section states "No clear consensus points identified" or similar, return null for that section.

4. **Preserve Quotes**: Keep quotation marks in quoted text, but ensure proper JSON escaping.

5. **Support Levels**: Extract phrases like "Nearly all commenters", "A strong majority", "Supported by a significant minority" into the supportLevel fields.

6. **Source Attribution**: When sources are mentioned inline or in brackets, extract them appropriately.

7. **Maintain Structure**: Even if bullet points have sub-bullets, flatten them appropriately into the arrays while preserving the logical relationships.

## Input Theme Analysis:

{THEME_ANALYSIS}

Return only the JSON object, no additional text or explanation.`; 