// Library of Ruina's passives (tests/ruina-passives.ts) built from the effect builder's pieces, and
// the pieces added for them run in combat. Run with `npm run test:engine`.
// Dice here have 1 side, so they always roll 1 and Final Power = 1 + Base Power.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dice, DiceKind, Page } from "../shared/character.ts";
import { applyAction, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import { cleanEffect, describeEffect, effectLibrary, effectWarnings, PRESET_EFFECTS, type Action, type Check, type EffectDef, type Rule } from "../shared/effects.ts";
import type { Effect, TableAction, TableState, Token } from "../shared/types.ts";
import { EXCLUDED, PASSIVES, STATUSES } from "./ruina-passives.ts";

/** Every passive id on the Tiphereth Database's Passives list (191). */
const SITE_IDS = [10001, 10004, 10005, 10008, 10010, 10011, 10012, 10013, 10112, 180005, 180104, 200004, 200005, 200006, 200007, 200010, 201001, 210001, 210002, 210003, 210006, 211003, 211005, 211007, 220001, 220002, 220003, 220004, 220005, 220006, 220007, 220008, 220009, 220010, 221001, 221005, 221007, 221009, 221010, 221012, 221013, 221014, 230001, 230004, 230005, 230006, 230007, 230008, 230010, 230011, 230012, 230018, 230019, 230020, 230021, 230022, 230023, 230024, 230025, 230026, 230107, 230118, 230121, 230124, 230207, 231001, 232001, 232002, 233001, 234001, 234002, 240001, 240002, 240003, 240004, 240005, 240006, 240010, 240015, 240016, 240018, 240019, 240020, 240021, 240022, 240023, 240024, 240025, 240026, 240027, 240101, 240118, 240127, 240227, 240301, 240308, 240408, 241001, 241002, 241102, 241301, 243001, 243003, 243005, 243101, 243105, 243201, 243205, 250001, 250002, 250003, 250004, 250005, 250006, 250007, 250008, 250009, 250010, 250011, 250012, 250014, 250015, 250016, 250017, 250018, 250020, 250021, 250023, 250024, 250025, 250026, 250027, 250036, 250051, 250106, 250110, 250113, 250114, 250115, 250122, 250123, 250127, 250151, 250210, 250214, 250222, 250223, 250322, 251001, 251002, 251003, 251101, 251102, 251103, 251201, 252001, 252002, 252003, 253001, 253002, 253003, 254001, 254002, 254003, 255001, 255002, 255003, 255004, 256001, 256002, 256003, 260001, 260002, 260003, 260004, 260005, 260006, 260007, 260008, 260009, 260010, 260011, 260012, 260013, 260014, 1005011, 1005012, 1005013, 1005014, 1005015, 1300001];

const LIBRARY = effectLibrary(STATUSES);
/** Warnings that are only reminders, not problems with how the effect is built. */
const reminder = (w: string) => w.startsWith("Emotion Levels only count") || w.includes("Emotion Levels only count");

test("every passive on the list is either built from pieces or listed as character-specific", () => {
  const built = PASSIVES.map((p) => p.id);
  const left = EXCLUDED.map((p) => p.id);
  assert.equal(SITE_IDS.length, 191);
  assert.equal(new Set([...built, ...left]).size, built.length + left.length, "no passive is listed twice");
  assert.deepEqual([...built, ...left].sort((a, b) => a - b), [...SITE_IDS].sort((a, b) => a - b));
});

test("every passive and the statuses it uses are valid effects with no builder warnings", () => {
  for (const [id, def] of Object.entries(STATUSES)) {
    assert.deepEqual(cleanEffect(def), def, `status ${id} survives cleaning unchanged`);
    // Charge, Vibration and the like are counters with no rules of their own.
    const fine = (w: string) => w.startsWith("It never loses stacks") || (def.rules.length === 0 && w.startsWith("It has no rules yet"));
    assert.deepEqual(effectWarnings(def).filter((w) => !fine(w)), [], `status ${id}`);
  }
  for (const p of PASSIVES) {
    assert.deepEqual(cleanEffect(p.def), p.def, `${p.def.name} survives cleaning unchanged`);
    assert.deepEqual(effectWarnings(p.def).filter((w) => !reminder(w)), [], `${p.def.name} has no warnings`);
    for (const r of p.def.rules) {
      for (const id of [r.effectId, ...r.checks.map((c) => c.effectId), ...r.actions.flatMap((a) => [a.effectId, ...(a.effectIds ?? [])])]) {
        if (id) assert.ok(LIBRARY[id], `${p.def.name} uses ${id}, which is in the library`);
      }
    }
    assert.ok(describeEffect(p.def, LIBRARY).length > 10, `${p.def.name} has card text`);
  }
});

// ---- The new pieces at the table ----

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };

let n = 0;
const die = (kind: DiceKind, fp: number, extra: Partial<Dice> = {}): Dice => ({ id: `d${n++}`, kind, counter: false, sides: 1, basePower: fp - 1, ...extra });
const page = (fp: number, extra: Partial<Page> = {}, kind: DiceKind = "slash"): Page => ({ id: "strike", name: "Strike", kind: "basic", cost: 0, type: "melee", dice: [die(kind, fp)], effect: "", ...extra });
const rule = (r: Omit<Rule, "id">): Rule => ({ id: `r${n++}`, ...r });
const passive = (name: string, rules: Omit<Rule, "id">[], extra: Partial<EffectDef> = {}): EffectDef => ({ name, kind: "passive", cost: 1, decay: "none", rules: rules.map(rule), ...extra });
const num = (k: number) => ({ kind: "number" as const, n: k });
const me = { who: "me" as const };
const them = { who: "them" as const };
const status = (defId: string, count: number, extra: Partial<Effect> = {}): Effect => ({ id: `e${n++}`, defId, name: defId, count, description: "", ...extra });

function token(id: string, side: Token["side"], x: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y: 2, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

/** Roland (player, always first) next to a Rat (enemy). Roland's Page hits One-Sided at the start of his next turn. */
function setup(opts: { roland?: Partial<Token>; rat?: Partial<Token>; page?: Page; pages?: Page[]; library?: Record<string, EffectDef>; passives?: string[]; emotion?: boolean; extra?: Token[] } = {}) {
  const pg = opts.page ?? page(5);
  const table: TableState = {
    map: { name: "m", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 2, { ownerId: "p1", justice: 100, ...opts.roland }),
      rat: token("rat", "enemy", 3, { justice: -100, pages: [{ ...page(1), id: "bite", name: "Bite" }], ...opts.rat }),
      ...Object.fromEntries((opts.extra ?? []).map((t) => [t.id, t])),
    },
    log: [],
  };
  const pages = Object.fromEntries([pg, ...(opts.pages ?? [])].map((p) => [p.id, p]));
  const loadout: Loadout = { pages, deck: Array(12).fill(pg.id), aux: [], passiveEffects: opts.passives, stats: { justice: 4 } };
  const library = { ...STATUSES, ...opts.library };
  const ctx: EngineContext = {
    loadout: (id) => (id === "roland" ? loadout : undefined),
    effectDef: (id) => library[id] ?? PRESET_EFFECTS[id],
    emotionLevels: () => !!opts.emotion,
  };
  const act = (a: TableAction, who: Actor = p1) => applyAction(table, a, who, ctx);
  act({ type: "startCombat", tokenIds: ["roland", "rat", ...(opts.extra ?? []).map((t) => t.id)] }, gm);
  const t = (id: string) => table.tokens[id];
  const s = {
    table,
    act,
    t,
    hp: (id: string) => t(id).resources.hp,
    stacks: (id: string, defId: string) => (t(id).effects ?? []).filter((e) => e.defId === defId).reduce((x, e) => x + e.count, 0),
    hand: () => table.combat!.decks.roland.hand,
    attack: (pageId = pg.id) => {
      const card = table.combat!.decks.roland.hand.find((c) => c.pageId === pageId)!;
      act({ type: "aim", source: "hand", cardId: card.id });
      act({ type: "slot", targets: ["rat"] });
    },
    endRound: () => {
      const r = table.combat!.round;
      while (table.combat && table.combat.round === r) act({ type: "endTurn" }, gm);
    },
    hit: (pageId?: string) => {
      s.attack(pageId);
      s.endRound();
    },
  };
  return s;
}

const lib = (defs: Record<string, EffectDef>) => ({ library: defs, passives: Object.keys(defs) });

test("Speed: a passive adds Speed Dice when Speed is rolled, and a GM re-roll keeps them", () => {
  const s = setup(lib({ speed: passive("Speed", [{ when: "speed", checks: [], actions: [{ kind: "speedDice", amount: num(2) }] }]) }));
  const entry = () => s.table.combat!.order.find((x) => x.tokenId === "roland")!;
  assert.equal(entry().dice, 3);
  s.act({ type: "rerollSpeed" }, gm);
  assert.equal(entry().dice, 3);
});

test("Gebura's Prowess: +1 Power per 2 points of Speed over the target, at most 5", () => {
  const s = setup(lib({ prowess: passive("Prowess", [{ when: "roll", checks: [], actions: [{ kind: "addPower", amount: { kind: "speedDiff", per: 2, max: 5 } }] }]) }));
  s.hit();
  // Roland's Speed is ~100 higher than the Rat's: +5, so Final Power 10.
  assert.equal(s.hp("rat"), 20);
});

test("Health-only and Stagger-only damage: Slash damage +2 leaves Stagger alone; Stagger damage +3 leaves Health alone", () => {
  const s = setup(
    lib({
      zwei: passive("Zwei", [{ when: "hit", checks: [{ kind: "die", dieKind: "slash" }], actions: [{ kind: "healthDamage", amount: num(2) }] }]),
      axe: passive("Axe", [{ when: "hit", checks: [], actions: [{ kind: "staggerHit", amount: num(3) }] }]),
    }),
  );
  s.hit();
  assert.equal(s.hp("rat"), 30 - 7);
  assert.equal(s.t("rat").resources.stagger, 20 - 8);
});

test("percent damage: Maximum Crash deals 50% more, and takes 30% less", () => {
  const crash = passive("Crash", [
    { when: "hit", checks: [], actions: [{ kind: "extraDamage", amount: num(50), percent: true }] },
    { when: "takingDamage", checks: [], actions: [{ kind: "reduceDamage", amount: num(30), percent: true }] },
  ]);
  const s = setup({ ...lib({ crash }), page: page(10), roland: { effects: [status("preset:burn", 10)] } });
  s.hit();
  assert.equal(s.hp("rat"), 15, "10 + 50%");
  assert.equal(s.hp("roland"), 23, "Burn 10 at the end of his turn, 30% less: 7");
});

test("someone else is Knocked Out: Half-baked Courage hears an ally fall, not an enemy", () => {
  const courage = passive("Courage", [{ when: "someoneDown", checks: [{ kind: "side", side: "allies" }], actions: [{ kind: "give", target: me, amount: num(1), effectId: "preset:strength", later: true }] }]);
  const ally = token("ally", "ally", 1, { justice: 50, resources: { hp: 1, maxHp: 10, stagger: 5, maxStagger: 5, light: 3, maxLight: 3, sanity: 0, maxSanity: 5 } });
  const s = setup({ ...lib({ courage }), page: page(30), extra: [ally] });
  s.hit();
  assert.equal(s.t("rat").status?.knockedOut, true);
  assert.equal(s.table.tokens.roland.effects?.find((e) => e.defId === "preset:strength")?.pending ?? 0, 0, "an enemy falling does nothing");
});

test("lethal: Guts nullifies a killing blow once a combat and heals", () => {
  const guts = passive("Guts", [{ when: "takingDamage", checks: [{ kind: "lethal" }], actions: [{ kind: "reduceDamage", amount: { kind: "event" } }, { kind: "heal", target: me, amount: num(100) }], limit: "combat" }]);
  const s = setup({ ...lib({ guts }), page: page(40) });
  s.t("rat").passiveEffects = ["guts"];
  s.hit();
  assert.equal(s.t("rat").status?.knockedOut, undefined);
  assert.equal(s.hp("rat"), 30);
});

test("the Page: Overbreathing restores Light only for a Page costing 4 or more, and Carver of Scars only on the first Page of the round", () => {
  const big = page(2, { id: "big", name: "Big", cost: 4 });
  const over = passive("Overbreathing", [{ when: "use", checks: [{ kind: "page", pageIs: "cost", cmp: "atLeast", n: 4 }], actions: [{ kind: "gainLight", target: me, amount: num(2) }] }]);
  const s = setup({ ...lib({ over }), page: big });
  s.t("roland").resources.light = 5;
  s.attack("big");
  assert.equal(s.t("roland").resources.light, 3, "paid 4, got 2 back");
  const carver = passive("Carver", [{ when: "hit", checks: [{ kind: "page", pageIs: "first" }], actions: [{ kind: "give", target: them, amount: num(2), effectId: "preset:bleed" }] }]);
  const s2 = setup({ ...lib({ carver }) });
  s2.hit();
  assert.equal(s2.stacks("rat", "preset:bleed"), 2);
});

test("hand and Pages used: Restfulness restores Light only in a round with no Page used; Incomplete Arbiter draws up to 4", () => {
  const rest = passive("Restfulness", [{ when: "roundEnd", checks: [{ kind: "used", cmp: "atMost", n: 0 }], actions: [{ kind: "gainLight", target: me, amount: num(1) }] }]);
  const arbiter = passive("Arbiter", [{ when: "roundStart", checks: [], actions: [{ kind: "drawTo", amount: num(4) }] }]);
  const s = setup(lib({ rest, arbiter }));
  s.t("roland").resources.light = 0;
  s.endRound();
  // Upkeep +1 Light, then Restfulness +1.
  assert.equal(s.t("roland").resources.light, 2);
  assert.ok(s.hand().length >= 4);
  s.attack();
  const light = s.t("roland").resources.light;
  s.endRound();
  assert.equal(s.t("roland").resources.light, Math.min(5, light + 1), "used a Page: Upkeep only");
});

test("discard, add a Page and cost down: Best Choice heals on discard; Life Insurance adds its own Page; Easygoing makes one cheaper", () => {
  const insurance = page(1, { id: "ins", name: "Life Insurance", cost: 2 });
  const pg = page(3, { cost: 2 });
  const lib1 = {
    best: passive("Best Choice", [{ when: "discard", checks: [], actions: [{ kind: "heal", target: me, amount: num(3) }] }]),
    tosser: passive("Tosser", [{ when: "roundStart", checks: [], actions: [{ kind: "discard", target: me, amount: num(1) }, { kind: "addPage", amount: num(1), text: "life insurance" }, { kind: "costDown", amount: num(5) }] }]),
  };
  const s = setup({ ...lib(lib1), page: pg, pages: [insurance], roland: { resources: { hp: 10, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 } } });
  // Round 1 started with combat (10 → 13); round 2 starts now (→ 16).
  assert.equal(s.hp("roland"), 13);
  const handBefore = s.hand().length;
  s.endRound();
  assert.equal(s.hp("roland"), 16);
  assert.ok(s.hand().some((c) => c.pageId === "ins"));
  assert.ok(s.hand().length >= handBefore);
  const cheap = s.hand().find((c) => c.discount)!;
  assert.ok(cheap, "one card costs less this round");
  s.t("roland").resources.light = 0;
  s.act({ type: "aim", source: "hand", cardId: cheap.id });
  s.act({ type: "slot", targets: ["rat"] });
  assert.equal(s.t("roland").resources.light, 0, "it cost 0 this round");
});

test("Counter Die from a passive answers a One-Sided attack", () => {
  const deflect = passive("Deflect", [{ when: "turnEnd", checks: [], actions: [{ kind: "counterDie", target: me, amount: num(1), dieKind: "block", base: 49 }] }]);
  const s = setup(lib({ deflect }));
  s.act({ type: "endTurn" }, gm);
  assert.equal(s.table.combat!.counters.roland?.[0]?.die.kind, "block");
  // The Rat attacks Roland One-Sided: the Block (Final Power 50) answers and staggers it instead.
  const bite = s.table.combat!.decks.rat?.hand[0];
  if (bite) {
    s.act({ type: "aim", source: "hand", cardId: bite.id }, gm);
    s.act({ type: "slot", targets: ["roland"] }, gm);
  }
  s.act({ type: "endTurn" }, gm);
  s.act({ type: "endTurn" }, gm);
  assert.equal(s.hp("roland"), 30, "the Bite never landed");
});

test("Change a Resistance: Seeing Through Weaknesses makes the type Fatal for the rest of combat", () => {
  const see = passive("See", [{ when: "hit", checks: [], actions: [{ kind: "resist", target: them, amount: num(1), dmgType: "die", level: 200, which: "health", until: "combat" }] }]);
  const s = setup({ ...lib({ see }), page: page(5) });
  s.hit();
  assert.equal(s.hp("rat"), 20, "Fatal from the moment the die hits: 5 × 2");
  s.hit();
  assert.equal(s.hp("rat"), 10, "and it stays Fatal");
  assert.equal(s.t("rat").resources.stagger, 10, "Stagger Resistance unchanged");
});

test("random targets and random Effects: Bzzz Bzzz paralyzes enemies; Grace of the Prescript gives one of its three", () => {
  const rats = [1, 2, 3].map((i) => token(`rat${i}`, "enemy", 5 + i, { justice: -50 }));
  const bzzz = passive("Bzzz", [{ when: "combatStart", checks: [], actions: [{ kind: "give", target: { who: "randomEnemies", count: 3 }, amount: num(1), effectId: "paralysis" }] }]);
  const grace = passive("Grace", [{ when: "roundStart", checks: [], actions: [{ kind: "giveRandom", target: me, amount: num(1), effectIds: ["prescriptSlash", "prescriptPierce", "prescriptBlunt"] }] }]);
  const s = setup({ ...lib({ bzzz, grace }), extra: rats });
  const paralyzed = ["rat", "rat1", "rat2", "rat3"].filter((id) => s.stacks(id, "paralysis") === 1);
  assert.equal(paralyzed.length, 3);
  assert.equal(["prescriptSlash", "prescriptPierce", "prescriptBlunt"].filter((id) => s.stacks("roland", id) === 1).length, 1);
});

test("every Nth time and skip the rest: Threefold Tenacity powers every third Offensive die; Madness gives exactly one", () => {
  const tenacity = passive("Tenacity", [{ when: "roll", checks: [{ kind: "die", dieKind: "offensive" }], actions: [{ kind: "addPower", amount: num(10) }], every: 3 }]);
  const s = setup({ ...lib({ tenacity }), page: page(1) });
  s.hit();
  s.hit();
  assert.equal(s.hp("rat"), 28);
  s.hit();
  assert.equal(s.hp("rat"), 28 - 11);
  const madness = passive("Madness", [
    { when: "roundStart", checks: [{ kind: "roll", sides: 4, cmp: "atMost", amount: num(1) }], actions: [{ kind: "give", target: me, amount: num(2), effectId: "preset:strength" }], stop: true },
    { when: "roundStart", checks: [{ kind: "roll", sides: 3, cmp: "atMost", amount: num(1) }], actions: [{ kind: "give", target: me, amount: num(2), effectId: "haste" }], stop: true },
    { when: "roundStart", checks: [{ kind: "roll", sides: 2, cmp: "atMost", amount: num(1) }], actions: [{ kind: "give", target: me, amount: num(2), effectId: "preset:endurance" }], stop: true },
    { when: "roundStart", checks: [], actions: [{ kind: "give", target: me, amount: num(5), effectId: "fragile" }] },
  ]);
  for (let i = 0; i < 10; i++) {
    const m = setup(lib({ madness }));
    const got = ["preset:strength", "haste", "preset:endurance", "fragile"].filter((id) => m.stacks("roland", id) > 0);
    assert.equal(got.length, 1, `exactly one of the four (${got.join(", ")})`);
  }
});

test("die rolls: The Twelve Fixers raises the Min; Manipulator of Odds rerolls the Min; The Strongest rolls Speed at its Max", () => {
  const fixers = passive("Fixers", [{ when: "roll", checks: [], actions: [{ kind: "raiseMin", amount: num(5) }] }]);
  const s = setup({ ...lib({ fixers }), page: { ...page(1), dice: [die("slash", 1, { sides: 6, basePower: 0 })] } });
  s.hit();
  assert.equal(s.hp("rat"), 24, "a d6 with Min +5 always rolls 6");
  const strongest = passive("Strongest", [{ when: "speed", checks: [], actions: [{ kind: "rollMax", amount: num(1) }] }]);
  const s2 = setup({ ...lib({ strongest }), roland: { justice: 0 } });
  assert.equal(s2.table.combat!.order.find((x) => x.tokenId === "roland")!.roll, 6);
});

test("Emotion Levels (Game setting): off by default nobody gains Emotion; on, clashes and hits build it and 'When my Emotion Level rises' fires", () => {
  const off = setup({ page: page(1) });
  off.hit();
  off.hit();
  assert.equal(off.t("roland").emotion, undefined);
  const rises = passive("Rises", [{ when: "emotionUp", checks: [], actions: [{ kind: "heal", target: me, amount: num(5) }] }]);
  const s = setup({ ...lib({ rises }), page: { ...page(1), dice: [die("slash", 1), die("slash", 1), die("slash", 1)] }, emotion: true, roland: { resources: { hp: 10, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 } } });
  assert.deepEqual(s.t("roland").emotion, { level: 0, points: 0 });
  s.attack();
  s.endRound(); // 3 hits land at the start of Roland's turn: 3 points, then Emotion Level 1 at the round's end.
  s.endRound();
  assert.equal(s.t("roland").emotion!.level, 1);
  assert.equal(s.hp("roland"), 15);
  const check = passive("Fervor", [{ when: "roll", checks: [{ kind: "emotion", cmp: "atLeast", n: 1 }], actions: [{ kind: "addPower", amount: num(1) }] }]);
  assert.equal(describeEffect(check), "When I roll a die, if my Emotion Level is at least 1, the die gets +1 Power.");
  s.act({ type: "endCombat" }, gm);
  assert.equal(s.t("roland").emotion, undefined);
});

test("Triple-R Suit: a passive lets its owner hold more of an Effect", () => {
  const suit = passive("Triple-R", [], { cap: { effectId: "charge", max: 20 } });
  const gain = passive("Gain", [{ when: "combatStart", checks: [], actions: [{ kind: "give", target: me, amount: num(15), effectId: "charge" }] }]);
  const s = setup(lib({ suit, gain }));
  assert.equal(s.stacks("roland", "charge"), 15);
  const s2 = setup(lib({ gain }));
  assert.equal(s2.stacks("roland", "charge"), 10, "without it, Charge stops at 10");
});

test("When I lose an Effect: Force Field gives Protection after spending Charge", () => {
  const spend = passive("Spend", [{ when: "use", checks: [], actions: [{ kind: "take", target: me, amount: num(3), effectId: "charge" }] }]);
  const field = passive("Force Field", [{ when: "lost", effectId: "charge", checks: [], actions: [{ kind: "give", target: me, amount: num(1), effectId: "protection", later: true }], limit: "round" }]);
  const s = setup({ ...lib({ spend, field }), roland: { effects: [status("charge", 5)] } });
  s.attack();
  assert.equal(s.stacks("roland", "charge"), 2);
  assert.equal(s.t("roland").effects?.find((e) => e.defId === "protection")?.pending, 1);
});

test("new pieces are cleaned like the old ones: unknown values fall back, numbers are clamped", () => {
  const dirty = cleanEffect({
    name: "x",
    kind: "passive",
    rules: [
      {
        when: "emotionUp",
        every: 500,
        stop: "yes",
        limit: "roundTarget",
        checks: [{ kind: "page", pageIs: "nope" }, { kind: "resist", n: 333 }, { kind: "emotion", n: 9 }],
        actions: [
          { kind: "resist", level: 7, dmgType: "fire", until: "forever", which: "x" },
          { kind: "counterDie", dieKind: "laser", base: 100, amount: { kind: "number", n: 6 } },
          { kind: "giveRandom", effectIds: ["a", "b", "c", "d", "e", "f", "g"] },
          { kind: "extraDamage", percent: true, amount: { kind: "maxHealth", n: 900 } },
        ],
      },
    ],
  });
  const r = dirty.rules[0];
  assert.equal(r.every, 20);
  assert.equal(r.stop, undefined);
  assert.equal(r.limit, "roundTarget");
  assert.deepEqual(r.checks, [{ kind: "page", pageIs: "melee" }, { kind: "resist", whose: "them", cmp: "atLeast", n: 150 }, { kind: "emotion", cmp: "atLeast", n: 5 }]);
  const [resist, counter, random, extra] = r.actions as Action[];
  assert.deepEqual([resist.level, resist.dmgType, resist.until, resist.which], [100, "die", "round", "both"]);
  assert.deepEqual([counter.dieKind, counter.base], ["block", 20]);
  assert.equal(random.effectIds!.length, 6);
  assert.deepEqual(extra.amount, { kind: "maxHealth", n: 100 });
  assert.equal(extra.percent, true);
  void ({} as Check);
});
