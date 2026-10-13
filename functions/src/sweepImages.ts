// The scheduled image cleanup: deletes uploaded images that nothing in Firestore uses any more
// (replaced or removed pictures, uploads that were never saved, art of deleted tokens, maps and
// enemies). Image URLs are copied between games, so it collects every URL in every game first,
// and it leaves anything uploaded in the last week alone (shared/imageRefs.ts). Each run logs
// the unused images it finds and deletes the ones the previous run logged that are still unused.
// Kept apart from index.ts so tests can run it against the emulators.
import type { Firestore } from "firebase-admin/firestore";
import { collectStoragePaths, type StoredFile, sweepPlan, unusedFiles } from "../../shared/imageRefs.ts";

/** Just the part of a Cloud Storage bucket this needs. */
export interface SweepFiles {
  getFiles(query: { prefix: string }): Promise<[{ name: string; metadata: { timeCreated?: string; size?: string | number }; delete(): Promise<unknown> }[], ...unknown[]]>;
}

/** Subcollections of a game that never hold image URLs: connection handshakes, hosting, invite code and token notes. */
const SKIP = new Set(["signals", "session", "gm"]);

/** Where a run leaves the images it found unused, for the next run to delete. Only the Cloud Functions read it. */
export const SWEEP_STATE = "system/imageSweep";

export interface SweepState {
  flagged: string[];
  at: number;
}

export interface SweepResult {
  /** Unused images the previous run logged, deleted now. */
  deleted: string[];
  deletedBytes: number;
  /** Unused images found for the first time, deleted next run if still unused. */
  flagged: string[];
  flaggedBytes: number;
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

const bytes = (files: StoredFile[]) => files.reduce((n, f) => n + f.size, 0);

export async function sweepImages(db: Firestore, files: SweepFiles, opts: { now?: number; graceMs?: number } = {}): Promise<SweepResult> {
  const stateRef = db.doc(SWEEP_STATE);
  const before = ((await stateRef.get()).data() as SweepState | undefined)?.flagged ?? [];
  const [list] = await files.getFiles({ prefix: "games/" });
  const used = await usedImagePaths(db);
  const stored: StoredFile[] = list.map((f) => ({ name: f.name, created: Date.parse(f.metadata.timeCreated ?? "") || 0, size: Number(f.metadata.size ?? 0) }));
  const plan = sweepPlan(unusedFiles(stored, used, opts.now ?? Date.now(), opts.graceMs), before);

  const doomed = new Set(plan.remove.map((f) => f.name));
  const deleted: StoredFile[] = [];
  const failed: StoredFile[] = [];
  for (const f of list) {
    if (!doomed.has(f.name)) continue;
    const file = plan.remove.find((r) => r.name === f.name)!;
    await f.delete().then(
      () => deleted.push(file),
      (err) => (console.error(`Couldn't delete ${f.name}`, err), failed.push(file)),
    );
  }
  // What couldn't be deleted is tried again next run.
  const flagged = [...failed, ...plan.flag];
  await stateRef.set({ flagged: flagged.map((f) => f.name), at: opts.now ?? Date.now() } satisfies SweepState);
  return { deleted: deleted.map((f) => f.name), deletedBytes: bytes(deleted), flagged: plan.flag.map((f) => f.name), flaggedBytes: bytes(plan.flag) };
}
