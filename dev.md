# Pipeline Quick Reference

## 🚀 Complete Pipeline in One Command

```bash
bun run full-pipeline ./comments
```

## 📋 Step-by-Step Commands

```bash
# Phase 1: Theme Discovery
bun run generate ./comments      # Discover themes
bun run setup-db                  # Parse into database
bun run abstract ./comments       # Extract perspectives

# Phase 2: Position Analysis
bun run discover-axes            # Find disagreement dimensions
bun run classify-positions       # Map to specific positions

# Validation & Export
bun run data-validator.ts check-data      # Validate quality
bun run data-validator.ts export-positions # Export JSON
```

## 🔍 Quick Database Queries

```bash
# Open database
sqlite3 ./output/abstractions.db

# Quick stats
.headers on
.mode column
SELECT * FROM (
  SELECT 'Documents' as metric, COUNT(*) as count FROM abstractions
  UNION SELECT 'Perspectives', COUNT(*) FROM perspectives
  UNION SELECT 'Axes', COUNT(*) FROM theme_axes
  UNION SELECT 'Classifications', COUNT(*) FROM perspective_positions
);

# Find hottest debates
SELECT theme_code, axis_name, 
       side_1, side_2, debate_intensity
FROM contested_debates LIMIT 10;

# See who agrees on what
SELECT submitter_type, position_label, 
       count || ' (' || percent || '%)' as support
FROM stakeholder_alignment
WHERE theme_code = '3.1';

# Exit
.quit
```

## 📊 Common Analysis Tasks

### Find Themes Ready for Axis Discovery
```sql
SELECT code, description, perspective_count
FROM theme_coverage
WHERE perspective_count >= 5
AND code NOT IN (SELECT theme_code FROM theme_axes)
ORDER BY perspective_count DESC;
```

### Check Classification Quality
```sql
SELECT confidence, COUNT(*) as count,
       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as percent
FROM perspective_positions
GROUP BY confidence;
```

### Export Debate Summary
```bash
sqlite3 -header -csv ./output/abstractions.db \
  "SELECT * FROM debate_summary ORDER BY total_perspectives DESC" \
  > debates.csv
```

### Find Coalition Patterns
```sql
-- Who takes similar positions across multiple issues
WITH position_profiles AS (
  SELECT a.organization_name, a.submitter_type,
         GROUP_CONCAT(ta.axis_name || ': ' || ap.position_label, ' | ') as positions
  FROM perspective_positions pp
  JOIN perspectives p ON pp.perspective_id = p.id
  JOIN abstractions a ON p.abstraction_id = a.id
  JOIN theme_axes ta ON pp.axis_id = ta.id
  JOIN axis_positions ap ON pp.position_id = ap.id
  WHERE pp.confidence IN ('high', 'medium')
  GROUP BY a.id
)
SELECT submitter_type, positions, COUNT(*) as coalition_size
FROM position_profiles
GROUP BY submitter_type, positions
HAVING coalition_size > 2
ORDER BY coalition_size DESC;
```

## 🛠️ Troubleshooting

### No Axes Found
```bash
# Check which themes have enough data
sqlite3 ./output/abstractions.db \
  "SELECT * FROM theme_coverage WHERE perspective_count >= 5"
```

### Low Confidence Classifications
```bash
# Review low confidence reasoning
sqlite3 ./output/abstractions.db \
  "SELECT reasoning FROM perspective_positions 
   WHERE confidence = 'low' LIMIT 10"
```

### Missing Attributes
```bash
# Check attribute coverage
bun run data-validator.ts check-data
```

## 📁 File Structure

```
taxonomy-pipeline/
├── taxonomy-pipeline.ts    # Core pipeline
├── axis-discovery.ts       # Position analysis
├── data-validator.ts       # Quality checks
├── database-schema.sql     # DB structure
├── analysis-queries.sql    # Analysis SQL
├── package.json               # Scripts & deps
└── output/
    ├── final_taxonomy.md      # Theme hierarchy
    ├── observed_attributes.json # Categories
    ├── abstractions.db        # Complete data
    └── positions.json         # Export file
```

## 🎯 Key Pipeline Variables

```typescript
// Batch processing size
const BATCH_SIZE = 5;  // Adjust based on document size

// Minimum perspectives for axis discovery
min_perspectives: 5    // In theme_axes table

// Confidence thresholds
WHERE confidence IN ('high', 'medium')  // Exclude 'low'
```

## 💡 Pro Tips

1. **Start Small**: Test with 10-20 documents first
2. **Check Coverage**: Run validator after each stage
3. **Iterate**: Re-run position classification after reviewing axes
4. **Export Often**: Save intermediate results for debugging

## 🚨 Common Issues & Fixes

| Issue | Check | Fix |
|-------|-------|-----|
| No axes discovered | `SELECT * FROM theme_coverage` | Need 5+ perspectives per theme |
| JSON parse errors | Check `./output/batch_*.md` | Reduce BATCH_SIZE |
| Missing positions | `SELECT * FROM axis_positions` | Run discover-axes first |
| Low confidence | Review reasoning field | Perspectives may be ambiguous |

## 📈 Success Metrics

Good pipeline run shows:
- ✅ 80%+ perspectives classified
- ✅ 60%+ high confidence
- ✅ Multiple contested debates found
- ✅ Clear stakeholder alignments
- ✅ Some unexpected coalitions

# Taxonomy & Position Analysis Pipeline

A complete system for analyzing public comments from regulations.gov that goes beyond simple sentiment analysis to discover actual policy positions and stakeholder alignments.

## Overview

This pipeline performs five key operations:

1. **Theme Discovery** - Builds hierarchical taxonomy of themes from comments
2. **Attribute Discovery** - Identifies submitter types, sentiments, and other categories
3. **Perspective Extraction** - Extracts specific viewpoints with evidence
4. **Axis Discovery** - Finds dimensions of disagreement within themes
5. **Position Classification** - Maps perspectives to specific policy positions

## Why Position Analysis Matters

Traditional sentiment analysis fails for policy:
- "Positive" about what exactly?
- Two "supportive" comments may support opposite approaches
- Real debates are about specific choices, not general feelings

This system automatically discovers the actual axes of disagreement and classifies perspectives by their specific positions.

## Installation

```bash
# Prerequisites
curl -fsSL https://bun.sh/install | bash  # Install bun
sqlite3 --version                          # Ensure SQLite installed

# Setup
git clone <repository>
cd regulations.gov-comment-browser
bun install

# Configure
export GEMINI_API_KEY=your-api-key-here
```

## Quick Start

```bash
# Run complete pipeline on your comments
bun run full-pipeline ./path/to/comments

# View results
sqlite3 ./output/abstractions.db < analysis-queries.sql
```

## Detailed Usage

### Step 1: Generate Taxonomy
```bash
bun run generate ./comments
```
Discovers hierarchical themes and attributes from your documents.

**Outputs:**
- `./output/final_taxonomy.md` - Human-readable theme hierarchy
- `./output/observed_attributes.json` - Discovered categories

### Step 2: Setup Database
```bash
bun run setup-db
```
Parses taxonomy into structured database tables.

### Step 3: Abstract Comments
```bash
bun run abstract ./comments
```
Extracts perspectives from each comment using the taxonomy.

### Step 4: Discover Axes
```bash
bun run discover-axes
```
For themes with 5+ perspectives, discovers dimensions of disagreement.

**Example Output:**
```
Theme 3.1: TEFCA Implementation
  ✓ Discovered axis: "Implementation Timeline"
    Question: When and how quickly should TEFCA be implemented?
    Positions: Immediate mandate, Phased rollout, Voluntary adoption
```

### Step 5: Classify Positions
```bash
bun run classify-positions
```
Maps each perspective to positions on relevant axes.

## Database Schema

### Core Tables
- `abstractions` - Document metadata and attributes
- `perspectives` - Individual viewpoints with evidence
- `taxonomy_ref` - Hierarchical theme structure
- `observed_attributes` - Discovered categories

### Position Analysis Tables
- `theme_axes` - Dimensions of disagreement
- `axis_positions` - Possible positions on each axis
- `perspective_positions` - How perspectives map to positions

## Key Analysis Queries

### Find Real Debates
```sql
-- Shows contested issues with balanced opposition
SELECT theme_code, axis_name, 
       side_1, side_2, debate_intensity
FROM contested_debates;
```

### Stakeholder Alignment
```sql
-- Who supports what positions
SELECT submitter_type, issue, position_label, support
FROM stakeholder_alignment
ORDER BY submitter_type, support DESC;
```

### Unusual Alliances
```sql
-- Different groups taking same position
SELECT theme_code, position_label, alliance
FROM unusual_alliances;
```

## Example Analysis Flow

### Input Comment
```
"As a rural hospital administrator, we support TEFCA but need 
5+ years to implement given our limited IT resources. Federal 
funding support is essential."
```

### Extracted Data
```json
{
  "submitter": {
    "type": "Healthcare Provider",
    "organization": "Rural Hospital"
  },
  "perspectives": [{
    "taxonomy_code": "3.1",
    "perspective": "TEFCA support contingent on extended timeline",
    "excerpt": "need 5+ years to implement"
  }]
}
```

### Position Classification
- **Timeline Axis**: Phased rollout (confidence: high)
- **Funding Axis**: Government subsidized (confidence: high)

### Analysis Result
This aligns with other rural providers who form a coalition supporting phased implementation with subsidies.

## Configuration

### Adjust Processing
```typescript
// In taxonomy-pipeline.ts
const BATCH_SIZE = 5;  // Files per batch
const MODEL = 'gemini-2.5-pro-preview-06-05';  // LLM model
```

### Minimum Thresholds
```typescript
// In axis-discovery.ts
min_perspectives: 5  // Minimum for axis discovery
```

## Output Files

```
./output/
├── final_taxonomy.md           # Hierarchical themes
├── observed_attributes.json    # Discovered categories
├── abstractions.db            # Complete analysis database
├── batch_*.md                 # Intermediate files
└── analysis-results.csv       # Query exports
```

## Troubleshooting

### No axes discovered
- Check theme has 5+ perspectives: `SELECT * FROM theme_coverage`
- Verify perspectives have substantive disagreements

### Low classification confidence
- Perspective may not clearly address the axis
- Review reasoning: `SELECT reasoning FROM perspective_positions WHERE confidence='low'`

### JSON parse errors
- Check intermediate files for malformed LLM output
- Reduce batch size or adjust temperature

## Advanced Usage

### Custom Analysis
```bash
# Export specific analyses
sqlite3 -header -csv ./output/abstractions.db \
  "SELECT * FROM stakeholder_alignment WHERE theme_code='3.1'" \
  > tefca-positions.csv
```

### Incremental Processing
```bash
# Add new comments to existing analysis
bun run abstract ./new-comments
bun run classify-positions  # Re-classify with new data
```

### Validation Queries
```sql
-- Check data quality
SELECT confidence, COUNT(*) FROM perspective_positions
GROUP BY confidence;

-- Find themes needing more data
SELECT * FROM theme_coverage WHERE perspective_count < 5;
```

## Key Innovations

1. **Domain Agnostic** - Discovers categories from your data
2. **Position-Based** - Maps actual policy choices, not sentiment
3. **Coalition Detection** - Finds groups with aligned positions
4. **Debate Discovery** - Surfaces real points of contention
5. **Missing Voice Detection** - Identifies unrepresented viewpoints

## Next Steps

The extracted positions enable:
- Interactive debate visualization
- Stakeholder alignment matrices
- Policy compromise identification
- Evidence-based decision support

## Support

For issues or questions:
1. Check intermediate files in `./output/`
2. Review error logs during processing
3. Validate data with analysis queries
4. Ensure sufficient perspectives per theme
