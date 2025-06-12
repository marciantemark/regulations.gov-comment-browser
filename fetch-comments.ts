#!/usr/bin/env bun
/**
 * fetch-comments.ts
 * -----------------
 * Download every public comment for a Regulations.gov document and store:
 *   • the raw comment JSON
 *   • every attachment (all available formats) as BLOBs in SQLite
 *   • (optionally) a copy of those binaries on disk for inspection/debugging
 *
 * USAGE
 *   bun run fetch-comments.ts <DOCUMENT_ID>            # SQLite with BLOBs
 *   bun run fetch-comments.ts <DOCUMENT_ID> --disk     # … and files on disk
 *   bun run fetch-comments.ts <DOCUMENT_ID> -d db.sqlite --no-blob
 *
 * FLAGS
 *   -d, --db <file>     SQLite file (default comments_<DOC>.sqlite)
 *   --disk              Also save binaries to ./attachments_<DOC>/
 *   --dir  <folder>     Custom directory for --disk (implies --disk)
 *   --no-blob           Skip storing BLOBs in SQLite
 *   --api-key <key>     Regulations.gov key (overrides $REGSGOV_API_KEY)
 *
 * ENV
 *   REGSGOV_API_KEY     falls back to DEMO_KEY if absent
 */

import { Command } from "commander";
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

// ───────────── CLI parsing ─────────────
const program = new Command()
  .name("fetch-comments")
  .argument("<documentId>", "Regulations.gov document ID (e.g., CMS-2025-0050-0031)")
  .option("-d, --db <file>", "SQLite database path")
  .option("--disk", "also write attachment binaries to disk")
  .option("--dir <folder>", "directory for --disk output (implies --disk)")
  .option("--no-blob", "do not store attachment binaries inside SQLite")
  .option("--api-key <key>", "Regulations.gov API key")
  .parse();

const docId: string = program.args[0];
const opt = program.opts<{
  db?: string;
  disk?: boolean;
  dir?: string;
  noBlob?: boolean;
  apiKey?: string;
}>();

if (!docId) {
  program.help({ error: true });
}

const dbPath =
  opt.db ?? `comments_${docId.replace(/[^\w-]/g, "_")}.sqlite`;

const saveToDisk = opt.disk || Boolean(opt.dir);
const diskDir =
  opt.dir ?? `attachments_${docId.replace(/[^\w-]/g, "_")}`;
if (saveToDisk && !existsSync(diskDir)) mkdirSync(diskDir, { recursive: true });

const storeBlob = !opt.noBlob;

const apiKey = opt.apiKey ?? process.env.REGSGOV_API_KEY ?? "DEMO_KEY";
const headers = { "X-Api-Key": apiKey };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ───────────── SQLite helpers ─────────────
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
const stmtComment = db.prepare(
  "INSERT OR REPLACE INTO comments (id, attributes_json) VALUES (?, ?)",
);
const stmtAttach = db.prepare(
  `INSERT OR REPLACE INTO attachments
     (id, comment_id, format, file_name, url, size, blob_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const tx = db.transaction(
  (
    cRows: Array<[string, string]>,
    aRows: Array<
      [string, string, string, string, string, number | null, Uint8Array | null]
    >,
  ) => {
    for (const r of cRows) stmtComment.run(r);
    for (const r of aRows) stmtAttach.run(r);
  },
);

// ───────────── helpers ─────────────
async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}  ${url}`);
  return res.json() as Promise<T>;
}

// ───────────── main ─────────────
(async () => {
  console.log(`▶ resolving objectId for ${docId}`);
  const doc = await getJSON<{ data: { attributes: { objectId: string } } }>(
    `https://api.regulations.gov/v4/documents/${docId}`,
  );
  const objectId = doc.data.attributes.objectId;
  console.log(`  objectId = ${objectId}`);

  console.log("▶ listing comment IDs");
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const res = await getJSON<{ data: Array<{ id: string }> }>(
      `https://api.regulations.gov/v4/comments` +
        `?filter[commentOnId]=${objectId}` +
        `&page[size]=250&page[number]=${page}`,
    );
    if (!res.data.length) break;
    ids.push(...res.data.map(d => d.id));
    if (res.data.length < 250) break;
    await sleep(1200);
  }
  console.log(`  ${ids.length} comments found`);

  const cRows: Array<[string, string]> = [];
  const aRows: Array<
    [string, string, string, string, string, number | null, Uint8Array | null]
  > = [];

  let done = 0;
  for (const cid of ids) {
    const detail = await getJSON<{
      data: {
        id: string;
        attributes: Record<string, unknown>;
        relationships?: { attachments?: { data: Array<{ id: string }> } };
      };
    }>(
      `https://api.regulations.gov/v4/comments/${cid}?include=attachments`,
    );
    cRows.push([cid, JSON.stringify(detail.data.attributes)]);
    

    for (const att of detail.data.relationships?.attachments?.data ?? []) {
      const meta = await getJSON<{
        data: {
          id: string;
          attributes: {
            fileFormats?: Array<{
              fileUrl?: string;
              downloadUrl?: string;
              format?: string;
              fileFormat?: string;
              size?: number;
              formatId?: string;
            }>;
          };
        };
      }>(`https://api.regulations.gov/v4/attachments/${att.id}?include=fileFormats`);

      for (const f of meta.data.attributes.fileFormats ?? []) {
        const url = f.downloadUrl ?? f.fileUrl;
        const fmt = f.fileFormat ?? f.format ?? "bin";
        if (!url) continue;

        const fileName = `${att.id}.${fmt}`;
        let blob: Uint8Array | null = null;

        if (storeBlob || saveToDisk) {
          const bin = await fetch(url, { headers });
          if (bin.ok) {
            const buf = new Uint8Array(await bin.arrayBuffer());
            if (storeBlob) blob = buf;
            if (saveToDisk) {
              await writeFile(join(diskDir, basename(fileName)), buf);
            }
          }
          await sleep(1000);
        }

        aRows.push([
          f.formatId ?? att.id,
          cid,
          fmt,
          fileName,
          url,
          f.size ?? null,
          blob,
        ]);
      }
    }

    // flush every 20 comments
    if (++done % 20 === 0) {
      tx(cRows.splice(0, cRows.length), aRows.splice(0, aRows.length));
    }
    await sleep(1200);
  }
  // final flush
  tx(cRows, aRows);
  db.close();

  console.log(
    `✅ ${done} comments stored in ${dbPath}` +
      (storeBlob ? " (attachments as BLOBs)" : "") +
      (saveToDisk ? ` + files in ${diskDir}/` : ""),
  );
})().catch(err => {
  console.error("❌", err);
  process.exit(1);
});

