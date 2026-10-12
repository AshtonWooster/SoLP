// Stat formula tests (game settings → Stat formulas). Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "../shared/character.ts";
import {
  computeMaxResources,
  DEFAULT_STAT_FORMULAS,
  evaluateFormula,
  formulaError,
  formulaRank,
  gameStatFormulas,
  LEGACY_STAT_FORMULAS,
} from "../shared/formulas.ts";
import { maxResources, npcSpawnData, blankNpc } from "../shared/ruleset.ts";
import type { GameDoc } from "../shared/types.ts";

const char = (rank: number, s: Partial<Character["primary"]> = {}) => ({ rank, primary: { fortitude: 0, prudence: 0, justice: 0, temperance: 0, ...s } });
const game = (settings?: GameDoc["settings"]): GameDoc => ({ name: "G", gmId: "gm", memberIds: ["gm"], members: {}, createdAt: 0, settings });

test("Rank counts up in formulas: Rank 9 is 1, Rank 1 is 9", () => {
  assert.deepEqual([9, 8, 7, 1].map(formulaRank), [1, 2, 3, 9]);
});

test("standard Light: 3 at Rank 9, 4 at Rank 7", () => {
  const light = (rank: number) => computeMaxResources(char(rank), DEFAULT_STAT_FORMULAS).maxLight;
  assert.deepEqual([9, 8, 7, 6, 5, 4, 3, 2, 1].map(light), [3, 4, 4, 5, 5, 6, 6, 7, 7]);
});

test("standard Health, Stagger and Sanity follow Rank and Stats", () => {
  assert.deepEqual(computeMaxResources(char(9), DEFAULT_STAT_FORMULAS), { maxHp: 80, maxStagger: 22, maxSanity: 16, maxLight: 3 });
  assert.deepEqual(computeMaxResources(char(1, { fortitude: 3, temperance: 2, prudence: 4 }), DEFAULT_STAT_FORMULAS), {
    maxHp: 64 + 9 * 16 + 30,
    maxStagger: 20 + 9 * 2 + 8,
    maxSanity: 15 + 9 + 8,
    maxLight: 7,
  });
  // Justice doesn't touch any of them by default.
  assert.deepEqual(computeMaxResources(char(5, { justice: 6 }), DEFAULT_STAT_FORMULAS), computeMaxResources(char(5), DEFAULT_STAT_FORMULAS));
});

test("a game from before stat formulas keeps its old numbers", () => {
  const old = (rank: number, s: Partial<Character["primary"]>) => {
    const step = 9 - rank;
    return { maxHp: 30 + step * 6 + (s.fortitude ?? 0), maxStagger: 20 + step * 4 + (s.temperance ?? 0), maxSanity: 15 + (s.prudence ?? 0), maxLight: 3 };
  };
  const formulas = gameStatFormulas(game());
  assert.equal(formulas, LEGACY_STAT_FORMULAS);
  assert.equal(gameStatFormulas(game({ clearEffectsAfterCombat: true })), LEGACY_STAT_FORMULAS);
  for (const rank of [9, 7, 4, 1]) {
    const s = { fortitude: 2, temperance: 3, prudence: 1 };
    assert.deepEqual(maxResources(char(rank, s), formulas), old(rank, s), `Rank ${rank}`);
  }
});

test("the GM's formulas replace the standard ones; missing ones fall back to the standard", () => {
  const f = gameStatFormulas(game({ statFormulas: { health: "100 + Fortitude*5" } }));
  assert.equal(f.health, "100 + Fortitude*5");
  assert.equal(f.light, DEFAULT_STAT_FORMULAS.light);
  assert.equal(computeMaxResources(char(9, { fortitude: 2 }), f).maxHp, 110);
  // GM characters are worked out with the same formulas.
  const t = blankNpc();
  t.primary.fortitude = 2;
  assert.equal(npcSpawnData(t, f).maxHp, 100 + 10);
});

test("formulas: arithmetic, brackets, functions and case-insensitive names", () => {
  const v = { rank: 3, fortitude: 2 };
  assert.equal(evaluateFormula("1 + 2 * 3", v), 7);
  assert.equal(evaluateFormula("(1 + 2) * 3", v), 9);
  assert.equal(evaluateFormula("-2 + 10 / 4", v), 0.5);
  assert.equal(evaluateFormula("RANK * fortitude", v), 6);
  assert.equal(evaluateFormula("floor(7/2) + ceil(1/2) + round(2.5) + max(1, Rank, 2) + min(4, 5)", v), 3 + 1 + 3 + 3 + 4);
  // Results are whole numbers, at least 1.
  assert.equal(computeMaxResources(char(9), { ...DEFAULT_STAT_FORMULAS, light: "3 + Rank/2" }).maxLight, 3);
  assert.equal(computeMaxResources(char(9), { ...DEFAULT_STAT_FORMULAS, sanity: "1 - 50" }).maxSanity, 1);
});

test("formulas: mistakes are reported and never run code", () => {
  assert.equal(formulaError(DEFAULT_STAT_FORMULAS.health), undefined);
  assert.match(formulaError("64 + Level*16")!, /Unknown name "Level"/);
  assert.match(formulaError("3 + (Rank")!, /Missing "\)"/);
  assert.match(formulaError("3 +")!, /ends too early/);
  assert.match(formulaError("")!, /Write a formula/);
  assert.match(formulaError("Rank / (Rank - Rank)")!, /divide by zero/);
  assert.match(formulaError("alert(1)")!, /Unknown function "alert"/);
  assert.match(formulaError("constructor")!, /Unknown name/);
  assert.match(formulaError("toString(1)")!, /Unknown function/);
  assert.match(formulaError("1".repeat(300))!, /under 200/);
  // A broken saved formula falls back to the standard one instead of breaking the table.
  assert.equal(computeMaxResources(char(9), { ...DEFAULT_STAT_FORMULAS, health: "oops(" }).maxHp, 80);
});
