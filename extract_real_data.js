import { Database } from "bun:sqlite";
import { writeFileSync } from "fs";

const db = new Database("dbs/CMS-2025-0050-0031.sqlite");

console.log("=== EXTRACTING REAL DATA FOR INTERFACE ===");

// Get all condensed comments
console.log("Fetching condensed comments...");
const comments = db.prepare(`
  SELECT 
    comment_id,
    status,
    structured_sections,
    created_at
  FROM condensed_comments 
  WHERE status = 'completed'
  ORDER BY comment_id
`).all();

console.log(`Found ${comments.length} condensed comments`);

// Check if entity tables exist and have data
let entitiesExist = false;
let entityData = [];

try {
  const entityCount = db.prepare("SELECT COUNT(*) as count FROM entity_taxonomy").get();
  if (entityCount.count > 0) {
    entitiesExist = true;
    console.log(`Found ${entityCount.count} entities in database`);
    
    // Get entities with comment associations
    entityData = db.prepare(`
      SELECT 
        et.entity_id,
        et.entity_name,
        et.entity_type,
        COUNT(ce.comment_id) as comment_count,
        GROUP_CONCAT(ce.comment_id) as comment_ids
      FROM entity_taxonomy et
      LEFT JOIN comment_entities ce ON et.entity_id = ce.entity_id
      GROUP BY et.entity_id, et.entity_name, et.entity_type
      HAVING comment_count > 0
      ORDER BY comment_count DESC
    `).all();
  }
} catch (e) {
  console.log("Entity tables not found - will extract from structured sections");
}

// Process comments and extract entities if not in separate tables
const processedComments = comments.map(comment => {
  let parsed = null;
  try {
    parsed = JSON.parse(comment.structured_sections);
  } catch (e) {
    console.log(`Error parsing comment ${comment.comment_id}`);
    return null;
  }
  
  // Extract entities from structured content if not in entity tables
  let entities = [];
  if (!entitiesExist) {
    // Try to extract entities from key points, categories, or content
    if (parsed.keyPoints) {
      entities = parsed.keyPoints.slice(0, 3); // Use key points as pseudo-entities
    }
    if (parsed.category) {
      entities.push(parsed.category);
    }
    // Look for organization names in content
    const orgPatterns = /\b([A-Z][a-z]+ (?:Health|Medical|Association|Corp|Inc|LLC|Company|Group|Systems))\b/g;
    const orgMatches = parsed.detailedContent.match(orgPatterns);
    if (orgMatches) {
      entities.push(...orgMatches.slice(0, 2));
    }
  }
  
  return {
    ...comment,
    parsed_content: parsed,
    entities: entities
  };
}).filter(Boolean);

// If we have entity tables, map comment entities
if (entitiesExist) {
  console.log("Mapping entities to comments...");
  const commentEntityMap = new Map();
  
  const commentEntities = db.prepare(`
    SELECT ce.comment_id, et.entity_name, et.entity_type
    FROM comment_entities ce
    JOIN entity_taxonomy et ON ce.entity_id = et.entity_id
  `).all();
  
  commentEntities.forEach(ce => {
    if (!commentEntityMap.has(ce.comment_id)) {
      commentEntityMap.set(ce.comment_id, []);
    }
    commentEntityMap.get(ce.comment_id).push({
      name: ce.entity_name,
      type: ce.entity_type
    });
  });
  
  // Add entity data to comments
  processedComments.forEach(comment => {
    const entities = commentEntityMap.get(comment.comment_id) || [];
    comment.entities = entities.map(e => e.name);
    comment.entity_details = entities;
  });
}

// Generate entity summary for sidebar
const entitySummary = new Map();
processedComments.forEach(comment => {
  if (comment.entities) {
    comment.entities.forEach(entity => {
      if (!entitySummary.has(entity)) {
        entitySummary.set(entity, {
          name: entity,
          commentCount: 0,
          comments: [],
          type: 'extracted'
        });
      }
      entitySummary.get(entity).commentCount++;
      entitySummary.get(entity).comments.push(comment.comment_id);
    });
  }
});

const finalEntityList = Array.from(entitySummary.values())
  .sort((a, b) => b.commentCount - a.commentCount);

// Export data for web interface
const exportData = {
  comments: processedComments,
  entities: finalEntityList,
  metadata: {
    totalComments: processedComments.length,
    totalEntities: finalEntityList.length,
    hasEntityTables: entitiesExist,
    exportDate: new Date().toISOString()
  }
};

writeFileSync("web_interface_data.json", JSON.stringify(exportData, null, 2));

console.log("=== EXPORT COMPLETE ===");
console.log(`✅ Exported ${processedComments.length} comments`);
console.log(`✅ Exported ${finalEntityList.length} entities`);
console.log(`✅ Data saved to web_interface_data.json`);
console.log(`✅ Entity tables existed: ${entitiesExist}`);

// Show top entities
console.log("\n=== TOP ENTITIES ===");
finalEntityList.slice(0, 10).forEach((entity, i) => {
  console.log(`${i+1}. ${entity.name} (${entity.commentCount} comments)`);
});

db.close();
