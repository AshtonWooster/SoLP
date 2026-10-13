// What the GM's hosting tab writes when it autosaves (src/net/host.ts). The table always changes;
// the combat flag players read and the GM's token notes change rarely, so they're written only
// when they differ from what was last saved. Firestore bills every write, and the security rules
// read the game once per request, so a save is one batch of one to three writes.
import type { GmNotes, TableState, TableStatus } from "./types.ts";

/** What this tab last saved (or loaded) of the parts written only on change. */
export interface LastSaved {
  combat?: boolean;
  notes?: string;
}

export interface AutosaveWrites {
  status?: TableStatus;
  notes?: GmNotes;
  /** What's saved once these writes succeed. */
  next: LastSaved;
}

export function autosaveWrites(table: TableState, notes: Record<string, string>, last: LastSaved): AutosaveWrites {
  const combat = !!table.combat;
  const notesKey = JSON.stringify(notes);
  return {
    ...(last.combat !== combat ? { status: { combat } } : {}),
    ...(last.notes !== notesKey ? { notes: { tokens: notes } } : {}),
    next: { combat, notes: notesKey },
  };
}

/** Notes as loaded, so the first save doesn't write them back unchanged. */
export function loadedNotes(notes: Record<string, string>): LastSaved {
  return { notes: JSON.stringify(notes) };
}
