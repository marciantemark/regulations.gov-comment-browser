import { mkdir } from "fs/promises";
import { join } from "path";

const DEBUG_DIR = "debug";
let debugEnabled = false;

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
