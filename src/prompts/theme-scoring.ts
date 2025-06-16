export const THEME_SCORING_PROMPT = `You will analyze a public comment against a hierarchical theme taxonomy to determine which themes it addresses.

SCORING SCALE:
1 = Directly addresses the theme in a substantive way (makes specific arguments, provides evidence, or offers detailed recommendations about this theme)
2 = Touches on the theme (mentions it briefly or tangentially, but it's not a primary focus)
3 = Does not address the theme

INSTRUCTIONS:
- Score EVERY theme in the hierarchy (all levels: 1, 1.1, 1.1.1, 1.2, 2, 2.1, etc.)
- A comment can score 1, 2, or 3 on every theme
- If a comment strongly addresses a sub-theme (e.g., 2.1.3), it should also score at least 2 on parent themes (2.1 and 2)
- Focus on substantive content, not just keyword matches
- Consider the comment's main arguments and evidence when scoring
- You MUST evaluate every single theme code listed in the hierarchy below

OUTPUT FORMAT:
Return a JSON object with theme codes as keys and scores (1, 2, or 3) as values.
CRITICAL: Your JSON must contain EXACTLY {THEME_COUNT} keys - one for every theme code in the hierarchy.
Include ALL themes, even those that score 3 (does not address).
IMPORTANT: Make sure you consider every theme code in the hierarchy - don't skip any levels.

Example output (if hierarchy had 5 themes):
{
  "1": 2,
  "1.1": 3,
  "1.2": 1,
  "2": 3,
  "2.1": 2
}

THEME HIERARCHY:
{THEME_HIERARCHY}

COMMENT TO ANALYZE:
{COMMENT}
---
Return a JSON object with theme codes as keys and scores as values.
`; 