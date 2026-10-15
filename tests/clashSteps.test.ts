// The clash animation's steps. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { alreadyRolled, nextStep, type FxStep } from "../src/components/clashSteps.ts";
import type { ClashFx, FxDie } from "../shared/types.ts";

const d = (power: number, counter = false): FxDie => ({ kind: "slash", sides: 6, basePower: 0, power, ...(counter ? { counter } : {}) });

/** Every step from the intro to the end. */
function play(fx: ClashFx): string[] {
  const out: string[] = [];
  for (let s: FxStep | null = { fx, round: 0, stage: "intro" }; s; s = nextStep(s)) out.push(`${s.round}:${s.stage}`);
  return out;
}

test("Mass Summation: the dice after the check show their numbers without rolling again", () => {
  const fx: ClashFx = {
    id: 1, a: "roland", b: "rat", pageA: "Sweep", targets: ["rat"],
    rounds: [
      { aDice: [d(4), d(5)], vs: { rat: { result: "hit" } }, result: "hit" },
      { a: d(4), vs: { rat: { result: "hit" } }, result: "hit" },
      { a: d(5), vs: { rat: { result: "hit" } }, result: "hit" },
    ],
  };
  assert.deepEqual(play(fx), ["0:intro", "0:roll", "0:reveal", "0:result", "1:reveal", "1:result", "2:reveal", "2:result"]);
  assert.deepEqual([0, 1, 2].map((r) => alreadyRolled(fx, r)), [false, true, true]);
});

test("a Counter Die answering a set Summation die is a fresh roll, so that step still rolls", () => {
  const fx: ClashFx = {
    id: 1, a: "roland", b: "rat", pageA: "Sweep", targets: ["rat"],
    rounds: [
      { aDice: [d(4)], vs: { rat: { result: "hit" } }, result: "hit" },
      { a: d(4), vs: { rat: { die: d(3, true), result: "a" } }, result: "hit" },
    ],
  };
  assert.deepEqual(play(fx).slice(4), ["1:roll", "1:reveal", "1:result"]);
});

test("clashes, One-Sided Attacks and Mass Individual roll every die", () => {
  const clash: ClashFx = { id: 1, a: "roland", b: "rat", pageA: "x", rounds: [{ a: d(3), b: d(2), result: "a" }, { a: d(5), result: "hit" }] };
  assert.deepEqual(play(clash), ["0:intro", "0:roll", "0:reveal", "0:result", "1:roll", "1:reveal", "1:result"]);
  const individual: ClashFx = {
    id: 2, a: "roland", b: "rat", pageA: "Hail", targets: ["rat"],
    rounds: [{ a: d(3), vs: { rat: { result: "hit" } }, result: "hit" }, { a: d(6), vs: { rat: { result: "hit" } }, result: "hit" }],
  };
  assert.ok(play(individual).includes("1:roll"));
  assert.equal(alreadyRolled(individual, 1), false);
});
