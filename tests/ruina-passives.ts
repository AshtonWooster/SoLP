// Every passive on the Tiphereth Database's Passives list (tiphereth.zasz.su/passives), built from
// the effect builder's menu pieces (shared/effects.ts). tests/ruina-passives.test.ts checks each one
// is a valid effect with no builder warnings, and runs a few of them in combat. Character-specific
// passives (named characters and their unique Pages) are listed in EXCLUDED instead.
import type { DiceKind } from "../shared/character.ts";
import type { Action, Amount, Check, EffectDef, Limit, Rule, Target, When } from "../shared/effects.ts";

// ---- Status effects the passives give or check (a game builds these once in its library) ----

const R = (when: When, checks: Check[], actions: Action[], extra: Partial<Rule> = {}): Rule => ({ id: `r${Math.random().toString(36).slice(2, 8)}`, when, checks, actions, ...extra });
const status = (name: string, rules: Rule[], decay: EffectDef["decay"], extra: Partial<EffectDef> = {}): EffectDef => ({ name, kind: "status", decay, rules, ...extra });

const n = (k: number): Amount => ({ kind: "number", n: k });
const perStack = (k = 1): Amount => ({ kind: "perStack", n: k });
const d = (sides: number, plus = 0): Amount => ({ kind: "roll", sides, ...(plus ? { plus } : {}) });
const stacks = (effectId: string, whose: "me" | "them" = "me", extra: Partial<Amount> = {}): Amount => ({ kind: "effectStacks", n: 1, effectId, whose, ...extra });
const event = (extra: Partial<Amount> = {}): Amount => ({ kind: "event", ...extra });
const me: Target = { who: "me" };
const them: Target = { who: "them" };
const all = (enemies: boolean): Target => ({ who: enemies ? "enemiesNear" : "alliesNear", range: 99 });
const random = (enemies: boolean, count: number): Target => ({ who: enemies ? "randomEnemies" : "randomAllies", count });

// Actions
const give = (effectId: string, amount: Amount, target: Target = me, later = false): Action => ({ kind: "give", target, amount, effectId, ...(later ? { later: true } : {}) });
const power = (amount: Amount): Action => ({ kind: "addPower", amount });
const lowerPower = (amount: Amount): Action => ({ kind: "lowerPower", amount });
const health = (amount: Amount, percent = false): Action => ({ kind: "healthDamage", amount, ...(percent ? { percent } : {}) });
const stagger = (amount: Amount, percent = false): Action => ({ kind: "staggerHit", amount, ...(percent ? { percent } : {}) });
const heal = (amount: Amount, target: Target = me): Action => ({ kind: "heal", target, amount });
const light = (k: number): Action => ({ kind: "gainLight", target: me, amount: n(k) });
const draw = (k: number): Action => ({ kind: "draw", amount: n(k) });
const one = (kind: Action["kind"], amount: Amount = n(1), extra: Partial<Action> = {}): Action => ({ kind, amount, ...extra });

// Checks
const chance = (pct: 50 | 25 | 10 | 5): Check => ({ kind: "roll", sides: { 50: 2, 25: 4, 10: 10, 5: 20 }[pct], cmp: "atMost", amount: n(1) });
const die = (dieKind: DiceKind | "offensive" | "defensive"): Check => ({ kind: "die", dieKind });
const has = (effectId: string, whose: "me" | "them", k = 1, cmp: "atLeast" | "atMost" = "atLeast"): Check => ({ kind: "effect", effectId, cmp, n: k, ...(whose === "them" ? { whose } : {}) });
const page = (pageIs: Check["pageIs"], extra: Partial<Check> = {}): Check => ({ kind: "page", pageIs, ...extra });
const emotion = (k: number): Check => ({ kind: "emotion", cmp: "atLeast", n: k });
const count = (side: "allies" | "enemies", cmp: "atLeast" | "atMost", k: number, down = false): Check => ({ kind: "count", side, cmp, n: k, ...(down ? { down } : {}) });
const firstRound: Check = { kind: "round", cmp: "atMost", n: 1 };
const lethal: Check = { kind: "lethal" };
const limit = (l: Limit): Partial<Rule> => ({ limit: l });

/** Status effects the pack's passives use, by library id. Burn, Bleed, Strength, Feeble and Endurance are built in. */
export const STATUSES: Record<string, EffectDef> = {
  paralysis: status("Paralysis", [R("roll", [], [one("disadvantage")])], "oneAfterTrigger"),
  protection: status("Protection", [R("takingDamage", [{ kind: "damage", damageType: "health", source: "attack" }], [one("reduceDamage", perStack())])], "allAtRoundEnd"),
  staggerProtection: status("Stagger Protection", [R("takingDamage", [{ kind: "damage", damageType: "stagger", source: "attack" }], [one("reduceDamage", perStack())])], "allAtRoundEnd"),
  fragile: status("Fragile", [R("takingDamage", [{ kind: "damage", damageType: "health", source: "attack" }], [one("increaseDamage", perStack())])], "allAtRoundEnd"),
  haste: status("Haste", [R("turnStart", [], [{ kind: "gainMovement", target: me, amount: perStack() }])], "allAtRoundEnd"),
  bind: status("Bind", [R("turnStart", [], [{ kind: "loseMovement", target: me, amount: perStack() }])], "allAtRoundEnd"),
  disarm: status("Disarm", [R("roll", [die("defensive")], [lowerPower(perStack())])], "allAtRoundEnd"),
  smoke: status("Smoke", [R("takingDamage", [{ kind: "damage", damageType: "any", source: "attack" }], [one("increaseDamage", perStack(5), { percent: true })])], "oneAtRoundEnd", { maxStacks: 10 }),
  charge: status("Charge", [], "none", { maxStacks: 10 }),
  immobilized: status("Immobilized", [], "allAtRoundEnd"),
  vibration: status("Vibration", [], "oneAtRoundEnd"),
  // Helpers a passive keeps on its owner.
  calm: status("Calm", [R("roll", [], [one("raiseMax", n(3))])], "allAfterTrigger"),
  unrelenting: status("Unrelenting", [R("takingDamage", [], [one("reduceDamage", n(25))])], "allAtRoundEnd", { maxStacks: 1 }),
  prescriptSlash: status("Prescript: Slash", [R("roll", [die("slash")], [power(n(2))])], "allAtRoundEnd", { maxStacks: 1 }),
  prescriptPierce: status("Prescript: Pierce", [R("roll", [die("pierce")], [power(n(2))])], "allAtRoundEnd", { maxStacks: 1 }),
  prescriptBlunt: status("Prescript: Blunt", [R("roll", [die("blunt")], [power(n(2))])], "allAtRoundEnd", { maxStacks: 1 }),
  kizuna: status("Kizuna", [R("roundStart", [], [give("preset:strength", perStack()), give("preset:endurance", perStack())])], "none", { maxStacks: 2 }),
  cleanup: status("Corpse Cleanup", [R("roundEnd", [], [heal({ kind: "maxHealth", n: 5, max: 12 })])], "allAtRoundEnd", { maxStacks: 1 }),
  bottomDeal: status("Bottom Deal", [R("roundStart", [], [draw(1)])], "allAfterTrigger", { maxStacks: 1 }),
  stackedDeck: status("Stacked Deck", [R("roundEnd", [], [light(1)])], "allAfterTrigger", { maxStacks: 1 }),
  furiousFire: status("Furious Fire", [R("gave", [], [give("preset:burn", event(), them)], { effectId: "preset:burn" })], "oneAfterTrigger", { maxStacks: 2 }),
  wildfire: status("Force of a Wildfire", [R("staggered", [], [give("preset:burn", stacks("preset:burn", "me", { per: 2 }), all(false))])], "oneAtRoundEnd", { maxStacks: 2 }),
  huggingFire: status("Hugging Fire", [R("takingDamage", [{ kind: "damage", damageType: "health", source: "effect", effectId: "preset:burn" }], [{ kind: "staggerDamage", target: me, amount: event({ per: 2 }) }])], "allAtRoundEnd", { maxStacks: 1 }),
  survivor: status("Survivor", [R("roundStart", [], [give("preset:strength", perStack()), give("preset:endurance", perStack())])], "none", { maxStacks: 5 }),
  bladeUnlocked: status("Blade Unlocked", [R("roll", [], [power(n(1))])], "none", { maxStacks: 1 }),
  finishingMark: status("Finishing Touch", [R("takingHit", [], [one("increaseDamage", n(50), { percent: true })])], "none", { maxStacks: 1 }),
  armorChink: status("Chink in One's Armor", [R("roll", [die("block")], [lowerPower(n(99))])], "allAfterTrigger", { maxStacks: 1 }),
  mirage: status("Mirage", [R("roundEnd", [{ kind: "state", state: "staggered", is: false }], [{ kind: "recoverStagger", target: me, amount: { kind: "halfStacks" } }])], "allAtRoundEnd"),
  guts: status("Guts", [R("roundEnd", [], [{ kind: "recoverStagger", target: me, amount: { kind: "maxStagger", n: 100 } }])], "allAfterTrigger", { maxStacks: 1 }),
  bloodfiend: status("Blood Drunk", [], "allAtRoundEnd"),
};

// ---- The passives ----

export interface PackPassive {
  /** The Tiphereth Database id. */
  id: number;
  def: EffectDef;
  /** Where the automation differs from the game's wording. */
  approx?: string;
}

const passive = (id: number, name: string, cost: number, rules: Rule[], extra: { approx?: string; def?: Partial<EffectDef> } = {}): PackPassive => ({
  id,
  def: { name, kind: "passive", cost, decay: "none", rules, ...extra.def },
  ...(extra.approx ? { approx: extra.approx } : {}),
});

/** A passive that's just "When I roll [kind], +N Power". */
const dicePower = (id: number, name: string, cost: number, kind: DiceKind | "offensive" | "defensive", k: number) => passive(id, name, cost, [R("roll", [die(kind)], [k > 0 ? power(n(k)) : lowerPower(n(-k))])]);
/** "[Type] damage +N" (Health only) and "[Type] Stagger damage +N". */
const typeDamage = (id: number, name: string, cost: number, kind: DiceKind, k: number, staggerOnly = false) => passive(id, name, cost, [R("hit", [die(kind)], [staggerOnly ? stagger(n(k)) : health(n(k))])]);
const speedDiff: Amount = { kind: "speedDiff", per: 2, max: 5 };
const lowHp = (pct: number, effectId: string, max: number): Rule => R("roundStart", [], [give(effectId, { kind: "healthLost", per: pct, max })]);

export const PASSIVES: PackPassive[] = [
  passive(10001, "Speed", 4, [R("speed", [], [one("speedDice")])]),
  passive(10004, "Speed Ⅱ", 8, [R("speed", [], [one("speedDice", n(2))])]),
  passive(10008, "Speed Ⅲ", 6, [R("speed", [], [one("speedDice")]), R("emotionUp", [emotion(3)], [one("speedDice")], limit("combat"))]),
  passive(10011, "Incomplete Arbiter", 6, [R("roundStart", [], [one("drawTo", n(4))])]),
  passive(10112, "Weariness", 0, [R("combatStart", [], [{ kind: "damage", target: me, amount: { kind: "maxHealth", n: 25 } }])]),
  passive(180005, "An Arbiter", 5, [R("roundStart", [], [one("drawTo", n(5))])]),
  passive(180104, "Gebura’s Prowess", 6, [R("roll", [], [power(speedDiff)])]),
  passive(200004, "Half-baked Courage", 1, [R("someoneDown", [{ kind: "side", side: "allies" }], [give("preset:strength", n(1), me, true)])]),
  passive(200005, "The Art of Defense", 1, [R("roll", [die("defensive"), chance(25)], [one("raiseMax", n(3))])]),
  passive(200006, "Yun’s Hunch", 1, [R("roll", [die("evade"), chance(50)], [one("raiseMax", n(3))])]),
  passive(200007, "Electric Shock", 1, [R("hit", [chance(25)], [give("paralysis", n(1), them, true)], limit("roundTarget"))]),
  passive(200010, "Hook", 1, [R("knockOut", [], [give("preset:strength", n(1), me, true)])]),
  passive(201001, "Slash of a Grade 9 Fixer", 1, [R("hit", [die("slash"), chance(50)], [health(n(1))])]),
  passive(210001, "Emergency Rations", 2, [R("roundStart", [], [heal(n(2))])]),
  passive(210002, "Instant Cooking", 4, [R("knockOut", [], [heal({ kind: "maxHealth", n: 10, max: 12 })])]),
  passive(210003, "Talent", 1, [R("hit", [{ kind: "speed", cmp: "atLeast", amount: { kind: "speed", whose: "them", plus: 1 } }], [stagger(n(1))])]),
  passive(210006, "Flaming Bat", 1, [R("hit", [chance(50)], [give("preset:burn", n(1), them)])]),
  passive(211003, "Open Wound", 1, [R("hit", [has("preset:bleed", "them")], [health(n(1))])]),
  passive(211005, "Penetration", 1, [R("hit", [die("pierce"), chance(50)], [health(n(1))])]),
  passive(211007, "Downward Slash", 1, [R("hit", [die("slash"), chance(50)], [health(n(1))])]),
  passive(220001, "Calmness", 1, [R("clashWin", [chance(25)], [give("calm", n(1))])]),
  typeDamage(220002, "Zwei Swordsmanship Ⅰ", 1, "slash", 1),
  typeDamage(220003, "Minimum Offense", 1, "slash", 1, true),
  dicePower(220004, "Your Shield", 4, "defensive", 1),
  passive(220005, "Best Choice", 1, [R("discard", [], [heal(n(3))])]),
  passive(220006, "Margin", 3, [R("roundEnd", [{ kind: "hand", cmp: "atMost", n: 0 }], [light(1), draw(1)])]),
  passive(220007, "In Times Like These!", 3, [R("roundEnd", [{ kind: "hand", cmp: "atMost", n: 3 }], [give("preset:strength", n(1), me, true)])]),
  passive(220008, "Restfulness", 2, [R("roundEnd", [{ kind: "used", cmp: "atMost", n: 0 }], [light(1)])]),
  passive(220009, "Double Kick", 1, [R("clashWin", [], [{ kind: "damage", target: them, amount: n(1) }])]),
  passive(220010, "Deep Breaths", 1, [R("roundStart", [chance(25)], [light(1)])]),
  passive(221001, "Keeping in Stride", 1, [R("clashWin", [], [heal(n(1))])]),
  typeDamage(221005, "Punch to the Solar Plexus", 2, "blunt", 2),
  typeDamage(221007, "Slashing Prowess of a Grade 8 Fixer", 1, "slash", 1, true),
  typeDamage(221009, "Piercing Prowess of a Grade 8 Fixer", 1, "pierce", 1, true),
  typeDamage(221010, "Slashing Prowess of a Grade 7 Fixer", 2, "slash", 2, true),
  typeDamage(221012, "Piercing Prowess of a Grade 7 Fixer", 2, "pierce", 2, true),
  typeDamage(221013, "Axe Gang Spirit", 1, "blunt", 1, true),
  passive(221014, "Double Axe", 1, [R("hit", [die("slash")], [health(n(2))]), R("hit", [die("pierce")], [one("lessHealthDamage")])]),
  passive(230001, "Remembrance", 4, [R("roundEnd", [count("allies", "atLeast", 1, true)], [give("preset:strength", n(2), me, true)])]),
  passive(230004, "Concentration", 2, [R("roll", [firstRound], [power(n(1))])]),
  passive(230005, "Blind Fire", 3, [R("roll", [firstRound], [power(n(2))])]),
  passive(230006, "Snipe", 4, [R("roll", [firstRound, die("offensive")], [power(n(3))])]),
  passive(230007, "Guardian", 1, [R("combatStart", [], [give("protection", n(2), random(false, 3))])]),
  passive(230008, "Lone Fixer", 3, [R("roundEnd", [count("allies", "atMost", 0)], [give("preset:strength", n(3), me, true)])]),
  passive(230010, "Bzzz Bzzz", 1, [R("combatStart", [], [give("paralysis", n(1), random(true, 3))])]),
  passive(230011, "Pzzt Pzzt", 1, [R("hit", [has("paralysis", "them")], [health(d(2))])]),
  passive(230012, "Unstable Charge", 2, [R("roundEnd", [chance(50)], [give("preset:strength", n(1), me, true)])]),
  passive(230018, "Battle Ready", 2, [R("combatStart", [], [draw(2)])]),
  passive(230019, "Digging Shank", 2, [R("gave", [], [give("preset:bleed", n(1), them)], { effectId: "preset:bleed" })], { approx: "Counts Bleed from any of my rules, not only Combat Pages." }),
  passive(230020, "Deep Wound", 1, [R("clashWin", [die("offensive")], [give("preset:bleed", n(1), them, true)])]),
  passive(230021, "Meow Meow~", 1, [R("combatStart", [], [give("preset:strength", n(1), random(false, 2))])]),
  passive(230022, "Squeak… Squeak…?", 2, [R("hit", [die("blunt")], [health(d(2))])]),
  passive(230023, "Oinkie!! Oink!!!", 1, [R("combatStart", [], [give("preset:feeble", n(1), random(true, 2))])]),
  passive(230024, "Unrelenting", 2, [R("takingDamage", [lethal], [one("reduceDamage", n(25)), give("unrelenting", n(1))], limit("combat"))]),
  typeDamage(230025, "Piercer", 1, "pierce", 1),
  typeDamage(230026, "Jolting Puncture", 1, "pierce", 1, true),
  passive(230107, "Light of Daybreak", 1, [R("hit", [has("preset:burn", "them")], [stagger(d(2))])]),
  dicePower(230118, "Dark Cloud Blade", 4, "slash", 1),
  passive(230121, "Improv Drumming", 1, [R("hit", [die("blunt")], [give("fragile", n(1), random(true, 1), true)], limit("round"))]),
  dicePower(230124, "Wedge", 4, "pierce", 1),
  passive(230207, "Stigma Workshop Weaponry", 2, [R("gave", [], [give("preset:burn", n(1), them)], { effectId: "preset:burn" })], { approx: "Counts Burn from any of my rules, not only Combat Pages." }),
  passive(231001, "Razor Strike", 2, [R("hit", [die("slash")], [give("preset:bleed", n(1), them, true)])]),
  passive(232001, "Sublimate", 3, [R("roll", [], [power(stacks("preset:bleed", "me", { per: 5 }))])]),
  passive(232002, "Twist Wound", 1, [R("hit", [has("preset:bleed", "them")], [stagger(n(1))])]),
  passive(233001, "Solidarity", 5, [
    R("roundEnd", [count("allies", "atLeast", 1), count("allies", "atMost", 0, true)], [give("preset:strength", n(1), me, true)]),
    R("roundEnd", [count("allies", "atMost", 0), count("allies", "atLeast", 1, true)], [give("preset:feeble", n(2), me, true)]),
  ]),
  passive(234001, "Bottom Deal", 2, [R("discard", [], [give("bottomDeal", n(1))])]),
  passive(234002, "Stacking the Deck", 2, [R("discard", [], [give("stackedDeck", n(1))])]),
  passive(240001, "Overbreathing/Exhaustion", 0, [R("use", [page("cost", { cmp: "atLeast", n: 4 })], [light(2)]), R("speed", [], [one("loseSpeedDice")])]),
  passive(240002, "Singular Strike", 3, [
    R("roll", [page("dice", { cmp: "atMost", n: 1 })], [power(n(2))]),
    R("clashWin", [page("dice", { cmp: "atMost", n: 1 })], [one("emotion", n(1), { target: me })]),
    R("clashLose", [page("dice", { cmp: "atMost", n: 1 })], [one("emotion", n(1), { target: me })]),
  ]),
  passive(240003, "Respiration", 2, [R("roundStart", [{ kind: "light", cmp: "atMost", n: 0 }], [light(1)])]),
  passive(240004, "Acceleration", 1, [R("hit", [{ kind: "speed", cmp: "atLeast", amount: n(5) }], [stagger(n(1))])]),
  typeDamage(240005, "Concussion", 2, "blunt", 2, true),
  dicePower(240006, "Puppet Skeleton", 4, "blunt", 1),
  passive(240010, "Acrobatic", 2, [R("hit", [page("ranged")], [health(n(1))])]),
  passive(240015, "Mind Hauler", 2, [R("hit", [], [{ kind: "recoverStagger", target: me, amount: n(2) }])]),
  passive(240016, "Health Hauler", 2, [R("hit", [], [heal(n(2))])]),
  passive(240018, "Grace of the Prescript", 6, [R("roundStart", [], [{ kind: "giveRandom", target: me, amount: n(1), effectIds: ["prescriptSlash", "prescriptPierce", "prescriptBlunt"] }])]),
  passive(240019, "Quantum Leap", 2, [R("hit", [{ kind: "speed", cmp: "atLeast", amount: n(4) }, chance(10)], [health(n(13))])]),
  passive(240020, "Refraction", 2, [R("hit", [chance(5)], [stagger(n(13))])]),
  passive(240021, "Reaction Force", 2, [R("roundEnd", [{ kind: "used", cmp: "atMost", n: 0 }], [give("preset:strength", n(1), me, true), give("preset:endurance", n(1), me, true)])]),
  passive(240022, "Dimensional Sections", 2, [R("hit", [chance(10)], [health(n(10))])]),
  passive(240023, "Sooty Thwack", 2, [R("hit", [has("smoke", "me")], [stagger({ kind: "effectStacks", n: 10, effectId: "smoke", whose: "me" }, true)])]),
  passive(240024, "Smoke Addiction", 1, [R("hit", [has("smoke", "them", 8)], [give("paralysis", n(2), them, true)], limit("roundTarget"))]),
  passive(240025, "Stimulating Fumes", 1, [R("turnEnd", [has("smoke", "me")], [{ kind: "counterDie", target: me, amount: stacks("smoke"), dieKind: "block", base: 0 }])], {
    approx: "The Block die waits as a Counter Die from the end of my turn to my next Upkeep, so it answers One-Sided attacks only.",
  }),
  passive(240026, "Puffy Brume", 1, [
    R("takingDamage", [has("smoke", "me"), { kind: "damage", damageType: "any", source: "attack" }], [one("reduceDamage", stacks("smoke", "me", { n: 5 }), { percent: true })]),
    R("hit", [has("smoke", "me")], [one("extraDamage", stacks("smoke", "me", { n: 5 }), { percent: true })]),
  ], { approx: "Cancels Smoke's +5% per stack on me and adds it to my attacks instead; match the numbers to how your Smoke is built." }),
  passive(240027, "Flaring Brand", 3, [R("hit", [], [give("preset:burn", d(2), them)])]),
  passive(240101, "Deflect Assault", 2, [R("turnEnd", [], [{ kind: "counterDie", target: me, amount: n(5), dieKind: "block", base: 1 }])], {
    approx: "The Block die (2-6) waits as a Counter Die from the end of my turn to my next Upkeep.",
  }),
  passive(240118, "Skim Prescript", 1, [R("combatStart", [], [draw(1)])]),
  passive(240127, "Plumed Escutcheon", 1, [R("wasHit", [], [give("preset:burn", d(2), them)])]),
  passive(240227, "Volatile Passion", 4, [R("roll", [die("offensive"), has("preset:burn", "them")], [power(n(1))])]),
  passive(240301, "Eye of Death/Enervation", 5, [R("roll", [], [power(n(4))]), R("roll", [], [lowerPower(n(3))])]),
  passive(240308, "High-level Acrobatics", 4, [R("roll", [page("cost", { cmp: "atLeast", n: 3 })], [power(n(1))])]),
  dicePower(240408, "Lion’s Fist", 4, "blunt", 1),
  passive(241001, "Kizuna/Extreme Fatigue", 1, [
    R("someoneDown", [{ kind: "side", side: "allies" }], [give("kizuna", n(1))]),
    R("combatStart", [], [{ kind: "damage", target: me, amount: { kind: "maxHealth", n: 75 } }]),
  ]),
  dicePower(241002, "Liquified Flesh", 4, "defensive", 1),
  passive(241102, "Corpse Cleanup", 6, [R("someoneDown", [], [give("cleanup", n(1))])], { approx: "Two deaths in one round heal once." }),
  passive(241301, "Kizuna/Extreme Fatigue", 3, [
    R("someoneDown", [{ kind: "side", side: "allies" }], [give("kizuna", n(1))]),
    R("combatStart", [], [{ kind: "damage", target: me, amount: { kind: "maxHealth", n: 25 } }]),
  ]),
  passive(243001, "Grasping Vulnerabilities", 2, [R("hit", [{ kind: "resist", whose: "them", cmp: "atLeast", n: 150 }], [health(n(1))])]),
  dicePower(243003, "Swordplay of the Homeland", 8, "slash", 2),
  passive(243005, "Carver of Scars", 6, [R("hit", [die("offensive"), page("first")], [give("preset:bleed", n(2), them)])]),
  passive(243101, "Information Assessment", 4, [R("roundEnd", [], [{ kind: "resist", target: random(true, 1), amount: n(1), dmgType: "random", level: 100, which: "health", until: "nextRound" }])]),
  passive(243105, "Toughness", 6, [
    R("roundStart", [emotion(1)], [give("protection", n(1)), give("staggerProtection", n(1))]),
    R("roundStart", [emotion(3)], [give("protection", n(1)), give("staggerProtection", n(1))]),
    R("roundStart", [emotion(5)], [give("protection", n(1)), give("staggerProtection", n(1))]),
  ]),
  passive(243201, "Seeing Through Weaknesses", 4, [
    R("hit", [{ kind: "resist", whose: "them", cmp: "atLeast", n: 150 }, has("fragile", "them", 5)], [{ kind: "resist", target: them, amount: n(1), dmgType: "die", level: 200, which: "health", until: "combat" }]),
  ], { approx: "Checked when the hit lands, not at the end of the round." }),
  passive(243205, "Rupture Wound", 4, [R("hit", [has("preset:bleed", "them")], [health(n(3))])]),
  passive(250001, "Fervor", 4, [R("roll", [die("offensive"), emotion(3)], [power(n(1))])]),
  passive(250002, "A Fighter that Never Retreats", 2, [R("emotionUp", [], [give("preset:strength", n(1), me, true), give("preset:endurance", n(1), me, true)])]),
  passive(250003, "Firm as a Great Mountain", 3, [R("emotionUp", [], [heal({ kind: "maxHealth", n: 15, max: 20 })])]),
  passive(250004, "Remain Vigilant in Peace", 2, [R("emotionUp", [{ kind: "state", state: "staggered", is: false }], [{ kind: "recoverStagger", target: me, amount: { kind: "maxStagger", n: 25 } }])]),
  passive(250005, "Ammo Supply", 9, [R("hit", [page("melee")], [one("addPage", n(1), { text: "Ammunition" })], { every: 3 })], {
    approx: "Write the names of your Ammunition Pages (split with commas); it adds one of them at random.",
  }),
  passive(250006, "The Boss’s Orders", 4, [R("roundStart", [], [give("protection", n(1), random(false, 2))])]),
  passive(250007, "Grit", 2, [R("takingDamage", [], [one("reduceDamage")])]),
  passive(250008, "Empowered First Shot", 3, [R("roll", [page("ranged"), page("firstDie")], [power(n(1))])]),
  passive(250009, "Additional Supplies", 2, [R("use", [page("named", { text: "Ammunition" })], [one("addPage", n(1), { text: "Ammunition" })], { every: 3 })], {
    approx: "Adds the Page right away rather than at the end of the round; write your Ammunition Pages' names.",
  }),
  passive(250010, "Emergency Resuscitation Protocol", 5, [
    R("takingDamage", [lethal], [one("reduceDamage", event()), heal(stacks("charge", "me", { n: 5 })), { kind: "clear", target: me, amount: n(1), effectId: "charge" }], limit("combat")),
  ]),
  passive(250011, "Force Field", 2, [R("lost", [], [give("protection", n(1), me, true)], { effectId: "charge", limit: "round" })]),
  passive(250012, "Heavy-hearted Forte", 2, [R("clashWin", [], [{ kind: "staggerDamage", target: them, amount: d(2) }])]),
  passive(250014, "Internal Combustion Engine", 1, [R("gained", [], [give("smoke", n(1))], { effectId: "smoke" })], { approx: "Counts Smoke from anything, not only Combat Pages." }),
  passive(250015, "Raging Torrent", 2, [R("use", [], [draw(1)], { every: 4 })], { approx: "Counts every Page used, not only different ones." }),
  passive(250016, "Breaking Pressure", 3, [R("theyRoll", [die("defensive")], [lowerPower(n(1))])]),
  passive(250017, "Easygoing Breather", 3, [R("roundStart", [emotion(2)], [one("costDown")])]),
  passive(250018, "Furious Fire Rending the Skies", 3, [R("roundStart", [], [give("furiousFire", n(2))])], { approx: "Doubles the next two times I give Burn this round, instead of marking two Pages." }),
  passive(250020, "Force of a Wildfire", 3, [R("hit", [page("melee")], [give("preset:burn", n(1), them), give("wildfire", n(2), them)])]),
  passive(250021, "Hugging Fire, Sitting on Brushwood", 3, [R("hit", [page("melee")], [give("huggingFire", n(1), them)])]),
  passive(250023, "The Commander", 7, [
    R("roundStart", [has("charge", "me", 11)], [give("preset:strength", n(1)), give("preset:endurance", n(1)), give("preset:strength", n(1), all(false)), give("preset:endurance", n(1), all(false))]),
  ]),
  passive(250024, "Myo’s Prowess", 5, [R("roll", [], [power(speedDiff)])]),
  passive(250025, "Maximum Crash", 5, [
    R("hit", [has("charge", "me", 20)], [one("extraDamage", n(50), { percent: true })]),
    R("takingHit", [has("charge", "me", 20)], [one("reduceDamage", n(30), { percent: true })]),
  ], { approx: "Checks Charge when the attack happens, not at the start of the round." }),
  passive(250026, "Survivor", 4, [R("recovered", [], [give("survivor", n(1))])]),
  passive(250027, "Manipulator of Odds", 3, [R("roll", [], [one("rerollMin")])]),
  passive(250106, "Threefold Tenacity", 4, [
    R("roll", [die("offensive"), { kind: "round", cmp: "atMost", n: 3 }], [power(n(1))], { every: 3 }),
    R("roll", [die("offensive"), { kind: "round", cmp: "atLeast", n: 4 }], [power(n(1))]),
  ]),
  passive(250110, "Charged Shield", 3, [R("gained", [emotion(2)], [give("preset:endurance", n(1), me, true)], { effectId: "charge", limit: "round" })]),
  passive(250113, "The Blue Reverberation", 5, [R("takingHit", [page("ranged")], [one("reduceDamage", n(100), { percent: true })])]),
  passive(250114, "Meat Gear", 2, [R("hit", [page("firstDie")], [health(d(2, 1))])]),
  passive(250115, "Locked Potential", 4, [R("use", [], [give("bladeUnlocked", n(1))], { every: 6, limit: "combat" })], { approx: "Counts every Page used, not only different ones." }),
  passive(250123, "Triple-R Suit", 1, [], { def: { cap: { effectId: "charge", max: 20 } } }),
  passive(250151, "The Messenger", 4, [R("roundStart", [], [one("addPage", n(1), { text: "Give Strength, Give Protection and Stagger Protection, Page Draw, Light Restoration" })])], {
    approx: "Make the four special Pages on the character; it adds one at random each round (no pick of two at Emotion Level 3).",
  }),
  passive(250210, "Energy Discharge", 4, [R("lost", [emotion(2)], [give("preset:strength", n(1), me, true)], { effectId: "charge", limit: "round" })]),
  dicePower(250214, "Thought Gear", 3, "evade", 1),
  passive(250222, "Retaliate", 5, [R("turnEnd", [], [{ kind: "counterDie", target: me, amount: n(5), dieKind: "slash", base: 3 }])], {
    approx: "The Counter Slash die (4-8) comes each turn and waits until my next Upkeep.",
  }),
  passive(250223, "Finishing Touch", 4, [R("use", [], [{ kind: "clear", target: all(true), amount: n(1), effectId: "finishingMark" }, give("finishingMark", n(1), them, true)])]),
  passive(250322, "The Strongest", 3, [R("speed", [], [one("rollMax")])], { approx: "The app rolls one Speed for all of a character's Speed Dice, so it's that roll." }),
  passive(251001, "Rabbit Augmentation", 4, [lowHp(30, "haste", 3)], { approx: "Counts Health missing now, not Health lost over the whole combat." }),
  passive(251002, "Rhino Procedure", 4, [lowHp(30, "preset:endurance", 2)], { approx: "Counts Health missing now, not Health lost over the whole combat." }),
  passive(251003, "Reindeer Treatment", 4, [lowHp(30, "preset:strength", 2)], { approx: "Counts Health missing now, not Health lost over the whole combat." }),
  passive(251101, "Compressed Charge-stimulated Muscleforce", 3, [R("roundStart", [has("charge", "me", 11)], [give("haste", n(1))])]),
  passive(251102, "Bionic Charge-synchronized Hull", 3, [R("roundStart", [has("charge", "me", 11)], [give("protection", n(2))])]),
  passive(251103, "Brainwave Charge-focusing Antlers", 3, [R("hit", [has("charge", "me", 11)], [stagger(n(2))])], { approx: "Checks Charge when the attack happens, not at the start of the round." }),
  passive(251201, "Sufficient Ammo", 3, [], {
    def: { note: "Combat Pages whose default type is Ranged don't run out when used." }, approx: "Nothing to automate: Combat Deck Pages already go back to the discard pile after use." }),
  passive(252001, "Mercy", 2, [R("roll", [die("offensive"), { kind: "health", whose: "them", cmp: "atMost", n: 9 }], [power(n(1))])]),
  passive(252002, "Stiletto", 7, [R("roll", [die("pierce")], [power(n(2))]), R("roll", [die("slash")], [lowerPower(n(2))]), R("roll", [die("blunt")], [lowerPower(n(2))])]),
  passive(252003, "Chink in One’s Armor", 4, [R("use", [page("melee"), { kind: "speed", cmp: "atLeast", amount: { kind: "speed", whose: "them", plus: 3 } }], [give("armorChink", n(1), them)])], {
    approx: "Their next Block die rolls 0 instead of being taken away.",
  }),
  passive(253001, "Mirage", 4, [R("takingDamage", [{ kind: "damage", damageType: "stagger", source: "any" }], [give("mirage", event())])], { approx: "Half rounds down, so 1 Stagger damage recovers nothing." }),
  passive(253002, "Hawk's Eye", 4, [R("roundEnd", [], [give("protection", n(2), { who: "mostHurt" }, true)])], { approx: "Picks whoever on my side has the lowest Health %." }),
  passive(253003, "Haboob", 2, [R("wasHit", [{ kind: "oneSided" }], [give("protection", n(1), me, true), give("staggerProtection", n(1), me, true)], limit("round"))]),
  passive(254001, "Insurance Benefits", 2, [R("wasHit", [{ kind: "oneSided" }], [light(1)], limit("round"))]),
  passive(254002, "Policy Form", 3, [R("roundEnd", [], [{ kind: "cancelNext", target: me, amount: n(1), effectIds: ["preset:feeble", "disarm", "bind"] }])]),
  passive(254003, "Life Insurance", 6, [R("roundEnd", [{ kind: "health", cmp: "atMost", n: 30 }], [one("addPage", n(1), { text: "Life Insurance" })])]),
  passive(255001, "Smoke Overflow", 2, [R("roundEnd", [has("smoke", "me", 8)], [give("preset:strength", n(1), me, true)])]),
  passive(255002, "Excess Supply", 2, [R("hit", [has("smoke", "me", 10)], [health(n(3))])]),
  passive(255003, "Immediate Repairs", 2, [R("staggered", [], [{ kind: "recoverStagger", target: me, amount: { kind: "maxStagger", n: 100 } }], limit("combat"))]),
  passive(255004, "Madness", 2, [
    R("roundStart", [chance(25)], [give("preset:strength", n(2))], { stop: true }),
    R("roundStart", [{ kind: "roll", sides: 3, cmp: "atMost", amount: n(1) }], [give("haste", n(2))], { stop: true }),
    R("roundStart", [chance(50)], [give("preset:endurance", n(2))], { stop: true }),
    R("roundStart", [], [give("fragile", n(5))]),
  ]),
  passive(256001, "Offensive Position", 3, [R("roundStart", [], [give("fragile", n(3)), give("preset:strength", n(1))])]),
  passive(256002, "Psych Up", 4, [R("roundEnd", [{ kind: "used", cmp: "atMost", n: 0 }], [light(1), draw(1)])]),
  passive(256003, "Readied Position", 5, [
    R("roundEnd", [has("immobilized", "me")], [give("preset:strength", n(1), me, true), give("protection", n(2), me, true), give("staggerProtection", n(2), me, true)]),
  ]),
  passive(260002, "Hana for All", 7, ["preset:strength", "preset:endurance", "protection", "staggerProtection"].map((id) => R("gained", [], [give(id, event(), random(false, 1))], { effectId: id })), {
    approx: "Counts the Effect from anything, not only Combat Pages.",
  }),
  passive(260003, "All for Hana", 4, [R("wasHit", [], [{ kind: "resist", target: me, amount: n(1), dmgType: "die", level: 50, which: "both", until: "nextRound" }])], {
    approx: "Every type that hits me becomes Endured next round, not only the one that hit hardest.",
  }),
  passive(260004, "The Twelve Fixers", 6, [R("roll", [], [one("raiseMin", n(2))]), R("roll", [emotion(3)], [one("raiseMax", n(1))])]),
  passive(260005, "Resonance", 4, [
    R("roll", [page("melee"), has("vibration", "them"), { kind: "speed", cmp: "atLeast", amount: stacks("vibration", "them", { plus: -1 }) }, { kind: "speed", cmp: "atMost", amount: stacks("vibration", "them", { plus: 1 }) }], [power(n(2))]),
    R("combatStart", [], [draw(2)]),
  ]),
  passive(260006, "Overheat", 4, [R("roll", [die("offensive"), has("preset:burn", "me")], [power(n(1))])]),
  passive(260007, "Masterful Smoker", 4, [R("roll", [page("gives", { effectId: "smoke" })], [power(n(1))])]),
  passive(260008, "Prep Up the Main Dish", 5, [R("roll", [die("offensive"), page("melee"), has("preset:bleed", "them")], [power(d(2))])]),
  passive(260009, "Neigh~! Woof-woof! Bawk!", 4, [
    R("hit", [page("melee")], [give("preset:feeble", n(1), them, true)], { limit: "round", stop: true }),
    R("hit", [page("melee")], [give("paralysis", n(1), them, true)], { limit: "round", stop: true }),
    R("hit", [page("melee")], [{ kind: "staggerDamage", target: them, amount: n(2) }], { limit: "round", stop: true }),
    R("hit", [page("melee")], [{ kind: "recoverStagger", target: me, amount: n(2) }], { limit: "round", stop: true }),
  ], { approx: "The four effects come in this order instead of at random." }),
  passive(260010, "Splendid Performance", 4, [R("roll", [page("kinds", { cmp: "atLeast", n: 3 })], [power(n(1))]), R("hit", [page("kinds", { cmp: "atLeast", n: 3 })], [health(n(1))])]),
  passive(260011, "Guts", 8, [R("takingDamage", [lethal], [one("reduceDamage", event()), heal(n(100)), give("guts", n(1))], limit("combat"))]),
  passive(260013, "Bloodfiendish", 6, [
    R("hit", [], [heal(n(2))]),
    R("healed", [], [give("bloodfiend", event())]),
    R("roundEnd", [has("bloodfiend", "me", 3)], [give("preset:strength", n(1), me, true)]),
  ]),
  passive(1300001, "Nuovo Fabric", 3, [R("takingDamage", [{ kind: "damage", damageType: "any", source: "attack" }], [one("reduceDamage", d(2))])]),
];

/** Passives left to the GM: tied to one named character, or to that character's own unique Pages and mechanics. */
export const EXCLUDED: { id: number; name: string; why: string }[] = [
  { id: 10005, name: "The Red Mist", why: "Gebura (The Red Mist); no description to automate." },
  { id: 10010, name: "Binah", why: "Binah's unique Key Page." },
  { id: 10012, name: "Orlando", why: "Roland's unique Key Page." },
  { id: 10013, name: "The Black Silence", why: "Roland (The Black Silence)." },
  { id: 250122, name: "Legendary", why: "Only Gebura can equip it; unlocks her unique E.G.O." },
  { id: 250036, name: "Nine Children of the Dragon", why: "Manifests one character's unique E.G.O." },
  { id: 250127, name: "Changing Stances", why: "One character's four stances, each with its own deck." },
  { id: 260001, name: "Four Trigrams", why: "One character's four special Pages and their play rules." },
  { id: 260012, name: "Puppet Strings", why: "One character's special Page and the status it gives an ally." },
  { id: 260014, name: "Contracts", why: "One character's Unsigned Contract Pages and their conditions." },
  { id: 250051, name: "얀샋ㄷ요무", why: "Counts Breakdown and Awakening Abnormality Pages, which the app doesn't have." },
  { id: 1005011, name: "Facing the Past", why: "Angela's final battle." },
  { id: 1005012, name: "Angela", why: "Angela's unique Key Page." },
  { id: 1005013, name: "Director of her Role’s Namesake", why: "Angela's Key Page." },
  { id: 1005014, name: "The Seed of Light", why: "Angela's Key Page." },
  { id: 1005015, name: "???", why: "Angela's Key Page (E.G.O. by battle phase)." },
];
