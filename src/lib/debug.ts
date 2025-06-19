import { mkdir } from "fs/promises";
import { join } from "path";
import { createWriteStream, type WriteStream } from "fs";

const DEBUG_DIR = "debug";
let debugEnabled = false;
const openStreams = new Map<string, WriteStream>();

export async function initDebug(enabled: boolean) {
  debugEnabled = enabled;
  if (debugEnabled) {
    await mkdir(DEBUG_DIR, { recursive: true });
    console.log(`🐛 Debug mode enabled - outputs will be saved to ${DEBUG_DIR}/`);
  }
}

export async function debugSave(filename: string, content: string | object) {
  if (!debugEnabled) return;
  
  const filepath = join(DEBUG_DIR, filename);
  const data = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  
  await Bun.write(filepath, data);
  console.log(`  💾 Debug saved: ${filename}`);
}

export function debugLog(...args: any[]) {
  if (!debugEnabled) return;
  console.log("  🐛", ...args);
}

// Streaming debug functions
export function debugStreamStart(filename: string): WriteStream | null {
  if (!debugEnabled) return null;
  
  const filepath = join(DEBUG_DIR, filename);
  const stream = createWriteStream(filepath, { flags: 'w' });
  openStreams.set(filename, stream);
  console.log(`  📝 Debug stream started: ${filename}`);
  return stream;
}

export function debugStreamWrite(filename: string, chunk: string) {
  if (!debugEnabled) return;
  
  const stream = openStreams.get(filename);
  if (stream) {
    stream.write(chunk);
  }
}

export function debugStreamEnd(filename: string) {
  if (!debugEnabled) return;
  
  const stream = openStreams.get(filename);
  if (stream) {
    stream.end();
    openStreams.delete(filename);
    console.log(`  💾 Debug stream saved: ${filename}`);
  }
}

// Clean up any open streams on process exit
process.on('exit', () => {
  for (const [filename, stream] of openStreams.entries()) {
    stream.end();
    openStreams.delete(filename);
  }
});
