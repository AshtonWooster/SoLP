// Player-permission settings: on, players change things freely; off, the GM approves. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character, ItemTemplate } from "../shared/character.ts";
import { approveEdits, describeEdits, partsNeedingApproval, pendingCount, proposeEdits, rejectEdits, withProposals } from "../shared/permissions.ts";
import { blankCharacter, blankTemplate, cleanTemplate, linkItem } from "../shared/ruleset.ts";
import type { GameDoc } from "../shared/types.ts";

const game = (settings?: GameDoc["settings"]): GameDoc => ({ name: "G", gmId: "gm", memberIds: ["gm", "p1"], members: {}, createdAt: 1, settings });
const sheet = (): Character => ({ ...blankCharacter("p1", "P1"), name: "Roland" });

test("every sheet part is free to edit by default, so existing games need no approval", () => {
  assert.deepEqual(partsNeedingApproval(game()), []);
  assert.deepEqual(partsNeedingApproval(game({ playerEdit: { stats: true } })), []);
  assert.deepEqual(partsNeedingApproval(game({ playerEdit: { stats: false, equipment: false } })), ["stats", "equipment"]);
});

test("a free part saves as edited; a part needing approval keeps its saved values and the change waits", () => {
  const saved = sheet();
  const view = structuredClone(saved);
  view.primary.justice = 3;
  view.ahn = 500;
  view.name = "Roland the Black Silence";
  const out = proposeEdits(view, saved, ["stats"]);
  // Stats need approval: unchanged on the sheet, the change waits.
  assert.equal(out.primary.justice, saved.primary.justice);
  assert.equal(out.pendingEdits?.stats?.primary?.justice, 3);
  // Inventory & Ahn and the name are free.
  assert.equal(out.ahn, 500);
  assert.equal(out.name, "Roland the Black Silence");
  assert.deepEqual(Object.keys(out.pendingEdits ?? {}), ["stats"]);
  // With nothing needing approval, everything saves as edited.
  const free = proposeEdits(view, saved, []);
  assert.equal(free.primary.justice, 3);
  assert.equal(free.pendingEdits, undefined);
});

test("the player sees their waiting changes in place, and undoing them clears the proposal", () => {
  const saved = sheet();
  const view = structuredClone(saved);
  view.primary.justice = 2;
  const stored = proposeEdits(view, saved, ["stats"]);
  const seen = withProposals(stored);
  assert.equal(seen.primary.justice, 2);
  // Further edits build on the proposal.
  const more = structuredClone(seen);
  more.primary.fortitude = 1;
  const stored2 = proposeEdits(more, stored, ["stats"]);
  assert.deepEqual({ j: stored2.pendingEdits?.stats?.primary?.justice, f: stored2.pendingEdits?.stats?.primary?.fortitude }, { j: 2, f: 1 });
  // Back to the saved values: nothing waits.
  const undone = structuredClone(seen);
  undone.primary = structuredClone(stored.primary);
  assert.equal(proposeEdits(undone, stored, ["stats"]).pendingEdits, undefined);
});

test("once the GM turns a part back on, the player's next save applies their waiting changes directly", () => {
  const saved = sheet();
  const view = structuredClone(saved);
  view.primary.justice = 4;
  const stored = proposeEdits(view, saved, ["stats"]);
  const out = proposeEdits(withProposals(stored), stored, []);
  assert.equal(out.primary.justice, 4);
  assert.equal(out.pendingEdits, undefined);
});

test("the GM approves or rejects a part's changes", () => {
  const saved = sheet();
  const view = structuredClone(saved);
  view.primary.justice = 3;
  view.ahn = 120;
  const stored = proposeEdits(view, saved, ["stats", "inventory"]);
  assert.equal(pendingCount(stored), 2);
  assert.deepEqual(describeEdits(stored, "stats"), ["Justice: 0 → 3"]);
  assert.deepEqual(describeEdits(stored, "inventory"), ["Ahn: 0 → 120"]);

  const approved = structuredClone(stored);
  approveEdits(approved, "stats");
  assert.equal(approved.primary.justice, 3);
  assert.equal(approved.ahn, 0);
  assert.equal(pendingCount(approved), 1);

  rejectEdits(approved, "inventory");
  assert.equal(approved.ahn, 0);
  assert.equal(approved.pendingEdits, undefined);
  assert.equal(pendingCount(approved), 0);
});

test("larger parts are summarised for the GM", () => {
  const saved = sheet();
  const view = structuredClone(saved);
  view.weapons = [{ ...structuredClone(view.weapons[0] ?? ({} as Character["weapons"][number])), name: "Durandal" }];
  const stored = proposeEdits(view, saved, ["equipment"]);
  assert.deepEqual(describeEdits(stored, "equipment"), ["Weapons changed"]);
});

test("a player's item waiting for approval stays out of inventories; approved, it links as usual", () => {
  const potion: ItemTemplate = { ...blankTemplate("item"), name: "Potion", description: "Heals", createdBy: "p1", pending: true };
  const held = { id: "x", templateId: "potion", name: "Potion", description: "Old text", kind: "item" as const, stacking: false, count: 1, maxStack: 1 };
  assert.equal(linkItem(held, { potion }).description, "Old text");
  const { pending: _p, ...approved } = potion;
  assert.equal(linkItem(held, { potion: approved }).description, "Heals");
});

test("only a player's item can be pending", () => {
  assert.equal(cleanTemplate({ name: "Salve", createdBy: "p1", pending: true })?.pending, true);
  assert.equal(cleanTemplate({ name: "Salve", createdBy: "p1" })?.pending, undefined);
  assert.equal(cleanTemplate({ name: "Ore", pending: true })?.pending, undefined);
});
