// Panic types (Game setting "Panic types"): Sanity at its minimum rolls a d4 for how a character
// Panics, holds Sanity there for 3 Upkeeps, then they recover. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { Dice, DiceKind, Page, PageType } from "../shared/character.ts";
import { applyAction, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import { PANIC_UPKEEPS } from "../shared/ruleset.ts";
import { panicTypesOn, type GameDoc, type PanicType, type TableAction, type TableState, type Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };

let n = 0;
const die = (kind: DiceKind, fp: number, sides = 1): Dice => ({ id: `d${n++}`, kind, counter: false, sides, basePower: fp - 1 });
const page = (id: string, type: PageType, dice: Dice[]): Page => ({ id, name: id, kind: "basic", cost: 0, type, dice, effect: "" });

function token(id: string, side: Token["side"], x: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y: 2, color: "#fff",
    resources: { hp: 300, maxHp: 300, stagger: 200, maxStagger: 200, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

/** Roland (player, always first) next to a Rat (enemy). Roland has an Auxiliary Page too. */
function setup(opts: { panic?: boolean; roland?: Page[]; rat?: Page[] } = {}) {
  const pages = opts.roland ?? [page("jab", "melee", [die("slash", 3)])];
  const tool = page("tool", "melee", [die("blunt", 2)]);
  const table: TableState = {
    map: { name: "m", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 2, { ownerId: "p1", justice: 100 }),
      rat: token("rat", "enemy", 3, { justice: -100, pages: opts.rat ?? [page("bite", "melee", [die("pierce", 1)])] }),
    },
    log: [],
  };
  const loadout: Loadout = {
    pages: Object.fromEntries([...pages, tool].map((p) => [p.id, p])),
    deck: pages.flatMap((p) => Array(12 / pages.length).fill(p.id)),
    aux: [{ pageId: "tool" }],
  };
  const ctx: EngineContext = { loadout: (id) => (id === "roland" ? loadout : undefined), panicTypes: () => !!opts.panic };
  const act = (a: TableAction, who: Actor = p1) => applyAction(table, a, who, ctx);
  act({ type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  const roland = () => table.tokens.roland;
  return { table, act, c: () => table.combat!, roland, status: () => roland().status ?? {}, logged: (s: string) => table.log.some((l) => l.includes(s)) };
}
type S = ReturnType<typeof setup>;

/** The GM sets Roland's Sanity, with the d4 (and any other die rolled meanwhile) forced to `roll`. */
function setSanity(s: S, sanity: number, roll: PanicType = 1) {
  const m = mock.method(globalThis.crypto, "getRandomValues", (buf: Uint32Array) => ((buf[0] = roll - 1), buf));
  try {
    s.act({ type: "setResources", tokenId: "roland", patch: { sanity } }, gm);
  } finally {
    m.mock.restore();
  }
}

/** Ends Roland's turn and the Rat's, so Roland passes one more Upkeep. */
function nextUpkeep(s: S) {
  s.act({ type: "endTurn" }, p1);
  s.act({ type: "endTurn" }, gm);
}

function play(s: S, pageId: string, targets: string[], who: Actor = p1, owner = "roland") {
  const card = s.c().decks[owner].hand.find((x) => x.pageId === pageId);
  assert.ok(card, `${pageId} in hand`);
  s.act({ type: "aim", source: "hand", cardId: card.id }, who);
  s.act({ type: "slot", targets }, who);
}

test("Panic types is off unless the GM turns it on", () => {
  const game = (settings?: GameDoc["settings"]) => ({ name: "g", gmId: "gm", members: {}, settings }) as unknown as GameDoc;
  assert.equal(panicTypesOn(undefined), false);
  assert.equal(panicTypesOn(game()), false);
  assert.equal(panicTypesOn(game({ panicTypes: false })), false);
  assert.equal(panicTypesOn(game({ panicTypes: true })), true);
});

test("with the setting off, Panic is only a flag: no d4, Sanity moves freely and Upkeeps are normal", () => {
  const s = setup();
  setSanity(s, -15);
  assert.equal(s.status().panic, true);
  assert.equal(s.status().panicType, undefined);
  assert.ok(!s.logged("Panics!"));
  const hand = s.c().decks.roland.hand.length;
  nextUpkeep(s);
  assert.equal(s.c().decks.roland.hand.length, hand + 1);
  assert.equal(s.status().panic, true, "still at minimum Sanity");
  // Winning a clash heals 1 Sanity and ends Panic.
  play(s, "jab", ["rat"]);
  s.act({ type: "endTurn" }, p1);
  play(s, "bite", ["roland"], gm, "rat");
  s.act({ type: "endTurn" }, gm);
  s.act({ type: "endTurn" }, p1);
  assert.equal(s.roland().resources.sanity, -14);
  assert.equal(s.status().panic, false);
});

test("with the setting on, losing a clash at -14 Sanity Panics: a d4 picks the type and it's logged", () => {
  const s = setup({ panic: true, roland: [page("jab", "melee", [die("slash", 1)])], rat: [page("bite", "melee", [die("pierce", 5)])] });
  setSanity(s, -14);
  assert.equal(s.status().panic, false);
  play(s, "jab", ["rat"]);
  s.act({ type: "endTurn" }, p1);
  play(s, "bite", ["roland"], gm, "rat");
  s.act({ type: "endTurn" }, gm); // Roland's turn: the Jab loses the clash.
  assert.equal(s.roland().resources.sanity, -15);
  assert.equal(s.status().panic, true);
  assert.ok([1, 2, 3, 4].includes(s.status().panicType!));
  assert.ok(s.logged("roland Panics! d4: "));
});

test("while Panicking, Sanity is stuck at its minimum; after the third Upkeep they recover at 0 Sanity", () => {
  const s = setup({ panic: true, roland: [page("jab", "melee", [die("slash", 5)])] });
  setSanity(s, -15, 3);
  assert.equal(s.status().panicType, 3);
  assert.equal(s.status().panicUpkeeps, 0);
  assert.ok(s.logged("roland Panics! d4: 3, Darkness: no gaining Light for 3 Upkeeps."));
  // Winning a clash would heal 1 Sanity; Panicking, it stays at -15.
  play(s, "jab", ["rat"]);
  s.act({ type: "endTurn" }, p1);
  play(s, "bite", ["roland"], gm, "rat");
  s.act({ type: "endTurn" }, gm); // Upkeep 1, after the Jab wins.
  assert.ok(s.c().decks.rat.discard.length > 0, "the clash happened");
  assert.equal(s.roland().resources.sanity, -15);
  assert.equal(s.status().panicUpkeeps, 1);
  assert.ok(s.logged("recovers in 2 more Upkeeps"));
  nextUpkeep(s); // 2
  assert.equal(s.status().panic, true);
  nextUpkeep(s); // 3: recovered.
  assert.equal(PANIC_UPKEEPS, 3);
  assert.equal(s.status().panic, false);
  assert.equal(s.status().panicType, undefined);
  assert.equal(s.status().panicUpkeeps, undefined);
  assert.equal(s.roland().resources.sanity, 0);
  assert.ok(s.logged("roland recovers from Panic"));
});

test("Panic 1: every die rolls its Min, Story Rolls included", () => {
  const s = setup({ panic: true, roland: [page("jab", "melee", [die("slash", 6, 6)])] });
  setSanity(s, -15, 1);
  play(s, "jab", ["rat"]);
  s.act({ type: "endTurn" }, p1);
  s.act({ type: "endTurn" }, gm); // The Jab hits One-Sided: 1d6+5 rolls 1, so 6 damage.
  assert.ok(s.logged("roland is Panicking: the die rolls its Min (1)."));
  assert.equal(s.table.tokens.rat.resources.hp, 294);
  s.act({ type: "storyRoll", tokenId: "roland", stat: "justice" }, p1);
  assert.equal(s.table.storyRoll?.roll, 1);
});

test("Panic 2: no drawing Pages at Upkeep or from effects", () => {
  const s = setup({ panic: true });
  setSanity(s, -15, 2);
  const hand = s.c().decks.roland.hand.length;
  nextUpkeep(s);
  assert.equal(s.c().decks.roland.hand.length, hand);
  assert.ok(s.logged("Upkeep: no draw"));
  nextUpkeep(s);
  nextUpkeep(s); // Recovered at this Upkeep, after its (missed) draw.
  assert.equal(s.c().decks.roland.hand.length, hand);
  nextUpkeep(s);
  assert.equal(s.c().decks.roland.hand.length, hand + 1, "draws again once recovered");
});

test("Panic 3: no gaining Light at Upkeep; spending it still works", () => {
  const s = setup({ panic: true });
  setSanity(s, -15, 3);
  const light = s.roland().resources.light;
  nextUpkeep(s);
  nextUpkeep(s);
  assert.equal(s.roland().resources.light, light);
  nextUpkeep(s); // Recovers at the end of this Upkeep, after it gained none.
  assert.equal(s.roland().resources.light, light);
  nextUpkeep(s);
  assert.equal(s.roland().resources.light, light + 1);
});

test("Panic 4: no Auxiliary Pages, but the hand still works", () => {
  const s = setup({ panic: true });
  setSanity(s, -15, 4);
  const aux = s.c().decks.roland.aux[0];
  assert.throws(() => s.act({ type: "aim", source: "aux", cardId: aux.id }), /Panicking and can't use Auxiliary Pages/);
  play(s, "jab", ["rat"]);
  assert.equal(s.c().slots.length, 1);
});

test("other Panic types leave Auxiliary Pages, draws and Light alone", () => {
  const s = setup({ panic: true });
  setSanity(s, -15, 1);
  const hand = s.c().decks.roland.hand.length;
  const light = s.roland().resources.light;
  s.act({ type: "aim", source: "aux", cardId: s.c().decks.roland.aux[0].id });
  s.act({ type: "endTurn" }, p1);
  s.act({ type: "endTurn" }, gm);
  assert.equal(s.c().decks.roland.hand.length, hand + 1);
  assert.equal(s.roland().resources.light, light + 1);
});

test("the GM raising Sanity above its minimum ends Panic", () => {
  const s = setup({ panic: true });
  setSanity(s, -15, 2);
  setSanity(s, -3);
  assert.equal(s.status().panic, false);
  assert.equal(s.status().panicType, undefined);
  const hand = s.c().decks.roland.hand.length;
  nextUpkeep(s);
  assert.equal(s.c().decks.roland.hand.length, hand + 1);
});
