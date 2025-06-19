export const ENTITY_CATEGORY_DISCOVERY_PROMPT = `Identify the main categories of entities mentioned in the comments below. For each category, provide 1-2 example entities to illustrate what belongs in that category.

Format your response as:

1. Category
* Member Name: Brief definition
* Another Member: Brief definition

2. Next Category
* Next Category Member Name: Brief definition

RULES:
• Plain text only – NO bold, italics, or markdown
• Categories should be broad groups (e.g., "Healthcare Organizations", "Government Agencies", "Medical Conditions")
• Include only 1-2 representative examples per category
• Examples should be actual entities from the comments, not hypothetical

{COMMENTS}

Output only the category structure with minimal examples.`;

export const ENTITY_CATEGORY_MERGE_PROMPT = `You have multiple category lists from different batches of comments. Create a unified MECE (Mutually Exclusive, Collectively Exhaustive) category structure.

MECE Requirements:
• Mutually Exclusive: Each entity should clearly belong to only ONE category
• Collectively Exhaustive: Every entity from the source lists must have a home
• Clear boundaries: Category definitions should make it obvious what belongs where

Reconciliation guidelines:
- "Healthcare Organizations" and "Medical Entities" → choose the clearer, more specific name
- "Government Bodies" and "Federal Agencies" → merge under the more precise category
- Split overly broad categories if they mix different types (e.g., "Healthcare" → "Healthcare Organizations", "Medical Conditions", "Medical Procedures")
- Combine overly narrow categories that could confuse placement

Return a JSON array of category names:
["Category 1", "Category 2", "Category 3", ...]

{CATEGORY_LISTS}

Output only the JSON array of MECE categories where every entity has exactly one obvious home.`;

export const ENTITY_EXTRACTION_PROMPT = `Extract all entities from the comments below and organize them into these predefined categories:

{CATEGORIES}

For each entity:
1. Place it in the most appropriate category
2. Provide a brief definition
3. List ALL exact strings/terms used to refer to it in quotes

Format:
1. Category Name
* Entity Name: Definition
  * "Exact string 1"
  * "Exact string 2"
* Next Entity: Definition
  * "Term"

RULES:
• Use ONLY the provided categories - do not create new ones
• Include ALL entities mentioned in the comments
• List ALL variations/terms for each entity
• Plain text only - no formatting

{COMMENTS}

Output the complete entity list organized by the given categories.`;

export const ENTITY_EXTRACTION_JSON_PROMPT = `Extract all entities from the comments below and organize them into these predefined categories:

{CATEGORIES}

Return a JSON object with this structure:
{
  "category_name": [
    {
      "label": "Entity Name",
      "definition": "Brief definition of the entity",
      "terms": ["exact term 1", "another term", "variant spellings", "etc"]
    }
  ]
}

RULES:
• Use ONLY the provided categories as keys in the JSON
• Include ALL entities mentioned in the comments
• List ALL variations/terms for each entity exactly as they appear
• Ensure valid JSON output

{COMMENTS}

Output only the JSON object with entities organized by category.`;

// Legacy prompts for backward compatibility
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