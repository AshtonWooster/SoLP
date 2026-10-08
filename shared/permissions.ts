// What players may change without the GM, and the changes that wait for the GM's approval.
//
// Each player-permission setting in Game settings works the same way: on, players change that
// part freely; off, their changes wait until the GM approves them.
//   - Sheet parts (Stats, Inventory…): a player's edits to a part the GM approves are kept in
//     the character's `pendingEdits` until the GM approves (applies) or rejects them.
//   - Items: a player's new or changed item is marked `pending` and stays out of inventories.
//   - Effects: a player's new or changed effect has `approved: false` and does nothing at the table.

import type { Character } from "./character.ts";
import { type GameDoc, PLAYER_EDIT_OPTIONS, type PlayerEditKey, playerCanEdit } from "./types.ts";

/** Parts of their sheet whose changes need the GM's approval in this game. */
export function partsNeedingApproval(game: GameDoc | undefined): PlayerEditKey[] {
  return PLAYER_EDIT_OPTIONS.filter((o) => !playerCanEdit(game, o.key)).map((o) => o.key);
}

const fieldsOf = (key: PlayerEditKey) => PLAYER_EDIT_OPTIONS.find((o) => o.key === key)!.fields as (keyof Character)[];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The sheet as its player sees it: their changes waiting for approval shown in place. */
export function withProposals(c: Character): Character {
  if (!c.pendingEdits) return c;
  const view = { ...c };
  for (const proposal of Object.values(c.pendingEdits)) Object.assign(view, proposal);
  return view;
}

/**
 * What to save when a player edits their sheet: parts needing approval keep their saved values and
 * the player's changes to them go into pendingEdits (dropped once they match the saved values again).
 * Parts the player may edit freely are saved as they are.
 */
export function proposeEdits(view: Character, saved: Character, needApproval: PlayerEditKey[]): Character {
  const out: Character = { ...view };
  const pending: NonNullable<Character["pendingEdits"]> = {};
  for (const o of PLAYER_EDIT_OPTIONS) {
    if (!needApproval.includes(o.key)) continue;
    const fields = fieldsOf(o.key);
    if (fields.some((f) => !same(view[f], saved[f]))) pending[o.key] = Object.fromEntries(fields.map((f) => [f, view[f]]));
    for (const f of fields) (out as unknown as Record<string, unknown>)[f] = saved[f];
  }
  if (Object.keys(pending).length) out.pendingEdits = pending;
  else delete out.pendingEdits;
  return out;
}

/** The GM approves a player's changes to one part: they take effect. Changes a draft in place. */
export function approveEdits(draft: Character, key: PlayerEditKey) {
  const proposal = draft.pendingEdits?.[key];
  if (proposal) Object.assign(draft, proposal);
  rejectEdits(draft, key);
}

/** The GM rejects (or the player withdraws) changes to one part. Changes a draft in place. */
export function rejectEdits(draft: Character, key: PlayerEditKey) {
  if (!draft.pendingEdits) return;
  delete draft.pendingEdits[key];
  if (!Object.keys(draft.pendingEdits).length) delete draft.pendingEdits;
}

/** How many parts of this sheet have changes waiting for the GM. */
export function pendingCount(c: Character | undefined): number {
  return Object.keys(c?.pendingEdits ?? {}).length;
}

/** A short list of what a player's waiting changes to one part would do, for the GM to review. */
export function describeEdits(c: Character, key: PlayerEditKey): string[] {
  const proposal = c.pendingEdits?.[key];
  if (!proposal) return [];
  const lines: string[] = [];
  for (const f of fieldsOf(key)) {
    if (!(f in proposal) || same(proposal[f], c[f])) continue;
    const before = c[f] as unknown;
    const after = proposal[f] as unknown;
    if (typeof before === "number" && typeof after === "number") lines.push(`${label(f)}: ${before} → ${after}`);
    else if (isNumberRecord(before) && isNumberRecord(after)) {
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if ((before[k] ?? 0) !== (after[k] ?? 0)) lines.push(`${cap(k)}: ${before[k] ?? 0} → ${after[k] ?? 0}`);
      }
    } else lines.push(`${label(f)} changed`);
  }
  return lines;
}

const LABELS: Partial<Record<keyof Character, string>> = { ahn: "Ahn", ego: "E.G.O. Pages", deck: "Combat Deck" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (f: keyof Character) => LABELS[f] ?? cap(f);
const isNumberRecord = (v: unknown): v is Record<string, number> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "number");
