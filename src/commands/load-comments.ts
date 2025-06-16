import { Command } from "commander";
import { Database } from "bun:sqlite";
import { createReadStream, readFileSync } from "fs";
import { parse } from "csv-parse";
import { basename, extname } from "path";
import { openDb, withTransaction } from "../lib/database";
import { initDebug, debugLog } from "../lib/debug";
import type { CommentAttributes } from "../types";

export const loadCommentsCommand = new Command("load")
  .description("Load comments from regulations.gov API or CSV file")
  .argument("<source>", "Document ID (e.g., CMS-2025-0050-0031) or path to CSV file")
  .option("-k, --api-key <key>", "Regulations.gov API key", process.env.REGSGOV_API_KEY || "DEMO_KEY")
  .option("--skip-attachments", "Skip downloading attachments")
  .option("-l, --limit <n>", "Stop after N comments", parseInt)
  .option("-d, --debug", "Enable debug output")
  .action(loadComments);

async function loadComments(source: string, options: any) {
  await initDebug(options.debug);
  
  // Determine if source is file or document ID
  const isFile = source.includes(".") || source.includes("/");
  
  if (isFile) {
    await loadFromCsv(source, options);
  } else {
    await loadFromApi(source, options);
  }
}

// Load from regulations.gov API
async function loadFromApi(documentId: string, options: any) {
  console.log(`📥 Loading comments for document ${documentId} from regulations.gov API`);
  
  const db = openDb(documentId);
  const headers = { "X-Api-Key": options.apiKey };
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  
  try {
    // Get document object ID
    console.log("🔍 Resolving document object ID...");
    const docResponse = await fetch(
      `https://api.regulations.gov/v4/documents/${documentId}`,
      { headers }
    );
    
    if (!docResponse.ok) {
      throw new Error(`Failed to fetch document: ${docResponse.status} ${docResponse.statusText}`);
    }
    
    const docData = await docResponse.json();
    const objectId = docData.data.attributes.objectId;
    debugLog(`Object ID: ${objectId}`);
    
    // Get existing comment count
    const existingCount = db.prepare("SELECT COUNT(*) as count FROM comments").get() as { count: number };
    console.log(`📊 Existing comments in database: ${existingCount.count}`);
    
    // List all comment IDs
    console.log("📋 Fetching comment list...");
    const commentIds: string[] = [];
    let page = 1;
    
    while (true) {
      const url = `https://api.regulations.gov/v4/comments?filter[commentOnId]=${objectId}&page[size]=250&page[number]=${page}`;
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      if (!data.data || data.data.length === 0) break;
      
      commentIds.push(...data.data.map((c: any) => c.id));
      console.log(`  Page ${page}: ${data.data.length} comments (total: ${commentIds.length})`);
      
      if (data.data.length < 250) break;
      page++;
      await sleep(1200); // Rate limiting
    }
    
    console.log(`📊 Total comments available: ${commentIds.length}`);
    
    // Filter out already loaded comments
    const loadedIds = db.prepare("SELECT id FROM comments").all().map((r: any) => r.id);
    const newIds = commentIds.filter(id => !loadedIds.includes(id));
    console.log(`🆕 New comments to load: ${newIds.length}`);
    
    // Apply limit if specified
    const idsToLoad = options.limit ? newIds.slice(0, options.limit - existingCount.count) : newIds;
    console.log(`🎯 Will load ${idsToLoad.length} comments`);
    
    // Prepare statements
    const insertComment = db.prepare("INSERT OR REPLACE INTO comments (id, attributes_json) VALUES (?, ?)");
    const insertAttachment = db.prepare(`
      INSERT OR REPLACE INTO attachments (id, comment_id, format, file_name, url, size, blob_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    let loaded = 0;
    
    for (const commentId of idsToLoad) {
      try {
        // Fetch comment details
        const url = `https://api.regulations.gov/v4/comments/${commentId}?include=attachments`;
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
          console.error(`❌ Failed to fetch comment ${commentId}: ${response.status}`);
          continue;
        }
        
        const data = await response.json();
        
        // Save comment
        withTransaction(db, () => {
          insertComment.run(commentId, JSON.stringify(data.data.attributes));
          
          // Handle attachments
          if (!options.skipAttachments && data.data.relationships?.attachments?.data) {
            for (const att of data.data.relationships.attachments.data) {
              processAttachment(db, insertAttachment, commentId, att.id, headers, options).catch(
                err => console.error(`⚠️  Error processing attachment ${att.id}:`, err)
              );
            }
          }
        });
        
        loaded++;
        process.stdout.write(`\r✅ Loaded ${loaded}/${idsToLoad.length} comments`);
        
        await sleep(1200); // Rate limiting
      } catch (error) {
        console.error(`\n❌ Error loading comment ${commentId}:`, error);
      }
    }
    
    console.log(`\n✅ Successfully loaded ${loaded} comments`);
    
  } finally {
    db.close();
  }
}

// Process attachment
async function processAttachment(
  db: Database,
  stmt: any,
  commentId: string,
  attachmentId: string,
  headers: any,
  options: any
) {
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  
  try {
    const url = `https://api.regulations.gov/v4/attachments/${attachmentId}?include=fileFormats`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      debugLog(`Failed to fetch attachment ${attachmentId}: ${response.status}`);
      return;
    }
    
    const data = await response.json();
    
    for (const format of data.data.attributes.fileFormats || []) {
      const fileUrl = format.downloadUrl || format.fileUrl;
      if (!fileUrl) continue;
      
      const fmt = format.fileFormat || format.format || "bin";
      const fileName = `${attachmentId}.${fmt}`;
      
      let blobData = null;
      let size = format.size || null;
      
      if (!options.skipAttachments) {
        const binResponse = await fetch(fileUrl, { headers });
        if (binResponse.ok) {
          const buffer = new Uint8Array(await binResponse.arrayBuffer());
          blobData = buffer;
          size = buffer.length;
          debugLog(`Downloaded ${fileName}: ${size} bytes`);
        }
      }
      
      stmt.run(
        format.formatId || attachmentId,
        commentId,
        fmt,
        fileName,
        fileUrl,
        size,
        blobData
      );
      
      await sleep(1000);
    }
  } catch (error) {
    debugLog(`Error processing attachment ${attachmentId}:`, error);
  }
}

// Load from CSV file
async function loadFromCsv(csvPath: string, options: any) {
  console.log(`📥 Loading comments from CSV file: ${csvPath}`);
  
  // Extract document ID from CSV filename or use generic ID
  const csvBasename = basename(csvPath, extname(csvPath));
  const documentId = /([A-Z]+-\d{4}-\d{4})/.exec(csvBasename)?.[1] || csvBasename;
  
  console.log(`📄 Using document ID: ${documentId}`);
  
  const db = openDb(documentId);
  
  // Prepare statements
  const insertComment = db.prepare("INSERT OR REPLACE INTO comments (id, attributes_json) VALUES (?, ?)");
  const insertAttachment = db.prepare(`
    INSERT OR REPLACE INTO attachments (id, comment_id, format, file_name, url, size, blob_data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  // CSV field mapping
  const fieldMap: Record<string, keyof CommentAttributes> = {
    "Document ID": "id",
    "Agency ID": "agencyId",
    "Docket ID": "docketId",
    "Document Type": "documentType",
    "Title": "title",
    "Posted Date": "postedDate",
    "Comment": "comment",
    "First Name": "firstName",
    "Last Name": "lastName",
    "Organization Name": "organization",
    "Submitter Representative": "submitterRep",
    "Category": "category",
    "State/Province": "stateProvinceRegion",
    "Country": "country",
    "Received Date": "receiveDate",
    "Page Count": "pageCount",
  };
  
  // Get existing count
  const existingCount = db.prepare("SELECT COUNT(*) as count FROM comments").get() as { count: number };
  const skipCount = existingCount.count;
  console.log(`📊 Existing comments: ${existingCount.count}`);
  
  // Parse CSV
  const parser = createReadStream(csvPath, "utf8").pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
    })
  );
  
  let processed = 0;
  let loaded = 0;
  
  try {
    for await (const row of parser) {
      processed++;
      
      // Skip already loaded rows
      if (processed <= skipCount) continue;
      
      // Check limit
      if (options.limit && loaded >= options.limit) {
        console.log(`\n🛑 Reached limit of ${options.limit} comments`);
        break;
      }
      
      const commentId = row["Document ID"] || `row${processed}`;
      
      // Build attributes object
      const attributes: CommentAttributes = {};
      for (const [csvField, attrField] of Object.entries(fieldMap)) {
        if (row[csvField]) {
          if (attrField === "pageCount") {
            attributes[attrField] = parseInt(row[csvField]) || null;
          } else {
            attributes[attrField] = row[csvField];
          }
        }
      }
      
      // Handle display properties
      const displayProps = row["Display Properties (Name, Label, Tooltip)"];
      if (displayProps) {
        attributes.displayProperties = displayProps
          .split(";")
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((piece: string) => {
            const [name, label, tooltip] = piece.split(/\s*,\s*/);
            return { name, label, tooltip };
          });
      }
      
      // Save comment
      withTransaction(db, () => {
        insertComment.run(commentId, JSON.stringify(attributes));
        
        // Handle attachment URLs
        if (!options.skipAttachments) {
          const urls = (
            (row["Attachment Files"] || "") + ";" + (row["Content Files"] || "")
          )
            .split(/[\s;,|]+/)
            .map(u => u.trim())
            .filter(Boolean);
          
          for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const fmt = extname(url).replace(".", "").toLowerCase() || "bin";
            const attachId = `${commentId}-att${i + 1}`;
            const fileName = basename(url);
            
            // For CSV, we just store the URL reference
            insertAttachment.run(attachId, commentId, fmt, fileName, url, null, null);
          }
        }
      });
      
      loaded++;
      
      if (loaded % 100 === 0) {
        process.stdout.write(`\r✅ Loaded ${loaded} comments`);
      }
    }
    
    console.log(`\n✅ Successfully loaded ${loaded} new comments (${existingCount.count + loaded} total)`);
    
  } finally {
    db.close();
  }
}
