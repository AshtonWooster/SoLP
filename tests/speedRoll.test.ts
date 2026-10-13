// Speed roll animation: which rolls screens play, and how. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, type Actor } from "../shared/engine.ts";
import { tableForPlayers } from "../shared/secrets.ts";
import type { TableState, Token } from "../shared/types.ts";
import { SPEED_TIMES, nextSpeedStep, ordinal, rollingSpeed, speedRollToPlay } from "../src/components/speedRoll.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const resources = { hp: 10, maxHp: 10, stagger: 5, maxStagger: 5, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
const token = (id: string, side: Token["side"], x: number, justice: number): Token => ({ id, name: id, side, x, y: 0, color: "#fff", resources, justice });

function table(): TableState {
  return {
    map: { name: "m", width: 8, height: 4 },
    tokens: { roland: token("roland", "player", 0, 100), rat: token("rat", "enemy", 2, 0), angela: token("angela", "ally", 4, -100) },
    log: [],
  };
}

test("starting combat marks everyone's Speed roll", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  const roll = t.combat!.speedRoll!;
  assert.ok(roll.id);
  assert.deepEqual([...roll.tokenIds].sort(), ["rat", "roland"]);
});

test("a re-roll and a newcomer each get a new roll; other actions keep the last one", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  const first = t.combat!.speedRoll!.id;
  applyAction(t, { type: "reorderCombatant", tokenId: "rat", dir: -1 }, gm);
  assert.equal(t.combat!.speedRoll!.id, first);

  applyAction(t, { type: "rerollSpeed" }, gm);
  const second = t.combat!.speedRoll!;
  assert.notEqual(second.id, first);
  assert.deepEqual([...second.tokenIds].sort(), ["rat", "roland"]);

  applyAction(t, { type: "addCombatant", tokenId: "angela" }, gm);
  const third = t.combat!.speedRoll!;
  assert.notEqual(third.id, second.id);
  assert.deepEqual(third.tokenIds, ["angela"]);
});

test("players' copy of the table carries the roll", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  assert.deepEqual(tableForPlayers(t).combat!.speedRoll, t.combat!.speedRoll);
});

test("a screen's first look plays nothing, so opening mid-combat doesn't replay the roll", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  assert.equal(speedRollToPlay(undefined, t.combat), null);
  assert.equal(speedRollToPlay(t.combat!.speedRoll!.id, t.combat), null);
});

test("a new roll plays once, with the rollers in turn order", () => {
  const t = table();
  // The screen saw the table before combat.
  const seen = null;
  applyAction(t, { type: "startCombat", tokenIds: ["rat", "roland"] }, gm);
  const step = speedRollToPlay(seen, t.combat)!;
  assert.equal(step.stage, "roll");
  assert.equal(step.whole, true);
  assert.deepEqual(
    step.entries.map((x) => x.tokenId),
    t.combat!.order.map((x) => x.tokenId),
  );
  assert.equal(step.entries[0].tokenId, "roland");

  const settle = nextSpeedStep(step)!;
  assert.equal(settle.stage, "settle");
  assert.equal(nextSpeedStep(settle), null);
  assert.ok(SPEED_TIMES.roll > 0 && SPEED_TIMES.settle > 0);
});

test("only a newcomer's die rolls when someone joins; the order stays up", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  const seen = t.combat!.speedRoll!.id;
  applyAction(t, { type: "addCombatant", tokenId: "angela" }, gm);
  const step = speedRollToPlay(seen, t.combat)!;
  assert.equal(step.whole, false);
  assert.deepEqual(
    step.entries.map((x) => x.tokenId),
    ["angela"],
  );
});

test("no combat, or rollers who have left, play nothing", () => {
  assert.equal(speedRollToPlay(null, undefined), null);
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  applyAction(t, { type: "addCombatant", tokenId: "angela" }, gm);
  applyAction(t, { type: "removeCombatant", tokenId: "angela" }, gm);
  assert.equal(speedRollToPlay(null, t.combat), null);
});

test("the tumbling die shows faces of 1d6 plus the bonus", () => {
  const entry = { tokenId: "x", roll: 3, bonus: 2, speed: 5, dice: 1 };
  assert.equal(rollingSpeed(entry, () => 0), 3);
  assert.equal(rollingSpeed(entry, () => 0.999), 8);
});

test("places read as 1st, 2nd, 3rd", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
});
