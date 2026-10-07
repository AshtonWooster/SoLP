// Tapping an arrow on the board shows the slotted Page, or both Pages of a clash. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dice, DiceKind, Page, PageType } from "../shared/character.ts";
import { applyAction, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import type { TableAction, TableState, Token } from "../shared/types.ts";
import { arrowHitSegment, arrowPages, boardArrows } from "../src/components/arrows.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };

let n = 0;
const die = (kind: DiceKind, fp: number): Dice => ({ id: `d${n++}`, kind, counter: false, sides: 1, basePower: fp - 1 });
const page = (id: string, type: PageType, dice: Dice[]): Page => ({ id, name: id, kind: "basic", cost: 1, type, dice, effect: "" });

function token(id: string, side: Token["side"], x: number, y: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 5, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

/** Roland (player, first), a Rat next to him, and Olivier (second). */
function setup() {
  const table: TableState = {
    map: { name: "m", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 2, 2, { ownerId: "p1", justice: 100 }),
      rat: token("rat", "enemy", 3, 2, { justice: -100, pages: [page("bite", "melee", [die("pierce", 2)])] }),
      olivier: token("olivier", "player", 3, 3, { justice: -50 }),
    },
    log: [],
  };
  const slash = page("slash", "melee", [die("slash", 5)]);
  const loadout: Loadout = { pages: { slash }, deck: Array(12).fill("slash"), aux: [] };
  const ctx: EngineContext = { loadout: (id) => (id === "roland" ? loadout : undefined) };
  const act = (a: TableAction, who: Actor = p1) => applyAction(table, a, who, ctx);
  act({ type: "startCombat", tokenIds: ["roland", "rat", "olivier"] }, gm);
  const use = (tokenId: string, pageId: string, targets: string[], who: Actor) => {
    const card = table.combat!.decks[tokenId].hand.find((x) => x.pageId === pageId)!;
    act({ type: "aim", source: "hand", cardId: card.id }, who);
    act({ type: "slot", targets }, who);
  };
  return { table, act, use };
}

test("a one-sided Page is one arrow that opens just that Page", () => {
  const s = setup();
  s.use("roland", "slash", ["rat"], p1);
  const arrows = boardArrows(s.table);
  assert.equal(arrows.length, 1);
  const [a] = arrows;
  assert.equal(a.from.id, "roland");
  assert.equal(a.to.id, "rat");
  assert.equal(a.clash, false);
  const shown = arrowPages(s.table, a.slotIds);
  assert.deepEqual(shown.map((x) => [x.slot.ownerId, x.page.name]), [["roland", "slash"]]);
});

test("a clash is one two-headed arrow that opens both Pages", () => {
  const s = setup();
  s.act({ type: "endTurn" }, p1); // Roland
  s.act({ type: "endTurn" }, gm); // Olivier
  s.use("rat", "bite", ["olivier"], gm);
  s.act({ type: "endTurn" }, gm); // Rat
  s.use("roland", "slash", ["rat"], p1);
  const arrows = boardArrows(s.table);
  assert.equal(arrows.length, 1, "the two clashing Pages share one arrow");
  const [a] = arrows;
  assert.ok(a.clash && a.both);
  const shown = arrowPages(s.table, a.slotIds);
  assert.deepEqual(shown.map((x) => [x.slot.ownerId, x.page.name]).sort(), [["rat", "bite"], ["roland", "slash"]]);
});

test("no arrows or Pages outside combat, and a slot that's gone shows nothing", () => {
  const s = setup();
  s.use("roland", "slash", ["rat"], p1);
  assert.deepEqual(arrowPages(s.table, ["nope"]), []);
  s.act({ type: "endCombat" }, gm);
  assert.deepEqual(boardArrows(s.table), []);
  assert.deepEqual(arrowPages(s.table, ["anything"]), []);
});

test("the tappable part of an arrow stops short of both tokens", () => {
  const far = arrowHitSegment({ from: { x: 0, y: 0 }, to: { x: 4, y: 0 } } as never);
  assert.deepEqual(far, { x1: 0.9, y1: 0.5, x2: 4.1, y2: 0.5 });
  const near = arrowHitSegment({ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } } as never);
  assert.ok(near.x2 > near.x1, "neighbours still leave something to tap");
  assert.ok(near.x1 > 0.5 && near.x2 < 1.5);
});
