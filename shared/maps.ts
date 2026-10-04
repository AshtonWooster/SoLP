// Several battle maps per game (like Roll20 pages / Foundry scenes). The current map is
// `table.map` with its tokens in `table.tokens`; the others wait in `table.maps`.
// Player characters travel with the GM between maps (keeping Health, Light, Effects...), each map
// remembering where they stood. Enemies and other tokens stay on the map they were placed on.
import { ActionError, clamp, log } from "./core.ts";
import { newId } from "./id.ts";
import type { MapInfo, SavedMap, TableState, Token } from "./types.ts";

export const MAP_MIN = 4;
export const MAP_MAX = 60;

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

export function createMap(table: TableState, a: { name?: unknown; width?: unknown; height?: unknown; background?: unknown }): SavedMap {
  currentMapId(table);
  const id = newId();
  const map: SavedMap = {
    id,
    name: cleanName(a.name, "New map"),
    width: size(a.width, 16),
    height: size(a.height, 10),
    tokens: {},
    positions: {},
  };
  const bg = cleanBackground(a.background);
  if (bg) map.background = bg;
  (table.maps ??= {})[id] = map;
  log(table, `GM created the map ${map.name} (${map.width}×${map.height}).`);
  return map;
}

export function updateMap(
  table: TableState,
  a: { mapId?: unknown; name?: unknown; width?: unknown; height?: unknown; background?: unknown },
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
