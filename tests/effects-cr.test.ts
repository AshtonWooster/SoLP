// The effect pieces added for the CR 3.2 effect list (shared/effects.ts): each test builds one of
// the sheet's effects from menu pieces and runs it in combat. Run with `npm run test:engine`.
// Dice here have 1 side, so they always roll 1 and Final Power = 1 + Base Power.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dice, DiceKind, Page } from "../shared/character.ts";
import { applyAction, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import { cleanEffect, describeEffect, effectWarnings, type Action, type Check, type EffectDef, type Rule } from "../shared/effects.ts";
import type { Effect, TableAction, TableState, Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };

let n = 0;
const die = (kind: DiceKind, fp: number, effectIds?: string[]): Dice => ({ id: `d${n++}`, kind, counter: false, sides: 1, basePower: fp - 1, ...(effectIds ? { effectIds } : {}) });
const page = (fp: number, effectIds?: string[], kind: DiceKind = "slash"): Page => ({ id: "strike", name: "Strike", kind: "basic", cost: 0, type: "melee", dice: [die(kind, fp, effectIds)], effect: "" });
const status = (defId: string, count: number, extra: Partial<Effect> = {}): Effect => ({ id: `e${n++}`, defId, name: defId, count, description: "", ...extra });
const rule = (r: Omit<Rule, "id">): Rule => ({ id: `r${n++}`, ...r });
const def = (name: string, kind: EffectDef["kind"], rules: Omit<Rule, "id">[], extra: Partial<EffectDef> = {}): EffectDef => ({ name, kind, decay: "none", rules: rules.map(rule), ...extra });
const num = (k: number) => ({ kind: "number" as const, n: k });
const me = { who: "me" as const };
const them = { who: "them" as const };

function token(id: string, side: Token["side"], x: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y: 2, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

/** Roland (player, always first) next to a Rat (enemy). Roland's Page hits One-Sided at the start of his next turn. */
function setup(opts: { roland?: Partial<Token>; rat?: Partial<Token>; page?: Page; library?: Record<string, EffectDef>; passives?: string[]; clearAfterCombat?: boolean; extra?: Token[] } = {}) {
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
  const loadout: Loadout = { pages: { [pg.id]: pg }, deck: Array(12).fill(pg.id), aux: [], passiveEffects: opts.passives, stats: { justice: 4 } };
  const ctx: EngineContext = {
    loadout: (id) => (id === "roland" ? loadout : undefined),
    effectDef: (id) => opts.library?.[id],
    clearEffectsAfterCombat: () => !!opts.clearAfterCombat,
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
    entry: (id: string, defId: string) => t(id).effects?.find((e) => e.defId === defId),
    attack: () => {
      const card = table.combat!.decks.roland.hand.find((c) => c.pageId === pg.id)!;
      act({ type: "aim", source: "hand", cardId: card.id });
      act({ type: "slot", targets: ["rat"] });
    },
    endTurn: (who: Actor = gm) => act({ type: "endTurn" }, who),
    /** Ends turns until the round goes up by one. */
    endRound: () => {
      const r = table.combat!.round;
      while (table.combat && table.combat.round === r) act({ type: "endTurn" }, gm);
    },
    /** Roland attacks; the Page lands at the start of his next turn. */
    hit: () => {
      s.attack();
      s.endRound();
    },
  };
  return s;
}

test("round timing: a CR Burn ticks once a round, at the round's end, then halves", () => {
  const burn = def("Burn (CR)", "status", [{ when: "roundEnd", checks: [], actions: [{ kind: "damage", target: me, amount: { kind: "perStack", n: 1 } }] }], { decay: "halfAtRoundEnd" });
  const s = setup({ roland: { effects: [status("burn", 5)] }, library: { burn } });
  s.endTurn(p1);
  assert.equal(s.hp("roland"), 30, "not at the end of Roland's turn");
  s.endTurn(); // The Rat's turn ends: the round ends.
  assert.equal(s.hp("roland"), 25);
  assert.equal(s.stacks("roland", "burn"), 2);
  assert.equal(s.table.combat!.round, 2);
});

test("next round: Fragile given now arrives at the start of the next round, then wears off at its end", () => {
  const fragile = def("Fragile", "status", [{ when: "takingDamage", checks: [{ kind: "damage", damageType: "health", source: "attack" }], actions: [{ kind: "increaseDamage", amount: { kind: "perStack", n: 1 } }] }], { decay: "allAtRoundEnd" });
  const inflict = def("Inflict Fragile", "die", [{ when: "hit", checks: [], actions: [{ kind: "give", target: them, amount: num(2), effectId: "fragile", later: true }] }]);
  const s = setup({ page: page(5, ["inflict"]), library: { fragile, inflict } });
  s.attack();
  s.endTurn(p1);
  s.endTurn(); // Round 2 starts; Roland's Page lands at the start of his turn.
  assert.equal(s.hp("rat"), 25, "the first hit isn't Fragile yet");
  assert.equal(s.entry("rat", "fragile")?.pending, 2);
  assert.equal(s.stacks("rat", "fragile"), 0);
  s.attack();
  s.endTurn(p1);
  s.endTurn(); // Round 3: the Fragile from round 2 arrives, then the hit lands.
  assert.equal(s.hp("rat"), 25 - 5 - 2);
  s.endRound();
  assert.equal(s.stacks("rat", "fragile"), 2, "the second hit's Fragile arrived for round 4");
});

test("Protection takes damage off attacks after Resistances; a Resistance to Burn only lowers Burn's damage", () => {
  const protection = def("Protection", "status", [{ when: "takingDamage", checks: [{ kind: "damage", damageType: "health", source: "attack" }], actions: [{ kind: "reduceDamage", amount: { kind: "perStack", n: 1 } }] }]);
  const burnRes = def("Burn Resistance", "passive", [{ when: "takingDamage", checks: [{ kind: "damage", damageType: "health", source: "effect", effectId: "preset:burn" }], actions: [{ kind: "reduceDamage", amount: num(2) }] }]);
  const s = setup({ rat: { effects: [status("protection", 3), status("preset:burn", 5)], resistances: { slash: 2, pierce: 1, blunt: 1 }, passiveEffects: ["burnRes"] }, library: { protection, burnRes } });
  s.endTurn(p1);
  s.endTurn(); // The Rat's Burn ticks: 5 − 2.
  assert.equal(s.hp("rat"), 27);
  s.attack();
  s.endTurn(p1);
  s.act({ type: "setEffects", tokenId: "rat", effects: [status("protection", 3)] }, gm);
  s.endTurn(); // 5 Power × 2 Resistance − 3 Protection.
  assert.equal(s.hp("rat"), 27 - 7);
});

test("[Type] Protection works before Resistances and only against that die type", () => {
  const slashProt = def("Slash Protection", "status", [{ when: "takingHit", checks: [{ kind: "die", dieKind: "slash" }], actions: [{ kind: "reduceDamage", amount: { kind: "perStack", n: 1 } }] }]);
  const s = setup({ rat: { resistances: { slash: 2, pierce: 1, blunt: 1 } }, library: { slashProt } });
  s.attack();
  s.endTurn(p1);
  s.act({ type: "setEffects", tokenId: "rat", effects: [status("slashProt", 2)] }, gm);
  s.endTurn();
  assert.equal(s.hp("rat"), 30 - (5 - 2) * 2);
  assert.equal(s.t("rat").resources.stagger, 20 - (5 - 2), "Stagger damage is lowered too (Stagger Resistance 1)");
});

test("Temporary Health blocks damage with its stacks and loses one per point blocked", () => {
  const temp = def("Temp HP", "status", [{ when: "takingDamage", checks: [{ kind: "damage", damageType: "health", source: "any" }], actions: [{ kind: "shield", amount: { kind: "perStack", n: 1 } }] }]);
  const s = setup({ library: { temp } });
  s.attack();
  s.endTurn(p1);
  s.act({ type: "setEffects", tokenId: "rat", effects: [status("temp", 3)] }, gm);
  s.endTurn();
  assert.equal(s.hp("rat"), 28);
  assert.equal(s.stacks("rat", "temp"), 0);
});

test("Bursts: setting off their Rupture with this die inflicts Bleed and Fragile from the burst stacks", () => {
  const rupture = def("Rupture (CR)", "status", [{ when: "wasHit", checks: [], actions: [{ kind: "damage", target: me, amount: { kind: "perStack", n: 1 } }] }], { decay: "allAfterTrigger" });
  const wounds = def("Rupture Wounds", "die", [{ when: "effectFiresOnThem", effectId: "rupture", checks: [], actions: [{ kind: "give", target: them, amount: num(4), effectId: "preset:bleed" }] }]);
  const jag = def("Rupture Jag", "die", [{ when: "effectFiresOnThem", effectId: "rupture", checks: [], actions: [{ kind: "give", target: them, amount: { kind: "event", per: 3 }, effectId: "frag", later: true }] }]);
  const frag = def("Fragile", "status", [], { decay: "allAtRoundEnd" });
  const s = setup({ page: page(5, ["wounds", "jag"]), rat: { effects: [status("rupture", 7)] }, library: { rupture, wounds, jag, frag } });
  s.hit();
  assert.equal(s.hp("rat"), 30 - 5 - 7);
  assert.equal(s.stacks("rat", "rupture"), 0);
  assert.equal(s.stacks("rat", "preset:bleed"), 4);
  assert.equal(s.entry("rat", "frag")?.pending, 2, "a third of 7, rounded down, next round");
});

test("Critical Hits: Poise rolls, the Critical deals 1d10 per Critical and clears; On Critical Hit gives Haste", () => {
  const critical = def("Critical", "status", []);
  const poise = def("Poise (CR)", "status", [
    {
      when: "hit",
      checks: [{ kind: "roll", sides: 1, cmp: "atMost", amount: { kind: "perStack", n: 1 } }],
      actions: [
        { kind: "extraDamage", amount: { kind: "rolls", sides: 1, effectId: "critical", whose: "me" } },
        { kind: "clear", target: me, amount: num(0), effectId: "critical" },
        { kind: "loseStacks", amount: { kind: "perStack", n: 1 } },
      ],
    },
  ]);
  const hasteCrit = def("Haste Crit", "die", [{ when: "effectFires", effectId: "poise", checks: [], actions: [{ kind: "give", target: me, amount: num(2), effectId: "haste", later: true }] }]);
  const haste = def("Haste", "status", [{ when: "turnStart", checks: [], actions: [{ kind: "gainMovement", target: me, amount: { kind: "perStack", n: 1 } }] }], { decay: "allAtRoundEnd" });
  const s = setup({ page: page(5, ["hasteCrit"]), roland: { effects: [status("poise", 3), status("critical", 4)] }, library: { critical, poise, hasteCrit, haste } });
  s.attack();
  s.endTurn(p1);
  s.endTurn(); // Round 2: Roland's Page lands (1d1 × 4 Critical = +4), then his turn starts.
  assert.equal(s.hp("rat"), 30 - 5 - 4);
  assert.equal(s.stacks("roland", "critical"), 0);
  assert.equal(s.stacks("roland", "poise"), 0);
  assert.equal(s.entry("roland", "haste")?.pending, 2, "On Critical Hit: Haste next round");
  s.endRound();
  const base = s.table.combat!.movementLeft;
  assert.equal(s.stacks("roland", "haste"), 2);
  assert.ok(base >= 2 && s.table.log.some((l) => l.includes("roland gains 2 Movement")), "Haste adds Movement at the start of the turn");
});

test("When I gain an Effect: gaining Critical with no Poise gives 1 Poise", () => {
  const poise = def("Poise", "status", []);
  const critical = def("Critical", "status", [{ when: "gained", effectId: "critical", checks: [{ kind: "effect", effectId: "poise", cmp: "atMost", n: 0 }], actions: [{ kind: "give", target: me, amount: num(1), effectId: "poise" }] }]);
  const gainCrit = def("Increase Critical", "die", [{ when: "hit", checks: [], actions: [{ kind: "give", target: me, amount: num(2), effectId: "critical" }] }]);
  const s = setup({ page: page(5, ["gainCrit"]), library: { poise, critical, gainCrit } });
  s.hit();
  assert.equal(s.stacks("roland", "critical"), 2);
  assert.equal(s.stacks("roland", "poise"), 1);
});

test("Burn+: when I give Burn, they gain 1 more, once (it can't feed itself)", () => {
  const inflict = def("Inflict Burn", "die", [{ when: "hit", checks: [], actions: [{ kind: "give", target: them, amount: num(2), effectId: "preset:burn" }] }]);
  const plus = def("Burn+", "die", [{ when: "gave", effectId: "preset:burn", checks: [], actions: [{ kind: "give", target: them, amount: num(1), effectId: "preset:burn" }] }]);
  const s = setup({ page: page(5, ["inflict", "plus"]), library: { inflict, plus } });
  s.hit();
  assert.equal(s.stacks("rat", "preset:burn"), 3);
});

test("Bonus and Vigor: Power from the target's stacks, and 1 per 3 of mine up to 3", () => {
  const bonus = def("Burn Bonus", "passive", [{ when: "roll", checks: [{ kind: "effect", whose: "them", effectId: "preset:burn", cmp: "atLeast", n: 2 }], actions: [{ kind: "addPower", amount: num(1) }] }]);
  const vigor = def("Burn Vigor", "passive", [{ when: "roll", checks: [{ kind: "die", dieKind: "offensive" }], actions: [{ kind: "addPower", amount: { kind: "effectStacks", effectId: "preset:burn", whose: "me", per: 3, max: 3 } }] }]);
  const s = setup({ roland: { effects: [status("preset:burn", 13)] }, rat: { effects: [status("preset:burn", 2)] }, library: { bonus, vigor }, passives: ["bonus", "vigor"] });
  s.attack();
  s.endTurn(p1); // Roland's Burn: 13 → 6.
  s.endTurn(); // The Rat's Burn: 2 → 1, so no Bonus.
  assert.equal(s.hp("rat"), 30 - 2 - (5 + 2));
  const s2 = setup({ roland: { effects: [status("preset:burn", 21)] }, rat: { effects: [status("preset:burn", 9)] }, library: { bonus, vigor }, passives: ["bonus", "vigor"] });
  s2.attack();
  s2.endTurn(p1); // 21 → 10 Burn: 1 Power per 3, so 3.
  s2.endTurn(); // Rat: 9 → 4 Burn, still Bonus.
  assert.equal(s2.hp("rat"), 30 - 9 - (5 + 3 + 1));
  const s3 = setup({ roland: { effects: [status("preset:burn", 27)] }, library: { vigor }, passives: ["vigor"] });
  s3.attack();
  s3.endTurn(p1); // 27 → 13 Burn: 4, but at most 3.
  s3.endTurn();
  assert.equal(s3.hp("rat"), 30 - (5 + 3));
});

test("Activate Strength: at the start of the round, 1 Strength per 25% of Health lost, at most 3", () => {
  const activate = def("Activate Strength", "passive", [{ when: "roundStart", checks: [], actions: [{ kind: "give", target: me, amount: { kind: "healthLost", per: 25, max: 3 }, effectId: "preset:strength" }] }]);
  const s = setup({ roland: { resources: { hp: 14, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 } }, library: { activate }, passives: ["activate"] });
  assert.equal(s.stacks("roland", "preset:strength"), 2, "53% lost at the start of round 1");
});

test("Enemy Power Down lowers the other side's die; disadvantage keeps the lower roll; Dice Max Up raises the Max", () => {
  const powerDown = def("Enemy Power Down", "passive", [{ when: "theyRoll", checks: [], actions: [{ kind: "lowerPower", amount: num(2) }] }]);
  const s = setup({ rat: { passiveEffects: ["powerDown"] }, library: { powerDown } });
  s.hit();
  assert.equal(s.hp("rat"), 30 - 3);
  const paralysis = def("Paralysis", "status", [{ when: "roll", checks: [], actions: [{ kind: "disadvantage", amount: num(0) }] }], { decay: "oneAfterTrigger" });
  const s2 = setup({ roland: { effects: [status("paralysis", 2)] }, library: { paralysis } });
  s2.hit();
  assert.ok(s2.table.log.some((l) => l.includes("roland rolls with disadvantage")));
  assert.equal(s2.stacks("roland", "paralysis"), 1);
  const maxUp = def("Dice Max Up", "die", [{ when: "roll", checks: [], actions: [{ kind: "raiseMax", amount: num(1) }] }]);
  const s3 = setup({ page: page(5, ["maxUp"]), library: { maxUp } });
  s3.hit();
  const dealt = 30 - s3.hp("rat");
  assert.ok(dealt === 5 || dealt === 6, "a 1-sided die rolls 1d2 with +1 Max");
});

test("Indomitable: the first time I'm Staggered each combat, I recover all Stagger", () => {
  const indomitable = def("Indomitable", "passive", [{ when: "staggered", limit: "combat", checks: [], actions: [{ kind: "recoverStagger", target: me, amount: num(99) }] }]);
  const s = setup({ page: page(25), rat: { passiveEffects: ["indomitable"] }, library: { indomitable } });
  s.hit();
  assert.equal(s.t("rat").resources.stagger, 20);
  assert.ok(!s.t("rat").status?.staggered);
  s.hit();
  assert.ok(s.t("rat").status?.staggered || s.t("rat").status?.knockedOut, "only once a combat");
});

test("Bloodthirst: when I Knock Someone Out, Strength next round; the first round gives Power", () => {
  const bloodthirst = def("Bloodthirst", "passive", [
    { when: "knockOut", checks: [], actions: [{ kind: "give", target: me, amount: num(2), effectId: "preset:strength", later: true }] },
    { when: "roll", checks: [{ kind: "round", cmp: "atMost", n: 1 }], actions: [{ kind: "addPower", amount: num(2) }] },
  ]);
  const s = setup({ page: page(30), library: { bloodthirst }, passives: ["bloodthirst"] });
  s.hit();
  assert.ok(s.t("rat").status?.knockedOut);
  assert.equal(s.entry("roland", "preset:strength")?.pending, 2);
});

test("Detonate sets off their Burn now and halves it; Renewed Blaze keeps it from halving", () => {
  const detonate = def("Detonate", "die", [{ when: "hit", checks: [], actions: [{ kind: "activate", target: them, amount: num(0), effectId: "preset:burn" }] }]);
  const s = setup({ page: page(5, ["detonate"]), rat: { effects: [status("preset:burn", 6)] }, library: { detonate } });
  s.attack();
  s.endTurn(p1);
  s.endTurn(); // The Rat's Burn ticks (6 → 3); then Roland's Page lands and sets off the 3 left.
  assert.equal(s.hp("rat"), 30 - 6 - 5 - 3);
  assert.equal(s.stacks("rat", "preset:burn"), 1);

  const blaze = def("Renewed Blaze", "status", [], { decay: "allAtRoundEnd", holds: "preset:burn" });
  const s2 = setup({ roland: { effects: [status("preset:burn", 6), status("blaze", 1)] }, library: { blaze } });
  s2.endTurn(p1);
  assert.equal(s2.hp("roland"), 24);
  assert.equal(s2.stacks("roland", "preset:burn"), 6, "Burn doesn't halve while Renewed Blaze is on");
  s2.endTurn(); // Round ends: Renewed Blaze wears off.
  s2.endTurn(p1);
  assert.equal(s2.stacks("roland", "preset:burn"), 3);
});

test("forced movement: Shove pushes them back until the map's edge", () => {
  const shove = def("Shove", "die", [{ when: "clashWin", checks: [], actions: [{ kind: "push", target: them, amount: num(2) }] }]);
  const pull = def("Loaded Magnet", "die", [{ when: "hit", checks: [], actions: [{ kind: "pull", target: them, amount: num(5) }] }]);
  const s = setup({ page: { ...page(5, ["pull"]), type: "ranged" }, rat: { x: 6 }, library: { shove, pull } });
  s.hit();
  assert.equal(s.t("rat").x, 3, "pulled until next to Roland");
  const s2 = setup({ page: page(5, ["shove"]), library: { shove } });
  s2.endTurn(p1);
  const bite = s2.table.combat!.decks.rat.hand.find((c) => c.pageId === "bite")!;
  s2.act({ type: "aim", source: "hand", cardId: bite.id }, gm);
  s2.act({ type: "slot", targets: ["roland"] }, gm);
  s2.endTurn();
  s2.attack(); // Clash: Roland's die wins and shoves.
  s2.endTurn(p1);
  assert.equal(s2.t("rat").x, 5);
});

test("Speed, On Use and Movement: Comfy Clothes, Gain Charge, Bind", () => {
  const comfy = def("Comfy Clothes", "passive", [{ when: "speed", checks: [], actions: [{ kind: "addPower", amount: num(3) }] }]);
  const charge = def("Charge", "status", []);
  const gain = def("Gain Charge", "die", [{ when: "use", checks: [], actions: [{ kind: "give", target: me, amount: num(2), effectId: "charge" }] }]);
  const bind = def("Bind", "status", [{ when: "turnStart", checks: [], actions: [{ kind: "loseMovement", target: me, amount: { kind: "perStack", n: 1 } }] }], { decay: "allAtRoundEnd" });
  const s = setup({ page: page(5, ["gain"]), roland: { effects: [status("bind", 2)] }, library: { comfy, charge, gain, bind }, passives: ["comfy"] });
  const roland = s.table.combat!.order.find((x) => x.tokenId === "roland")!;
  assert.equal(roland.bonus, 103);
  assert.ok(s.table.log.some((l) => l.includes("roland loses 2 Movement")));
  s.attack();
  assert.equal(s.stacks("roland", "charge"), 2, "On Use, when the Page is slotted");
});

test("Marks: each character's stacks are kept apart, and 'from me' only counts mine", () => {
  const marked = def("Marked", "status", [], { bySource: true });
  const mark = def("Branding Strike", "die", [{ when: "hit", checks: [], actions: [{ kind: "give", target: them, amount: num(1), effectId: "marked" }] }]);
  const assassination = def("Target for Assassination", "passive", [{ when: "hit", checks: [{ kind: "effect", whose: "them", effectId: "marked", cmp: "atLeast", n: 1, mine: true }], actions: [{ kind: "extraDamage", amount: num(3) }] }]);
  const s = setup({ page: page(5, ["mark"]), rat: { effects: [status("marked", 1, { sourceId: "someone-else" })] }, library: { marked, mark, assassination }, passives: ["assassination"] });
  s.hit();
  assert.equal(s.hp("rat"), 25, "the other character's Mark doesn't count");
  assert.equal(s.t("rat").effects!.filter((e) => e.defId === "marked").length, 2);
  s.hit();
  assert.equal(s.hp("rat"), 25 - 5 - 3);
});

test("Lone Fighter counts allies nearby; Remembrance counts Knocked Out allies", () => {
  const lone = def("Lone Fighter", "passive", [{ when: "roll", checks: [{ kind: "count", side: "allies", cmp: "atMost", n: 0, range: 2 }], actions: [{ kind: "addPower", amount: num(2) }] }]);
  const ally = token("ally", "ally", 2, { y: 3, justice: -50 });
  const s = setup({ library: { lone }, passives: ["lone"], extra: [ally] });
  s.hit();
  assert.equal(s.hp("rat"), 25, "an ally within 2 tiles");
  const remembrance = def("Remembrance", "passive", [{ when: "roundEnd", checks: [{ kind: "count", side: "allies", down: true, cmp: "atLeast", n: 1 }], actions: [{ kind: "give", target: me, amount: num(2), effectId: "preset:strength", later: true }] }]);
  const fallen = token("fallen", "ally", 9, { justice: -50, status: { knockedOut: true }, resources: { hp: 0, maxHp: 30, stagger: 20, maxStagger: 20, light: 0, maxLight: 3, sanity: 0, maxSanity: 15 } });
  const s2 = setup({ library: { remembrance }, passives: ["remembrance"], extra: [fallen] });
  s2.endRound();
  assert.equal(s2.stacks("roland", "preset:strength"), 2);
});

test("Game setting off (the default): automated Effects stay when combat ends; 'When combat ends' rules still run", () => {
  const storage = def("Regeneration Storage", "passive", [{ when: "combatEnd", checks: [], actions: [{ kind: "heal", target: me, amount: num(5) }] }]);
  const s = setup({ roland: { effects: [status("preset:poise", 3), { id: "note", name: "Cursed", count: 1, description: "by hand" }], resources: { hp: 10, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 } }, library: { storage }, passives: ["storage"] });
  s.act({ type: "endCombat" }, gm);
  assert.equal(s.table.combat, undefined);
  assert.equal(s.stacks("roland", "preset:poise"), 3);
  assert.equal(s.hp("roland"), 15);
});

test("Game setting on: automated Effects wear off when combat ends; hand-tracked ones stay", () => {
  const s = setup({ clearAfterCombat: true, roland: { effects: [status("preset:poise", 3), { id: "note", name: "Cursed", count: 1, description: "by hand" }] }, rat: { effects: [status("preset:burn", 4, { pending: 2 })] } });
  s.act({ type: "endCombat" }, gm);
  assert.deepEqual(s.t("roland").effects!.map((e) => e.name), ["Cursed"]);
  assert.deepEqual(s.t("rat").effects, []);
  assert.ok(s.table.log.some((l) => l.includes("automated Effects wear off")));
});

test("once a round: a rule fires at most once each round", () => {
  const charge = def("Charge", "status", []);
  const exploit = def("Target for Exploitation", "passive", [{ when: "hit", limit: "round", checks: [], actions: [{ kind: "give", target: me, amount: num(2), effectId: "charge" }] }]);
  const twoDice: Page = { ...page(2), dice: [die("slash", 2), die("slash", 2)] };
  const s = setup({ page: twoDice, library: { charge, exploit }, passives: ["exploit"] });
  s.hit();
  assert.equal(s.stacks("roland", "charge"), 2);
});

test("cleanEffect keeps the new pieces and drops nonsense", () => {
  const d = cleanEffect({
    name: "Everything",
    kind: "status",
    decay: "halfAtRoundEnd",
    holds: "preset:burn",
    bySource: true,
    rules: [
      {
        id: "a",
        when: "effectFiresOnThem",
        effectId: "preset:rupture",
        limit: "round",
        checks: [
          { kind: "effect", whose: "them", effectId: "preset:burn", cmp: "atLeast", n: 500, mine: true },
          { kind: "state", whose: "them", state: "panic", is: false },
          { kind: "count", side: "enemies", cmp: "atMost", n: 0, range: 99 },
          { kind: "damage", damageType: "stagger", source: "effect", effectId: "preset:burn" },
        ],
        actions: [
          { kind: "give", target: { who: "them" }, effectId: "preset:bleed", later: true, amount: { kind: "event", per: 3, plus: -1, max: 4 } },
          { kind: "activate", target: { who: "them" }, effectId: "preset:burn", amount: { kind: "rolls", sides: 7, effectId: "c", whose: "x" } },
        ],
      },
      { id: "b", when: "turnEnd", effectId: "dropped", limit: "forever", checks: [], actions: [] },
    ],
  });
  assert.equal(d.decay, "halfAtRoundEnd");
  assert.equal(d.holds, "preset:burn");
  assert.equal(d.bySource, true);
  const [a, b] = d.rules;
  assert.equal(a.effectId, "preset:rupture");
  assert.equal(a.limit, "round");
  assert.equal(a.checks[0].n, 99);
  assert.equal(a.checks[0].mine, true);
  assert.deepEqual(a.checks[1], { kind: "state", whose: "them", state: "panic", is: false });
  assert.equal(a.checks[2].range, 20);
  assert.deepEqual(a.checks[3], { kind: "damage", damageType: "stagger", source: "effect", effectId: "preset:burn" });
  assert.deepEqual(a.actions[0], { kind: "give", target: { who: "them" }, effectId: "preset:bleed", later: true, amount: { kind: "event", per: 3, plus: -1, max: 4 } });
  assert.deepEqual(a.actions[1].amount, { kind: "rolls", sides: 10, effectId: "c", whose: "me" });
  assert.equal(b.effectId, undefined, "only Effect triggers name an Effect");
  assert.equal(b.limit, undefined);
  assert.deepEqual(cleanEffect(d), d, "cleaning twice changes nothing");
  const passive = cleanEffect({ name: "P", kind: "passive", holds: "x", bySource: true, rules: [] });
  assert.equal(passive.holds, undefined);
  assert.equal(passive.bySource, undefined);
});

test("card text for the new pieces reads as sentences", () => {
  const library = { "preset:burn": { name: "Burn", kind: "status", decay: "none", rules: [] } as EffectDef, rupture: def("Rupture", "status", []), fragile: def("Fragile", "status", []) };
  const text = describeEffect(
    def(
      "Jag",
      "die",
      [
        { when: "effectFiresOnThem", effectId: "rupture", checks: [], actions: [{ kind: "give", target: them, amount: { kind: "event", per: 3 }, effectId: "fragile", later: true }] },
        { when: "roll", limit: "combat", checks: [{ kind: "effect", whose: "them", effectId: "preset:burn", cmp: "atLeast", n: 2 } as Check], actions: [{ kind: "addPower", amount: { kind: "effectStacks", effectId: "preset:burn", whose: "me", per: 3, max: 3 } } as Action] },
      ],
    ),
    library,
  );
  assert.equal(
    text,
    "When this die sets off their Rupture, they gain Fragile equal to that amount ÷ 3 next round. When this die is rolled (once a combat), if they have at least 2 Burn, the die gets +Power equal to my Burn ÷ 3 (at most 3).",
  );
  const status = describeEffect(def("Blaze", "status", [], { decay: "allAtRoundEnd", holds: "preset:burn", bySource: true }), library);
  assert.equal(status, "At the end of the round, lose all the stacks. While this is on me, my Burn doesn't lose stacks on its own. Each character's stacks are kept apart.");
});

test("warnings catch pieces that don't fit their When", () => {
  const w = effectWarnings(
    def("Odd", "passive", [
      {
        when: "turnEnd",
        checks: [{ kind: "damage", damageType: "health", source: "attack" }, { kind: "effect", whose: "them", effectId: "x", cmp: "atLeast", n: 1 }],
        actions: [
          { kind: "reduceDamage", amount: num(1) },
          { kind: "shield", amount: num(1) },
          { kind: "heal", target: me, amount: { kind: "event" } },
          { kind: "push", target: me, amount: num(1) },
        ],
      },
    ]),
  );
  assert.ok(w.some((x) => x.includes('"Take less damage" only works with')));
  assert.ok(w.some((x) => x.includes("only a Status effect has stacks to block with")));
  assert.ok(w.some((x) => x.includes('"That many" needs a When')));
  assert.ok(w.some((x) => x.includes("can't push or pull myself")));
  assert.ok(w.some((x) => x.includes('"The kind of damage" only works with')));
  assert.ok(w.some((x) => x.includes('there\'s no "they" to check')));
});
