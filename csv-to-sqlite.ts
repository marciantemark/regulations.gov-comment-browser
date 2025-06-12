#!/usr/bin/env bun
/**
 * csv-to-sqlite.ts  (2025-06-12)
 * ------------------------------
 * Import a Regulations.gov bulk-download CSV into the SAME SQLite schema
 * produced by the live-API script, with a faithful API-style attributes_json.
 *
 *  bun add csv-parse
 *
 *  bun run csv-to-sqlite.ts <CSV_FILE>
 *  bun run csv-to-sqlite.ts <CSV_FILE> --db cms.db --disk
 */

import { Command } from "commander";
import { readFileSync, mkdirSync, existsSync, createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parse } from "csv-parse";
import { Database } from "bun:sqlite";

// ────────────────── CLI ──────────────────
const cli = new Command()
  .argument("<csv>", "bulk-download CSV file")
  .option("-d, --db <file>", "SQLite database path")
  .option("--disk", "also save attachment binaries to disk")
  .option("--dir <folder>", "directory for --disk output (implies --disk)")
  .option("--no-blob", "do NOT store attachment binaries inside SQLite")
  .parse();

const csvPath: string = cli.args[0];
const opt = cli.opts<{ db?: string; disk?: boolean; dir?: string; noBlob?: boolean }>();

if (!csvPath) cli.help({ error: true });

const firstRow = readFileSync(csvPath, "utf8").split(/\r?\n/)[1] ?? "";
const docketPrefix =
  /([A-Z]+-\d{4}-\d{4})/.exec(firstRow)?.[1] ??
  basename(csvPath).replace(/\.[^.]+$/, "");

const dbPath = opt.db ?? `comments_${docketPrefix}.sqlite`;
const saveToDisk = opt.disk || Boolean(opt.dir);
const diskDir = opt.dir ?? `attachments_${docketPrefix}`;
if (saveToDisk && !existsSync(diskDir)) mkdirSync(diskDir, { recursive: true });
const storeBlob = !opt.noBlob;

// ────────────────── SQLite ──────────────────
function openDb(path: string) {
  const db = new Database(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS comments (
      id              TEXT PRIMARY KEY,
      attributes_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id          TEXT,
      comment_id  TEXT NOT NULL,
      format      TEXT,
      file_name   TEXT,
      url         TEXT,
      size        INTEGER,
      blob_data   BLOB,
      PRIMARY KEY (id, format)
    );
  `);
  return db;
}
const db = openDb(dbPath);
const qComment = db.prepare(
  "INSERT OR REPLACE INTO comments (id, attributes_json) VALUES (?, ?)",
);
const qAttach = db.prepare(
  `INSERT OR REPLACE INTO attachments
     (id, comment_id, format, file_name, url, size, blob_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const tx = db.transaction(
  (
    c: Array<[string, string]>,
    a: Array<[string, string, string, string, string, number | null, Uint8Array | null]>,
  ) => {
    for (const r of c) qComment.run(...r);
    for (const r of a) qAttach.run(...r);
  },
);

// ────────────────── helpers ──────────────────
function toBool(v: string) {
  return v?.toLowerCase() === "true" ? true : v?.toLowerCase() === "false" ? false : null;
}
function toInt(v: string) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// CSV → API field map
const map: Record<string, string> = {
  "Agency ID": "agencyId",
  "Docket ID": "docketId",
  "Tracking Number": "trackingNbr",
  "Document Type": "documentType",
  "Document Subtype": "subtype",
  "Posted Date": "postedDate",
  "Is Withdrawn?": "withdrawn",
  Title: "title",
  "Comment on Document ID": "commentOnDocumentId",
  "Duplicate Comments": "duplicateComments",
  "Comment": "comment",
  "First Name": "firstName",
  "Last Name": "lastName",
  City: "city",
  "State/Province": "stateProvinceRegion",
  "Zip/Postal Code": "zip",
  Country: "country",
  "Organization Name": "organization",
  "Submitter Representative": "submitterRep",
  "Representative's Address": "submitterRepAddress",
  "Representative's City, State & Zip": "submitterRepCityState",
  "Government Agency": "govAgency",
  "Government Agency Type": "govAgencyType",
  Category: "category",
  "Restrict Reason Type": "restrictReasonType",
  "Restrict Reason": "restrictReason",
  "Reason Withdrawn": "reasonWithdrawn",
  "Page Count": "pageCount",
  "Postmark Date": "postmarkDate",
  "Received Date": "receiveDate",
};

// ────────────────── ingest CSV ──────────────────
console.log(`\nImporting from ${csvPath}...`);
const parser = createReadStream(csvPath, "utf8").pipe(
  parse({
    columns: true,
    skip_empty_lines: true,
  }),
);

const commentRows: Array<[string, string]> = [];
const attachRows: Array<
  [string, string, string, string, string, number | null, Uint8Array | null]
> = [];

let processed = 0;
for await (const row of parser) {
  const id = row["Document ID"] ?? `row${processed + 1}`;

  // ── Build clean attributes object ──
  const attr: Record<string, unknown> = {
    commentOn: null,              // unavailable in bulk CSV
    commentOnDocumentId: null,
    duplicateComments: null,
    address1: null,
    address2: null,
    agencyId: null,
    city: null,
    category: null,
    comment: null,
    country: null,
    displayProperties: null,
    docAbstract: null,
    docketId: null,
    documentType: null,
    email: null,
    fax: null,
    field1: null,
    field2: null,
    fileFormats: null,
    firstName: null,
    govAgency: null,
    govAgencyType: null,
    objectId: null,
    lastName: null,
    legacyId: null,
    modifyDate: null,
    organization: null,
    originalDocumentId: null,
    pageCount: null,
    phone: null,
    postedDate: null,
    postmarkDate: null,
    reasonWithdrawn: null,
    receiveDate: null,
    restrictReason: null,
    restrictReasonType: null,
    stateProvinceRegion: null,
    submitterRep: null,
    submitterRepAddress: null,
    submitterRepCityState: null,
    subtype: null,
    title: null,
    trackingNbr: null,
    withdrawn: null,
    zip: null,
    openForComment: null,
  };

  for (const [csvKey, apiKey] of Object.entries(map)) {
    const v = row[csvKey];
    if (v === undefined) continue;
    if (apiKey === "withdrawn") attr[apiKey] = toBool(v);
    else if (apiKey === "duplicateComments" || apiKey === "pageCount")
      attr[apiKey] = toInt(v);
    else if (v === "") attr[apiKey] = null;
    else attr[apiKey] = v;
  }

  // displayProperties
  const disp = row["Display Properties (Name, Label, Tooltip)"];
  if (disp) {
    attr.displayProperties = disp
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean)
      .map((piece: string) => {
        const [name, label, tooltip] = piece.split(/\s*,\s*/);
        return { name, label, tooltip };
      });
  }

  commentRows.push([id, JSON.stringify(attr)]);

  // ── attachments ──
  const urls = (
    (row["Attachment Files"] ?? "") + ";" + (row["Content Files"] ?? "")
  )
    .split(/[\s;,|]+/)
    .map(u => u.trim())
    .filter(Boolean);

  let idx = 0;
  for (const url of urls) {
    const fmt = extname(url).replace(".", "").toLowerCase() || "bin";
    const attId = `${id}-att${++idx}`;
    const fileName = basename(url);

    let blob: Uint8Array | null = null;
    let size: number | null = null;

    if (storeBlob || saveToDisk) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer());
          blob = storeBlob ? buf : null;
          size = buf.length;
          if (saveToDisk) await writeFile(join(diskDir, fileName), buf);
        } else {
          console.warn(`⚠️  ${res.status} ${res.statusText} — ${url}`);
        }
      } catch (e) {
        console.warn(`⚠️  fetch failed — ${url}`);
      }
    }

    attachRows.push([attId, id, fmt, fileName, url, size, blob]);
  }

  if (++processed % 500 === 0) {
    tx(commentRows.splice(0), attachRows.splice(0));
    process.stdout.write(`\rProcessed ${processed} rows... (committed)`);
  } else if (processed % 10 === 0) {
    process.stdout.write(`\rProcessed ${processed} rows...`);
  }
}
process.stdout.write(`\rProcessed ${processed} total rows.            \n`);

// final flush
tx(commentRows, attachRows);
db.close();

console.log(
  `✅ ${processed} rows → ${dbPath}` +
    (storeBlob ? " (BLOBs)" : "") +
    (saveToDisk ? ` + files in ${diskDir}/` : ""),
);
