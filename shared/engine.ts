// The game rules. Runs in the GM's browser, which hosts the live table, and in the
// createGame function (for the starting table). Every action from a player or the GM
// goes through applyAction, which checks whether that person may do it.
// Combat turns, decks, Pages and clashes live in combat.ts.
import type { DeckEntry, Page, ResistanceSet } from "./character.ts";
import {
  activeToken,
  actingToken,
  addCombatant,
  aim,
  aimTarget,
  dash,
  dropCombatant,
  endTurn,
  pinnedBy,
  slot,
  sortOrder,
  storyRoll,
  speedText,
  startCombat,
  withContext,
  type EngineContext,
} from "./combat.ts";
import { ActionError, clamp, log, occupied, type Actor } from "./core.ts";
import {
  addMapItem,
  arrangeMapItem,
  createMap,
  currentMapId,
  deleteMap,
  placeToken,
  removeMapItem,
  setMapItems,
  setTokenHidden,
  switchMap,
  updateMap,
  updateMapItem,
} from "./maps.ts";
import { newId, rollDie } from "./id.ts";
import { moveCost, SPEED_DIE } from "./ruleset.ts";
import type { Resources, Side, TableAction, TableState, Token } from "./types.ts";

export { activeToken, ActionError, newId, type Actor, type EngineContext };
export { pinnedBy, validTargets } from "./combat.ts";
export type { Loadout } from "./combat.ts";

const PLAYER_COLORS = ["#4fb3bf", "#e0b04f", "#9b7ede", "#6cc070", "#e07a9b", "#5c8fe0"];

function defaultResources(): Resources {
  // Placeholder values until rank/stat tables are filled in the rules.
  return { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
}

function makeToken(name: string, side: Side, x: number, y: number, color: string): Token {
  return { id: newId(), name, side, x, y, color, resources: defaultResources() };
}

export function newTable(): TableState {
  const enemy = makeToken("Sweeper", "enemy", 12, 4, "#d9534f");
  return {
    map: { id: newId(), name: "Training Floor", width: 16, height: 10 },
    tokens: { [enemy.id]: enemy },
    log: ["Table created."],
  };
}

/** Name, max values and combat stats for a player's token, from their character sheet. */
export interface SeatProfile {
  name: string;
  max: Pick<Resources, "maxHp" | "maxStagger" | "maxSanity" | "maxLight">;
  justice: number;
  resistances?: ResistanceSet;
  staggerResistances?: ResistanceSet;
  portrait?: string;
}

/**
 * Gives a player a token the first time they sit at the table, and keeps an existing token's
 * name and max values in step with their character. Called by the host, never by a device.
 * Returns false if nothing changed.
 */
export function seatPlayer(table: TableState, actor: Actor, profile?: SeatProfile): boolean {
  const existing = Object.values(table.tokens).find((t) => t.ownerId === actor.uid);
  const name = profile?.name.trim() || actor.displayName;
  if (!existing) {
    const n = Object.values(table.tokens).filter((t) => t.side === "player").length;
    const token = makeToken(name, "player", 2, clamp(2 + n, 0, table.map.height - 1), PLAYER_COLORS[n % PLAYER_COLORS.length]);
    token.ownerId = actor.uid;
    if (profile) {
      const m = profile.max;
      token.resources = { ...token.resources, ...m, hp: m.maxHp, stagger: m.maxStagger, light: m.maxLight };
      token.justice = profile.justice;
      if (profile.resistances) token.resistances = profile.resistances;
      if (profile.staggerResistances) token.staggerResistances = profile.staggerResistances;
      if (profile.portrait) token.portrait = profile.portrait;
    }
    table.tokens[token.id] = token;
    log(table, `${name} took a seat.`);
    return true;
  }
  if (!profile) return false;
  const r = existing.resources;
  const m = profile.max;
  const next: Resources = {
    ...r,
    ...m,
    hp: Math.min(r.hp, m.maxHp),
    stagger: Math.min(r.stagger, m.maxStagger),
    light: Math.min(r.light, m.maxLight),
    sanity: Math.min(r.sanity, m.maxSanity),
  };
  const sameRes =
    JSON.stringify([existing.resistances ?? null, existing.staggerResistances ?? null]) ===
    JSON.stringify([profile.resistances ?? null, profile.staggerResistances ?? null]);
  const samePortrait = (existing.portrait ?? "") === (profile.portrait ?? "");
  const changed =
    existing.name !== name ||
    existing.justice !== profile.justice ||
    !sameRes ||
    !samePortrait ||
    (Object.keys(next) as (keyof Resources)[]).some((k) => next[k] !== r[k]);
  existing.name = name;
  existing.resources = next;
  if (profile.portrait) existing.portrait = profile.portrait;
  else delete existing.portrait;
  existing.justice = profile.justice;
  if (profile.resistances) existing.resistances = profile.resistances;
  else delete existing.resistances;
  if (profile.staggerResistances) existing.staggerResistances = profile.staggerResistances;
  else delete existing.staggerResistances;
  return changed;
}

/**
 * Applies one action to the table in place. Returns false if nothing changed.
 * Throws ActionError with a message for the person if they aren't allowed to do it.
 * The host passes ctx so combat can read players' decks from their character sheets.
 */
export function applyAction(table: TableState, action: TableAction, actor: Actor, ctx?: EngineContext): boolean {
  return withContext(ctx, () => apply(table, action, actor, ctx));
}

function apply(table: TableState, action: TableAction, actor: Actor, ctx?: EngineContext): boolean {
  if (!action || typeof action !== "object") throw new ActionError("Bad request.");
  const isGm = actor.role === "gm";
  const gmOnly = () => {
    if (!isGm) throw new ActionError("GM only.");
  };
  // Adding and removing tokens on a map the players aren't on (the GM getting it ready): run the
  // action on that map, with nothing in the shared log to give it away.
  if ((action.type === "addToken" || action.type === "spawnEnemy" || action.type === "removeToken") && action.mapId) {
    gmOnly();
    if (action.mapId !== currentMapId(table)) {
      const saved = table.maps?.[String(action.mapId)];
      if (!saved) throw new ActionError("Map not found.");
      return apply({ map: saved, tokens: saved.tokens, log: [] }, { ...action, mapId: undefined }, actor, ctx);
    }
  }
  const tokenOf = (id: unknown) => {
    const t = table.tokens[String(id)];
    if (!t) throw new ActionError("Token not found.");
    return t;
  };
  const say = (line: string) => log(table, line);
  const { width, height } = table.map;
  const combat = table.combat;
  const inCombat = () => {
    if (!combat) throw new ActionError("Combat hasn't started.");
    return combat;
  };
  /** In combat, a player's movement spends Movement Points and is blocked while an enemy's Page targets them. */
  const spendMovement = (token: Token, cost: number) => {
    const c = inCombat();
    const by = pinnedBy(table, token);
    if (by) throw new ActionError(`${token.name} is targeted by ${by.name}'s attack and can't move.`);
    if (cost > c.movementLeft) throw new ActionError(`That's ${cost} tiles; ${token.name} has ${c.movementLeft} Movement left.`);
    c.movementLeft -= cost;
  };
  /**
   * Moves a token. The GM moves anything, any time, for free. Players move their own token
   * freely outside combat; in combat only during their own Combat Actions, spending Movement.
   */
  const moveToken = (token: Token, x: number, y: number) => {
    const to = { x: clamp(x, 0, width - 1), y: clamp(y, 0, height - 1) };
    if (to.x === token.x && to.y === token.y) return false;
    if (!isGm) {
      if (token.ownerId !== actor.uid) throw new ActionError("You can't move that token.");
      if (combat) {
        if (actingToken(table, actor).id !== token.id) throw new ActionError("It isn't your turn.");
        if (occupied(table, to.x, to.y, token.id)) throw new ActionError("Someone is already there.");
        spendMovement(token, moveCost(token, to));
      }
    }
    token.x = to.x;
    token.y = to.y;
    return true;
  };

  switch (action.type) {
    case "move": {
      const token = tokenOf(action.tokenId);
      return moveToken(token, action.x, action.y);
    }
    case "step": {
      const token = tokenOf(action.tokenId);
      return moveToken(token, token.x + clamp(action.dx, -1, 1), token.y + clamp(action.dy, -1, 1));
    }
    case "turnMove": {
      // From the board or the active player's phone: always within Movement Points.
      const token = actingToken(table, actor);
      const to = { x: clamp(action.x, 0, width - 1), y: clamp(action.y, 0, height - 1) };
      const cost = moveCost(token, to);
      if (cost === 0) return false;
      if (occupied(table, to.x, to.y, token.id)) throw new ActionError("Someone is already there.");
      spendMovement(token, cost);
      token.x = to.x;
      token.y = to.y;
      return true;
    }
    case "addToken": {
      gmOnly();
      const side: Side = action.side === "player" ? "player" : "enemy";
      const name = String(action.name ?? "").trim().slice(0, 24) || "Enemy";
      const token = makeToken(name, side, clamp(action.x, 0, width - 1), clamp(action.y, 0, height - 1), side === "enemy" ? "#d9534f" : "#4fb3bf");
      table.tokens[token.id] = token;
      if (action.hidden === true) token.hidden = true;
      else say(`GM added ${token.name}.`);
      return true;
    }
    case "removeToken": {
      gmOnly();
      const token = tokenOf(action.tokenId);
      dropCombatant(table, token.id);
      delete table.tokens[token.id];
      say(`GM removed ${token.name}.`);
      return true;
    }
    case "setResources": {
      gmOnly();
      const token = tokenOf(action.tokenId);
      const applied: string[] = [];
      for (const [key, value] of Object.entries(action.patch ?? {})) {
        if (key in token.resources && typeof value === "number" && Number.isFinite(value)) {
          token.resources[key as keyof Resources] = Math.round(value);
          applied.push(`${key}=${Math.round(value)}`);
        }
      }
      // Overrides can bring a character back (or knock them out).
      const r = token.resources;
      const nowStaggered = r.stagger <= 0;
      const upkeeps = nowStaggered && token.status?.staggered ? (token.status.staggerUpkeeps ?? 0) : 0;
      token.status = { ...token.status, knockedOut: r.hp <= 0, staggered: nowStaggered, staggerUpkeeps: upkeeps, panic: r.sanity <= -r.maxSanity };
      if (applied.length) say(`GM override: ${token.name} ${applied.join(", ")}`);
      return applied.length > 0;
    }
    case "setNote": {
      // Notes live outside the shared table; the host stores them. This only checks permission.
      gmOnly();
      tokenOf(action.tokenId);
      return false;
    }
    case "setJustice": {
      gmOnly();
      const token = tokenOf(action.tokenId);
      token.justice = clamp(action.justice, -20, 50);
      return true;
    }
    case "setResistances": {
      gmOnly();
      const token = tokenOf(action.tokenId);
      token.resistances = cleanResistances(action.resistances);
      if (action.staggerResistances) token.staggerResistances = cleanResistances(action.staggerResistances);
      return true;
    }
    case "setEnemyDeck": {
      gmOnly();
      const token = tokenOf(action.tokenId);
      if (token.side === "player") throw new ActionError("Players use their character's decks.");
      token.pages = (Array.isArray(action.pages) ? action.pages : []).slice(0, 60) as Page[];
      token.deck = cleanDeckEntries(action.deck);
      return true;
    }
    case "spawnEnemy": {
      gmOnly();
      const t = action.template;
      // Each copy is its own token with its own Health and so on; it shares only the starting values.
      const same = Object.values(table.tokens).filter((x) => x.templateId === action.templateId).length;
      const name = (String(t.name ?? "").trim().slice(0, 24) || "Enemy") + (same ? ` ${same + 1}` : "");
      const side: Side = t.side === "ally" || t.side === "neutral" ? t.side : "enemy";
      const token = makeToken(name, side, clamp(action.x, 0, width - 1), clamp(action.y, 0, height - 1), String(t.color || "#d9534f"));
      const n = (v: unknown, d: number) => Math.max(1, Math.round(Number(v) || d));
      const maxHp = n(t.maxHp, 30);
      const maxStagger = n(t.maxStagger, 20);
      const maxLight = n(t.maxLight, 3);
      const maxSanity = n(t.maxSanity, 15);
      token.resources = { hp: maxHp, maxHp, stagger: maxStagger, maxStagger, light: maxLight, maxLight, sanity: 0, maxSanity };
      token.justice = clamp(t.justice, -20, 50);
      token.resistances = cleanResistances(t.resistances);
      token.staggerResistances = cleanResistances(t.staggerResistances);
      token.pages = (Array.isArray(t.pages) ? t.pages : []).slice(0, 60) as Page[];
      token.deck = cleanDeckEntries(t.deck);
      if (Array.isArray(t.passiveEffects) && t.passiveEffects.length) token.passiveEffects = t.passiveEffects.slice(0, 30).map((x) => String(x).slice(0, 80));
      token.templateId = String(action.templateId);
      if (typeof t.portrait === "string" && t.portrait) token.portrait = t.portrait;
      // Find a free tile near where it was asked for.
      for (let r = 0; occupied(table, token.x, token.y, token.id) && r < Math.max(width, height); r++) {
        const spot = reachableTiles(table, token, r + 1).values().next().value;
        if (spot) [token.x, token.y] = spot.split(",").map(Number);
      }
      table.tokens[token.id] = token;
      if (action.hidden === true) token.hidden = true;
      else say(`GM placed ${token.name}.`);
      return true;
    }
    case "startCombat": {
      gmOnly();
      if (combat) throw new ActionError("Combat is already running.");
      const ids = [...new Set((action.tokenIds ?? []).map(String))].filter((id) => table.tokens[id]);
      if (!ids.length) throw new ActionError("Pick at least one character for the turn order.");
      for (const id of ids) reveal(table.tokens[id]);
      startCombat(table, ids, ctx);
      return true;
    }
    case "createMap":
      gmOnly();
      createMap(table, action);
      return true;
    case "updateMap":
      gmOnly();
      updateMap(table, action);
      return true;
    case "switchMap":
      gmOnly();
      return switchMap(table, action.mapId);
    case "deleteMap":
      gmOnly();
      deleteMap(table, action.mapId);
      return true;
    case "addMapItem":
      gmOnly();
      addMapItem(table, action);
      return true;
    case "updateMapItem":
      gmOnly();
      return updateMapItem(table, action);
    case "removeMapItem":
      gmOnly();
      removeMapItem(table, action);
      return true;
    case "arrangeMapItem":
      gmOnly();
      return arrangeMapItem(table, action);
    case "setMapItems":
      gmOnly();
      setMapItems(table, action);
      return true;
    case "placeToken":
      gmOnly();
      return placeToken(table, action);
    case "setTokenHidden":
      gmOnly();
      return setTokenHidden(table, action);
    case "endCombat": {
      gmOnly();
      if (!combat) return false;
      delete table.combat;
      say("Combat ended.");
      return true;
    }
    case "addCombatant": {
      gmOnly();
      const c = inCombat();
      const token = tokenOf(action.tokenId);
      if (c.order.some((x) => x.tokenId === token.id)) throw new ActionError(`${token.name} is already in the turn order.`);
      reveal(token);
      addCombatant(table, token, ctx);
      return true;
    }
    case "removeCombatant": {
      gmOnly();
      inCombat();
      const token = tokenOf(action.tokenId);
      dropCombatant(table, token.id);
      if (table.combat) say(`${token.name} left the turn order.`);
      return true;
    }
    case "reorderCombatant": {
      gmOnly();
      const c = inCombat();
      const i = c.order.findIndex((x) => x.tokenId === action.tokenId);
      const j = i + (action.dir === -1 ? -1 : 1);
      if (i < 0 || j < 0 || j >= c.order.length) return false;
      const activeId = c.order[c.turn].tokenId;
      [c.order[i], c.order[j]] = [c.order[j], c.order[i]];
      c.turn = c.order.findIndex((x) => x.tokenId === activeId);
      return true;
    }
    case "rerollSpeed": {
      gmOnly();
      const c = inCombat();
      const activeId = c.order[c.turn].tokenId;
      c.order = sortOrder(
        table,
        c.order
          .filter((x) => table.tokens[x.tokenId])
          .map((x) => {
            const roll = rollDie(SPEED_DIE);
            const bonus = table.tokens[x.tokenId].justice ?? 0;
            return { ...x, roll, bonus, speed: roll + bonus };
          }),
      );
      c.turn = Math.max(0, c.order.findIndex((x) => x.tokenId === activeId));
      say(`Speed re-rolled: ${c.order.map((x) => speedText(table.tokens[x.tokenId], x)).join(", ")}.`);
      return true;
    }
    case "endTurn": {
      inCombat();
      const active = activeToken(table)!;
      // The GM can end any turn (e.g. to skip someone); a player ends their own during Combat Actions.
      if (!isGm) actingToken(table, actor);
      say(`${active.name} ended their turn.`);
      endTurn(table);
      return true;
    }
    case "dash":
      dash(table, actor);
      return true;
    case "aim":
      aim(table, actor, action.source, action.cardId, action.die === undefined ? undefined : clamp(action.die, 0, 20));
      return true;
    case "storyRoll":
      storyRoll(table, actor, tokenOf(action.tokenId), action.stat, ctx);
      return true;
    case "setEffects": {
      gmOnly();
      const token = tokenOf(action.tokenId);
      token.effects = (Array.isArray(action.effects) ? action.effects : []).slice(0, 50).map((e) => ({
        id: String(e?.id || newId()),
        name: String(e?.name ?? "").slice(0, 60),
        count: Math.max(0, Math.min(999, Math.round(Number(e?.count) || 0))),
        description: String(e?.description ?? "").slice(0, 1000),
        ...(e?.duration ? { duration: String(e.duration).slice(0, 80) } : {}),
        ...(e?.defId ? { defId: String(e.defId).slice(0, 80) } : {}),
      }));
      return true;
    }
    case "aimTarget":
      aimTarget(table, actor, String(action.tokenId));
      return true;
    case "clearAim": {
      const c = inCombat();
      if (!c.aim) return false;
      actingToken(table, actor);
      delete c.aim;
      return true;
    }
    case "slot":
      slot(table, actor, action.targets?.map(String), ctx);
      return true;
    default:
      throw new ActionError("Unknown action.");
  }
}

/** Joining combat shows a hidden token to everyone. */
function reveal(token: Token | undefined) {
  if (token?.hidden) delete token.hidden;
}

function cleanResistances(r: Partial<ResistanceSet> | undefined): ResistanceSet {
  const num = (v: unknown) => Math.max(0, Math.min(10, Number(v ?? 1)));
  return { slash: num(r?.slash), pierce: num(r?.pierce), blunt: num(r?.blunt) };
}

function cleanDeckEntries(deck: unknown): DeckEntry[] {
  return (Array.isArray(deck) ? deck : [])
    .map((e) => ({ pageId: String(e?.pageId ?? ""), copies: Math.max(0, Math.min(99, Math.round(Number(e?.copies) || 0))) }))
    .filter((e) => e.pageId && e.copies > 0);
}

/** Free tiles the token can reach with the given Movement Points, as "x,y". */
export function reachableTiles(table: TableState, token: Token, movement: number): Set<string> {
  const out = new Set<string>();
  const { width, height } = table.map;
  for (let y = Math.max(0, token.y - movement); y <= Math.min(height - 1, token.y + movement); y++) {
    for (let x = Math.max(0, token.x - movement); x <= Math.min(width - 1, token.x + movement); x++) {
      const cost = moveCost(token, { x, y });
      if (cost > 0 && cost <= movement && !occupied(table, x, y, token.id)) out.add(`${x},${y}`);
    }
  }
  return out;
}
