// What the GM's hosting tab writes when it autosaves. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveWrites, loadedNotes } from "../shared/autosave.ts";
import { newTable } from "../shared/engine.ts";
import type { CombatState } from "../shared/types.ts";

test("the first save writes the combat flag; notes loaded unchanged aren't written back", () => {
  const w = autosaveWrites(newTable(), { t1: "Has the key" }, loadedNotes({ t1: "Has the key" }));
  assert.deepEqual(w.status, { combat: false });
  assert.equal(w.notes, undefined);
});

test("later saves write only the table until combat starts or ends, or a note changes", () => {
  const table = newTable();
  let last = autosaveWrites(table, {}, {}).next;
  let w = autosaveWrites(table, {}, last);
  assert.equal(w.status, undefined);
  assert.equal(w.notes, undefined);

  table.combat = { round: 1 } as CombatState;
  w = autosaveWrites(table, {}, last);
  assert.deepEqual(w.status, { combat: true });
  last = w.next;

  w = autosaveWrites(table, { t1: "Wounded" }, last);
  assert.equal(w.status, undefined);
  assert.deepEqual(w.notes, { tokens: { t1: "Wounded" } });
  last = w.next;

  delete table.combat;
  w = autosaveWrites(table, { t1: "Wounded" }, last);
  assert.deepEqual(w.status, { combat: false });
  assert.equal(w.notes, undefined);
});

test("a game with no notes yet saves them the first time", () => {
  assert.deepEqual(autosaveWrites(newTable(), {}, {}).notes, { tokens: {} });
});
