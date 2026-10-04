// Small pieces shared by the rules modules (engine.ts and combat.ts).
import type { GameRole, TableState } from "./types.ts";

/** A rules violation, with a message to show the person who tried it. */
export class ActionError extends Error {}

export interface Actor {
  uid: string;
  role: GameRole;
  displayName: string;
}

export function log(table: TableState, line: string) {
  table.log.push(line);
  if (table.log.length > 150) table.log.splice(0, table.log.length - 150);
}

export function clamp(n: unknown, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
}

export function occupied(table: TableState, x: number, y: number, except: string) {
  return Object.values(table.tokens).some((t) => t.id !== except && t.x === x && t.y === y);
}
