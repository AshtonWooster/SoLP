// The Game settings added with the October ruleset update (LoR_PMTTRPG Rules.md): Knocked Out
// rules, Recover when combat ends, Weapon properties, and the GM's Rest. Each is off unless the GM
// turns it on. Run with `npm run test:engine`. Dice here have 1 side: Final Power = 1 + Base Power.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { Dice, DiceKind, Page, PageType, Weapon } from "../shared/character.ts";
import { applyAction, guardDice, revivable, validTargets, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import { blankCharacter, blankWeapon, characterChecks, KO_UPKEEPS, restPerHour, reviveHealth, withWeaponProperty, withWeaponRanges } from "../shared/ruleset.ts";
import { endOfCombatRecoveryOn, knockOutRulesOn, weaponPropertiesOn, type GameDoc, type TableAction, type TableState, type Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };
const p2: Actor = { uid: "p2", role: "player", displayName: "P2" };

let n = 0;
const die = (kind: DiceKind, fp: number, counter = false): Dice => ({ id: `d${n++}`, kind, counter, sides: 1, basePower: fp - 1 });
const page = (id: string, type: PageType, dice: Dice[], extra: Partial<Page> = {}): Page => ({ id, name: id, kind: "basic", cost: 0, type, dice, effect: "", ...extra });

function token(id: string, side: Token["side"], x: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y: 2, color: "#fff",
    resources: { hp: 40, maxHp: 40, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

interface Opts {
  knockOut?: boolean;
  endRecovery?: boolean;
  angela?: Page[];
  roland?: Page[];
  rat?: Page[];
  ratX?: number;
  start?: boolean;
}

/** Angela (player, first), Roland (player) and a Rat (enemy, last). Angela has Temperance 2 and Prudence 1; Roland Prudence 4. */
function setup(o: Opts = {}) {
  const jab = page("jab", "melee", [die("slash", 3)]);
  const table: TableState = {
    map: { name: "m", width: 20, height: 10 },
    tokens: {
      angela: token("angela", "player", 1, { ownerId: "p2", justice: 200 }),
      roland: token("roland", "player", 2, { ownerId: "p1", justice: 100 }),
      rat: token("rat", "enemy", o.ratX ?? 3, { justice: -100, pages: o.rat ?? [page("bite", "melee", [die("pierce", 50)])] }),
    },
    log: [],
  };
  const loadout = (pages: Page[], stats: Record<string, number>, rank: number): Loadout => ({
    pages: Object.fromEntries(pages.map((p) => [p.id, p])),
    deck: pages.flatMap((p) => Array(12 / pages.length).fill(p.id)),
    aux: [],
    stats,
    rank,
  });
  const loadouts: Record<string, Loadout> = {
    angela: loadout(o.angela ?? [jab], { temperance: 2, prudence: 1, fortitude: 1 }, 9),
    roland: loadout(o.roland ?? [jab], { prudence: 4, fortitude: 3 }, 8),
  };
  const ctx: EngineContext = {
    loadout: (id) => loadouts[id],
    knockOutRules: () => !!o.knockOut,
    endOfCombatRecovery: () => !!o.endRecovery,
  };
  const act = (a: TableAction, who: Actor = gm) => applyAction(table, a, who, ctx);
  if (o.start !== false) act({ type: "startCombat", tokenIds: ["angela", "roland", "rat"] });
  const t = (id: string) => table.tokens[id];
  return { table, act, ctx, t, c: () => table.combat!, logged: (s: string) => table.log.some((l) => l.includes(s)) };
}
type S = ReturnType<typeof setup>;

/** The hand is drawn at random: make sure a copy of the Page is in it. */
function inHand(s: S, tokenId: string, pageId: string) {
  const deck = s.c().decks[tokenId];
  if (!deck.hand.some((x) => x.pageId === pageId)) {
    const i = deck.draw.findIndex((x) => x.pageId === pageId);
    if (i >= 0) deck.hand.push(...deck.draw.splice(i, 1));
  }
  const card = deck.hand.find((x) => x.pageId === pageId);
  assert.ok(card, `${pageId} in ${tokenId}'s hand`);
  return card;
}

function use(s: S, who: Actor, tokenId: string, pageId: string, targets: string[], extra: Partial<Extract<TableAction, { type: "slot" }>> = {}) {
  s.act({ type: "aim", source: "hand", cardId: inHand(s, tokenId, pageId).id }, who);
  s.act({ type: "slot", targets, ...extra }, who);
}

/** Runs an action with every die forced to roll `roll`. */
function rigged<T>(roll: number, fn: () => T): T {
  const m = mock.method(globalThis.crypto, "getRandomValues", (buf: Uint32Array) => ((buf[0] = roll - 1), buf));
  try {
    return fn();
  } finally {
    m.mock.restore();
  }
}

/** Knock Roland out by hand, then pass to Angela's next turn (Roland's own turn is skipped). */
function knockOutRoland(s: S) {
  s.act({ type: "setResources", tokenId: "roland", patch: { hp: 0 } });
  assert.equal(s.t("roland").status?.knockedOut, true);
}

/** Ends Angela's turn and the Rat's (Roland's is skipped while he's down), back to Angela. */
function nextRound(s: S) {
  s.act({ type: "endTurn" }, p2);
  s.act({ type: "endTurn" });
}

// ---- Settings ----

test("every new setting is off unless the GM turns it on", () => {
  const game = (settings: GameDoc["settings"]): GameDoc => ({ name: "g", gmId: "gm", memberIds: [], members: {}, createdAt: 0, settings });
  for (const on of [knockOutRulesOn, endOfCombatRecoveryOn, weaponPropertiesOn]) {
    assert.equal(on(undefined), false);
    assert.equal(on(game({})), false);
  }
  assert.equal(knockOutRulesOn(game({ knockOutRules: true })), true);
  assert.equal(endOfCombatRecoveryOn(game({ endOfCombatRecovery: true })), true);
  assert.equal(weaponPropertiesOn(game({ weaponProperties: true })), true);
});

// ---- Knocked Out rules ----

test("Knocked Out rules off: a Knocked Out character can't be targeted and never dies, as before", () => {
  const s = setup();
  knockOutRoland(s);
  assert.equal(s.c().knockOutRules, undefined);
  for (let i = 0; i < KO_UPKEEPS + 1; i++) nextRound(s);
  assert.equal(s.t("roland").status?.dead, undefined);
  assert.equal(revivable(s.table, s.t("roland")), false);
  assert.ok(!validTargets(s.table, s.t("rat"), s.t("rat").pages![0]).some((t) => t.id === "roland"));
  assert.throws(() => s.act({ type: "koRecovery", tokenId: "roland" }, p2), /Knocked Out rules are off/);
});

test("Knocked Out rules: three Upkeeps without a revive and the character is Dead", () => {
  const s = setup({ knockOut: true });
  knockOutRoland(s);
  nextRound(s); // Roland's turn skipped: Upkeep 1.
  assert.equal(s.t("roland").status?.koUpkeeps, 1);
  assert.ok(s.logged("roland is Dead in 2 more Upkeeps unless revived"));
  nextRound(s);
  nextRound(s);
  assert.equal(s.t("roland").status?.dead, true);
  assert.ok(s.logged("roland is Dead."));
  assert.equal(revivable(s.table, s.t("roland")), false);
  assert.throws(() => s.act({ type: "koRecovery", tokenId: "roland" }, p2), /roland is Dead/);
  // The GM can still bring them back by setting their Health.
  s.act({ type: "setResources", tokenId: "roland", patch: { hp: 5 } });
  assert.equal(s.t("roland").status?.dead, undefined);
  assert.equal(s.t("roland").status?.knockedOut, false);
});

test("Knocked Out rules: a Temperance Story Roll of 12+ revives with a quarter of Health, 3 + Prudence Sanity and full Stagger; the reviver gains 3 + Prudence Sanity", () => {
  const s = setup({ knockOut: true });
  s.t("roland").resources.stagger = 4;
  knockOutRoland(s);
  rigged(9, () => s.act({ type: "koRecovery", tokenId: "roland" }, p2)); // 9 + 2 Temperance = 11: fails.
  assert.equal(s.t("roland").status?.knockedOut, true);
  assert.equal(s.t("roland").status?.koRecoveryFails, 1);
  assert.ok(s.logged("Not enough (needs 12): roland is still Knocked Out. The next attempt gets +1."));
  assert.throws(() => s.act({ type: "koRecovery", tokenId: "roland" }, p2), /already tried to revive someone this turn/);
  nextRound(s);
  rigged(9, () => s.act({ type: "koRecovery", tokenId: "roland" }, p2)); // 9 + 2 + 1 = 12.
  const r = s.t("roland");
  assert.equal(r.status?.knockedOut, false);
  assert.equal(r.status?.koUpkeeps, undefined);
  assert.equal(r.resources.hp, reviveHealth(40));
  assert.equal(r.resources.hp, 10);
  assert.equal(r.resources.stagger, 20);
  assert.equal(r.resources.sanity, 7, "3 + Prudence 4");
  assert.equal(s.t("angela").resources.sanity, 4, "the reviver: 3 + Prudence 1");
});

test("Knocked Out rules: only an ally, on their own turn, can revive; enemies aren't covered by the rules", () => {
  const s = setup({ knockOut: true });
  knockOutRoland(s);
  assert.throws(() => s.act({ type: "koRecovery", tokenId: "roland" }, p1), /isn't your turn/);
  assert.throws(() => s.act({ type: "koRecovery", tokenId: "angela" }, p2), /angela isn't Knocked Out/);
  s.act({ type: "setResources", tokenId: "rat", patch: { hp: 0 } });
  assert.equal(revivable(s.table, s.t("rat")), false, "the rules are for players' characters");
  assert.throws(() => s.act({ type: "koRecovery", tokenId: "rat" }, p2), /can only revive an ally/);
});

test("Knocked Out rules: Pages can target a Knocked Out character; they do nothing but an Offensive Die brings Death closer", () => {
  const s = setup({ knockOut: true, rat: [page("bite", "melee", [die("pierce", 50), die("block", 3)])] });
  knockOutRoland(s);
  s.act({ type: "endTurn" }, p2); // Angela passes; Roland is skipped (Upkeep 1); the Rat acts.
  assert.equal(s.t("roland").status?.koUpkeeps, 1);
  assert.ok(validTargets(s.table, s.t("rat"), s.t("rat").pages![0]).some((t) => t.id === "roland"));
  use(s, gm, "rat", "bite", ["roland"]);
  s.act({ type: "endTurn" }); // Angela, Roland (Upkeep 2), then the Rat resolves Bite on Roland.
  s.act({ type: "endTurn" }, p2);
  assert.ok(s.logged("rat uses bite on roland, who is Knocked Out: it does nothing to them."));
  assert.equal(s.t("roland").resources.hp, 0);
  assert.equal(s.t("roland").status?.dead, true, "Upkeep 2 plus the Bite: 3");
});

// ---- Recover when combat ends ----

test("ending combat with the setting off leaves resources as they are", () => {
  const s = setup();
  s.t("roland").resources.light = 0;
  s.t("roland").resources.stagger = 2;
  s.act({ type: "endCombat" });
  assert.equal(s.t("roland").resources.light, 0);
  assert.equal(s.t("roland").resources.stagger, 2);
});

test("Recover when combat ends: full Light and Stagger, 3 + Prudence Sanity, and Panic, Stagger and Knock Out end; the Dead stay Dead", () => {
  const s = setup({ endRecovery: true });
  const angela = s.t("angela");
  angela.resources.light = 0;
  angela.resources.sanity = 2;
  s.act({ type: "setResources", tokenId: "roland", patch: { hp: 0, stagger: 0, sanity: -15 } });
  assert.equal(s.t("roland").status?.panic, true);
  s.t("rat").status = { knockedOut: true, dead: true };
  s.t("rat").resources.hp = 0;
  s.act({ type: "endCombat" });
  assert.deepEqual([angela.resources.light, angela.resources.stagger, angela.resources.sanity], [5, 20, 6], "Sanity 2 + 3 + Prudence 1");
  const roland = s.t("roland");
  assert.equal(roland.status?.knockedOut, false);
  assert.equal(roland.status?.staggered, false);
  assert.equal(roland.status?.panic, false);
  assert.equal(roland.resources.hp, 10, "a quarter of 40");
  assert.equal(roland.resources.stagger, 20);
  assert.equal(roland.resources.sanity, 7, "Panic ends at 0, then 3 + Prudence 4");
  assert.equal(s.t("rat").resources.hp, 0);
  assert.equal(s.t("rat").status?.dead, true);
});

// ---- Resting ----

test("Resting: each hour restores 6 + (10 − Rank)×2 + Fortitude×2 Health and (10 − Rank)×2 + Prudence Sanity", () => {
  assert.deepEqual(restPerHour({ rank: 9, fortitude: 1, prudence: 1 }), { hp: 10, sanity: 3 });
  assert.deepEqual(restPerHour({ rank: 8, fortitude: 3, prudence: 4 }), { hp: 16, sanity: 8 });
  const s = setup({ start: false });
  s.t("angela").resources.hp = 5;
  s.t("angela").resources.sanity = -5;
  s.t("roland").resources.hp = 0;
  s.t("roland").status = { knockedOut: true };
  s.t("rat").resources.hp = 1;
  s.act({ type: "rest", hours: 2 });
  assert.equal(s.t("angela").resources.hp, 25);
  assert.equal(s.t("angela").resources.sanity, 1);
  assert.equal(s.t("roland").resources.hp, 32);
  assert.equal(s.t("roland").resources.sanity, 15, "capped at max");
  assert.equal(s.t("roland").status?.knockedOut, false);
  assert.equal(s.t("rat").resources.hp, 1, "only the players' characters rest");
  assert.ok(s.logged("The party rests for 2 hours."));
});

test("Resting: the GM only, out of combat, 1 to 24 hours", () => {
  const s = setup({ start: false });
  assert.throws(() => s.act({ type: "rest", hours: 1 }, p1), /GM only/);
  assert.throws(() => s.act({ type: "rest", hours: 0 }), /1 to 24 hours/);
  assert.throws(() => s.act({ type: "rest", hours: 25 }), /1 to 24 hours/);
  s.act({ type: "startCombat", tokenIds: ["angela", "rat"] });
  assert.throws(() => s.act({ type: "rest", hours: 1 }), /can't rest during combat/);
});

// ---- Weapon properties ----

test("Weapon properties: a property sets the Weapon's hands and range", () => {
  const w = blankWeapon();
  assert.deepEqual(pick(withWeaponProperty(w, "small")), ["melee", 1, 1, undefined]);
  assert.deepEqual(pick(withWeaponProperty(w, "medium")), ["melee", 2, 1, undefined]);
  assert.deepEqual(pick(withWeaponProperty(w, "heavy")), ["melee", 2, 1, undefined]);
  assert.deepEqual(pick(withWeaponProperty(w, "lowCaliber")), ["ranged", 1, 1, 6]);
  assert.deepEqual(pick(withWeaponProperty(w, "highCaliber")), ["ranged", 2, 1, 10]);
  function pick(x: Weapon) {
    return [x.category, x.hands, x.meleeRange, x.rangedRange];
  }
});

test("Weapon properties: the sheet asks for a property and type, and a Melee Weapon can't carry Ranged Pages (only with the setting on)", () => {
  const c = blankCharacter("p1", "Roland");
  const w = { ...withWeaponProperty(blankWeapon(), "small"), name: "Knife" };
  w.pages[0].type = "ranged";
  c.weapons = [w];
  const texts = (on: boolean) => characterChecks(c, { weaponProperties: on }).filter((x) => !x.ok).map((x) => x.text);
  assert.ok(texts(true).includes("Knife is a Melee Weapon: it can't have Ranged Pages"));
  assert.ok(texts(true).includes("Knife: Melee or Ranged property and Offensive or Defensive type chosen"));
  assert.ok(!texts(false).some((x) => x.includes("Melee Weapon") || x.includes("property")));
  w.style = "offensive";
  w.pages[0].type = "melee";
  assert.ok(!texts(true).some((x) => x.includes("Melee Weapon") || x.includes("property")));
});

test("Weapon properties: a Weapon's Pages carry its Offensive or Defensive type into combat only with the setting on", () => {
  const w: Weapon = { ...blankWeapon(), style: "defensive" };
  const pages = w.pages;
  assert.deepEqual(withWeaponRanges({ weapons: [w] }, pages).map((p) => p.weaponStyle), [undefined, undefined]);
  assert.deepEqual(withWeaponRanges({ weapons: [w] }, pages, { weaponProperties: true }).map((p) => p.weaponStyle), ["defensive", "defensive"]);
});

test("Offensive Weapon: a Page that starts a Clash can resolve it right away", () => {
  const strike = page("strike", "melee", [die("slash", 9)], { weaponStyle: "offensive" });
  const s = setup({ angela: [strike], ratX: 0, rat: [page("bite", "melee", [die("pierce", 2)])] });
  s.act({ type: "endTurn" }, p2);
  s.act({ type: "endTurn" }, p1);
  use(s, gm, "rat", "bite", ["angela"]);
  s.act({ type: "endTurn" });
  use(s, p2, "angela", "strike", ["rat"], { resolveNow: true });
  assert.ok(s.logged("angela's Offensive Weapon resolves the Clash right away."));
  assert.equal(s.t("rat").resources.hp, 31, "Slash 9 won and hit");
  assert.equal(s.c().slots.length, 0, "both Pages resolved");
});

test("Offensive Weapon: only its Pages, and only when they start a Clash", () => {
  const jab = page("jab", "melee", [die("slash", 3)]);
  const strike = page("strike", "melee", [die("slash", 3)], { weaponStyle: "offensive" });
  const s = setup({ angela: [jab, strike], ratX: 0 });
  assert.throws(() => use(s, p2, "angela", "jab", ["rat"], { resolveNow: true }), /Only a Page from an Offensive Weapon/);
  assert.throws(() => use(s, p2, "angela", "strike", ["rat"], { resolveNow: true }), /Only a Clash with a Page/);
});

test("Defensive Weapon: it can Clash with an attack on an ally within its range, even when the attacker is out of range", () => {
  const guard = page("guard", "melee", [die("block", 9)], { weaponStyle: "defensive" });
  const s = setup({ angela: [guard], ratX: 10, rat: [page("shot", "ranged", [die("pierce", 3)], { range: 20 })] });
  s.act({ type: "endTurn" }, p2);
  s.act({ type: "endTurn" }, p1);
  use(s, gm, "rat", "shot", ["roland"]); // Aimed at Roland, next to Angela.
  s.act({ type: "endTurn" });
  const angela = s.t("angela");
  assert.deepEqual(guardDice(s.table, angela, guard, "rat"), [0]);
  assert.ok(validTargets(s.table, angela, guard).some((t) => t.id === "rat"), "the Rat is 9 tiles away but its Shot is on Roland");
  assert.ok(!validTargets(s.table, angela, { ...guard, weaponStyle: undefined }).some((t) => t.id === "rat"), "a Page without a Defensive Weapon can't");
  assert.throws(() => use(s, p2, "angela", "guard", ["rat"], { unopposed: true }), /out of range/);
  use(s, p2, "angela", "guard", ["rat"]);
  const shot = s.c().slots.find((x) => x.ownerId === "rat")!;
  assert.ok(shot.clashWith, "the Shot now clashes with the Guard");
  assert.equal(shot.targets[0].tokenId, "angela", "and faces Angela");
});
