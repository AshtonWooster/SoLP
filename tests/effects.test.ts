// Automated Effects and Passives (shared/effects.ts) running in combat. Run with `npm run test:engine`.
// Dice here have 1 side, so they always roll 1 and Final Power = 1 + Base Power.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dice, DiceKind, Page } from "../shared/character.ts";
import { applyAction, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import {
  blankEffect,
  cleanEffect,
  copyEffect,
  describeEffect,
  effectWarnings,
  PRESET_EFFECTS,
  type EffectDef,
  type Rule,
} from "../shared/effects.ts";
import { tryEffect } from "../shared/effects-try.ts";
import { linkedEffects } from "../shared/ruleset.ts";
import type { Effect, TableAction, TableState, Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };

let n = 0;
const die = (kind: DiceKind, fp: number): Dice => ({ id: `d${n++}`, kind, counter: false, sides: 1, basePower: fp - 1 });
const slash = (fp: number): Page => ({ id: "slash", name: "Slash", kind: "basic", cost: 0, type: "melee", dice: [die("slash", fp)], effect: "" });
const status = (defId: string, count: number): Effect => ({ id: `e${n++}`, defId, name: defId, count, description: "" });

function token(id: string, side: Token["side"], x: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y: 2, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

/** Roland (player, always first) next to a Rat (enemy), with whatever effects and Passives they start with. */
function setup(opts: { roland?: Partial<Token>; rat?: Partial<Token>; page?: Page; library?: Record<string, EffectDef>; passives?: string[] } = {}) {
  const page = opts.page ?? slash(5);
  const table: TableState = {
    map: { name: "m", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 2, { ownerId: "p1", justice: 100, ...opts.roland }),
      rat: token("rat", "enemy", 3, { justice: -100, pages: [{ ...slash(1), id: "bite", name: "Bite" }], ...opts.rat }),
    },
    log: [],
  };
  const loadout: Loadout = { pages: { [page.id]: page }, deck: Array(12).fill(page.id), aux: [], passiveEffects: opts.passives, stats: { justice: 4 } };
  const ctx: EngineContext = { loadout: (id) => (id === "roland" ? loadout : undefined), effectDef: (id) => opts.library?.[id] };
  const act = (a: TableAction, who: Actor = p1) => applyAction(table, a, who, ctx);
  act({ type: "startCombat", tokenIds: ["roland", "rat"] }, gm);
  const t = (id: string) => table.tokens[id];
  return {
    table,
    act,
    t,
    hp: (id: string) => t(id).resources.hp,
    stacks: (id: string, defId: string) => t(id).effects?.find((e) => e.defId === defId)?.count ?? 0,
    /** Roland slots his Page on the Rat; it hits One-Sided at the start of his next turn. */
    attack: () => {
      const card = table.combat!.decks.roland.hand.find((c) => c.pageId === page.id)!;
      act({ type: "aim", source: "hand", cardId: card.id });
      act({ type: "slot", targets: ["rat"] });
    },
    endTurn: (who: Actor = gm) => act({ type: "endTurn" }, who),
  };
}

const rule = (r: Omit<Rule, "id">): Rule => ({ id: `r${n++}`, ...r });

test("Burn: at the end of my turn, 1 damage per stack, then lose half the stacks", () => {
  const s = setup({ roland: { effects: [status("preset:burn", 5)] } });
  s.endTurn(p1);
  assert.equal(s.hp("roland"), 25);
  assert.equal(s.stacks("roland", "preset:burn"), 2);
  s.endTurn(); // The Rat's turn ends: Roland's Burn doesn't tick.
  assert.equal(s.hp("roland"), 25);
  s.endTurn(p1);
  assert.equal(s.hp("roland"), 23);
  assert.equal(s.stacks("roland", "preset:burn"), 1);
  s.endTurn();
  s.endTurn(p1);
  assert.equal(s.hp("roland"), 22);
  assert.equal(s.stacks("roland", "preset:burn"), 0);
  assert.deepEqual(s.t("roland").effects, [], "an effect at 0 stacks comes off");
  assert.ok(s.table.log.some((l) => l.includes("roland's Burn 5 triggers")));
});

test("Rupture: when hit, 1 damage per stack, then lose all the stacks", () => {
  const s = setup({ rat: { effects: [status("preset:rupture", 3)] } });
  s.attack();
  s.endTurn(p1);
  s.endTurn();
  assert.equal(s.hp("rat"), 30 - 5 - 3);
  assert.equal(s.stacks("rat", "preset:rupture"), 0);
});

test("Poise: when I hit, roll a d10; at or under my Poise, deal another roll of the die as extra damage", () => {
  // 10 Poise: the d10 always passes, and the 1-sided die rolls 5 again.
  const s = setup({ roland: { effects: [status("preset:poise", 10)] } });
  s.attack();
  s.endTurn(p1);
  s.endTurn();
  assert.equal(s.hp("rat"), 30 - 5 - 5);
  assert.equal(s.stacks("roland", "preset:poise"), 10);
});

test("a roll that misses its check does nothing", () => {
  const never: EffectDef = { name: "Never", kind: "status", decay: "none", rules: [rule({ when: "hit", checks: [{ kind: "roll", sides: 4, cmp: "atMost", amount: { kind: "number", n: 0 } }], actions: [{ kind: "extraDamage", amount: { kind: "number", n: 9 } }] })] };
  const s = setup({ roland: { effects: [status("never", 1)] }, library: { never } });
  s.attack();
  s.endTurn(p1);
  s.endTurn();
  assert.equal(s.hp("rat"), 25);
});

test("Strength adds Power to Offensive dice, and wears off at the end of the turn", () => {
  const s = setup({ roland: { effects: [status("preset:strength", 2)] } });
  s.attack();
  s.endTurn(p1);
  assert.equal(s.stacks("roland", "preset:strength"), 0);
  // Give it again just before the Page resolves.
  s.act({ type: "setEffects", tokenId: "roland", effects: [status("preset:strength", 2)] }, gm);
  s.endTurn();
  assert.equal(s.hp("rat"), 30 - 7);
});

test("an effect can give another: when I hit, they gain 2 Burn", () => {
  const igniting: EffectDef = {
    name: "Igniting", kind: "passive", decay: "none",
    rules: [rule({ when: "hit", checks: [], actions: [{ kind: "give", target: { who: "them" }, amount: { kind: "number", n: 2 }, effectId: "preset:burn" }] })],
  };
  const s = setup({ library: { igniting }, passives: ["igniting"] });
  s.attack();
  s.endTurn(p1);
  s.endTurn();
  assert.equal(s.stacks("rat", "preset:burn"), 2);
  const burn = s.t("rat").effects!.find((e) => e.defId === "preset:burn")!;
  assert.equal(burn.name, "Burn");
  assert.match(burn.description, /At the end of my turn, I take 1 damage per stack/);
  s.endTurn(p1);
  s.endTurn(); // The Rat's turn ends: Burn ticks.
  assert.equal(s.hp("rat"), 30 - 5 - 2);
});

test("a player's Passive linked to a library effect runs; Stats count", () => {
  const second: EffectDef = {
    name: "Second Wind", kind: "passive", decay: "none",
    rules: [rule({ when: "turnStart", checks: [{ kind: "health", cmp: "atMost", n: 50 }], actions: [{ kind: "heal", target: { who: "me" }, amount: { kind: "stat", stat: "justice" } }] })],
  };
  const s = setup({ roland: { resources: { hp: 10, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 } }, library: { second }, passives: ["second"] });
  // Roland's first turn already started: healed by his Justice (4).
  assert.equal(s.hp("roland"), 14);
  s.endTurn(p1);
  s.endTurn();
  assert.equal(s.hp("roland"), 18);
});

test("enemies' Passives come from their token; area targets reach enemies in range only", () => {
  const aura: EffectDef = {
    name: "Searing Aura", kind: "passive", decay: "none",
    rules: [rule({ when: "turnEnd", checks: [], actions: [{ kind: "damage", target: { who: "enemiesNear", range: 1 }, amount: { kind: "number", n: 3 } }] })],
  };
  const s = setup({ rat: { passiveEffects: ["aura"] }, library: { aura } });
  s.endTurn(p1);
  s.endTurn();
  assert.equal(s.hp("roland"), 27);
  assert.equal(s.hp("rat"), 30);
});

test("a player's effect does nothing until the GM approves it", () => {
  const def = (approved: boolean): EffectDef => ({
    name: "Mine", kind: "status", decay: "none", createdBy: "p1", approved,
    rules: [rule({ when: "turnEnd", checks: [], actions: [{ kind: "damage", target: { who: "me" }, amount: { kind: "number", n: 4 } }] })],
  });
  const off = setup({ roland: { effects: [status("mine", 1)] }, library: { mine: def(false) } });
  off.endTurn(p1);
  assert.equal(off.hp("roland"), 30);
  const on = setup({ roland: { effects: [status("mine", 1)] }, library: { mine: def(true) } });
  on.endTurn(p1);
  assert.equal(on.hp("roland"), 26);
});

test("Effects without a library effect are notes the GM tracks by hand, as before", () => {
  const s = setup({ roland: { effects: [{ id: "x", name: "Burn", count: 5, description: "Take damage" }] } });
  s.endTurn(p1);
  assert.equal(s.hp("roland"), 30);
  assert.equal(s.t("roland").effects![0].count, 5);
});

test("damage from effects can Knock Out", () => {
  const s = setup({ roland: { effects: [status("preset:burn", 40)] } });
  s.endTurn(p1);
  assert.equal(s.hp("roland"), 0);
  assert.ok(s.t("roland").status?.knockedOut);
});

test("setEffects keeps the library link; stacks stay within the max", () => {
  const capped: EffectDef = { name: "Capped", kind: "status", decay: "none", maxStacks: 3, rules: [rule({ when: "turnStart", checks: [], actions: [{ kind: "gainStacks", amount: { kind: "number", n: 5 } }] })] };
  const s = setup({ library: { capped } });
  s.act({ type: "setEffects", tokenId: "roland", effects: [status("capped", 1)] }, gm);
  assert.equal(s.t("roland").effects![0].defId, "capped");
  s.endTurn(p1);
  s.endTurn();
  assert.equal(s.stacks("roland", "capped"), 3);
});

test("card text is written from the pieces", () => {
  assert.equal(describeEffect(PRESET_EFFECTS["preset:burn"]), "At the end of my turn, I take 1 damage per stack. At the end of my turn, lose half the stacks (rounded down).");
  assert.equal(describeEffect(PRESET_EFFECTS["preset:rupture"]), "When I'm hit, I take 1 damage per stack. Lose all the stacks after it triggers.");
  assert.equal(describeEffect(PRESET_EFFECTS["preset:poise"]), "When I hit someone, if a d10 roll is at most my stacks, deal extra damage equal to another roll of this die.");
});

test("cleanEffect keeps only known pieces and sensible numbers", () => {
  const dirty = {
    name: "x".repeat(200),
    kind: "status",
    decay: "explode",
    maxStacks: 5000,
    approved: true,
    rules: [{ when: "always", checks: [{ kind: "roll", sides: 7, cmp: "?" }], actions: [{ kind: "eval", amount: { kind: "number", n: 1e9 } }, { kind: "give", amount: { kind: "perStack", n: -3 }, effectId: "preset:burn" }] }],
  };
  const d = cleanEffect(dirty);
  assert.equal(d.name.length, 60);
  assert.equal(d.decay, "none");
  assert.equal(d.maxStacks, 99);
  assert.equal(d.approved, undefined, "only a player's effect carries approval");
  assert.equal(d.rules[0].when, "turnEnd");
  assert.deepEqual(d.rules[0].checks[0], { kind: "roll", sides: 10, cmp: "atMost", amount: { kind: "number", n: 1 } });
  assert.equal(d.rules[0].actions[0].kind, "damage");
  assert.equal(d.rules[0].actions[0].amount.n, 99);
  assert.deepEqual(d.rules[0].actions[1].amount, { kind: "perStack", n: 1 });
  assert.deepEqual(cleanEffect(d), d, "cleaning twice changes nothing");
});

test("warnings in plain English, and copies drop who made it", () => {
  const def = blankEffect();
  def.decay = "none";
  def.rules[0].when = "turnEnd";
  def.rules[0].actions = [{ kind: "extraDamage", amount: { kind: "number", n: 1 } }, { kind: "damage", target: { who: "them" }, amount: { kind: "number", n: 1 } }];
  const w = effectWarnings(def);
  assert.ok(w.includes("Give it a name."));
  assert.ok(w.some((x) => x.includes('"Deal extra damage" only works with "When I hit someone"')));
  assert.ok(w.some((x) => x.includes("there's no \"they\"")));
  assert.ok(w.includes("It never loses stacks on its own. Is that on purpose?"));
  assert.deepEqual(effectWarnings(PRESET_EFFECTS["preset:burn"]), []);
  const copy = copyEffect({ ...PRESET_EFFECTS["preset:burn"], createdBy: "p1", approved: true }, "Hellfire");
  assert.equal(copy.name, "Hellfire");
  assert.equal(copy.createdBy, undefined);
  assert.equal(copy.approved, undefined);
});

test("linkedEffects collects Passives and Proficiencies linked to library effects", () => {
  const p = (effectId?: string) => ({ id: "p", name: "p", cost: 1, description: "", ...(effectId ? { effectId } : {}) });
  const ids = linkedEffects({
    augment: { name: "", description: "", passives: [p("a"), p()] },
    weapons: [{ id: "w", name: "w", description: "", hands: 1, passives: [p("b")], pages: [] }],
    armor: null,
    proficiencies: [{ id: "x", name: "x", description: "", effectId: "c" }],
  });
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("Clash wins and losses trigger for each side", () => {
  const winner: EffectDef = { name: "Momentum", kind: "passive", decay: "none", rules: [rule({ when: "clashWin", checks: [], actions: [{ kind: "gainSanity", target: { who: "me" }, amount: { kind: "number", n: 2 } }] })] };
  const loser: EffectDef = { name: "Rattled", kind: "passive", decay: "none", rules: [rule({ when: "clashLose", checks: [], actions: [{ kind: "staggerDamage", target: { who: "me" }, amount: { kind: "number", n: 4 } }] })] };
  const s = setup({ page: slash(6), rat: { pages: [{ ...slash(4), id: "bite", name: "Bite" }], passiveEffects: ["loser"] }, library: { winner, loser }, passives: ["winner"] });
  s.endTurn(p1);
  const bite = s.table.combat!.decks.rat.hand.find((c) => c.pageId === "bite")!;
  s.act({ type: "aim", source: "hand", cardId: bite.id }, gm);
  s.act({ type: "slot", targets: ["roland"] }, gm);
  s.endTurn();
  s.attack(); // Roland slots against the Rat's die: Clash, resolved on the Rat's turn.
  s.endTurn(p1);
  assert.equal(s.hp("rat"), 24);
  assert.equal(s.t("roland").resources.sanity, 1 + 2, "+1 for winning the Clash, +2 from the effect");
  assert.equal(s.t("rat").resources.stagger, 20 - 6 - 4);
});

test("Try it runs an effect on two dummies with the real rules", () => {
  const r = tryEffect({ ...PRESET_EFFECTS["preset:burn"], name: "Draft Burn", createdBy: "p1" }, PRESET_EFFECTS, 4);
  assert.ok(r.log.some((l) => l.includes("You's Draft Burn 4 triggers.")), "unapproved drafts still run in Try it");
  assert.ok(r.log.some((l) => l.includes("You takes 4 damage")));
  assert.ok(r.log.some((l) => l.includes("Draft Burn: 4 → 2")));
  assert.ok(r.log.some((l) => /takes \d+ slash damage/.test(l)), "they trade Strikes");
  const passive = tryEffect({ name: "Thorns", kind: "passive", decay: "none", rules: [rule({ when: "wasHit", checks: [], actions: [{ kind: "damage", target: { who: "them" }, amount: { kind: "number", n: 2 } }] })] }, PRESET_EFFECTS);
  assert.ok(passive.log.some((l) => l.includes("You's Thorns triggers.")));
  assert.ok(passive.log.some((l) => l.includes("Dummy takes 2 damage")));
});
