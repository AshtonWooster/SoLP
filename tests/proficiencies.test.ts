// The Proficiency tree (shared/proficiencies.ts). Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character, Proficiency } from "../shared/character.ts";
import { cleanEffect, isLive, slotProficiency, type EffectDef } from "../shared/effects.ts";
import {
  canPick,
  emptyStatFilter,
  matchesStatFilter,
  neededBy,
  PLACEHOLDER_TREE,
  placeholderTree,
  proficiencyChecks,
  proficiencyMode,
  proficiencyPages,
  proficiencyTree,
  statFilterText,
  unmetRequirements,
  wouldLoop,
} from "../shared/proficiencies.ts";
import { blankCharacter, proficiencyCount } from "../shared/ruleset.ts";
import { proficienciesNeedApproval, type GameDoc } from "../shared/types.ts";

const prof = (name: string, extra: Partial<EffectDef> = {}): EffectDef => ({ name, kind: "proficiency", decay: "none", rules: [], ...extra });
const page = { id: "pg", name: "Flurry", kind: "basic" as const, cost: 1, type: "melee" as const, effect: "", dice: [] };

const library: Record<string, EffectDef> = {
  drills: prof("Combat Drills"),
  blade: prof("Bladework", { requires: ["drills"], minStats: { justice: 2 } }),
  flurry: prof("Flurry", { requires: ["blade"], page }),
  street: prof("Streetwise"),
  tactics: prof("Tactics"),
  lore: prof("City Lore"),
  capstone: prof("Seasoned", { requires: ["blade", "street"], minStats: { insight: 2 } }),
  waiting: prof("New idea", { createdBy: "p1", pending: true }),
  burn: { name: "Burn", kind: "status", decay: "none", rules: [] },
};

function sheet(stats: Partial<Record<string, number>> = {}, picks: string[] = [], rank = 9): Character {
  const c = blankCharacter("p1", "");
  c.rank = rank;
  for (const [k, v] of Object.entries(stats)) {
    if (k in c.primary) (c.primary as Record<string, number>)[k] = v!;
    else c.secondary[k] = v!;
  }
  c.proficiencies = picks.map((id) => slotProficiency(id, library));
  return c;
}

test("picks: 4 at Rank 9 and 2 more at each Rank Up (the ruleset's Proficiency Counts by Rank)", () => {
  assert.deepEqual([9, 8, 7, 6, 5, 4, 3, 2, 1].map(proficiencyCount), [4, 6, 8, 10, 12, 14, 16, 18, 20]);
});

test("the tree: Proficiencies only, in tiers by their prerequisites", () => {
  const tree = proficiencyTree(library);
  const tier = Object.fromEntries(tree.map((n) => [n.id, n.tier]));
  assert.equal(tree.some((n) => n.id === "burn"), false);
  assert.deepEqual(tier, { drills: 0, street: 0, tactics: 0, lore: 0, waiting: 0, blade: 1, flurry: 2, capstone: 2 });
});

test("the tree: prerequisites deleted from the library or making a loop don't break it", () => {
  const loopy = { a: prof("A", { requires: ["b"] }), b: prof("B", { requires: ["a", "gone"] }) };
  const tree = proficiencyTree(loopy);
  assert.equal(tree.length, 2);
  assert.deepEqual(tree.find((n) => n.id === "b")!.requires, ["a"]);
  assert.equal(wouldLoop(library, "drills", "flurry"), true);
  assert.equal(wouldLoop(library, "flurry", "street"), false);
  assert.equal(wouldLoop(library, "blade", "blade"), true);
});

test("requirements: prerequisites picked and Stats high enough", () => {
  assert.deepEqual(unmetRequirements(sheet(), library.blade, [], library), ["Needs Combat Drills", "Needs Justice 2"]);
  assert.deepEqual(unmetRequirements(sheet({ justice: 2 }), library.blade, ["drills"], library), []);
  assert.deepEqual(unmetRequirements(sheet({ insight: 1 }), library.capstone, ["blade", "street"], library), ["Needs Insight 2"]);
  assert.deepEqual(unmetRequirements(sheet({ insight: 2 }), library.capstone, ["blade", "street"], library), []);
});

test("picking: only with a free pick, every requirement met, and not waiting on the GM", () => {
  assert.equal(canPick(sheet(), "drills", library).ok, true);
  assert.deepEqual(canPick(sheet({}, ["drills"]), "blade", library).why, ["Needs Justice 2"]);
  assert.equal(canPick(sheet({ justice: 3 }, ["drills"]), "blade", library).ok, true);
  // Rank 9: four picks, all used.
  assert.deepEqual(canPick(sheet({}, ["drills", "street", "tactics", "lore"]), "flurry", library).why[0], "All 4 picks used");
  // A Rank Up gives two more.
  assert.equal(canPick(sheet({ justice: 3 }, ["drills", "street", "tactics", "lore"], 8), "blade", library).ok, true);
  assert.equal(canPick(sheet(), "drills", { ...library }).ok, true);
  assert.deepEqual(canPick(sheet({}, ["drills"]), "drills", library).why, ["Already picked"]);
  assert.deepEqual(canPick(sheet(), "waiting", library).why, ["Waiting for the GM's approval"]);
  assert.equal(canPick(sheet(), "burn", library).ok, false);
});

test("removing a prerequisite: what still needs it, and the sheet's checks flag it", () => {
  const c = sheet({ justice: 2 }, ["drills", "blade"], 8);
  assert.deepEqual(neededBy(c, "drills", library), ["Bladework"]);
  assert.deepEqual(proficiencyChecks(c, library), []);
  c.proficiencies = c.proficiencies.filter((p) => p.effectId !== "drills");
  assert.deepEqual(proficiencyChecks(c, library), [{ step: "Proficiencies", ok: false, text: "Bladework: needs combat drills" }]);
  // Lower Stats flag it too.
  const low = sheet({ justice: 1 }, ["drills", "blade"], 8);
  assert.equal(proficiencyChecks(low, library).length, 1);
  assert.deepEqual(proficiencyChecks(low, undefined), []);
});

test("what a Proficiency does: automated, a Page, or words only", () => {
  assert.equal(proficiencyMode(library.drills), "manual");
  assert.equal(proficiencyMode(library.flurry), "page");
  assert.equal(proficiencyMode(prof("Edge", { rules: PLACEHOLDER_TREE.bladework.rules })), "automated");
});

test("Pages from Proficiencies go to the Auxiliary Deck once approved", () => {
  const c = sheet({ justice: 2 }, ["drills", "blade", "flurry"], 8);
  assert.deepEqual(proficiencyPages(c, library), [{ proficiencyId: c.proficiencies[2].id, page }]);
  // A player's Proficiency adds its Page only once the GM approves it, like an automated effect.
  const mine = { ...library, flurry: { ...library.flurry, createdBy: "p1" } };
  assert.deepEqual(proficiencyPages(c, mine), []);
  assert.equal(proficiencyPages(c, { ...mine, flurry: { ...mine.flurry, approved: true } }).length, 1);
  assert.deepEqual(proficiencyPages(c, undefined), []);
  // Old Proficiencies typed on the sheet (no library link) add nothing.
  const typed: Proficiency = { id: "x", name: "Old", description: "" };
  assert.deepEqual(proficiencyPages({ proficiencies: [typed] }, library), []);
});

test("saving: prerequisites, Stats and the Page are kept for Proficiencies only, within limits", () => {
  const clean = cleanEffect({
    ...prof("Big"),
    requires: ["a", "a", "b", "c", "d", "e", ""],
    minStats: { justice: 3, insight: "2", fortitude: 0, "bad key": 5, prudence: 500 },
    page: { ...page, cost: 99, type: "nonsense", dice: [{ kind: "slash", sides: 4, basePower: 1 }] },
  });
  assert.deepEqual(clean.requires, ["a", "b", "c", "d"]);
  assert.deepEqual(clean.minStats, { justice: 3, insight: 2, prudence: 99 });
  assert.equal(clean.page!.cost, 10);
  assert.equal(clean.page!.type, "instant");
  assert.equal(clean.page!.dice[0].kind, "slash");
  assert.ok(clean.page!.dice[0].id);
  const passive = cleanEffect({ name: "P", kind: "passive", decay: "none", rules: [], requires: ["a"], minStats: { justice: 2 }, page });
  assert.equal(passive.requires, undefined);
  assert.equal(passive.minStats, undefined);
  assert.equal(passive.page, undefined);
  // Old entries stay as they were.
  assert.deepEqual(cleanEffect(prof("Plain")), prof("Plain"));
});

test("Game setting: approving changes to the tree is off by default", () => {
  const game = { settings: {} } as GameDoc;
  assert.equal(proficienciesNeedApproval(game), false);
  assert.equal(proficienciesNeedApproval(undefined), false);
  assert.equal(proficienciesNeedApproval({ settings: { approveProficiencies: true } } as GameDoc), true);
});

test("pending: a player's Proficiency waiting on the GM does nothing and can't be approved by saving", () => {
  const waiting = cleanEffect({ ...prof("W"), createdBy: "p1", pending: true, approved: true });
  assert.equal(waiting.pending, true);
  assert.equal(waiting.approved, undefined);
  assert.equal(isLive(waiting), false);
  assert.equal(isLive({ ...waiting, pending: false, approved: true }), true);
  // Only players' entries can be pending; the GM's never wait.
  assert.equal(cleanEffect({ ...prof("G"), pending: true }).pending, undefined);
});

test("placeholder tree: ten linked nodes with fresh ids, Pages and Stat requirements", () => {
  let n = 0;
  const tree = placeholderTree(() => `id${n++}`);
  const nodes = proficiencyTree(tree);
  assert.equal(nodes.length, 10);
  assert.ok(nodes.every((x) => x.requires.length === (x.def.requires ?? []).length), "every prerequisite points at a node in the tree");
  assert.equal(Math.max(...nodes.map((x) => x.tier)), 2);
  assert.equal(nodes.filter((x) => x.def.page).length, 2);
  assert.ok(nodes.some((x) => x.def.rules.length), "some are automated");
  assert.ok(nodes.some((x) => !x.def.rules.length && !x.def.page), "some are words only");
  // Saved as-is, it stays the same.
  for (const d of Object.values(tree)) assert.deepEqual(cleanEffect(d), d);
  // A starting character can take a first-tier Proficiency.
  const root = nodes.find((x) => x.tier === 0)!;
  assert.equal(canPick(blankCharacter("p1", ""), root.id, tree).ok, true);
});

test("filtering by required Stats: any amount, at least, exactly or at most, with and/or", () => {
  const lib: Record<string, EffectDef> = {
    plain: prof("Plain"),
    tough: prof("Tough", { minStats: { fortitude: 2 } }),
    tougher: prof("Tougher", { minStats: { fortitude: 4 } }),
    sharp: prof("Sharp", { minStats: { insight: 3 } }),
    both: prof("Both", { minStats: { fortitude: 3, insight: 2 } }),
  };
  const names = (f: Parameters<typeof matchesStatFilter>[1]) =>
    Object.values(lib)
      .filter((d) => matchesStatFilter(d, f))
      .map((d) => d.name);
  // No filter: everything, including Proficiencies with no Stat requirements.
  assert.deepEqual(names(emptyStatFilter()), ["Plain", "Tough", "Tougher", "Sharp", "Both"]);
  assert.deepEqual(names(undefined), ["Plain", "Tough", "Tougher", "Sharp", "Both"]);
  const fort = (cmp: "any" | "atLeast" | "exactly" | "atMost", n = 3) => ({ stat: "fortitude", cmp, n });
  assert.deepEqual(names({ mode: "and", rows: [fort("any")] }), ["Tough", "Tougher", "Both"]);
  assert.deepEqual(names({ mode: "and", rows: [fort("atLeast")] }), ["Tougher", "Both"]);
  assert.deepEqual(names({ mode: "and", rows: [fort("exactly")] }), ["Both"]);
  assert.deepEqual(names({ mode: "and", rows: [fort("atMost")] }), ["Tough", "Both"]);
  // Fortitude and/or Insight.
  const insight = { stat: "insight", cmp: "any" as const, n: 2 };
  assert.deepEqual(names({ mode: "and", rows: [fort("any"), insight] }), ["Both"]);
  assert.deepEqual(names({ mode: "or", rows: [fort("any"), insight] }), ["Tough", "Tougher", "Sharp", "Both"]);
  assert.equal(statFilterText({ mode: "or", rows: [fort("atLeast", 2), insight] }), "Needs Fortitude at least 2 or Insight");
  assert.equal(statFilterText(emptyStatFilter()), "");
});
