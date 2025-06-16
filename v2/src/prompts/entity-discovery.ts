export const ENTITY_DISCOVERY_PROMPT = `Design a taxonomy of mentioned entities relevant to the comments below. Organize it into a numbered hierarchy like:

1. Some Category
* Common Entity Name: Entity definition/explanation
  * "Exact string as it appears"
  * "Another exact string"
* Next Entity Name: Entity definition
2. Next Category

STRICT FORMATTING RULES (important):
• Plain text only – NO bold, italics, markdown headers, or extra indentation.
• Category lines MUST be in the form '1. Category Name' (single leading digit, period, space).
• Each entity line MUST start with '* ' followed by the canonical name, a single colon, a single space, then its definition.
• Each term line MUST start with two spaces + '* "Exact term"' (quote marks required, bullet required, exactly two leading spaces).
• Use only exact string matches gathered from the comments – no paraphrasing.

Canonical entity names should be those in common use, not necessarily fully expanded names.

{COMMENTS}

Output the complete taxonomy including all entities and all exact strings by which they appear across all comments.`;

export const ENTITY_MERGE_PROMPT = `You have two entity taxonomies from different batches of comments. Create a unified taxonomy.

When the same entity appears in both:
- Keep all unique search terms from both
- Use the clearer definition

Reconcile different categorization approaches:
- If one uses "Healthcare Organizations" and another uses "Medical Entities", choose the more appropriate category
- Move entities to their best-fit categories

Maintain the exact formatting from before.

TAXONOMY 1:
{TAXONOMY1}

TAXONOMY 2:
{TAXONOMY2}

Output the complete merged taxonomy with all entities and search terms.`;
