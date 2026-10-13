// The scheduled image cleanup: deletes uploaded images that nothing in Firestore uses any more
// (replaced or removed pictures, uploads that were never saved, art of deleted tokens, maps and
// enemies). Image URLs are copied between games, so it collects every URL in every game first,
// and it leaves anything uploaded in the last week alone (shared/imageRefs.ts). Kept apart from
// index.ts so tests can run it against the emulators.
import type { Firestore } from "firebase-admin/firestore";
import { collectStoragePaths, type StoredFile, unusedFiles } from "../../shared/imageRefs.ts";

/** Just the part of a Cloud Storage bucket this needs. */
export interface SweepFiles {
  getFiles(query: { prefix: string }): Promise<[{ name: string; metadata: { timeCreated?: string; size?: string | number }; delete(): Promise<unknown> }[], ...unknown[]]>;
}

/** Subcollections of a game that never hold image URLs: connection handshakes, hosting, invite code and token notes. */
const SKIP = new Set(["signals", "session", "gm"]);

export interface SweepResult {
  /** Images nothing uses, older than the grace period. */
  unused: string[];
  bytes: number;
  /** Whether they were deleted, or only reported. */
  deleted: boolean;
}

/** Every Storage path referenced by any game, by every document in it (removed library entries excepted). */
export async function usedImagePaths(db: Firestore): Promise<Set<string>> {
  const used = new Set<string>();
  for (const game of await db.collection("games").listDocuments()) {
    const snap = await game.get();
    if (snap.exists) collectStoragePaths(snap.data(), used);
    for (const col of await game.listCollections()) {
      if (SKIP.has(col.id)) continue;
      for (const d of (await col.get()).docs) {
        // A map asset taken out of the library keeps a marker; its image counts only where a map still uses it.
        if (col.id === "mapAssets" && d.get("removed") === true) continue;
        collectStoragePaths(d.data(), used);
      }
    }
  }
  return used;
}

export async function sweepImages(db: Firestore, files: SweepFiles, opts: { remove: boolean; now?: number; graceMs?: number }): Promise<SweepResult> {
  const [list] = await files.getFiles({ prefix: "games/" });
  const used = await usedImagePaths(db);
  const stored: StoredFile[] = list.map((f) => ({ name: f.name, created: Date.parse(f.metadata.timeCreated ?? "") || 0, size: Number(f.metadata.size ?? 0) }));
  const unused = unusedFiles(stored, used, opts.now ?? Date.now(), opts.graceMs);
  if (opts.remove) {
    const names = new Set(unused.map((f) => f.name));
    for (const f of list) {
      if (names.has(f.name)) await f.delete().catch((err) => console.error(`Couldn't delete ${f.name}`, err));
    }
  }
  return { unused: unused.map((f) => f.name), bytes: unused.reduce((n, f) => n + f.size, 0), deleted: opts.remove };
}
