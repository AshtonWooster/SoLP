// The game rules. Runs in the GM's browser, which hosts the live table, and in the
// createGame function (for the starting table). Every action from a player or the GM
// goes through applyAction, which checks whether that person may do it.
import type { GameRole, Resources, Side, TableAction, TableState, Token } from "./types.ts";

export class ActionError extends Error {}

export interface Actor {
  uid: string;
  role: GameRole;
  displayName: string;
}

const PLAYER_COLORS = ["#4fb3bf", "#e0b04f", "#9b7ede", "#6cc070", "#e07a9b", "#5c8fe0"];

/** Random id that also works on plain-http LAN pages, where crypto.randomUUID is unavailable. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
  const mayMove = (t: Token) => {
    if (!isGm && t.ownerId !== actor.uid) throw new ActionError("You can't move that token.");
  };
  const log = (line: string) => {
    table.log.push(line);
    if (table.log.length > 100) table.log.splice(0, table.log.length - 100);
  };
  const { width, height } = table.map;

  switch (action.type) {
    case "takeSeat": {
      if (isGm) throw new ActionError("You're the GM of this game. Use the GM screen.");
      if (Object.values(table.tokens).some((t) => t.ownerId === actor.uid)) return false;
      const n = Object.values(table.tokens).filter((t) => t.side === "player").length;
      const token = makeToken(actor.displayName, "player", 2, clamp(2 + n, 0, height - 1), PLAYER_COLORS[n % PLAYER_COLORS.length]);
      token.ownerId = actor.uid;
      table.tokens[token.id] = token;
      log(`${actor.displayName} took a seat.`);
      return true;
    }
    case "move": {
      const token = tokenOf(action.tokenId);
      mayMove(token);
      token.x = clamp(action.x, 0, width - 1);
      token.y = clamp(action.y, 0, height - 1);
      return true;
    }
    case "step": {
      const token = tokenOf(action.tokenId);
      mayMove(token);
      token.x = clamp(token.x + clamp(action.dx, -1, 1), 0, width - 1);
      token.y = clamp(token.y + clamp(action.dy, -1, 1), 0, height - 1);
      return true;
    }
    case "addToken": {
      gmOnly();
      const side: Side = action.side === "player" ? "player" : "enemy";
      const name = String(action.name ?? "").trim().slice(0, 24) || "Enemy";
      const token = makeToken(name, side, clamp(action.x, 0, width - 1), clamp(action.y, 0, height - 1), side === "enemy" ? "#d9534f" : "#4fb3bf");
      table.tokens[token.id] = token;
      log(`GM added ${token.name}.`);
      return true;
    }
    case "removeToken": {
      gmOnly();
      const token = tokenOf(action.tokenId);
      delete table.tokens[token.id];
      log(`GM removed ${token.name}.`);
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
      if (applied.length) log(`GM override: ${token.name} ${applied.join(", ")}`);
      return applied.length > 0;
    }
    case "setNote": {
      // Notes live outside the shared table; the host stores them. This only checks permission.
      gmOnly();
      tokenOf(action.tokenId);
      return false;
    }
    default:
      throw new ActionError("Unknown action.");
  }
}
