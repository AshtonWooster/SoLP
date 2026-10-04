// The game rules. Runs in the GM's browser, which hosts the live table, and in the
// createGame function (for the starting table). Every action from a player or the GM
// goes through applyAction, which checks whether that person may do it.
import { newId, rollDie } from "./id.ts";
import { moveCost, movementPoints, SPEED_DIE, UPKEEP_LIGHT } from "./ruleset.ts";
import type { Combatant, GameRole, Resources, Side, TableAction, TableState, Token } from "./types.ts";

export { newId };

export class ActionError extends Error {}

export interface Actor {
  uid: string;
  role: GameRole;
  displayName: string;
}

const PLAYER_COLORS = ["#4fb3bf", "#e0b04f", "#9b7ede", "#6cc070", "#e07a9b", "#5c8fe0"];

function defaultResources(): Resources {
  // Placeholder values until rank/stat tables are filled in the rules.
  return { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
}

function makeToken(name: string, side: Side, x: number, y: number, color: string): Token {
  return { id: newId(), name, side, x, y, color, resources: defaultResources() };
}

function clamp(n: unknown, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
}

export function newTable(): TableState {
  const enemy = makeToken("Sweeper", "enemy", 12, 4, "#d9534f");
  return {
    map: { name: "Training Floor", width: 16, height: 10 },
    tokens: { [enemy.id]: enemy },
    log: ["Table created."],
  };
}

/** Name and max values for a player's token, from their character sheet. */
export interface SeatProfile {
  name: string;
  max: Pick<Resources, "maxHp" | "maxStagger" | "maxSanity" | "maxLight">;
  justice: number;
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
    }
    table.tokens[token.id] = token;
    table.log.push(`${name} took a seat.`);
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
  const changed =
    existing.name !== name ||
    existing.justice !== profile.justice ||
    (Object.keys(next) as (keyof Resources)[]).some((k) => next[k] !== r[k]);
  existing.name = name;
  existing.resources = next;
  existing.justice = profile.justice;
  return changed;
}

// ---- Combat (Act 8) ----

function log(table: TableState, line: string) {
  table.log.push(line);
  if (table.log.length > 100) table.log.splice(0, table.log.length - 100);
}

function rollSpeed(token: Token): Combatant {
  const bonus = token.justice ?? 0;
  const roll = rollDie(SPEED_DIE);
  return { tokenId: token.id, roll, bonus, speed: roll + bonus };
}

function speedText(t: Token, c: Combatant) {
  return `${t.name} ${c.speed} (${c.roll}${c.bonus >= 0 ? "+" : ""}${c.bonus})`;
}

/** Highest Speed first. On a tie players go before enemies; other ties keep their order (the GM can swap them). */
function sortOrder(table: TableState, order: Combatant[]): Combatant[] {
  const sideRank = (c: Combatant) => (table.tokens[c.tokenId]?.side === "player" ? 0 : 1);
  return [...order].sort((a, b) => b.speed - a.speed || sideRank(a) - sideRank(b));
}

/** The token whose turn it is, if combat is running. */
export function activeToken(table: TableState): Token | undefined {
  const c = table.combat;
  return c ? table.tokens[c.order[c.turn]?.tokenId] : undefined;
}

/** Start of a turn: fresh Movement Points, then Upkeep restores Light. */
function beginTurn(table: TableState) {
  const c = table.combat!;
  const token = activeToken(table);
  if (!token) return;
  c.movementLeft = movementPoints(token.justice ?? 0);
  const r = token.resources;
  const gained = Math.min(UPKEEP_LIGHT, Math.max(0, r.maxLight - r.light));
  r.light += gained;
  log(table, `Round ${c.round}: ${token.name}'s turn.${gained ? ` +${gained} Light.` : ""}`);
}

/** Moves to the next character in the order, starting a new round after the last. */
function nextTurn(table: TableState) {
  const c = table.combat!;
  c.turn += 1;
  if (c.turn >= c.order.length) {
    c.turn = 0;
    c.round += 1;
  }
  beginTurn(table);
}

/** Takes a character out of the order, keeping the turn on the right person. */
function dropCombatant(table: TableState, tokenId: string) {
  const c = table.combat;
  if (!c) return;
  const i = c.order.findIndex((x) => x.tokenId === tokenId);
  if (i < 0) return;
  c.order.splice(i, 1);
  if (c.order.length === 0) {
    delete table.combat;
    log(table, "Combat ended: no one left in the turn order.");
    return;
  }
  if (i < c.turn) c.turn -= 1;
  else if (i === c.turn) {
    // It was their turn: the next person goes.
    if (c.turn >= c.order.length) {
      c.turn = 0;
      c.round += 1;
    }
    beginTurn(table);
  }
}

const occupied = (table: TableState, x: number, y: number, except: string) =>
  Object.values(table.tokens).some((t) => t.id !== except && t.x === x && t.y === y);

/**
 * Applies one action to the table in place. Returns false if nothing changed.
 * Throws ActionError with a message for the person if they aren't allowed to do it.
 */
export function applyAction(table: TableState, action: TableAction, actor: Actor): boolean {
  if (!action || typeof action !== "object") throw new ActionError("Bad request.");
  const isGm = actor.role === "gm";
  const gmOnly = () => {
    if (!isGm) throw new ActionError("GM only.");
  };
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
  /** Whoever's turn it is: the GM, or the player who owns the active token. */
  const mayActNow = () => {
    const active = activeToken(table);
    if (!active) throw new ActionError("Combat hasn't started.");
    if (!isGm && active.ownerId !== actor.uid) throw new ActionError("It isn't your turn.");
    return active;
  };
  /**
   * Moves a token. The GM moves anything, any time, for free. Players move their own token
   * freely outside combat; in combat only on their turn, spending Movement Points.
   */
  const moveToken = (token: Token, x: number, y: number) => {
    const to = { x: clamp(x, 0, width - 1), y: clamp(y, 0, height - 1) };
    if (to.x === token.x && to.y === token.y) return false;
    if (!isGm) {
      if (token.ownerId !== actor.uid) throw new ActionError("You can't move that token.");
      if (combat) {
        if (activeToken(table)?.id !== token.id) throw new ActionError("It isn't your turn.");
        const cost = moveCost(token, to);
        if (cost > combat.movementLeft) throw new ActionError(`That's ${cost} tiles; you have ${combat.movementLeft} Movement left.`);
        if (occupied(table, to.x, to.y, token.id)) throw new ActionError("Someone is already there.");
        combat.movementLeft -= cost;
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
      // From the board (run by the GM) or the active player's phone: always within Movement Points.
      const c = inCombat();
      const token = mayActNow();
      const to = { x: clamp(action.x, 0, width - 1), y: clamp(action.y, 0, height - 1) };
      const cost = moveCost(token, to);
      if (cost === 0) return false;
      if (cost > c.movementLeft) throw new ActionError(`That's ${cost} tiles; ${token.name} has ${c.movementLeft} Movement left.`);
      if (occupied(table, to.x, to.y, token.id)) throw new ActionError("Someone is already there.");
      c.movementLeft -= cost;
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
      say(`GM added ${token.name}.`);
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
    case "startCombat": {
      gmOnly();
      if (combat) throw new ActionError("Combat is already running.");
      const ids = [...new Set((action.tokenIds ?? []).map(String))].filter((id) => table.tokens[id]);
      if (!ids.length) throw new ActionError("Pick at least one character for the turn order.");
      const order = sortOrder(table, ids.map((id) => rollSpeed(table.tokens[id])));
      table.combat = { round: 1, order, turn: 0, movementLeft: 0 };
      say(`Combat started. Speed: ${order.map((c) => speedText(table.tokens[c.tokenId], c)).join(", ")}.`);
      beginTurn(table);
      return true;
    }
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
      const entry = rollSpeed(token);
      const activeId = c.order[c.turn].tokenId;
      c.order = sortOrder(table, [...c.order, entry]);
      c.turn = c.order.findIndex((x) => x.tokenId === activeId);
      say(`${speedText(token, entry)} joined the turn order.`);
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
        c.order.filter((x) => table.tokens[x.tokenId]).map((x) => rollSpeed(table.tokens[x.tokenId])),
      );
      c.turn = Math.max(0, c.order.findIndex((x) => x.tokenId === activeId));
      say(`Speed re-rolled: ${c.order.map((x) => speedText(table.tokens[x.tokenId], x)).join(", ")}.`);
      return true;
    }
    case "endTurn": {
      const active = mayActNow();
      say(`${active.name} ended their turn.`);
      nextTurn(table);
      return true;
    }
    default:
      throw new ActionError("Unknown action.");
  }
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
