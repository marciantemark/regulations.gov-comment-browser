import { GoogleGenAI } from '@google/genai';
import { Database } from 'bun:sqlite';

const MODEL = 'gemini-2.5-pro-preview-06-05';

// Command parsing
const command = process.argv[2];
if (!command || !['discover-axes', 'classify-positions'].includes(command)) {
  console.log(`
Axis Discovery - Position Analysis Extension

Usage:
  bun run axis-discovery.ts discover-axes     # Discover axes of disagreement
  bun run axis-discovery.ts classify-positions # Classify perspectives by position
  `);
  process.exit(1);
}

const prompts = {
  discoverAxes: `Analyze these perspectives on theme "{THEME_DESC}" to identify axes of disagreement.

PERSPECTIVES:
{PERSPECTIVES}

TASK:
1. Identify 1-3 major dimensions where perspectives disagree
2. For each dimension:
   - Name it clearly (e.g., "Implementation Timeline", "Scope of Authority")
   - Frame as a neutral question
   - Identify 3-5 mutually exclusive positions that cover all perspectives
   - Ensure positions are MECE (mutually exclusive, collectively exhaustive)

3. Minor variations or nuances should not be separate axes - only major philosophical/practical divides

OUTPUT FORMAT:
{
  "axes": [
    {
      "name": "Implementation Approach",
      "question": "How should this be implemented?",
      "positions": [
        {
          "key": "mandatory_immediate",
          "label": "Immediate mandate",
          "description": "Required for all within 12 months"
        },
        {
          "key": "phased_rollout", 
          "label": "Phased by size",
          "description": "Large organizations first, small get 3+ years"
        },
        {
          "key": "voluntary_incentives",
          "label": "Voluntary with incentives", 
          "description": "Encourage adoption through benefits, not mandates"
        }
      ]
    }
  ],
  "analysis_notes": "Brief explanation of why these are the key divides"
}`,

  classifyPosition: `Given this perspective and the axes of disagreement, classify its position.

PERSPECTIVE:
Organization: {ORG}
Theme: {THEME}
Viewpoint: {PERSPECTIVE}
Excerpt: {EXCERPT}

AXES OF DISAGREEMENT:
{AXES}

For each axis, determine:
1. Which position best matches this perspective
2. Confidence level (high/medium/low)
3. Brief reasoning

If the perspective doesn't clearly address an axis, mark confidence as "low" and explain.

OUTPUT FORMAT:
{
  "classifications": [
    {
      "axis_id": {AXIS_ID},
      "position_key": "selected_position_key",
      "confidence": "high|medium|low",
      "reasoning": "They explicitly state X which aligns with position Y"
    }
  ]
}`
};

async function discoverAxes() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const db = new Database('./output/abstractions.db');
  
  // Find themes with sufficient perspectives
  const themes = db.prepare(`
    SELECT 
      t.code,
      t.description,
      COUNT(DISTINCT p.id) as perspective_count
    FROM taxonomy_ref t
    JOIN perspectives p ON t.code = p.taxonomy_code
    GROUP BY t.code, t.description
    HAVING perspective_count >= 5
    ORDER BY t.level, t.code
  `).all() as Array<{code: string; description: string; perspective_count: number}>;
  
  console.log(`Found ${themes.length} themes with sufficient perspectives for analysis\n`);
  
  const insertAxis = db.prepare(`
    INSERT INTO theme_axes (theme_code, axis_name, axis_question)
    VALUES (?, ?, ?)
  `);
  
  const insertPosition = db.prepare(`
    INSERT INTO axis_positions (axis_id, position_key, position_label, position_description)
    VALUES (?, ?, ?, ?)
  `);
  
  let totalAxes = 0;
  let totalPositions = 0;
  
  for (const theme of themes) {
    console.log(`\nAnalyzing theme ${theme.code}: ${theme.description}`);
    console.log(`  (${theme.perspective_count} perspectives)`);
    
    // Get all perspectives for this theme
    const perspectives = db.prepare(`
      SELECT 
        p.id,
        p.perspective,
        p.excerpt,
        a.organization_name,
        a.submitter_type
      FROM perspectives p
      JOIN abstractions a ON p.abstraction_id = a.id
      WHERE p.taxonomy_code = ?
    `).all(theme.code) as Array<{
      id: number;
      perspective: string;
      excerpt: string;
      organization_name: string;
      submitter_type: string;
    }>;
    
    // Format perspectives for analysis
    const perspectiveText = perspectives.map((p, i) => 
      `${i + 1}. [${p.submitter_type}${p.organization_name ? ' - ' + p.organization_name : ''}]\n` +
      `   Viewpoint: ${p.perspective}\n` +
      `   Evidence: "${p.excerpt}"`
    ).join('\n\n');
    
    // Discover axes
    const prompt = prompts.discoverAxes
      .replace('{THEME_DESC}', `${theme.code} ${theme.description}`)
      .replace('{PERSPECTIVES}', perspectiveText);
    
    try {
      const response = await generateContent(ai, prompt);
      const result = JSON.parse(response);
      
      // Store axes and positions
      for (const axis of result.axes) {
        const axisResult = insertAxis.run(theme.code, axis.name, axis.question);
        const axisId = axisResult.lastInsertRowid;
        totalAxes++;
        
        for (const position of axis.positions) {
          insertPosition.run(
            axisId,
            position.key,
            position.label,
            position.description
          );
          totalPositions++;
        }
        
        console.log(`  ✓ Discovered axis: "${axis.name}"`);
        console.log(`    Question: ${axis.question}`);
        console.log(`    Positions: ${axis.positions.map(p => p.label).join(', ')}`);
      }
      
      if (result.analysis_notes) {
        console.log(`  Note: ${result.analysis_notes}`);
      }
      
    } catch (error) {
      console.error(`  ✗ Error analyzing theme ${theme.code}:`, error);
    }
  }
  
  db.close();
  
  console.log('\n=== Axis Discovery Complete ===');
  console.log(`Total axes discovered: ${totalAxes}`);
  console.log(`Total positions defined: ${totalPositions}`);
}

async function classifyPositions() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const db = new Database('./output/abstractions.db');
  
  // Get all axes with their positions
  const axes = db.prepare(`
    SELECT 
      ta.id as axis_id,
      ta.theme_code,
      ta.axis_name,
      ta.axis_question,
      t.description as theme_description
    FROM theme_axes ta
    JOIN taxonomy_ref t ON ta.theme_code = t.code
    ORDER BY ta.theme_code
  `).all() as Array<{
    axis_id: number;
    theme_code: string;
    axis_name: string;
    axis_question: string;
    theme_description: string;
  }>;
  
  console.log(`Found ${axes.length} axes to classify perspectives against\n`);
  
  const insertClassification = db.prepare(`
    INSERT INTO perspective_positions (perspective_id, axis_id, position_id, confidence, reasoning)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  let totalClassified = 0;
  let highConfidence = 0;
  let mediumConfidence = 0;
  let lowConfidence = 0;
  
  for (const axis of axes) {
    console.log(`\nClassifying for: ${axis.theme_code} - ${axis.axis_name}`);
    console.log(`  Question: "${axis.axis_question}"`);
    
    // Get positions for this axis
    const positions = db.prepare(`
      SELECT id, position_key, position_label, position_description
      FROM axis_positions
      WHERE axis_id = ?
    `).all(axis.axis_id) as Array<{
      id: number;
      position_key: string;
      position_label: string;
      position_description: string;
    }>;
    
    console.log(`  Positions: ${positions.map(p => p.position_label).join(', ')}`);
    
    // Get perspectives for this theme
    const perspectives = db.prepare(`
      SELECT 
        p.id,
        p.perspective,
        p.excerpt,
        a.organization_name,
        a.submitter_type
      FROM perspectives p
      JOIN abstractions a ON p.abstraction_id = a.id
      WHERE p.taxonomy_code = ?
      AND NOT EXISTS (
        SELECT 1 FROM perspective_positions pp 
        WHERE pp.perspective_id = p.id 
        AND pp.axis_id = ?
      )
    `).all(axis.theme_code, axis.axis_id) as Array<{
      id: number;
      perspective: string;
      excerpt: string;
      organization_name: string;
      submitter_type: string;
    }>;
    
    console.log(`  Classifying ${perspectives.length} perspectives...`);
    
    // Format axis info
    const axisInfo = {
      id: axis.axis_id,
      name: axis.axis_name,
      question: axis.axis_question,
      positions: positions.map(p => ({
        key: p.position_key,
        label: p.position_label,
        description: p.position_description
      }))
    };
    
    // Classify each perspective
    let axisClassified = 0;
    for (const persp of perspectives) {
      const prompt = prompts.classifyPosition
        .replace('{ORG}', persp.organization_name || persp.submitter_type)
        .replace('{THEME}', `${axis.theme_code} ${axis.theme_description}`)
        .replace('{PERSPECTIVE}', persp.perspective)
        .replace('{EXCERPT}', persp.excerpt)
        .replace('{AXES}', JSON.stringify([axisInfo], null, 2))
        .replace('{AXIS_ID}', axis.axis_id.toString());
      
      try {
        const response = await generateContent(ai, prompt);
        const result = JSON.parse(response);
        
        for (const classification of result.classifications) {
          // Find position ID
          const position = positions.find(p => p.position_key === classification.position_key);
          if (position) {
            insertClassification.run(
              persp.id,
              classification.axis_id,
              position.id,
              classification.confidence,
              classification.reasoning
            );
            totalClassified++;
            axisClassified++;
            
            // Track confidence levels
            if (classification.confidence === 'high') highConfidence++;
            else if (classification.confidence === 'medium') mediumConfidence++;
            else if (classification.confidence === 'low') lowConfidence++;
          }
        }
        
      } catch (error) {
        console.error(`    Error classifying perspective ${persp.id}:`, error);
      }
    }
    
    console.log(`  ✓ Classified ${axisClassified} perspectives`);
  }
  
  // Update position counts
  db.run(`
    UPDATE axis_positions
    SET example_count = (
      SELECT COUNT(*)
      FROM perspective_positions pp
      WHERE pp.position_id = axis_positions.id
    )
  `);
  
  db.close();
  
  console.log('\n=== Position Classification Complete ===');
  console.log(`Total classifications: ${totalClassified}`);
  console.log(`Confidence breakdown:`);
  console.log(`  High: ${highConfidence} (${Math.round(highConfidence/totalClassified*100)}%)`);
  console.log(`  Medium: ${mediumConfidence} (${Math.round(mediumConfidence/totalClassified*100)}%)`);
  console.log(`  Low: ${lowConfidence} (${Math.round(lowConfidence/totalClassified*100)}%)`);
}

async function generateContent(ai: GoogleGenAI, prompt: string): Promise<string> {
  const config = { responseMimeType: 'text/plain' };
  const contents = [{
    role: 'user' as const,
    parts: [{ text: prompt }]
  }];
  
  const response = await ai.models.generateContentStream({
    model: MODEL,
    config,
    contents,
  });
  
  let result = '';
  for await (const chunk of response) {
    result += chunk.text;
  }
  
  return result;
}

// Main execution
if (command === 'discover-axes') {
  console.log('Discovering axes of disagreement for all themes...\n');
  discoverAxes().catch(console.error);
} else if (command === 'classify-positions') {
  console.log('Classifying all perspectives by position...\n');
  classifyPositions().catch(console.error);
}
