// Finding the uploaded images a game still uses, for the scheduled image cleanup
// (functions/src/sweepImages.ts). Images are stored by download URL in many places (sheets, Pages,
// items, enemies, maps, popups, the game's cover) and copied between games, so the cleanup collects
// every URL anywhere before deleting a file.

/** Uploads younger than this are never deleted: a form may not be saved yet, or a map edit undone. */
export const SWEEP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const DOWNLOAD_URL = /\/v0\/b\/[^/]+\/o\/([^?#\s"']+)/g;

/** The file paths named by Cloud Storage download URLs in a string. */
export function storagePaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DOWNLOAD_URL)) {
    try {
      out.push(decodeURIComponent(m[1]));
    } catch {
      // Not a real URL; nothing to keep.
    }
  }
  return out;
}

/** Adds every file path referenced anywhere in a document's data to `into`. */
export function collectStoragePaths(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === "string") {
    if (value.includes("/v0/b/")) for (const p of storagePaths(value)) into.add(p);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStoragePaths(v, into);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStoragePaths(v, into);
  }
  return into;
}

export interface StoredFile {
  name: string;
  /** Upload time, ms. */
  created: number;
  size: number;
}

/** Files nothing references that are older than the grace period. */
export function unusedFiles(files: StoredFile[], used: Set<string>, now: number, graceMs = SWEEP_GRACE_MS): StoredFile[] {
  return files.filter((f) => !used.has(f.name) && now - f.created > graceMs);
}
