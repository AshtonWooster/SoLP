// The map asset library: images the GM has uploaded for this game's maps, kept so they can be
// placed again on any map without uploading them twice. Stored GM-only in games/{id}/mapAssets.
import type { MapInfo } from "./types.ts";

/** One image in the library. Removed entries stay as a marker so images already on a map don't come back. */
export interface MapAsset {
  url: string;
  name: string;
  /** When it was uploaded (or first seen on a map), for newest-first order. */
  addedAt: number;
  removed?: boolean;
}

/** An image ready to show in the library panel. */
export interface LibraryEntry {
  id: string;
  url: string;
  name: string;
  addedAt: number;
  /** How many times it's placed across the game's maps. */
  uses: number;
}

export const ASSET_NAME_MAX = 60;

/** A stable document id for an image, so the same file is never listed twice. */
export function assetId(url: string): string {
  // Two FNV-1a passes with different seeds: 64 bits, plenty for one game's images.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ url.length;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** A file name made readable: no extension, underscores and dashes as spaces, at most 60 characters. */
export function assetName(fileName: string): string {
  const name = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ASSET_NAME_MAX);
  return name || "Image";
}

/** The library entry saved for a new upload. */
export function newAsset(url: string, fileName: string, now = Date.now()): MapAsset {
  return { url, name: assetName(fileName), addedAt: now };
}

/** How many times each image is placed on the game's maps (assets only, not backgrounds). */
export function assetUses(maps: Pick<MapInfo, "items">[]): Map<string, number> {
  const uses = new Map<string, number>();
  for (const m of maps) for (const i of m.items ?? []) if (i.kind === "image" && i.url) uses.set(i.url, (uses.get(i.url) ?? 0) + 1);
  return uses;
}

/**
 * Everything in the library, newest first: saved uploads, plus images already on a map from before
 * the library existed (so older games start with their images). Removed entries are left out.
 */
export function libraryEntries(saved: Record<string, MapAsset> | undefined, maps: Pick<MapInfo, "items">[]): LibraryEntry[] {
  const uses = assetUses(maps);
  const byUrl = new Map<string, LibraryEntry | null>();
  for (const a of Object.values(saved ?? {})) {
    if (!a?.url) continue;
    byUrl.set(a.url, a.removed ? null : { id: assetId(a.url), url: a.url, name: a.name || "Image", addedAt: a.addedAt ?? 0, uses: uses.get(a.url) ?? 0 });
  }
  for (const m of maps) {
    for (const i of m.items ?? []) {
      if (i.kind !== "image" || !i.url || byUrl.has(i.url)) continue;
      byUrl.set(i.url, { id: assetId(i.url), url: i.url, name: i.name || "Image", addedAt: 0, uses: uses.get(i.url) ?? 0 });
    }
  }
  return [...byUrl.values()].filter((e): e is LibraryEntry => !!e).sort((x, y) => y.addedAt - x.addedAt || x.name.localeCompare(y.name));
}

/** Entries whose name has every word of the search in it. */
export function searchLibrary(entries: LibraryEntry[], search: string): LibraryEntry[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => words.every((w) => e.name.toLowerCase().includes(w)));
}

/** What to save to take an image out of the library. The file stays: maps (and undo) may still use it. */
export function removedAsset(entry: Pick<LibraryEntry, "url" | "name" | "addedAt">): MapAsset {
  return { url: entry.url, name: entry.name, addedAt: entry.addedAt, removed: true };
}
