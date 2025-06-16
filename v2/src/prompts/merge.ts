// Generic merge prompts that could be used for other merging tasks

export const GENERIC_MERGE_PROMPT = `Merge these two items into a single comprehensive result.

INSTRUCTIONS:
1. Combine similar elements
2. Preserve important distinctions
3. Maintain consistent structure
4. Use clear, descriptive names
5. Include all unique information from both sources

ITEM 1:
{ITEM1}

ITEM 2:
{ITEM2}

OUTPUT:
[Merged result following the same format as the inputs]`;

// For future theme analysis narrative merging
export const NARRATIVE_MERGE_PROMPT = `Merge these two narrative summaries into a comprehensive overview.

IMPORTANT: Since narratives may not contain all underlying data, also extract and preserve:
- Specific claims and positions mentioned
- Stakeholder groups and their stances
- Quantitative data points
- Key examples or case studies

NARRATIVE 1:
{NARRATIVE1}

NARRATIVE 2:
{NARRATIVE2}

OUTPUT:
{
  "merged_narrative": "Combined 2-3 paragraph narrative",
  "all_claims": ["List of all specific claims from both narratives"],
  "stakeholder_positions": {
    "group_name": ["their position 1", "their position 2"]
  },
  "data_points": ["specific statistics or numbers mentioned"],
  "examples": ["key examples or case studies referenced"]
}`;
