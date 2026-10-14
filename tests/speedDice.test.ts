// The player's slotted Pages panel (and Cycle characters): each Speed Die's Page, targets and responses. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page, PageType } from "../shared/character.ts";
import type { CombatState, SlottedPage, TableState, Token } from "../shared/types.ts";
import { responseTo, speedDiceOf } from "../src/components/player/speedDice.ts";

const resources = { hp: 10, maxHp: 10, stagger: 5, maxStagger: 5, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
const token = (id: string, side: Token["side"]): Token => ({ id, name: id, side, x: 0, y: 0, color: "#fff", resources });
const page = (id: string, type: PageType = "melee"): Page => ({ id, name: id, kind: "basic", cost: 1, type, dice: [], effect: "" });
const slot = (id: string, ownerId: string, die: number, pageId: string, targets: string[], clashWith?: string): SlottedPage => ({
  id,
  ownerId,
  die,
  pageId,
  targets: targets.map((tokenId) => ({ tokenId, die: 0 })),
  ...(clashWith ? { clashWith } : {}),
});

function table(slots: SlottedPage[], combat = true): TableState {
  const c: CombatState = {
    round: 1,
    order: [
      { tokenId: "roland", roll: 5, bonus: 0, speed: 5, dice: 3 },
      { tokenId: "rat", roll: 3, bonus: 0, speed: 3, dice: 1 },
      { tokenId: "fox", roll: 2, bonus: 0, speed: 2, dice: 1 },
    ],
    turn: 0,
    phase: "actions",
    movementLeft: 0,
    pages: { strike: page("strike"), bite: page("bite"), sweep: page("sweep", "massIndividual"), guard: page("guard") },
    decks: {},
    slots,
    counters: {},
  };
  return {
    map: { name: "m", width: 8, height: 4 },
    tokens: { roland: token("roland", "player"), rat: token("rat", "enemy"), fox: token("fox", "enemy") },
    log: [],
    ...(combat ? { combat: c } : {}),
  };
}

test("one row per Speed Die, empty dice included", () => {
  const rows = speedDiceOf(table([slot("a", "roland", 1, "strike", ["rat"])]), "roland");
  assert.deepEqual(
    rows.map((r) => [r.die, r.page?.id]),
    [
      [0, undefined],
      [1, "strike"],
      [2, undefined],
    ],
  );
  assert.deepEqual(rows[0].targets, []);
});

test("a clash shows the Page answering it, from either side of the pairing", () => {
  const mine = slot("a", "roland", 0, "strike", ["rat"], "b");
  const theirs = slot("b", "rat", 0, "bite", ["roland"], "a");
  const t = table([mine, theirs]);
  const [first] = speedDiceOf(t, "roland");
  assert.equal(first.targets[0].tokenId, "rat");
  assert.equal(first.targets[0].responsePage?.id, "bite");
  // Only one side recording the clash still finds it.
  assert.equal(responseTo(table([slot("a", "roland", 0, "strike", ["rat"], "b"), slot("b", "rat", 0, "bite", ["roland"])]), mine, "rat")?.id, "b");
  assert.equal(responseTo(table([slot("a", "roland", 0, "strike", ["rat"]), slot("b", "rat", 0, "bite", ["roland"], "a")]), mine, "rat")?.id, "b");
});

test("an unopposed attack has no response", () => {
  const t = table([slot("a", "roland", 0, "strike", ["rat"]), slot("b", "rat", 0, "bite", ["fox"])]);
  const [first] = speedDiceOf(t, "roland");
  assert.equal(first.targets[0].response, undefined);
});

test("a Mass Attack lists each target with its own response", () => {
  const sweep = slot("a", "roland", 0, "sweep", ["rat", "fox"]);
  const t = table([sweep, slot("b", "rat", 0, "guard", ["roland"], "a")]);
  const [first] = speedDiceOf(t, "roland");
  assert.equal(first.mass, true);
  assert.deepEqual(
    first.targets.map((x) => [x.tokenId, x.responsePage?.id]),
    [
      ["rat", "guard"],
      ["fox", undefined],
    ],
  );
});

test("nothing outside combat or the turn order", () => {
  assert.deepEqual(speedDiceOf(table([], false), "roland"), []);
  assert.deepEqual(speedDiceOf(table([]), "nobody"), []);
});
