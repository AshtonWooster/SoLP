// Clearing the table log (game settings). The settings page empties the saved log and stamps
// settings.logClearedAt on the game; a GM screen that's hosting at the time sees the new stamp
// and empties its live log too, so its next autosave doesn't bring the old lines back.
import type { GameDoc, TableState } from "./types.ts";

/** When the GM last cleared the log, or 0 if they never have. */
export function logClearedAt(game: GameDoc | undefined): number {
  const at = game?.settings?.logClearedAt;
  return typeof at === "number" && Number.isFinite(at) ? at : 0;
}

/** Whether the GM cleared the log since the host last looked (`seen` is the stamp it last saw). */
export function logClearRequested(seen: number, game: GameDoc | undefined): boolean {
  return logClearedAt(game) > seen;
}

/** Empties the table log. Returns whether anything was removed. */
export function clearLog(table: TableState): boolean {
  if (table.log.length === 0) return false;
  table.log = [];
  return true;
}
