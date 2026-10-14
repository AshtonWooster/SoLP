// Fog of war: the GM draws boxes on a map that hide or reveal parts of it, or hides or reveals the
// whole map at once. Each map keeps its own fog (`MapInfo.fog`); a map without one is fully revealed,
// so maps made before fog existed look the same. The tools are always there for the GM.
//
// Players never get what's under the fog: `playerView` (shared/maps.ts) leaves out the tokens, pins
// and assets inside hidden areas (and a hidden token's part in combat) before the table is sent, and
// their screens cover the hidden tiles.
import { ActionError, clamp } from "./core.ts";
import type { MapInfo, MapItem, Token } from "./types.ts";

/** Most boxes one map keeps; past this the fog is redrawn as the fewest boxes that cover it. */
export const MAX_FOG_RECTS = 200;

/** A box of whole tiles drawn by the GM. Later boxes are drawn over earlier ones. */
export interface FogRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Reveals what it covers; otherwise it hides it. */
  reveal?: boolean;
}

export interface Fog {
  /** The whole map starts hidden (Hide all); the boxes are drawn over that. */
  covered?: boolean;
  rects?: FogRect[];
}

/** Which tiles are hidden, row by row (index y * width + x), or undefined when nothing is. */
export function fogMask(map: MapInfo): boolean[] | undefined {
  const fog = map.fog;
  if (!fog || (!fog.covered && !fog.rects?.length)) return undefined;
  const { width, height } = map;
  const mask = new Array<boolean>(width * height).fill(!!fog.covered);
  for (const r of fog.rects ?? []) {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(width, r.x + r.w);
    const y1 = Math.min(height, r.y + r.h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * width + x] = !r.reveal;
  }
  return mask.some(Boolean) ? mask : undefined;
}

/** Whether the tile (x, y) is under the fog. Off the map counts as not hidden. */
export function isFogged(map: MapInfo, mask: boolean[] | undefined, x: number, y: number): boolean {
  if (!mask) return false;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return mask[ty * map.width + tx];
}

/** The hidden tiles as few boxes as it takes: runs along each row, stacked when rows match. For drawing. */
export function fogAreas(map: MapInfo, mask = fogMask(map)): FogRect[] {
  if (!mask) return [];
  const { width, height } = map;
  const out: FogRect[] = [];
  let above = new Map<string, FogRect>();
  for (let y = 0; y < height; y++) {
    const row = new Map<string, FogRect>();
    let x = 0;
    while (x < width) {
      if (!mask[y * width + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < width && mask[y * width + x]) x++;
      const key = `${start},${x}`;
      const prev = above.get(key);
      if (prev) {
        prev.h++;
        row.set(key, prev);
      } else {
        const r = { x: start, y, w: x - start, h: 1 };
        out.push(r);
        row.set(key, r);
      }
    }
    above = row;
  }
  return out;
}

/** A box from the GM, in whole tiles, cut to the map. Throws when none of it is on the map. */
export function cleanFogRect(map: MapInfo, a: { x?: unknown; y?: unknown; w?: unknown; h?: unknown; reveal?: unknown }): FogRect {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : NaN);
  let x = n(a.x);
  let y = n(a.y);
  let w = n(a.w);
  let h = n(a.h);
  if ([x, y, w, h].some(Number.isNaN) || w < 1 || h < 1) throw new ActionError("Draw a box on the map.");
  const x1 = clamp(x + w, 0, map.width);
  const y1 = clamp(y + h, 0, map.height);
  x = clamp(x, 0, map.width);
  y = clamp(y, 0, map.height);
  w = x1 - x;
  h = y1 - y;
  if (w < 1 || h < 1) throw new ActionError("Draw the box on the map.");
  const r: FogRect = { x, y, w, h };
  if (a.reveal === true) r.reveal = true;
  return r;
}

const inside = (a: FogRect, b: FogRect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/**
 * Draws a box of fog (or a box that reveals) over a map. Returns false if nothing changed. Boxes the
 * new one covers completely are dropped, and the fog is stored as simply as it can be.
 */
export function drawFog(map: MapInfo, rect: FogRect): boolean {
  const before = JSON.stringify(fogMask(map) ?? null);
  const rects = (map.fog?.rects ?? []).filter((r) => !inside(r, rect));
  rects.push(rect);
  // Worked out on a copy, so a map with too much fog stays as it was.
  const next: MapInfo = { ...map, fog: { ...(map.fog?.covered ? { covered: true } : {}), rects } };
  tidyFog(next);
  if (next.fog) map.fog = next.fog;
  else delete map.fog;
  return JSON.stringify(fogMask(map) ?? null) !== before;
}

/** Hide or reveal the whole map. Returns false if it already was. */
export function setFogAll(map: MapInfo, hidden: boolean): boolean {
  const mask = fogMask(map);
  const was = !mask ? "none" : mask.every(Boolean) ? "all" : "some";
  if (hidden) map.fog = { covered: true };
  else delete map.fog;
  return was !== (hidden ? "all" : "none");
}

/** Keep stored fog small and canonical: nothing hidden is no fog, everything hidden is `covered`. */
export function tidyFog(map: MapInfo) {
  const mask = fogMask(map);
  if (!mask) return void delete map.fog;
  if (mask.every(Boolean)) return void (map.fog = { covered: true });
  if ((map.fog?.rects?.length ?? 0) > MAX_FOG_RECTS) {
    const areas = fogAreas(map, mask);
    if (areas.length > MAX_FOG_RECTS) throw new ActionError("That's more fog than one map can keep. Hide all and reveal the open areas instead.");
    map.fog = { rects: areas };
  }
}

/** Fog as the GM sent it, cleaned (tables saved by hand or by older versions). */
export function cleanFog(map: MapInfo) {
  const raw = map.fog as unknown;
  if (!raw || typeof raw !== "object") return void delete map.fog;
  const f = raw as Fog;
  const rects: FogRect[] = [];
  for (const r of Array.isArray(f.rects) ? f.rects : []) {
    try {
      rects.push(cleanFogRect(map, r ?? {}));
    } catch {
      // Off the map now (it shrank): nothing to keep.
    }
  }
  map.fog = { ...(f.covered === true ? { covered: true } : {}), rects };
  tidyFog(map);
}

/**
 * Whether players may see a token on a fogged map: not when it stands on a hidden tile, whoever it
 * is (other players' characters and anyone in the fight included). A player's phone (`viewerId`)
 * still gets that player's own characters, so they can keep playing them.
 */
export function tokenInView(map: MapInfo, mask: boolean[] | undefined, t: Token, viewerId?: string): boolean {
  if (!mask || (viewerId && t.ownerId === viewerId)) return true;
  return !isFogged(map, mask, t.x, t.y);
}

/**
 * Whether players may see an asset or pin on a fogged map. A pin shows unless its tile is hidden; an
 * image shows unless every tile it covers is hidden (screens draw the fog over the rest of it).
 */
export function itemInView(map: MapInfo, mask: boolean[] | undefined, i: MapItem): boolean {
  if (!mask) return true;
  if (i.kind === "pin") return !isFogged(map, mask, i.x, i.y);
  const w = i.w ?? 1;
  const h = i.h ?? 1;
  // A turned image covers the box around it.
  const turn = ((i.rotation ?? 0) * Math.PI) / 180;
  const bw = Math.abs(w * Math.cos(turn)) + Math.abs(h * Math.sin(turn));
  const bh = Math.abs(w * Math.sin(turn)) + Math.abs(h * Math.cos(turn));
  const cx = i.x + w / 2;
  const cy = i.y + h / 2;
  const x0 = Math.floor(cx - bw / 2 + 1e-6);
  const y0 = Math.floor(cy - bh / 2 + 1e-6);
  const x1 = Math.ceil(cx + bw / 2 - 1e-6);
  const y1 = Math.ceil(cy + bh / 2 - 1e-6);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!isFogged(map, mask, x, y)) return true;
    }
  }
  return false;
}
