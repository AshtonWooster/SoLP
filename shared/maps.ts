// Several battle maps per game (like Roll20 pages / Foundry scenes). The current map is
// `table.map` with its tokens in `table.tokens`; the others wait in `table.maps`.
// Player characters travel with the GM between maps (keeping Health, Light, Effects...), each map
// remembering where they stood. Enemies and other tokens stay on the map they were placed on.
//
// The map editor builds each map in three layers: the background image at the bottom, images and
// other assets in the middle (`items`), and the tokens on top, with pins and notes drawn over them.
// Anything can be hidden: then only the GM sees it (`playerView` is what everyone else gets).
import { ActionError, clamp, log } from "./core.ts";
import { newId } from "./id.ts";
import type { MapInfo, MapItem, SavedMap, TableState, Token } from "./types.ts";

export const MAP_MIN = 4;
export const MAP_MAX = 60;
/** Most assets and pins one map can hold. */
export const MAX_ITEMS = 300;
/** Smallest an asset can be, in tiles, when it isn't snapped to the grid. */
export const MIN_ITEM_SIZE = 0.25;

/** Tokens that come along when the map changes. */
export const travels = (t: Token) => t.side === "player";

function cleanName(name: unknown, fallback: string) {
  return String(name ?? "").trim().slice(0, 60) || fallback;
}

function cleanBackground(url: unknown): string | undefined {
  const s = typeof url === "string" ? url.trim() : "";
  return /^https?:\/\//.test(s) && s.length < 2000 ? s : undefined;
}

/** The current map's id, giving it one if it was saved before maps had ids. */
export function currentMapId(table: TableState): string {
  return (table.map.id ??= newId());
}

/** The free tile closest to (x, y); `taken` says which tiles are occupied. */
function freeTileNear(table: TableState, x: number, y: number, taken: (x: number, y: number) => boolean): { x: number; y: number } {
  const { width, height } = table.map;
  const cx = clamp(x, 0, width - 1);
  const cy = clamp(y, 0, height - 1);
  for (let r = 0; r < width + height; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && !taken(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}

/** Settle tokens onto the map in order (after a resize or a switch): any off it, or on a tile an earlier one took, moves to the nearest free tile. */
function fitTokens(table: TableState, order: Token[]) {
  const { width, height } = table.map;
  const used = new Set<string>();
  for (const t of order) {
    const inside = t.x >= 0 && t.y >= 0 && t.x < width && t.y < height;
    if (!inside || used.has(`${t.x},${t.y}`)) {
      const spot = freeTileNear(table, t.x, t.y, (x, y) => used.has(`${x},${y}`));
      t.x = spot.x;
      t.y = spot.y;
    }
    used.add(`${t.x},${t.y}`);
  }
}

function size(n: unknown, fallback: number) {
  return clamp(n ?? fallback, MAP_MIN, MAP_MAX);
}

export function createMap(
  table: TableState,
  a: { id?: unknown; name?: unknown; width?: unknown; height?: unknown; background?: unknown; copyFrom?: unknown },
): SavedMap {
  const taken = new Set([currentMapId(table), ...Object.keys(table.maps ?? {})]);
  // The editor names the new map itself, so it can open it straight away.
  const id = typeof a.id === "string" && ID_RE.test(a.id) && !taken.has(a.id) ? a.id : newId();
  const source = a.copyFrom ? findMap(table, a.copyFrom).map : undefined;
  const map: SavedMap = {
    id,
    name: cleanName(a.name, source ? `${source.name} copy` : "New map"),
    width: size(a.width, source?.width ?? 16),
    height: size(a.height, source?.height ?? 10),
    tokens: {},
    positions: {},
  };
  const bg = cleanBackground(a.background ?? source?.background);
  if (bg) map.background = bg;
  if (source) {
    // A copy takes the source's look (background, assets, pins) but none of its tokens.
    if (source.backgroundHidden) map.backgroundHidden = true;
    if (source.hideGrid) map.hideGrid = true;
    if (source.items?.length) map.items = source.items.map((i) => ({ ...structuredClone(i), id: newId() }));
  }
  (table.maps ??= {})[id] = map;
  log(table, `GM created the map ${map.name} (${map.width}×${map.height}).`);
  return map;
}

export function updateMap(
  table: TableState,
  a: {
    mapId?: unknown;
    name?: unknown;
    width?: unknown;
    height?: unknown;
    background?: unknown;
    backgroundHidden?: unknown;
    hideGrid?: unknown;
  },
) {
  const id = String(a.mapId ?? "");
  const current = id === currentMapId(table);
  const map: MapInfo | undefined = current ? table.map : table.maps?.[id];
  if (!map) throw new ActionError("Map not found.");
  if (a.name !== undefined) map.name = cleanName(a.name, map.name);
  if (a.width !== undefined) map.width = size(a.width, map.width);
  if (a.height !== undefined) map.height = size(a.height, map.height);
  if (a.background !== undefined) {
    const bg = cleanBackground(a.background);
    if (bg) map.background = bg;
    else delete map.background;
  }
  if (a.backgroundHidden !== undefined) setFlag(map, "backgroundHidden", a.backgroundHidden === true);
  if (a.hideGrid !== undefined) setFlag(map, "hideGrid", a.hideGrid === true);
  if (current) {
    // Tokens still on the map keep their tiles; the rest move in next to them.
    const all = Object.values(table.tokens);
    const inside = (t: Token) => t.x < map.width && t.y < map.height;
    fitTokens(table, [...all.filter(inside), ...all.filter((t) => !inside(t))]);
  }
  else {
    // Keep a stored map's tokens and remembered spots on it too.
    const saved = map as SavedMap;
    for (const t of Object.values(saved.tokens)) {
      t.x = clamp(t.x, 0, saved.width - 1);
      t.y = clamp(t.y, 0, saved.height - 1);
    }
    for (const p of Object.values(saved.positions)) {
      p.x = clamp(p.x, 0, saved.width - 1);
      p.y = clamp(p.y, 0, saved.height - 1);
    }
  }
}

/**
 * Put another map on the table. The current map is stored with its own tokens and where each
 * player stood; players come along to where they last stood on the new map (or near its top-left
 * the first time).
 */
export function switchMap(table: TableState, mapIdArg: unknown) {
  const id = String(mapIdArg ?? "");
  const fromId = currentMapId(table);
  if (id === fromId) return false;
  const next = table.maps?.[id];
  if (!next) throw new ActionError("Map not found.");
  if (table.combat) throw new ActionError("End combat before changing maps.");

  const positions: SavedMap["positions"] = {};
  const stays: Record<string, Token> = {};
  for (const t of Object.values(table.tokens)) {
    positions[t.id] = { x: t.x, y: t.y };
    if (!travels(t)) {
      stays[t.id] = t;
      delete table.tokens[t.id];
    }
  }
  const { tokens: arriving, positions: remembered, ...info } = next;
  const maps = table.maps!;
  delete maps[id];
  maps[fromId] = { ...table.map, id: fromId, tokens: stays, positions };
  table.map = { ...info, id };
  for (const t of Object.values(arriving)) table.tokens[t.id] = t;

  // Players: back where they stood here, or lined up from the top-left the first time.
  const players = Object.values(table.tokens).filter(travels);
  players.forEach((t, i) => {
    const spot = remembered[t.id] ?? { x: 1, y: 1 + i };
    t.x = spot.x;
    t.y = spot.y;
  });
  fitTokens(table, [...Object.values(arriving), ...players]);
  log(table, `GM switched to the map ${table.map.name}.`);
  return true;
}

export function deleteMap(table: TableState, mapIdArg: unknown) {
  const id = String(mapIdArg ?? "");
  if (id === currentMapId(table)) throw new ActionError("Switch to another map before deleting this one.");
  const map = table.maps?.[id];
  if (!map) throw new ActionError("Map not found.");
  delete table.maps![id];
  log(table, `GM deleted the map ${map.name}.`);
}

function setFlag<T extends object>(o: T, key: keyof T, on: boolean) {
  if (on) (o as Record<keyof T, unknown>)[key] = true;
  else delete o[key];
}

/** A map by id, wherever it is: on the table (`current`) or waiting for the players. */
export function findMap(table: TableState, mapIdArg: unknown): { map: MapInfo & { id: string }; tokens: Record<string, Token>; current: boolean; saved?: SavedMap } {
  const id = String(mapIdArg ?? "");
  if (id && id === currentMapId(table)) return { map: table.map as MapInfo & { id: string }, tokens: table.tokens, current: true };
  const saved = table.maps?.[id];
  if (!saved) throw new ActionError("Map not found.");
  return { map: saved, tokens: saved.tokens, current: false, saved };
}

// ---- The map editor: assets and pins ----

/** A number in range with up to 3 decimals (assets can sit between tiles), or the fallback. */
function decimal(v: unknown, lo: number, hi: number, fallback: number) {
  const n = Number(v);
  if (v === null || v === "" || !Number.isFinite(n)) return fallback;
  return Math.round(Math.max(lo, Math.min(hi, n)) * 1000) / 1000;
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Checks an asset or pin from the editor. `base` is the item being changed, whose id and kind stay. */
export function cleanItem(raw: Partial<MapItem> | undefined, base?: MapItem): MapItem {
  const r = { ...base, ...(raw && typeof raw === "object" ? raw : {}) };
  const kind = base?.kind ?? (r.kind === "pin" ? "pin" : "image");
  const id = base?.id ?? (typeof r.id === "string" && ID_RE.test(r.id) ? r.id : newId());
  const out: MapItem = { id, kind, x: decimal(r.x, -MAP_MAX, MAP_MAX * 2, 0), y: decimal(r.y, -MAP_MAX, MAP_MAX * 2, 0) };
  if (kind === "image") {
    const url = cleanBackground(r.url);
    if (!url) throw new ActionError("Pick an image for this asset.");
    out.url = url;
    out.w = decimal(r.w, MIN_ITEM_SIZE, MAP_MAX * 2, 2);
    out.h = decimal(r.h, MIN_ITEM_SIZE, MAP_MAX * 2, 2);
    const rotation = (((Math.round(Number(r.rotation) || 0)) % 360) + 360) % 360;
    if (rotation) out.rotation = rotation;
  } else {
    const note = String(r.note ?? "").slice(0, 2000);
    if (note.trim()) out.note = note;
    if (typeof r.color === "string" && COLOR_RE.test(r.color)) out.color = r.color;
  }
  const name = String(r.name ?? "").trim().slice(0, 60);
  if (name) out.name = name;
  if (r.hidden === true) out.hidden = true;
  if (r.locked === true) out.locked = true;
  return out;
}

function itemsOf(map: MapInfo) {
  return (map.items ??= []);
}

function itemOn(map: MapInfo, itemIdArg: unknown) {
  const i = (map.items ?? []).findIndex((x) => x.id === String(itemIdArg ?? ""));
  if (i < 0) throw new ActionError("That asset is gone.");
  return i;
}

export function addMapItem(table: TableState, a: { mapId?: unknown; item?: Partial<MapItem> }): MapItem {
  const { map } = findMap(table, a.mapId);
  const items = itemsOf(map);
  if (items.length >= MAX_ITEMS) throw new ActionError(`A map holds up to ${MAX_ITEMS} assets and pins.`);
  const item = cleanItem(a.item);
  if (items.some((x) => x.id === item.id)) item.id = newId();
  items.push(item);
  return item;
}

export function updateMapItem(table: TableState, a: { mapId?: unknown; itemId?: unknown; patch?: Partial<MapItem> }): boolean {
  const { map } = findMap(table, a.mapId);
  const i = itemOn(map, a.itemId);
  const next = cleanItem(a.patch, map.items![i]);
  if (JSON.stringify(next) === JSON.stringify(map.items![i])) return false;
  map.items![i] = next;
  return true;
}

export function removeMapItem(table: TableState, a: { mapId?: unknown; itemId?: unknown }) {
  const { map } = findMap(table, a.mapId);
  map.items!.splice(itemOn(map, a.itemId), 1);
}

/** Move an asset or pin up or down the drawing order. Returns false if it was already there. */
export function arrangeMapItem(table: TableState, a: { mapId?: unknown; itemId?: unknown; to?: unknown }): boolean {
  const { map } = findMap(table, a.mapId);
  const items = map.items!;
  const i = itemOn(map, a.itemId);
  const j =
    a.to === "front" ? items.length - 1 : a.to === "back" ? 0 : a.to === "forward" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
  if (i === j) return false;
  const [item] = items.splice(i, 1);
  items.splice(j, 0, item);
  return true;
}

/** Replace every asset and pin on a map at once (the editor's undo and redo). */
export function setMapItems(table: TableState, a: { mapId?: unknown; items?: unknown }) {
  const { map } = findMap(table, a.mapId);
  const list = (Array.isArray(a.items) ? a.items : []).slice(0, MAX_ITEMS).map((x) => cleanItem(x as Partial<MapItem>));
  const seen = new Set<string>();
  for (const item of list) {
    if (seen.has(item.id)) item.id = newId();
    seen.add(item.id);
  }
  map.items = list;
}

/**
 * The GM moves a token on any map. On a map the players aren't on, a player character's spot is
 * where they'll arrive when the GM moves everyone there.
 */
export function placeToken(table: TableState, a: { mapId?: unknown; tokenId?: unknown; x?: unknown; y?: unknown }): boolean {
  const { map, tokens, current, saved } = findMap(table, a.mapId);
  const id = String(a.tokenId ?? "");
  const x = clamp(a.x, 0, map.width - 1);
  const y = clamp(a.y, 0, map.height - 1);
  const token = tokens[id];
  if (token) {
    if (token.x === x && token.y === y) return false;
    token.x = x;
    token.y = y;
    return true;
  }
  if (!current && table.tokens[id] && travels(table.tokens[id])) {
    saved!.positions[id] = { x, y };
    return true;
  }
  throw new ActionError("Token not found.");
}

/** Hide a token from everyone but the GM, or show it again. */
export function setTokenHidden(table: TableState, a: { mapId?: unknown; tokenId?: unknown; hidden?: unknown }): boolean {
  const { tokens, current } = findMap(table, a.mapId ?? currentMapId(table));
  const token = tokens[String(a.tokenId ?? "")];
  if (!token) throw new ActionError("Token not found.");
  const hidden = a.hidden === true;
  if (!!token.hidden === hidden) return false;
  if (hidden && token.ownerId) throw new ActionError("Players' characters are always shown to them.");
  if (hidden && current && table.combat?.order.some((c) => c.tokenId === token.id)) {
    throw new ActionError(`${token.name} is in the turn order, so everyone can see them.`);
  }
  setFlag(token, "hidden", hidden);
  return true;
}

/** Where a player character arrives on a map the first time: lined up from the top-left. */
export function arrivalSpot(map: SavedMap, tokenId: string, index: number) {
  return map.positions[tokenId] ?? { x: 1, y: 1 + index };
}

/** A map as players see it: no hidden background, assets, pins or tokens. */
export function visibleMap<M extends MapInfo>(map: M): M {
  const { background, backgroundHidden: _hidden, items, ...rest } = map;
  const out = { ...rest } as M;
  if (background && !map.backgroundHidden) out.background = background;
  const shown = (items ?? []).filter((i) => !i.hidden);
  if (shown.length) out.items = shown;
  return out;
}

/** The table as players (and the shared board) see it: everything the GM hid is left out. */
export function playerView(table: TableState): TableState {
  return {
    ...table,
    map: visibleMap(table.map),
    tokens: Object.fromEntries(Object.entries(table.tokens).filter(([, t]) => !t.hidden)),
  };
}

// ---- Editor geometry (dragging and resizing), in tiles ----

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Corner = "nw" | "ne" | "sw" | "se";

const hundredths = (n: number) => Math.round(n * 100) / 100;

/** Snapped: to whole tiles. Free: to a hundredth of a tile, so saved numbers stay short. */
export function snapValue(n: number, snap: boolean) {
  return snap ? Math.round(n) : hundredths(n);
}

/** An asset dragged by (dx, dy) tiles. */
export function moveRect(r: Rect, dx: number, dy: number, snap: boolean): Rect {
  return { ...r, x: snapValue(r.x + dx, snap), y: snapValue(r.y + dy, snap) };
}

/**
 * An asset resized by dragging one corner by (dx, dy) tiles; the opposite corner stays put.
 * keepAspect keeps its shape (holding Shift in the editor).
 */
export function resizeRect(r: Rect, corner: Corner, dx: number, dy: number, opts: { snap: boolean; keepAspect?: boolean }): Rect {
  const min = opts.snap ? 1 : MIN_ITEM_SIZE;
  const west = corner.includes("w");
  const north = corner.includes("n");
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  let w = west ? right - snapValue(r.x + dx, opts.snap) : snapValue(right + dx, opts.snap) - r.x;
  let h = north ? bottom - snapValue(r.y + dy, opts.snap) : snapValue(bottom + dy, opts.snap) - r.y;
  w = Math.max(min, w);
  h = Math.max(min, h);
  if (opts.keepAspect && r.w > 0 && r.h > 0) {
    const ratio = r.w / r.h;
    if (w / r.w >= h / r.h) h = Math.max(min, w / ratio);
    else w = Math.max(min, h * ratio);
  }
  w = hundredths(w);
  h = hundredths(h);
  return { x: west ? hundredths(right - w) : r.x, y: north ? hundredths(bottom - h) : r.y, w, h };
}
