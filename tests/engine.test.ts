// Combat rules tests. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { activeToken, applyAction, ActionError, type Actor } from "../shared/engine.ts";
import { BASE_MOVEMENT } from "../shared/ruleset.ts";
import type { TableState, Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };
const p2: Actor = { uid: "p2", role: "player", displayName: "P2" };

function token(id: string, side: Token["side"], x: number, y: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 1, maxLight: 3, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

function table(): TableState {
  return {
    map: { name: "m", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 2, 2, { ownerId: "p1", justice: 2 }),
      angela: token("angela", "player", 2, 4, { ownerId: "p2", justice: 0 }),
      rat: token("rat", "enemy", 10, 4, { justice: 1 }),
      bystander: token("bystander", "enemy", 14, 8),
    },
    log: [],
  };
}

const order = (t: TableState) => t.combat!.order.map((c) => c.tokenId);

test("start combat: everyone chosen rolls 1d6 + Justice, highest first", () => {
  for (let i = 0; i < 200; i++) {
    const t = table();
    applyAction(t, { type: "startCombat", tokenIds: ["roland", "angela", "rat"] }, gm);
    const c = t.combat!;
    assert.equal(c.order.length, 3, "bystander not included");
    for (const x of c.order) {
      assert.ok(x.roll >= 1 && x.roll <= 6);
      assert.equal(x.bonus, t.tokens[x.tokenId].justice ?? 0);
      assert.equal(x.speed, x.roll + x.bonus);
    }
    for (let j = 1; j < c.order.length; j++) {
      const [a, b] = [c.order[j - 1], c.order[j]];
      assert.ok(a.speed >= b.speed);
      // Ties: players before enemies.
      if (a.speed === b.speed) assert.ok(!(t.tokens[a.tokenId].side === "enemy" && t.tokens[b.tokenId].side === "player"));
    }
    assert.equal(c.round, 1);
    assert.equal(c.turn, 0);
  }
});

test("a turn starts with Movement Points and +1 Light (capped at max)", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland"] }, gm);
  assert.equal(t.combat!.movementLeft, BASE_MOVEMENT + 2);
  assert.equal(t.tokens.roland.resources.light, 2);
  for (let i = 0; i < 5; i++) applyAction(t, { type: "endTurn" }, p1);
  assert.equal(t.tokens.roland.resources.light, 3, "Light never goes past max");
  assert.equal(t.combat!.round, 6);
});

test("only the active player moves, within Movement Points, onto free tiles", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "angela"] }, gm);
  // Force a known order: roland first.
  t.combat!.order.sort((a) => (a.tokenId === "roland" ? -1 : 1));
  t.combat!.turn = 0;
  t.combat!.movementLeft = 5;
  assert.throws(() => applyAction(t, { type: "turnMove", x: 3, y: 4 }, p2), /isn't your turn/);
  assert.throws(() => applyAction(t, { type: "step", tokenId: "angela", dx: 1, dy: 0 }, p2), /isn't your turn/);
  assert.throws(() => applyAction(t, { type: "turnMove", x: 8, y: 2 }, p1), /6 tiles; Roland|6 tiles/);
  assert.throws(() => applyAction(t, { type: "turnMove", x: 2, y: 4 }, p1), /already there/);
  applyAction(t, { type: "turnMove", x: 5, y: 5 }, p1); // diagonal: 3 tiles
  assert.deepEqual([t.tokens.roland.x, t.tokens.roland.y], [5, 5]);
  assert.equal(t.combat!.movementLeft, 2);
  applyAction(t, { type: "step", tokenId: "roland", dx: 1, dy: 0 }, p1);
  assert.equal(t.combat!.movementLeft, 1);
  // The board (run by the GM's account) can move whoever's turn it is, still within Movement.
  applyAction(t, { type: "turnMove", x: 7, y: 5 }, gm);
  assert.equal(t.combat!.movementLeft, 0);
  assert.throws(() => applyAction(t, { type: "turnMove", x: 8, y: 5 }, gm), /0 Movement left/);
});

test("the GM moves anything anywhere, any time, without spending Movement", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "angela"] }, gm);
  const before = t.combat!.movementLeft;
  applyAction(t, { type: "move", tokenId: "angela", x: 15, y: 9 }, gm);
  applyAction(t, { type: "move", tokenId: "rat", x: 0, y: 0 }, gm);
  assert.deepEqual([t.tokens.angela.x, t.tokens.angela.y], [15, 9]);
  assert.equal(t.combat!.movementLeft, before);
});

test("ending turns walks the order and starts new rounds; others can't end your turn", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "angela", "rat"] }, gm);
  const first = activeToken(t)!;
  const notMe = first.ownerId === "p1" ? p2 : p1;
  if (first.side === "player") assert.throws(() => applyAction(t, { type: "endTurn" }, notMe), /isn't your turn/);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    seen.push(activeToken(t)!.id);
    applyAction(t, { type: "endTurn" }, gm);
  }
  assert.deepEqual(seen, order(t));
  assert.equal(t.combat!.round, 2);
  assert.equal(activeToken(t)!.id, order(t)[0]);
});

test("GM adds and removes combatants mid-combat without skipping whoever is active", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "angela", "rat"] }, gm);
  applyAction(t, { type: "endTurn" }, gm);
  const active = activeToken(t)!.id;
  applyAction(t, { type: "addCombatant", tokenId: "bystander" }, gm);
  assert.equal(activeToken(t)!.id, active);
  assert.equal(t.combat!.order.length, 4);
  assert.throws(() => applyAction(t, { type: "addCombatant", tokenId: "bystander" }, gm), /already/);
  // Removing the active character passes the turn on.
  const next = order(t)[(t.combat!.turn + 1) % 4];
  applyAction(t, { type: "removeCombatant", tokenId: active }, gm);
  assert.equal(activeToken(t)!.id, next);
  // Deleting a token also takes it out of combat.
  applyAction(t, { type: "removeToken", tokenId: next }, gm);
  assert.ok(!order(t).includes(next));
});

test("GM can swap neighbours to settle ties, re-roll, and end combat", () => {
  const t = table();
  applyAction(t, { type: "startCombat", tokenIds: ["roland", "angela", "rat"] }, gm);
  const [a, b] = order(t);
  applyAction(t, { type: "reorderCombatant", tokenId: b, dir: -1 }, gm);
  assert.deepEqual(order(t).slice(0, 2), [b, a]);
  assert.equal(activeToken(t)!.id, a, "the active character keeps their turn");
  applyAction(t, { type: "rerollSpeed" }, gm);
  assert.equal(t.combat!.order.length, 3);
  applyAction(t, { type: "endCombat" }, gm);
  assert.equal(t.combat, undefined);
});

test("players can't run combat", () => {
  const t = table();
  for (const action of [
    { type: "startCombat", tokenIds: ["roland"] },
    { type: "endCombat" },
    { type: "rerollSpeed" },
    { type: "setJustice", tokenId: "rat", justice: 9 },
  ] as const) {
    assert.throws(() => applyAction(t, action as never, p1), ActionError);
  }
});

test("outside combat players still move their own token freely", () => {
  const t = table();
  applyAction(t, { type: "move", tokenId: "roland", x: 12, y: 9 }, p1);
  assert.deepEqual([t.tokens.roland.x, t.tokens.roland.y], [12, 9]);
  assert.throws(() => applyAction(t, { type: "move", tokenId: "angela", x: 1, y: 1 }, p1), /can't move/);
});
