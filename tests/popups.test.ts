// GM screen popups: the enemy-turn popup and dragging popups around. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gmTurnToken } from "../shared/combat.ts";
import { applyAction, type Actor } from "../shared/engine.ts";
import type { TableState, Token } from "../shared/types.ts";
import { dragOffset } from "../src/components/drag.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const resources = { hp: 10, maxHp: 10, stagger: 5, maxStagger: 5, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
const token = (id: string, side: Token["side"], x: number, justice: number): Token => ({ id, name: id, side, x, y: 0, color: "#fff", resources, justice });

function fight(): TableState {
  const table: TableState = {
    map: { name: "m", width: 8, height: 4 },
    tokens: { roland: token("roland", "player", 0, 100), rat: token("rat", "enemy", 2, 0), angela: token("angela", "ally", 4, -100) },
    log: [],
  };
  applyAction(table, { type: "startCombat", tokenIds: ["roland", "rat", "angela"] }, gm);
  return table;
}

test("the enemy-turn popup shows nothing outside combat or on a player's turn", () => {
  const table = fight();
  assert.equal(table.combat!.order[table.combat!.turn].tokenId, "roland");
  assert.equal(gmTurnToken(table), undefined);
  delete table.combat;
  assert.equal(gmTurnToken(table), undefined);
});

test("the enemy-turn popup opens for each of the GM's characters, enemies and allies alike", () => {
  const table = fight();
  applyAction(table, { type: "endTurn" }, gm);
  assert.equal(gmTurnToken(table)?.id, "rat");
  applyAction(table, { type: "endTurn" }, gm);
  assert.equal(gmTurnToken(table)?.id, "angela");
});

const view = { width: 1000, height: 800 };
const box = { left: 600, top: 100, width: 360, height: 500 };

test("a dragged popup follows the pointer", () => {
  assert.deepEqual(dragOffset({ x: 0, y: 0 }, { x: -200, y: 50 }, box, view), { x: -200, y: 50 });
  // A second drag carries on from where the first left it.
  assert.deepEqual(dragOffset({ x: -200, y: 50 }, { x: 10, y: -20 }, { ...box, left: 400, top: 150 }, view), { x: -190, y: 30 });
});

test("a popup can't be dragged off the sides or the top, so its close button stays in reach", () => {
  assert.deepEqual(dragOffset({ x: 0, y: 0 }, { x: 900, y: -400 }, box, view), { x: 40, y: -100 });
  assert.deepEqual(dragOffset({ x: 0, y: 0 }, { x: -900, y: 0 }, box, view), { x: -600, y: 0 });
});

test("dragged down, a popup stops at the bottom of the window", () => {
  const o = dragOffset({ x: 0, y: 0 }, { x: 0, y: 2000 }, box, view);
  assert.equal(box.top + o.y + box.height, view.height);
});

test("a popup taller than the window keeps its top, with the close button, on screen", () => {
  const tall = { ...box, top: 0, height: 1200 };
  assert.deepEqual(dragOffset({ x: 0, y: 0 }, { x: 0, y: 300 }, tall, view), { x: 0, y: 0 });
});

test("a popup wider than the window keeps its right edge, where the close button is, on screen", () => {
  const wide = { left: -50, top: 0, width: 1200, height: 300 };
  const o = dragOffset({ x: 0, y: 0 }, { x: -500, y: 0 }, wide, view);
  assert.equal(wide.left + o.x + wide.width, view.width);
});
