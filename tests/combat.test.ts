// Decks, turn phases, slotting and clashing. Run with `npm run test:engine`.
// Dice here have 1 side, so they always roll 1 and Final Power = 1 + Base Power.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dice, DiceKind, Page, PageType } from "../shared/character.ts";
import { activeToken, applyAction, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import { DASH_MOVEMENT, STARTING_HAND } from "../shared/ruleset.ts";
import type { TableAction, TableState, Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };

let n = 0;
const die = (kind: DiceKind, fp: number, counter = false): Dice => ({ id: `d${n++}`, kind, counter, sides: 1, basePower: fp - 1 });
const page = (id: string, type: PageType, dice: Dice[], cost = 1): Page => ({ id, name: id, kind: "basic", cost, type, dice, effect: "" });

function token(id: string, side: Token["side"], x: number, y: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 5, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

/** Roland (player, always first) next to a Rat (enemy). */
function setup(playerPages: Page[], enemyPages: Page[] = [], deck?: string[]) {
  const table: TableState = {
    map: { name: "m", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 2, 2, { ownerId: "p1", justice: 100 }),
      rat: token("rat", "enemy", 3, 2, { justice: -100, pages: enemyPages }),
    },
    log: [],
  };
  const loadout: Loadout = {
    pages: Object.fromEntries(playerPages.map((p) => [p.id, p])),
    deck: deck ?? playerPages.flatMap((p) => Array(12 / playerPages.length).fill(p.id)),
    aux: [],
  };
  const ctx: EngineContext = { loadout: (id) => (id === "roland" ? loadout : undefined) };
  const act = (a: TableAction, who: Actor = p1) => applyAction(table, a, who, ctx);
  act({ type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  return { table, act, c: () => table.combat!, hp: (id: string) => table.tokens[id].resources.hp };
}

/** Play a card from Roland's hand by page id against the given targets. */
function play(s: ReturnType<typeof setup>, pageId: string, targets: string[]) {
  const card = s.c().decks.roland.hand.find((x) => x.pageId === pageId);
  assert.ok(card, `${pageId} in hand`);
  s.act({ type: "aim", source: "hand", cardId: card.id });
  s.act({ type: "slot", targets });
}

/** The Rat (GM) uses one of its pages. */
function enemyPlay(s: ReturnType<typeof setup>, pageId: string, targets: string[]) {
  s.act({ type: "aim", source: "enemy", pageId }, gm);
  s.act({ type: "slot", targets }, gm);
}

const endTurn = (s: ReturnType<typeof setup>, who: Actor = gm) => s.act({ type: "endTurn" }, who);

test("players start with 3 Pages and draw 1 at each Upkeep; phases pass on their own to Combat Actions", () => {
  const s = setup([page("slash", "melee", [die("slash", 3)])]);
  const d = s.c().decks.roland;
  // Roland goes first, so his first Upkeep has already drawn: 3 + 1.
  assert.equal(d.hand.length, STARTING_HAND + 1);
  assert.equal(d.draw.length, 12 - STARTING_HAND - 1);
  assert.equal(s.c().phase, "actions");
  assert.equal(activeToken(s.table)!.id, "roland");
  endTurn(s, p1);
  assert.equal(activeToken(s.table)!.id, "rat");
  assert.equal(s.c().phase, "actions");
  endTurn(s);
  assert.equal(d === s.c().decks.roland ? d.hand.length : s.c().decks.roland.hand.length, STARTING_HAND + 2);
});

test("an empty Combat Deck reshuffles the discard pile; with both empty, no draw", () => {
  const s = setup([page("slash", "melee", [die("slash", 3)], 0)], [], ["slash", "slash", "slash", "slash"]);
  const deck = () => s.c().decks.roland;
  assert.equal(deck().hand.length, 4);
  assert.equal(deck().draw.length, 0);
  play(s, "slash", ["rat"]);
  endTurn(s, p1);
  endTurn(s); // Roland's turn: his Page resolves into the discard pile, then Upkeep reshuffles and draws it.
  assert.equal(deck().discard.length, 0);
  assert.equal(deck().hand.length, 4);
  endTurn(s, p1);
  endTurn(s); // Nothing left anywhere: no draw.
  assert.equal(deck().hand.length, 4);
});

test("slotting pays Light and holds the Page until the owner's next turn, then it hits One-Sided", () => {
  const s = setup([page("slash", "melee", [die("slash", 3), die("pierce", 4)], 2)]);
  play(s, "slash", ["rat"]);
  assert.equal(s.table.tokens.roland.resources.light, 3);
  assert.equal(s.c().slots.length, 1);
  assert.equal(s.hp("rat"), 30, "nothing happens until Roland's next turn");
  endTurn(s, p1);
  endTurn(s);
  assert.equal(s.hp("rat"), 30 - 3 - 4);
  assert.equal(s.c().slots.length, 0);
  assert.equal(s.c().decks.roland.discard.length, 1);
});

test("not enough Light, out of range, or not your turn: refused", () => {
  const s = setup([page("big", "melee", [die("slash", 3)], 9), page("slash", "melee", [die("slash", 3)])]);
  assert.throws(() => play(s, "big", ["rat"]), /costs 9 Light/);
  s.table.tokens.rat.x = 8;
  assert.throws(() => play(s, "slash", ["rat"]), /out of range/);
  endTurn(s, p1);
  assert.throws(() => s.act({ type: "dash" }), /isn't your turn/);
});

test("Type Resistance multiplies damage", () => {
  const s = setup([page("blunt", "melee", [die("blunt", 10)])]);
  s.table.tokens.rat.resistances = { slash: 1, pierce: 1, blunt: 0.5 };
  play(s, "blunt", ["rat"]);
  endTurn(s, p1);
  endTurn(s);
  assert.equal(s.hp("rat"), 25);
});

test("slotting against a Speed Die holding a Page starts a Clash; the winner hits, Sanity +1/-1", () => {
  const s = setup([page("slash", "melee", [die("slash", 6)])], [page("bite", "melee", [die("pierce", 4)])]);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]); // Rat slots first...
  endTurn(s);
  play(s, "slash", ["rat"]); // ...Roland slots against the Rat's die: Clash.
  assert.ok(s.c().slots.every((x) => x.clashWith));
  endTurn(s, p1); // Rat's turn: the clash resolves.
  assert.equal(s.hp("rat"), 24);
  assert.equal(s.hp("roland"), 30);
  assert.equal(s.table.tokens.roland.resources.sanity, 1);
  assert.equal(s.table.tokens.rat.resources.sanity, -1);
  assert.equal(s.c().slots.length, 0);
});

test("a Draw Negates both dice", () => {
  const s = setup([page("slash", "melee", [die("slash", 5)])], [page("bite", "melee", [die("pierce", 5)])]);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]);
  endTurn(s);
  play(s, "slash", ["rat"]);
  endTurn(s, p1);
  assert.equal(s.hp("rat"), 30);
  assert.equal(s.hp("roland"), 30);
});

test("Block: losing reduces damage before Resistance; winning deals the difference as Stagger; vs Defensive deals its full power", () => {
  // Rat's Block 4 loses to Slash 7: 3 damage, halved by Resistance 0.5 -> 1.
  let s = setup([page("slash", "melee", [die("slash", 7)])], [page("guard", "melee", [die("block", 4)])]);
  s.table.tokens.rat.resistances = { slash: 0.5, pierce: 1, blunt: 1 };
  endTurn(s, p1);
  enemyPlay(s, "guard", ["roland"]);
  endTurn(s);
  play(s, "slash", ["rat"]);
  endTurn(s, p1);
  assert.equal(s.hp("rat"), 29);
  // Rat's Block 9 beats Slash 3: Roland takes 6 Stagger.
  s = setup([page("slash", "melee", [die("slash", 3)])], [page("guard", "melee", [die("block", 9)])]);
  endTurn(s, p1);
  enemyPlay(s, "guard", ["roland"]);
  endTurn(s);
  play(s, "slash", ["rat"]);
  endTurn(s, p1);
  assert.equal(s.table.tokens.roland.resources.stagger, 14);
  // Block 6 beats Evade 2: 6 Stagger.
  s = setup([page("dodge", "melee", [die("evade", 2)])], [page("guard", "melee", [die("block", 6)])]);
  endTurn(s, p1);
  enemyPlay(s, "guard", ["roland"]);
  endTurn(s);
  play(s, "dodge", ["rat"]);
  endTurn(s, p1);
  assert.equal(s.table.tokens.roland.resources.stagger, 14);
});

test("Evade: a win recovers Stagger and is Recycled against the next Offensive die; Evade vs Evade is always a Draw", () => {
  const s = setup([page("dodge", "melee", [die("evade", 8)])], [page("flurry", "melee", [die("slash", 3), die("slash", 4)])]);
  s.table.tokens.roland.resources.stagger = 10;
  endTurn(s, p1);
  enemyPlay(s, "flurry", ["roland"]);
  endTurn(s);
  play(s, "dodge", ["rat"]);
  endTurn(s, p1);
  // The one Evade beat both Slashes: +8 twice, capped at 20.
  assert.equal(s.table.tokens.roland.resources.stagger, 20);
  assert.equal(s.hp("roland"), 30);

  const t = setup([page("dodge", "melee", [die("evade", 9)])], [page("sidestep", "melee", [die("evade", 2)])]);
  endTurn(t, p1);
  enemyPlay(t, "sidestep", ["roland"]);
  endTurn(t);
  play(t, "dodge", ["rat"]);
  endTurn(t, p1);
  assert.equal(t.table.tokens.roland.resources.sanity, 0, "draw: no Sanity change");
});

test("Melee vs Ranged: a winning melee Offensive die deals no damage and goes to the bottom of its Page", () => {
  const s = setup([page("swing", "melee", [die("slash", 9), die("block", 2)])], [page("shot", "ranged", [die("pierce", 3), die("pierce", 3)])]);
  endTurn(s, p1);
  enemyPlay(s, "shot", ["roland"]);
  endTurn(s);
  play(s, "swing", ["rat"]);
  endTurn(s, p1);
  // Slash 9 beats Pierce 3 (no damage, to the bottom); Block 2 loses to Pierce 3 (1 damage);
  // the recycled Slash 9 is left over with no dice against it, so it hits: 9.
  assert.equal(s.hp("roland"), 29);
  assert.equal(s.hp("rat"), 21);
});

test("leftover Defensive dice become Counter Dice, which answer One-Sided attacks before the owner's next Upkeep, then are lost", () => {
  // Turn order: Roland, Rat, Wolf.
  const s = setup([page("guard", "melee", [die("slash", 5), die("block", 9)])], [page("bite", "melee", [die("pierce", 3)])]);
  s.table.tokens.wolf = token("wolf", "enemy", 2, 3, { justice: -200, pages: [page("maul", "melee", [die("blunt", 4), die("blunt", 4)])] });
  s.act({ type: "addCombatant", tokenId: "wolf" }, gm);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]); // Rat targets Roland.
  endTurn(s);
  s.act({ type: "aim", source: "enemy", pageId: "maul" }, gm); // Wolf attacks Roland One-Sided.
  s.act({ type: "slot", targets: ["roland"] }, gm);
  endTurn(s);
  play(s, "guard", ["rat"]); // Round 2, Roland: clash with the Rat's Bite.
  endTurn(s, p1);
  // Rat's turn: Slash 5 beats Pierce 3; the Block 9 is left over and becomes a Counter Die.
  assert.equal(s.hp("rat"), 25);
  assert.equal(s.c().counters.roland.length, 1);
  endTurn(s);
  // Wolf's turn: its Maul is One-Sided, so the Counter Block 9 answers both Blunt 4s (recycled after winning).
  assert.equal(s.hp("roland"), 30);
  assert.equal(s.table.tokens.wolf.resources.stagger, 20 - 5 - 5);
  assert.equal((s.c().counters.roland ?? []).length, 0, "lost after the Maul resolved");
});

test("Counter Dice on a Page are stored when it's slotted and expire at the end of the owner's next Upkeep", () => {
  const s = setup([page("riposte", "melee", [die("slash", 2), die("slash", 6, true)])], [page("bite", "melee", [die("pierce", 3)])]);
  play(s, "riposte", ["rat"]);
  assert.equal(s.c().counters.roland.length, 1);
  endTurn(s, p1);
  // Rat attacks One-Sided (Roland's die holds a Page, but the Rat slotted against... Roland's die): it's a clash, so slot elsewhere:
  // Give the Rat a way to attack One-Sided by removing Roland's page first.
  s.c().slots = s.c().slots.filter((x) => x.ownerId !== "roland");
  enemyPlay(s, "bite", ["roland"]);
  endTurn(s); // Roland's Upkeep clears his Counter Dice.
  assert.equal((s.c().counters.roland ?? []).length, 0);
});

test("Mass Attack (Summation), 2 targets: clashes wait for the Mass owner's turn; a lower Page is Negated and hit, a higher one is unaffected", () => {
  // Turn order: Roland, Rat, Wolf.
  const s = setup([page("sweep", "massSummation", [die("slash", 5), die("slash", 5)])], [page("bite", "melee", [die("pierce", 3)])]);
  s.table.tokens.wolf = token("wolf", "enemy", 2, 3, { justice: -200, pages: [page("shield", "melee", [die("block", 20)])] });
  s.act({ type: "addCombatant", tokenId: "wolf" }, gm);
  play(s, "sweep", ["rat", "wolf"]);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]); // Clashes with the Sweep (it's aimed at the Rat)...
  endTurn(s);
  s.act({ type: "aim", source: "enemy", pageId: "shield" }, gm);
  s.act({ type: "slot", targets: ["roland"] }, gm);
  endTurn(s);
  // ...and waited: Roland's turn resolves the Sweep. 10 vs Bite 3: Negated, Rat takes 5+5. 10 vs Shield 20: Wolf unaffected.
  assert.equal(s.hp("rat"), 20);
  assert.equal(s.hp("wolf"), 30);
  assert.equal(s.hp("roland"), 30, "the Bite never landed");
  const shield = s.c().slots.find((x) => x.ownerId === "wolf");
  assert.ok(shield && !shield.clashWith, "the Wolf's Page stays slotted for its own turn");
});

test("Mass Attack (Individual): each Mass die beats a lower target die and lands", () => {
  const s = setup([page("barrage", "massIndividual", [die("pierce", 6), die("pierce", 2)])], [page("claw", "melee", [die("slash", 4), die("slash", 4)])]);
  play(s, "barrage", ["rat"]);
  endTurn(s, p1);
  enemyPlay(s, "claw", ["roland"]);
  endTurn(s);
  // Pierce 6 vs Slash 4: lands for 6. Pierce 2 vs Slash 4: doesn't land.
  assert.equal(s.hp("rat"), 24);
});

test("Instant Pages resolve right away and never clash", () => {
  const s = setup([page("jab", "instant", [die("blunt", 4)])], [page("bite", "melee", [die("pierce", 3)])]);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]);
  endTurn(s);
  play(s, "jab", ["rat"]);
  assert.equal(s.hp("rat"), 26);
  assert.ok(!s.c().slots.some((x) => x.ownerId === "roland"));
});

test("a character targeted by an enemy's (non-Mass) Page can't move; Dash turns Light into Movement", () => {
  const s = setup([page("slash", "melee", [die("slash", 3)])], [page("bite", "melee", [die("pierce", 3)])]);
  const before = s.c().movementLeft;
  s.act({ type: "dash" });
  assert.equal(s.c().movementLeft, before + DASH_MOVEMENT);
  assert.equal(s.table.tokens.roland.resources.light, 4);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]);
  endTurn(s);
  assert.throws(() => s.act({ type: "turnMove", x: 2, y: 4 }), /can't move/);
});

test("at 0 Health a character is Knocked Out: their Pages are discarded and their turns skipped", () => {
  const s = setup([page("slash", "melee", [die("slash", 40)])], [page("bite", "melee", [die("pierce", 3)])]);
  play(s, "slash", ["rat"]);
  endTurn(s, p1);
  enemyPlay(s, "bite", ["roland"]);
  endTurn(s); // Clash: Slash 40 beats Bite 3 and knocks the Rat out.
  assert.ok(s.table.tokens.rat.status?.knockedOut);
  endTurn(s, p1);
  assert.equal(activeToken(s.table)!.id, "roland", "the Rat's turn was skipped");
});

test("players can't use enemy Pages or act for someone else; the GM can", () => {
  const s = setup([page("slash", "melee", [die("slash", 3)])], [page("bite", "melee", [die("pierce", 3)])]);
  assert.throws(() => s.act({ type: "aim", source: "enemy", pageId: "bite" }), /Wrong kind/);
  endTurn(s, p1);
  assert.throws(() => s.act({ type: "aim", source: "enemy", pageId: "bite" }), /isn't your turn/);
  enemyPlay(s, "bite", ["roland"]);
  assert.equal(s.c().slots.length, 1);
});
