// Automated Effects and Passives (Act 7, "Effects" and "Passives"), built from menu pieces so
// anyone can make one without writing code. An Effect is a few rules shaped like
//   When <something happens>, if <checks>, do <actions>
// where every blank is picked from a list (WHEN_OPTIONS, CHECK_OPTIONS, ACTION_OPTIONS, AMOUNT_OPTIONS,
// WHO_OPTIONS), plus how its stacks go away (DECAY_OPTIONS). describeEffect turns the pieces back into card
// text. The host runs them from shared/combat.ts through runTrigger, which never runs anything but these pieces.
//
// Firestore: games/{gameId}/effects/{effectId}  EffectDef  members read; GM write (players too when the
// GM's Game settings allow, but their effects only work once the GM approves them).
import type { Character, Dice, DiceKind, Passive, Proficiency } from "./character.ts";
import { newId, rollDie } from "./id.ts";

// ---- The pieces ----

/** When a rule runs. "Me" is the character the Effect is on (or whose Passive it is). */
export type When =
  | "combatStart"
  | "combatEnd"
  | "roundStart"
  | "roundEnd"
  | "turnStart"
  | "turnEnd"
  | "speed"
  | "use"
  | "roll"
  | "theyRoll"
  | "hit"
  | "wasHit"
  | "clashWin"
  | "clashLose"
  | "takingHit"
  | "takingDamage"
  | "knockOut"
  | "staggered"
  | "panic"
  | "effectFires"
  | "effectFiresOnThem"
  | "gained"
  | "gave";

export const WHEN_OPTIONS: { value: When; label: string; hint: string }[] = [
  { value: "turnEnd", label: "At the end of my turn", hint: "After Combat Actions" },
  { value: "turnStart", label: "At the start of my turn", hint: "After Upkeep, before Combat Actions" },
  { value: "roundEnd", label: "At the end of the round", hint: "Once everyone has had their turn" },
  { value: "roundStart", label: "At the start of the round", hint: "Before the first turn of each round, round 1 included" },
  { value: "combatStart", label: "When combat starts", hint: "Once, when the Combat Encounter begins" },
  { value: "combatEnd", label: "When combat ends", hint: "Once, when the GM ends the Combat Encounter" },
  { value: "speed", label: "When I roll Speed", hint: "Change my Speed roll here" },
  { value: "use", label: "When I use a Page", hint: "On Use: right after paying its Light" },
  { value: "roll", label: "When I roll a die", hint: "Change the die's Power here" },
  { value: "theyRoll", label: "When someone rolls against me", hint: "Change their die's Power here (On Clash)" },
  { value: "hit", label: "When I hit someone", hint: "One of my Offensive Dice lands; add damage here" },
  { value: "wasHit", label: "When I'm hit", hint: "After an Offensive Die deals me damage" },
  { value: "takingHit", label: "When an attack is about to hit me", hint: "Before Resistances; raise or lower the damage here" },
  { value: "takingDamage", label: "When I'm about to take damage", hint: "Health or Stagger damage from anything, after Resistances" },
  { value: "clashWin", label: "When I win a Clash", hint: "One of my dice beats theirs" },
  { value: "clashLose", label: "When I lose a Clash", hint: "One of their dice beats mine" },
  { value: "knockOut", label: "When I Knock Someone Out", hint: "A killing blow, from my die or my effect" },
  { value: "staggered", label: "When I'm Staggered", hint: "My Stagger Resist reaches 0" },
  { value: "panic", label: "When I Panic", hint: "My Sanity reaches its minimum" },
  { value: "effectFires", label: "When one of my Effects triggers", hint: "A status Effect on me fires (a Critical Hit…)" },
  { value: "effectFiresOnThem", label: "When I set off their Effect", hint: "An Effect on the one I hit or clash with fires (a Burst, a Devastating Hit…)" },
  { value: "gained", label: "When I gain an Effect", hint: "Someone (or something) gives me stacks" },
  { value: "gave", label: "When I give someone an Effect", hint: "One of my rules gives someone stacks" },
];

/** A Dice effect's When, worded for the die it's on. Only these make sense for a die. */
export const DIE_WHEN_OPTIONS: { value: When; label: string; hint: string }[] = [
  { value: "use", label: "When this die's Page is used", hint: "On Use: right after paying its Light" },
  { value: "roll", label: "When this die is rolled", hint: "Change its Power here" },
  { value: "hit", label: "When this die hits", hint: "It lands on someone; add damage here" },
  { value: "clashWin", label: "When this die wins a Clash", hint: "It beats the other die" },
  { value: "clashLose", label: "When this die loses a Clash", hint: "The other die beats it" },
  { value: "effectFires", label: "When this die sets off my Effect", hint: "A status Effect on me fires with this die (a Critical Hit…)" },
  { value: "effectFiresOnThem", label: "When this die sets off their Effect", hint: "An Effect on the one it hits fires (a Burst, a Devastating Hit…)" },
  { value: "gave", label: "When this die gives someone an Effect", hint: "One of this die's rules gives stacks" },
];

/** The When menu for a kind of effect. */
export const whenOptions = (kind: EffectKind) => (kind === "die" ? DIE_WHEN_OPTIONS : WHEN_OPTIONS);

/** Triggers about one Effect in particular: the rule can name it (missing = any). */
export const EFFECT_WHENS: When[] = ["effectFires", "effectFiresOnThem", "gained", "gave"];

/** Who "them" is depends on When: the one I hit, who hit me, who I clashed with, who gave me stacks… */
const HAS_OTHER: Record<When, boolean> = {
  combatStart: false,
  combatEnd: false,
  roundStart: false,
  roundEnd: false,
  turnStart: false,
  turnEnd: false,
  speed: false,
  use: true,
  roll: true,
  theyRoll: true,
  hit: true,
  wasHit: true,
  clashWin: true,
  clashLose: true,
  takingHit: true,
  takingDamage: true,
  knockOut: true,
  staggered: false,
  panic: false,
  effectFires: true,
  effectFiresOnThem: true,
  gained: true,
  gave: true,
};
/** Triggers that involve one of the dice, so "the die" checks and amounts make sense. */
const HAS_DIE: Record<When, boolean> = { ...HAS_OTHER, use: false, takingDamage: false, knockOut: false, gained: false, gave: false, effectFires: false, effectFiresOnThem: false };
/** Triggers that change a die roll (Power, Max, advantage). */
const ROLLS: When[] = ["roll", "theyRoll", "speed"];
/** Triggers where incoming damage can be raised or lowered. */
const DAMAGE_WHENS: When[] = ["takingHit", "takingDamage"];
/** Triggers that carry a number, for "That many". */
const HAS_EVENT: When[] = ["takingHit", "takingDamage", "effectFires", "effectFiresOnThem", "gained", "gave"];

/** How much: picked from a list, never typed as a formula. */
export type AmountKind = "number" | "perStack" | "halfStacks" | "roll" | "dieRoll" | "stat" | "effectStacks" | "rolls" | "event" | "healthLost";

export type Whose = "me" | "them";

export interface Amount {
  kind: AmountKind;
  /** number: the number. perStack / effectStacks: how much per stack. */
  n?: number;
  /** roll / rolls: the die size (1d4 to 1d20). */
  sides?: number;
  /** stat: which Stat (Primary or Secondary). */
  stat?: string;
  /** effectStacks / rolls: whose stacks of which Effect (rolls without one: this Effect's stacks). */
  effectId?: string;
  whose?: Whose;
  /** Divided by this, rounded down (rolls: fewer dice). Missing or 1: not divided. */
  per?: number;
  /** Added after dividing (can be negative). */
  plus?: number;
  /** At most this much. Missing or 0: no limit. */
  max?: number;
}

export const AMOUNT_OPTIONS: { value: AmountKind; label: string }[] = [
  { value: "number", label: "A number" },
  { value: "perStack", label: "Per stack" },
  { value: "halfStacks", label: "Half the stacks" },
  { value: "effectStacks", label: "Stacks of an Effect" },
  { value: "roll", label: "A die roll" },
  { value: "rolls", label: "A die roll per stack" },
  { value: "dieRoll", label: "Another roll of this die" },
  { value: "stat", label: "One of my Stats" },
  { value: "healthLost", label: "% of my Health lost" },
  { value: "event", label: "That many (from the trigger)" },
];

export type Who = "me" | "them" | "alliesNear" | "enemiesNear";

export interface Target {
  who: Who;
  /** alliesNear / enemiesNear: within this many tiles. */
  range?: number;
}

export const WHO_OPTIONS: { value: Who; label: string }[] = [
  { value: "me", label: "I" },
  { value: "them", label: "They" },
  { value: "enemiesNear", label: "Enemies near me" },
  { value: "alliesNear", label: "Allies near me" },
];

export type CheckKind = "roll" | "stacks" | "effect" | "die" | "health" | "sanity" | "state" | "round" | "count" | "damage";

/** One "only if" condition. Every check on a rule must pass. */
export interface Check {
  kind: CheckKind;
  /** roll: the die rolled (d4 to d20). */
  sides?: number;
  /** compare at most or at least. */
  cmp?: "atMost" | "atLeast";
  /** roll: what the roll is compared to. */
  amount?: Amount;
  /** stacks / effect: how many. health: the percent of max Health. sanity: Sanity. round: the round. count: how many characters. */
  n?: number;
  /** die: the kind of die rolled. */
  dieKind?: DiceKind | "offensive" | "defensive";
  /** effect / health / sanity / state: on whom. */
  whose?: Whose;
  /** effect: which Effect. damage: from which Effect (missing: any Effect). */
  effectId?: string;
  /** effect: count only the stacks I gave them (Marks). */
  mine?: boolean;
  /** state: Staggered or in Panic. */
  state?: "staggered" | "panic";
  /** state: false for "isn't". */
  is?: boolean;
  /** count: allies or enemies (never me), Knocked Out ones only, within this many tiles (missing: anywhere). */
  side?: "allies" | "enemies";
  down?: boolean;
  range?: number;
  /** damage: Health or Stagger damage, from an attack or an Effect. */
  damageType?: "any" | "health" | "stagger";
  source?: "any" | "attack" | "effect";
}

export const CHECK_OPTIONS: { value: CheckKind; label: string }[] = [
  { value: "roll", label: "A die roll" },
  { value: "stacks", label: "My stacks" },
  { value: "effect", label: "Stacks of an Effect" },
  { value: "die", label: "The kind of die" },
  { value: "health", label: "Health" },
  { value: "sanity", label: "Sanity" },
  { value: "state", label: "Staggered or Panicking" },
  { value: "round", label: "The round" },
  { value: "count", label: "How many allies or enemies" },
  { value: "damage", label: "The kind of damage" },
];

export type ActionKind =
  | "damage"
  | "staggerDamage"
  | "heal"
  | "recoverStagger"
  | "gainLight"
  | "loseLight"
  | "gainSanity"
  | "loseSanity"
  | "addPower"
  | "lowerPower"
  | "raiseMax"
  | "lowerMax"
  | "advantage"
  | "disadvantage"
  | "extraDamage"
  | "reduceDamage"
  | "increaseDamage"
  | "shield"
  | "give"
  | "take"
  | "clear"
  | "activate"
  | "gainStacks"
  | "loseStacks"
  | "gainMovement"
  | "loseMovement"
  | "push"
  | "pull"
  | "draw";

/** One thing a rule does. */
export interface Action {
  kind: ActionKind;
  /** Who it happens to (actions that only make sense for "me" ignore this). */
  target?: Target;
  amount: Amount;
  /** give / take / clear / activate: the Effect. */
  effectId?: string;
  /** give: the stacks arrive at the start of the next round ("next round"), not now. */
  later?: boolean;
}

/** Every action, its menu label, and which When it makes sense with (missing = any). */
export const ACTION_OPTIONS: { value: ActionKind; label: string; targets: boolean; only?: When[]; effect?: boolean; noAmount?: boolean }[] = [
  { value: "damage", label: "Take damage", targets: true },
  { value: "staggerDamage", label: "Take Stagger damage", targets: true },
  { value: "heal", label: "Recover Health", targets: true },
  { value: "recoverStagger", label: "Recover Stagger Resist", targets: true },
  { value: "gainLight", label: "Gain Light", targets: true },
  { value: "loseLight", label: "Lose Light", targets: true },
  { value: "gainSanity", label: "Gain Sanity", targets: true },
  { value: "loseSanity", label: "Lose Sanity", targets: true },
  { value: "give", label: "Gain an Effect", targets: true, effect: true },
  { value: "take", label: "Lose stacks of an Effect", targets: true, effect: true },
  { value: "clear", label: "Lose all of an Effect", targets: true, effect: true, noAmount: true },
  { value: "activate", label: "Set off an Effect now", targets: true, effect: true, noAmount: true },
  { value: "gainMovement", label: "Gain Movement this turn", targets: true },
  { value: "loseMovement", label: "Lose Movement this turn", targets: true },
  { value: "push", label: "Get pushed away from me", targets: true },
  { value: "pull", label: "Get pulled toward me", targets: true },
  { value: "addPower", label: "Add Power to the die", targets: false, only: ROLLS },
  { value: "lowerPower", label: "Lower the die's Power", targets: false, only: ROLLS },
  { value: "raiseMax", label: "Raise the die's Max", targets: false, only: ROLLS },
  { value: "lowerMax", label: "Lower the die's Max", targets: false, only: ROLLS },
  { value: "advantage", label: "Roll it with advantage", targets: false, only: ROLLS, noAmount: true },
  { value: "disadvantage", label: "Roll it with disadvantage", targets: false, only: ROLLS, noAmount: true },
  { value: "extraDamage", label: "Deal extra damage", targets: false, only: ["hit"] },
  { value: "increaseDamage", label: "Take more damage", targets: false, only: DAMAGE_WHENS },
  { value: "reduceDamage", label: "Take less damage", targets: false, only: DAMAGE_WHENS },
  { value: "shield", label: "Block it with this Effect's stacks", targets: false, only: DAMAGE_WHENS },
  { value: "gainStacks", label: "This gains stacks", targets: false },
  { value: "loseStacks", label: "This loses stacks", targets: false },
  { value: "draw", label: "Draw Pages", targets: false },
];

/** How a status Effect's stacks go away on their own. */
export type Decay =
  | "none"
  | "halfAtTurnEnd"
  | "oneAtTurnEnd"
  | "allAtTurnEnd"
  | "halfAtRoundEnd"
  | "oneAtRoundEnd"
  | "allAtRoundEnd"
  | "allAfterTrigger"
  | "halfAfterTrigger"
  | "oneAfterTrigger";

export const DECAY_OPTIONS: { value: Decay; label: string }[] = [
  { value: "none", label: "Never goes away on its own" },
  { value: "halfAtTurnEnd", label: "Lose half at the end of my turn" },
  { value: "oneAtTurnEnd", label: "Lose 1 at the end of my turn" },
  { value: "allAtTurnEnd", label: "Lose all at the end of my turn" },
  { value: "halfAtRoundEnd", label: "Lose half at the end of the round" },
  { value: "oneAtRoundEnd", label: "Lose 1 at the end of the round" },
  { value: "allAtRoundEnd", label: "Lose all at the end of the round" },
  { value: "allAfterTrigger", label: "Lose all after it triggers" },
  { value: "halfAfterTrigger", label: "Lose half after it triggers" },
  { value: "oneAfterTrigger", label: "Lose 1 after it triggers" },
];

/** How often a rule may fire. */
export type Limit = "always" | "round" | "combat";

export const LIMIT_OPTIONS: { value: Limit; label: string }[] = [
  { value: "always", label: "every time" },
  { value: "round", label: "once a round" },
  { value: "combat", label: "once a combat" },
];

export interface Rule {
  id: string;
  when: When;
  /** effectFires / effectFiresOnThem / gained / gave: only for this Effect (missing: any). */
  effectId?: string;
  /** Missing: every time. */
  limit?: Limit;
  checks: Check[];
  actions: Action[];
}

/**
 * What an entry in the effect library is:
 * - status: sits on a character with a number of stacks (Burn, Poise…).
 * - passive: slotted on an Augment, Weapon or Armor (with a Passive Cost); always on for its owner.
 * - proficiency: picked on a character's Proficiencies; always on for its owner.
 * - die: slotted on a die of a Page; runs only when that die is rolled, hits or clashes.
 * Passives and Proficiencies can be plain text with no rules: the GM handles them by hand.
 */
export type EffectKind = "status" | "passive" | "proficiency" | "die";

export const EFFECT_KINDS: { value: EffectKind; label: string; plural: string; hint: string }[] = [
  { value: "status", label: "Status effect", plural: "Status effects", hint: "Sits on a character with stacks, like Burn or Poise" },
  { value: "passive", label: "Passive", plural: "Passives", hint: "Slotted on an Augment, Weapon or Armor, with a Passive Cost" },
  { value: "proficiency", label: "Proficiency", plural: "Proficiencies", hint: "Picked on a character's Proficiencies" },
  { value: "die", label: "Dice effect", plural: "Dice effects", hint: "Slotted on a die of a Page; works only for that die" },
];

/** Library entries that are always on for whoever has them (no stacks). */
export const isAlwaysOn = (kind: EffectKind) => kind !== "status";

/** An entry in the game's effect library. */
export interface EffectDef {
  name: string;
  kind: EffectKind;
  /** Passives: the Passive Cost (negative for a Negative Passive). */
  cost?: number;
  /** What it does in words: the description of a Passive or Proficiency the GM handles by hand, or extra card text. */
  note?: string;
  decay: Decay;
  /** Stacks can't go above this (missing: 99). */
  maxStacks?: number;
  /** Status effects: while this is on a character, that Effect of theirs doesn't lose stacks on its own (Renewed Blaze). */
  holds?: string;
  /** Status effects: each character's stacks are kept apart, so rules can ask for "the ones I gave" (Marks). */
  bySource?: boolean;
  rules: Rule[];
  /** The player who made it, when the GM lets players make effects. Missing: the GM's. */
  createdBy?: string;
  /** Set by the GM on a player's effect; until then it does nothing at the table. */
  approved?: boolean;
  updatedAt?: number;
}

export const MAX_STACKS = 99;
const DIE_SIZES = [4, 6, 8, 10, 12, 20];
/** Effects can set off other effects (Burn given on hit…), but only this many deep. */
const MAX_DEPTH = 4;

// ---- Built-in effects ----

const amt = (kind: AmountKind, extra: Partial<Amount> = {}): Amount => ({ kind, ...extra });
const me: Target = { who: "me" };

/** Ready-made effects every game has. Copy one ("Make a variant") to change it. */
export const PRESET_EFFECTS: Record<string, EffectDef> = {
  "preset:burn": {
    name: "Burn",
    kind: "status",
    decay: "halfAtTurnEnd",
    rules: [{ id: "r1", when: "turnEnd", checks: [], actions: [{ kind: "damage", target: me, amount: amt("perStack", { n: 1 }) }] }],
  },
  "preset:rupture": {
    name: "Rupture",
    kind: "status",
    decay: "allAfterTrigger",
    rules: [{ id: "r1", when: "wasHit", checks: [], actions: [{ kind: "damage", target: me, amount: amt("perStack", { n: 1 }) }] }],
  },
  "preset:poise": {
    name: "Poise",
    kind: "status",
    decay: "none",
    rules: [
      {
        id: "r1",
        when: "hit",
        checks: [{ kind: "roll", sides: 10, cmp: "atMost", amount: amt("perStack", { n: 1 }) }],
        actions: [{ kind: "extraDamage", amount: amt("dieRoll") }],
      },
    ],
  },
  "preset:bleed": {
    name: "Bleed",
    kind: "status",
    decay: "halfAtTurnEnd",
    rules: [
      {
        id: "r1",
        when: "roll",
        checks: [{ kind: "die", dieKind: "offensive" }],
        actions: [{ kind: "damage", target: me, amount: amt("perStack", { n: 1 }) }],
      },
    ],
  },
  "preset:strength": {
    name: "Strength",
    kind: "status",
    decay: "allAtTurnEnd",
    rules: [{ id: "r1", when: "roll", checks: [{ kind: "die", dieKind: "offensive" }], actions: [{ kind: "addPower", amount: amt("perStack", { n: 1 }) }] }],
  },
  "preset:feeble": {
    name: "Feeble",
    kind: "status",
    decay: "allAtTurnEnd",
    rules: [{ id: "r1", when: "roll", checks: [{ kind: "die", dieKind: "offensive" }], actions: [{ kind: "lowerPower", amount: amt("perStack", { n: 1 }) }] }],
  },
  "preset:endurance": {
    name: "Endurance",
    kind: "status",
    decay: "allAtTurnEnd",
    rules: [{ id: "r1", when: "roll", checks: [{ kind: "die", dieKind: "defensive" }], actions: [{ kind: "addPower", amount: amt("perStack", { n: 1 }) }] }],
  },
};

export const isPreset = (id: string) => id.startsWith("preset:");

/** Whether an effect does anything at the table: the GM's always do; a player's once approved. */
export function isLive(def: EffectDef | undefined): def is EffectDef {
  return !!def && (!def.createdBy || def.approved === true);
}

/** The built-in effects plus a game's own, by id. */
export function effectLibrary(game: Record<string, EffectDef> | undefined): Record<string, EffectDef> {
  // Cleaned on the way in too, so a hand-edited or older entry can't break the editor or the table.
  const own = Object.fromEntries(Object.entries(game ?? {}).map(([id, d]) => [id, cleanEffect(d)]));
  return { ...PRESET_EFFECTS, ...own };
}

// ---- Blank pieces, for the editor ----

export const blankAmount = (): Amount => ({ kind: "number", n: 1 });

export const blankAction = (kind: ActionKind = "damage"): Action => {
  const opt = ACTION_OPTIONS.find((o) => o.value === kind)!;
  const a: Action = { kind, amount: blankAmount() };
  if (opt.targets) a.target = { who: kind === "push" || kind === "pull" ? "them" : "me" };
  if (opt.effect) a.effectId = "preset:burn";
  if (kind === "extraDamage") a.amount = { kind: "roll", sides: 4 };
  return a;
};

export function blankCheck(kind: CheckKind = "roll"): Check {
  switch (kind) {
    case "roll":
      return { kind, sides: 10, cmp: "atMost", amount: { kind: "perStack", n: 1 } };
    case "stacks":
      return { kind, cmp: "atLeast", n: 3 };
    case "effect":
      return { kind, whose: "them", effectId: "preset:burn", cmp: "atLeast", n: 1 };
    case "die":
      return { kind, dieKind: "offensive" };
    case "health":
      return { kind, cmp: "atMost", n: 50 };
    case "sanity":
      return { kind, cmp: "atMost", n: 0 };
    case "state":
      return { kind, whose: "them", state: "staggered" };
    case "round":
      return { kind, cmp: "atMost", n: 1 };
    case "count":
      return { kind, side: "allies", cmp: "atLeast", n: 1 };
    case "damage":
      return { kind, damageType: "health", source: "attack" };
  }
}

/** The first action a new rule (or "+ Do something else") gets, picked to fit its When. */
export const blankActionFor = (when: When): Action => blankAction(when === "hit" ? "extraDamage" : ROLLS.includes(when) ? "addPower" : DAMAGE_WHENS.includes(when) ? "reduceDamage" : "damage");

export const blankRule = (when: When = "turnEnd"): Rule => ({ id: newId(), when, checks: [], actions: [blankActionFor(when)] });

/** A new library entry. Passives and Proficiencies start as plain text; add rules to automate them. */
export function blankEffect(kind: EffectKind = "status"): EffectDef {
  const def: EffectDef = { name: "", kind, decay: kind === "status" ? "halfAtTurnEnd" : "none", rules: [] };
  if (kind === "status") def.rules = [blankRule()];
  if (kind === "die") def.rules = [blankRule("hit")];
  if (kind === "passive") def.cost = 1;
  return def;
}

/** A copy of an effect to change, e.g. a variant of a built-in one. */
export function copyEffect(def: EffectDef, name = def.name): EffectDef {
  const { createdBy: _c, approved: _a, updatedAt: _u, ...rest } = structuredClone(def);
  return { ...rest, name, rules: rest.rules.map((r) => ({ ...r, id: newId() })) };
}

// ---- Cleaning (anything saved or sent is checked against the menus) ----

const oneOf = <T extends string>(v: unknown, list: readonly { value: T }[], d: T): T => (list.some((o) => o.value === v) ? (v as T) : d);
const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const id80 = (v: unknown, d = "") => String(v ?? d).slice(0, 80);
const DIE_KIND_CHECKS = ["slash", "pierce", "blunt", "block", "evade", "offensive", "defensive"] as const;

function cleanAmount(raw: unknown): Amount {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Amount>;
  const kind = oneOf(r.kind, AMOUNT_OPTIONS, "number");
  let a: Amount;
  if (kind === "number") a = { kind, n: int(r.n, 0, 99, 1) };
  else if (kind === "perStack") a = { kind, n: int(r.n, 1, 20, 1) };
  else if (kind === "roll") a = { kind, sides: DIE_SIZES.includes(Number(r.sides)) ? Number(r.sides) : 6 };
  else if (kind === "stat") a = { kind, stat: String(r.stat ?? "justice").slice(0, 40) };
  else if (kind === "effectStacks") a = { kind, n: int(r.n, 1, 20, 1), effectId: id80(r.effectId, "preset:burn"), whose: r.whose === "them" ? "them" : "me" };
  else if (kind === "rolls") {
    a = { kind, sides: DIE_SIZES.includes(Number(r.sides)) ? Number(r.sides) : 10 };
    if (r.effectId) Object.assign(a, { effectId: id80(r.effectId), whose: r.whose === "them" ? "them" : "me" });
  } else a = { kind };
  const per = int(r.per, 1, 99, 1);
  const plus = int(r.plus, -99, 99, 0);
  const max = int(r.max, 0, 999, 0);
  if (per > 1) a.per = per;
  if (plus) a.plus = plus;
  if (max) a.max = max;
  return a;
}

function cleanTarget(raw: unknown): Target {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Target>;
  const who = oneOf(r.who, WHO_OPTIONS, "me");
  return who === "alliesNear" || who === "enemiesNear" ? { who, range: int(r.range, 1, 20, 2) } : { who };
}

const WHOSE = (r: Partial<Check>) => (r.whose === "them" ? { whose: "them" as const } : {});
const DAMAGE_TYPES = [{ value: "any" as const }, { value: "health" as const }, { value: "stagger" as const }];
const SOURCES = [{ value: "any" as const }, { value: "attack" as const }, { value: "effect" as const }];

function cleanCheck(raw: unknown): Check {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Check>;
  const c = blankCheck(oneOf(r.kind, CHECK_OPTIONS, "roll"));
  const cmp = r.cmp === "atLeast" || r.cmp === "atMost" ? r.cmp : c.cmp;
  switch (c.kind) {
    case "roll":
      return { kind: "roll", sides: DIE_SIZES.includes(Number(r.sides)) ? Number(r.sides) : 10, cmp, amount: cleanAmount(r.amount) };
    case "stacks":
      return { kind: "stacks", cmp, n: int(r.n, 0, MAX_STACKS, 3) };
    case "effect":
      return { kind: "effect", ...WHOSE(r), effectId: id80(r.effectId, "preset:burn"), cmp, n: int(r.n, 0, MAX_STACKS, 1), ...(r.mine === true ? { mine: true } : {}) };
    case "health":
      return { kind: "health", ...WHOSE(r), cmp, n: int(r.n, 0, 100, 50) };
    case "sanity":
      return { kind: "sanity", ...WHOSE(r), cmp, n: int(r.n, -99, 99, 0) };
    case "state":
      return { kind: "state", ...WHOSE(r), state: r.state === "panic" ? "panic" : "staggered", ...(r.is === false ? { is: false } : {}) };
    case "round":
      return { kind: "round", cmp, n: int(r.n, 1, 99, 1) };
    case "count":
      return {
        kind: "count",
        side: r.side === "enemies" ? "enemies" : "allies",
        cmp,
        n: int(r.n, 0, 20, 1),
        ...(r.down === true ? { down: true } : {}),
        ...(r.range != null ? { range: int(r.range, 1, 20, 2) } : {}),
      };
    case "damage": {
      const source = oneOf(r.source, SOURCES, "any");
      return { kind: "damage", damageType: oneOf(r.damageType, DAMAGE_TYPES, "any"), source, ...(source === "effect" && r.effectId ? { effectId: id80(r.effectId) } : {}) };
    }
    case "die":
      return { kind: "die", dieKind: (DIE_KIND_CHECKS as readonly string[]).includes(String(r.dieKind)) ? (r.dieKind as Check["dieKind"]) : "offensive" };
  }
}

function cleanAction(raw: unknown): Action {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Action>;
  const kind = oneOf(r.kind, ACTION_OPTIONS, "damage");
  const opt = ACTION_OPTIONS.find((o) => o.value === kind)!;
  const a: Action = { kind, amount: cleanAmount(r.amount) };
  if (opt.targets) a.target = cleanTarget(r.target);
  if (opt.effect) a.effectId = id80(r.effectId);
  if (kind === "give" && r.later === true) a.later = true;
  return a;
}

/** An effect as it may be saved: only known pieces, sensible numbers, and limits on size. */
export function cleanEffect(raw: unknown): EffectDef {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<EffectDef>;
  const kind = oneOf(r.kind, EFFECT_KINDS, "status");
  const def: EffectDef = {
    name: String(r.name ?? "").slice(0, 60),
    kind,
    decay: kind === "status" ? oneOf(r.decay, DECAY_OPTIONS, "none") : "none",
    rules: (Array.isArray(r.rules) ? r.rules : []).slice(0, 8).map((rule) => {
      const when = oneOf(rule?.when, whenOptions(kind), kind === "die" ? "hit" : "turnEnd");
      const out: Rule = { id: String(rule?.id || newId()).slice(0, 40), when, checks: [], actions: [] };
      if (EFFECT_WHENS.includes(when) && rule?.effectId) out.effectId = id80(rule.effectId);
      if (rule?.limit === "round" || rule?.limit === "combat") out.limit = rule.limit;
      out.checks = (Array.isArray(rule?.checks) ? rule.checks : []).slice(0, 4).map(cleanCheck);
      out.actions = (Array.isArray(rule?.actions) ? rule.actions : []).slice(0, 6).map(cleanAction);
      return out;
    }),
  };
  if (kind === "passive") def.cost = int(r.cost, -20, 20, 1);
  if (r.note) def.note = String(r.note).slice(0, 1000);
  if (kind === "status" && r.maxStacks != null && r.maxStacks !== ("" as unknown)) def.maxStacks = int(r.maxStacks, 1, MAX_STACKS, MAX_STACKS);
  if (kind === "status" && r.holds) def.holds = id80(r.holds);
  if (kind === "status" && r.bySource === true) def.bySource = true;
  if (r.createdBy) def.createdBy = String(r.createdBy);
  if (r.createdBy && r.approved === true) def.approved = true;
  if (r.updatedAt) def.updatedAt = Number(r.updatedAt) || 0;
  return def;
}

// ---- Card text ----

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);
const nameOf = (library: Record<string, EffectDef>, id: string | undefined, d = "an Effect") => (id && library[id]?.name) || d;

function amountText(a: Amount, unit: string, stats: Record<string, string> = {}, library: Record<string, EffectDef> = PRESET_EFFECTS): string {
  const u = unit ? ` ${unit}` : "";
  const equal = (what: string) => (unit ? `${unit} equal to ${what}` : what);
  const whose = a.whose === "them" ? "their" : "my";
  let text: string;
  switch (a.kind) {
    case "number":
      text = `${a.n ?? 0}${u}`;
      break;
    case "perStack":
      text = `${a.n ?? 1}${u} per stack`;
      break;
    case "halfStacks":
      text = equal("half the stacks");
      break;
    case "roll":
      text = `1d${a.sides ?? 6}${u}`;
      break;
    case "rolls": {
      const per = a.per && a.per > 1 ? `${a.per} ` : "";
      text = `1d${a.sides ?? 10}${u} per ${per}${a.effectId ? `${nameOf(library, a.effectId)} on ${a.whose === "them" ? "them" : "me"}` : plural(a.per ?? 1, "stack")}`;
      break;
    }
    case "dieRoll":
      text = equal("another roll of this die");
      break;
    case "stat":
      text = equal(`my ${stats[a.stat ?? ""] ?? a.stat}`);
      break;
    case "effectStacks":
      text = equal(`${(a.n ?? 1) > 1 ? `${a.n} × ` : ""}${whose} ${nameOf(library, a.effectId)}`);
      break;
    case "event":
      text = equal("that amount");
      break;
    case "healthLost":
      text = equal("the % of my Health I've lost");
      break;
  }
  if (a.per && a.per > 1 && a.kind !== "rolls") text += ` ÷ ${a.per}`;
  if (a.plus) text += ` ${a.plus > 0 ? "+" : "−"} ${Math.abs(a.plus)}`;
  if (a.max) text += ` (at most ${a.max})`;
  return text;
}

function whoText(t: Target | undefined): string {
  switch (t?.who) {
    case "them":
      return "they";
    case "alliesNear":
      return `allies within ${t.range ?? 2} ${plural(t.range ?? 2, "tile")}`;
    case "enemiesNear":
      return `enemies within ${t.range ?? 2} ${plural(t.range ?? 2, "tile")}`;
    default:
      return "I";
  }
}

/** The same, as an object: "me", "them", "allies within 2 tiles". */
const whomText = (t: Target | undefined) => (t?.who === "them" ? "them" : t?.who === "me" || !t ? "me" : whoText(t));

const DIE_KIND_TEXT: Record<NonNullable<Check["dieKind"]>, string> = {
  slash: "a Slash die",
  pierce: "a Pierce die",
  blunt: "a Blunt die",
  block: "a Block die",
  evade: "an Evade die",
  offensive: "an Offensive die",
  defensive: "a Defensive die",
};

function checkText(c: Check, library: Record<string, EffectDef>): string {
  const cmp = c.cmp === "atLeast" ? "at least" : "at most";
  const them = c.whose === "them";
  switch (c.kind) {
    case "roll":
      return `a d${c.sides} roll is ${cmp} ${amountText(c.amount ?? blankAmount(), "", {}, library).replace(/^(\d+) per stack$/, (_, n) => (n === "1" ? "my stacks" : `${n} × my stacks`))}`;
    case "stacks":
      return `I have ${cmp} ${c.n} ${plural(c.n ?? 0, "stack")}`;
    case "effect":
      return `${them ? "they have" : "I have"} ${cmp} ${c.n} ${nameOf(library, c.effectId)}${c.mine ? " from me" : ""}`;
    case "die":
      return `the die is ${DIE_KIND_TEXT[c.dieKind ?? "offensive"]}`;
    case "health":
      return `${them ? "their" : "my"} Health is ${cmp} ${c.n}%`;
    case "sanity":
      return `${them ? "their" : "my"} Sanity is ${cmp} ${c.n}`;
    case "state":
      return `${them ? "they" : "I"} ${c.is === false ? (them ? "aren't" : "am not") : them ? "are" : "am"} ${c.state === "panic" ? "Panicking" : "Staggered"}`;
    case "round":
      return c.cmp === "atMost" && c.n === 1 ? "it's the first round" : `the round is ${cmp} ${c.n}`;
    case "count": {
      const noun = c.side === "enemies" ? plural(c.n ?? 0, "enemy", "enemies") : plural(c.n ?? 0, "ally", "allies");
      const within = c.range ? `within ${c.range} ${plural(c.range, "tile")}` : "";
      return `${cmp} ${c.n} ${noun} ${c.n === 1 ? "is" : "are"} ${c.down ? `Knocked Out${within ? ` ${within}` : ""}` : within || "in the fight"}`;
    }
    case "damage": {
      const type = c.damageType === "health" ? "Health damage" : c.damageType === "stagger" ? "Stagger damage" : "the damage";
      const from = c.source === "attack" ? " from an attack" : c.source === "effect" ? ` from ${nameOf(library, c.effectId, "an Effect")}` : "";
      return c.damageType === "health" || c.damageType === "stagger" ? `it's ${type}${from}` : from ? `the damage is${from}` : "there's damage";
    }
  }
}

function actionText(a: Action, library: Record<string, EffectDef>, stats?: Record<string, string>): string {
  const who = whoText(a.target);
  const amount = (unit: string) => amountText(a.amount, unit, stats, library);
  const name = nameOf(library, a.effectId);
  switch (a.kind) {
    case "damage":
      return `${who} take ${amount("damage")}`;
    case "staggerDamage":
      return `${who} take ${amount("Stagger damage")}`;
    case "heal":
      return `${who} recover ${amount("Health")}`;
    case "recoverStagger":
      return `${who} recover ${amount("Stagger Resist")}`;
    case "gainLight":
      return `${who} gain ${amount("Light")}`;
    case "loseLight":
      return `${who} lose ${amount("Light")}`;
    case "gainSanity":
      return `${who} gain ${amount("Sanity")}`;
    case "loseSanity":
      return `${who} lose ${amount("Sanity")}`;
    case "give":
      return `${who} gain ${amount(name)}${a.later ? " next round" : ""}`;
    case "take":
      return `${who} lose ${amount(name)}`;
    case "clear":
      return `${who} lose all ${name}`;
    case "activate":
      return `${name} on ${whomText(a.target)} goes off now`;
    case "gainMovement":
      return `${who} gain ${amount("Movement")} this turn`;
    case "loseMovement":
      return `${who} lose ${amount("Movement")} this turn`;
    case "push":
      return `${who} get pushed back ${amount("tiles")}`;
    case "pull":
      return `${who} get pulled ${amount("tiles")} closer`;
    case "addPower":
      return `the die gets +${amount("Power")}`;
    case "lowerPower":
      return `the die gets −${amount("Power")}`;
    case "raiseMax":
      return `the die's Max goes up by ${amount("")}`;
    case "lowerMax":
      return `the die's Max goes down by ${amount("")}`;
    case "advantage":
      return "the die is rolled with advantage";
    case "disadvantage":
      return "the die is rolled with disadvantage";
    case "extraDamage":
      return `deal ${amount("extra damage")}`;
    case "increaseDamage":
      return `I take ${amount("more damage")}`;
    case "reduceDamage":
      return `I take ${amount("less damage")}`;
    case "shield":
      return `this blocks up to ${amount("damage")}, losing a stack for each point blocked`;
    case "gainStacks":
      return `this gains ${amount("")}${a.amount.kind === "number" ? ` ${plural(a.amount.n ?? 0, "stack")}` : ""}`;
    case "loseStacks":
      return `this loses ${amount("")}${a.amount.kind === "number" ? ` ${plural(a.amount.n ?? 0, "stack")}` : ""}`;
    case "draw":
      return `I draw ${amountText(a.amount, "", stats, library)}${a.amount.kind === "number" ? ` ${plural(a.amount.n ?? 0, "Page")}` : " Pages"}`;
  }
}

const joinAnd = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A rule's When as words, naming its Effect when it has one: "When I set off their Rupture". */
export function whenText(rule: Pick<Rule, "when" | "effectId" | "limit">, library: Record<string, EffectDef> = PRESET_EFFECTS, kind: EffectKind = "status"): string {
  const die = kind === "die";
  const x = rule.effectId ? nameOf(library, rule.effectId) : "";
  let text = whenOptions(kind).find((o) => o.value === rule.when)?.label ?? WHEN_OPTIONS.find((o) => o.value === rule.when)?.label ?? rule.when;
  if (x && rule.when === "effectFires") text = die ? `When this die sets off my ${x}` : `When my ${x} triggers`;
  if (x && rule.when === "effectFiresOnThem") text = die ? `When this die sets off their ${x}` : `When I set off their ${x}`;
  if (x && rule.when === "gained") text = `When I gain ${x}`;
  if (x && rule.when === "gave") text = die ? `When this die gives someone ${x}` : `When I give someone ${x}`;
  if (rule.limit && rule.limit !== "always") text += ` (${LIMIT_OPTIONS.find((o) => o.value === rule.limit)!.label})`;
  return text;
}

/** One rule as a sentence: "At the end of my turn, I take 1 damage per stack." */
export function describeRule(rule: Rule, library: Record<string, EffectDef> = PRESET_EFFECTS, stats?: Record<string, string>, kind: EffectKind = "status"): string {
  const checks = rule.checks.length ? `, if ${joinAnd(rule.checks.map((c) => checkText(c, library)))}` : "";
  const actions = rule.actions.length ? joinAnd(rule.actions.map((a) => actionText(a, library, stats))) : "nothing happens";
  return `${whenText(rule, library, kind)}${checks}, ${actions}.`;
}

const DECAY_TEXT: Record<Decay, string> = {
  none: "",
  halfAtTurnEnd: "At the end of my turn, lose half the stacks (rounded down).",
  oneAtTurnEnd: "At the end of my turn, lose 1 stack.",
  allAtTurnEnd: "At the end of my turn, lose all the stacks.",
  halfAtRoundEnd: "At the end of the round, lose half the stacks (rounded down).",
  oneAtRoundEnd: "At the end of the round, lose 1 stack.",
  allAtRoundEnd: "At the end of the round, lose all the stacks.",
  allAfterTrigger: "Lose all the stacks after it triggers.",
  halfAfterTrigger: "Lose half the stacks after it triggers (rounded down).",
  oneAfterTrigger: "Lose 1 stack after it triggers.",
};

/** The effect's card text, written from its pieces. */
export function describeEffect(def: EffectDef, library: Record<string, EffectDef> = PRESET_EFFECTS, stats?: Record<string, string>): string {
  const lines = def.rules.map((r) => describeRule(r, library, stats, def.kind));
  if (def.kind === "status" && DECAY_TEXT[def.decay]) lines.push(DECAY_TEXT[def.decay]);
  if (def.maxStacks && def.maxStacks < MAX_STACKS) lines.push(`Up to ${def.maxStacks} ${plural(def.maxStacks, "stack")}.`);
  if (def.kind === "status" && def.holds) lines.push(`While this is on me, my ${nameOf(library, def.holds)} doesn't lose stacks on its own.`);
  if (def.kind === "status" && def.bySource) lines.push("Each character's stacks are kept apart.");
  if (def.note?.trim()) lines.push(def.note.trim());
  return lines.map(capital).join(" ");
}

/** Plain-English nudges for things that are allowed but probably not meant. */
export function effectWarnings(def: EffectDef): string[] {
  const out: string[] = [];
  const label = (w: When) => WHEN_OPTIONS.find((o) => o.value === w)!.label;
  if (!def.name.trim()) out.push("Give it a name.");
  if (def.rules.length === 0) {
    if (def.kind === "status" || def.kind === "die") out.push("It has no rules yet, so it won't do anything.");
    else if (!def.note?.trim()) out.push("Say what it does, or add a rule to automate it.");
  }
  for (const [i, r] of def.rules.entries()) {
    const n = def.rules.length > 1 ? `Rule ${i + 1}: ` : "";
    if (r.actions.length === 0) out.push(`${n}it doesn't do anything yet.`);
    for (const a of r.actions) {
      const opt = ACTION_OPTIONS.find((o) => o.value === a.kind)!;
      if (opt.only && !opt.only.includes(r.when)) {
        out.push(`${n}"${opt.label}" only works with "${label(opt.only[0])}"${opt.only.length > 1 ? " and the like" : ""}.`);
      }
      if (a.target?.who === "them" && !HAS_OTHER[r.when]) out.push(`${n}there's no "they" ${label(r.when).toLowerCase()}; pick someone else.`);
      if (a.amount.kind === "dieRoll" && !HAS_DIE[r.when]) out.push(`${n}there's no die to roll again here.`);
      if (a.amount.kind === "event" && !HAS_EVENT.includes(r.when)) out.push(`${n}"That many" needs a When that comes with a number, like "When I'm about to take damage".`);
      if (isAlwaysOn(def.kind) && (a.amount.kind === "perStack" || a.amount.kind === "halfStacks" || (a.amount.kind === "rolls" && !a.amount.effectId))) {
        out.push(`${n}${EFFECT_KINDS.find((k) => k.value === def.kind)!.plural} don't have stacks; they count as 1.`);
      }
      if (a.kind === "shield" && def.kind !== "status") out.push(`${n}only a Status effect has stacks to block with.`);
      if ((a.kind === "push" || a.kind === "pull") && a.target?.who === "me") out.push(`${n}I can't push or pull myself; pick someone else.`);
    }
    for (const c of r.checks) {
      if (c.kind === "die" && !HAS_DIE[r.when]) out.push(`${n}there's no die to check here.`);
      if (c.kind === "damage" && !DAMAGE_WHENS.includes(r.when)) out.push(`${n}"The kind of damage" only works with "${label("takingDamage")}" or "${label("takingHit")}".`);
      if (c.whose === "them" && !HAS_OTHER[r.when]) out.push(`${n}there's no "they" to check ${label(r.when).toLowerCase()}.`);
    }
    if (def.kind === "die" && !DIE_WHEN_OPTIONS.some((o) => o.value === r.when)) out.push(`${n}a Dice effect only runs when its die is rolled, hits or clashes.`);
  }
  if (def.kind === "status" && def.decay === "none" && !def.rules.some((r) => r.actions.some((a) => a.kind === "loseStacks"))) {
    out.push("It never loses stacks on its own. Is that on purpose?");
  }
  return out;
}

// ---- Running effects (the host calls these from shared/combat.ts) ----

/** One automated Effect on a character, as shared/types.ts stores it. */
export interface HeldEffect {
  id: string;
  defId?: string;
  name: string;
  count: number;
  description: string;
  /** Stacks that arrive at the start of the next round ("next round"). */
  pending?: number;
  /** Who gave them, for Effects that keep each character's stacks apart. */
  sourceId?: string;
}

/** A character's view of the table, as effects need it. Implemented by shared/combat.ts. */
export interface EffectHolder {
  id: string;
  name: string;
  /** Status Effects on the character: their library id and stacks. */
  effects?: HeldEffect[];
  /** Rules that fire once a round or once a combat: the round each last fired in. */
  effectUses?: Record<string, number>;
}

/** Where damage comes from: an attack, or an Effect (and who that Effect belongs to). */
export interface DamageSource<T> {
  attack?: boolean;
  effectId?: string;
  by?: T;
}

/** What the rules can do to the table; shared/combat.ts provides it so the rules stay in one place. */
export interface EffectOps<T extends EffectHolder> {
  def(id: string): EffectDef | undefined;
  /** Library ids of the always-on Passive effects a character has. */
  passives(t: T): string[];
  stat(t: T, key: string): number;
  healthPercent(t: T): number;
  sanityOf(t: T): number;
  state(t: T, state: "staggered" | "panic"): boolean;
  /** The combat round (1 at the start). */
  round(): number;
  /** Characters within range on the same side (allies) or the other (enemies), never t itself. */
  near(t: T, range: number, enemies: boolean): T[];
  /** How many allies or enemies t has (never t), Knocked Out ones only if `down`, within range if given. */
  count(t: T, enemies: boolean, down: boolean, range?: number): number;
  out(t: T): boolean;
  damage(t: T, n: number, source: DamageSource<T>): void;
  staggerDamage(t: T, n: number, source: DamageSource<T>): void;
  heal(t: T, n: number): void;
  recoverStagger(t: T, n: number): void;
  light(t: T, n: number): void;
  sanity(t: T, n: number): void;
  draw(t: T, n: number): void;
  /** Movement Points for t's current turn (only while it's t's turn). */
  movement(t: T, n: number): void;
  /** Moves t straight away from `from` (negative: toward it), stopping at the map's edge or another character. */
  push(from: T, t: T, n: number): void;
  log(line: string): void;
}

/** What a trigger hands back: Power and damage to add, damage to take off, the die's Max, and advantage (+) or disadvantage (−). */
export interface TriggerResult {
  power: number;
  damage: number;
  reduce: number;
  max: number;
  advantage: number;
}

/** The number and details a trigger comes with: damage about to be taken, stacks given, the stacks an Effect fired with. */
export interface TriggerEvent {
  amount: number;
  effectId?: string;
  type?: "health" | "stagger";
  /** "attack", or the library id of the Effect dealing the damage. */
  source?: string;
}

export interface TriggerOptions<T> {
  /** "They": who I hit, who hit me, who I clash with, who gave me stacks… */
  other?: T;
  die?: Dice;
  /** Whether the die is the holder's own (only then do its Dice effects run). Default true. */
  dieIsMine?: boolean;
  event?: TriggerEvent;
  /** Only the character's Effects and Passives, or only the die's Dice effects. */
  only?: "character" | "die";
}

export const noResult = (): TriggerResult => ({ power: 0, damage: 0, reduce: 0, max: 0, advantage: 0 });

let depth = 0;
/** Effect triggers in progress (who, what, which Effect), so "when I give Burn, give 1 more Burn" can't feed itself. */
const busy = new Set<string>();

const keep = (e: HeldEffect) => !e.defId || e.count > 0 || (e.pending ?? 0) > 0;
const stacksOf = (t: EffectHolder | undefined, defId: string | undefined, from?: string) =>
  (t?.effects ?? []).filter((e) => e.defId === defId && (from === undefined || e.sourceId === from)).reduce((n, e) => n + e.count, 0);

/**
 * Adds stacks of an Effect to a character (a new entry if they don't have it). `later` holds them
 * until the start of the next round. Negative stacks take stacks away; an Effect at 0 comes off.
 */
export function giveEffect<T extends EffectHolder>(ops: EffectOps<T>, t: T, defId: string, stacks: number, opts: { later?: boolean; sourceId?: string } = {}) {
  const def = ops.def(defId);
  if (!def || stacks === 0) return;
  const list = (t.effects ??= []);
  if (stacks < 0) {
    let left = -stacks;
    for (const e of list.filter((x) => x.defId === defId)) {
      const off = Math.min(left, e.count);
      e.count -= off;
      left -= off;
    }
  } else {
    const max = def.maxStacks ?? MAX_STACKS;
    const sourceId = def.bySource ? opts.sourceId : undefined;
    let have = list.find((e) => e.defId === defId && (!def.bySource || e.sourceId === sourceId));
    if (!have) {
      have = { id: newId(), defId, name: def.name, count: 0, description: describeEffect(def) };
      if (sourceId) have.sourceId = sourceId;
      list.push(have);
    }
    if (opts.later) have.pending = Math.min(max, (have.pending ?? 0) + stacks);
    else have.count = Math.min(max, have.count + stacks);
  }
  t.effects = list.filter(keep);
}

/** Every stack of an Effect comes off (next round's too). */
function clearEffect<T extends EffectHolder>(t: T, defId: string) {
  if (t.effects) t.effects = t.effects.filter((e) => e.defId !== defId);
}

interface Source {
  defId: string;
  entry?: HeldEffect;
  kinds: EffectKind[];
}

/** Whether a status Effect is kept from losing stacks on its own (Renewed Blaze on Burn). */
function held<T extends EffectHolder>(ops: EffectOps<T>, holder: T, defId: string) {
  return (holder.effects ?? []).some((e) => e.count > 0 && e.defId && ops.def(e.defId)?.holds === defId);
}

/**
 * Runs every rule listening for this moment on a character: their status Effects (with their
 * stacks), then their Passives, then the die's Dice effects. Returns any Power or damage changes.
 */
export function runTrigger<T extends EffectHolder>(ops: EffectOps<T>, when: When, holder: T, opts: TriggerOptions<T> = {}): TriggerResult {
  const result = noResult();
  if (depth >= MAX_DEPTH || ops.out(holder)) return result;
  depth++;
  try {
    const dieIsMine = opts.dieIsMine ?? true;
    const sources: Source[] = [];
    if (opts.only !== "die") {
      sources.push(...(holder.effects ?? []).filter((e) => e.defId).map((e) => ({ defId: e.defId!, entry: e, kinds: ["status" as EffectKind] })));
      sources.push(...ops.passives(holder).map((defId) => ({ defId, kinds: ["passive", "proficiency"] as EffectKind[] })));
    }
    // Dice effects run for the die they're slotted on, when it's the holder's own die.
    if (opts.only !== "character" && dieIsMine) sources.push(...(opts.die?.effectIds ?? []).map((defId) => ({ defId, kinds: ["die" as EffectKind] })));
    for (const src of sources) fire(ops, holder, src, (r) => r.when === when, opts, result);
    if (holder.effects) holder.effects = holder.effects.filter(keep);
  } finally {
    depth--;
  }
  return result;
}

/** Runs one source's matching rules. A status Effect that fires tells its holder and whoever set it off. */
function fire<T extends EffectHolder>(ops: EffectOps<T>, holder: T, src: Source, pick: (r: Rule) => boolean, opts: TriggerOptions<T>, result: TriggerResult) {
  const def = ops.def(src.defId);
  const entry = src.entry;
  if (!def || !src.kinds.includes(def.kind) || (entry && entry.count <= 0)) return;
  const rules = def.rules.filter(pick);
  if (!rules.length) return;
  const dieIsMine = opts.dieIsMine ?? true;
  let firedWith = 0;
  for (const rule of rules) {
    if (rule.effectId && rule.effectId !== opts.event?.effectId) continue;
    const key = `${src.defId}:${rule.id}`;
    const used = holder.effectUses?.[key];
    if (rule.limit === "round" && used === ops.round()) continue;
    if (rule.limit === "combat" && used !== undefined) continue;
    if (entry && entry.count <= 0) break;
    const stacks = entry ? entry.count : 1;
    const scope: Scope<T> = { ops, holder, other: opts.other, die: opts.die, dieIsMine, stacks, event: opts.event, entry, def, defId: src.defId };
    if (!rule.checks.every((c) => passes(c, scope))) continue;
    if (rule.limit === "round" || rule.limit === "combat") (holder.effectUses ??= {})[key] = ops.round();
    firedWith ||= stacks;
    ops.log(`  ${holder.name}'s ${def.name}${entry ? ` ${stacks}` : ""} triggers.`);
    for (const action of rule.actions) act(action, scope, result);
  }
  if (!firedWith || !entry) return;
  if (!held(ops, holder, src.defId)) {
    if (def.decay === "allAfterTrigger") entry.count = 0;
    else if (def.decay === "halfAfterTrigger") entry.count = Math.floor(entry.count / 2);
    else if (def.decay === "oneAfterTrigger") entry.count = Math.max(0, entry.count - 1);
  }
  // A Critical Hit, a Burst: rules can listen for this Effect going off, on either side.
  const event: TriggerEvent = { amount: firedWith, effectId: src.defId };
  announce(ops, "effectFires", holder, { other: opts.other, die: opts.die, dieIsMine, event });
  if (opts.other) announce(ops, "effectFiresOnThem", opts.other, { other: holder, die: opts.die, dieIsMine: !dieIsMine, event });
}

/** Runs an Effect-about trigger, unless that same trigger is already running (it would only feed itself). */
function announce<T extends EffectHolder>(ops: EffectOps<T>, when: When, holder: T, opts: TriggerOptions<T>) {
  const key = `${when}:${holder.id}:${opts.event?.effectId}`;
  if (busy.has(key)) return;
  busy.add(key);
  try {
    runTrigger(ops, when, holder, opts);
  } finally {
    busy.delete(key);
  }
}

/** The rules an Effect runs on its own clock, which "Set off an Effect now" runs early. */
const TIMED: When[] = ["turnStart", "turnEnd", "roundStart", "roundEnd", "use"];

/** Sets off an Effect on a character right now (Detonate), then it loses stacks as if its time had come. */
function activate<T extends EffectHolder>(ops: EffectOps<T>, t: T, defId: string, by: T) {
  const def = ops.def(defId);
  const entries = (t.effects ?? []).filter((e) => e.defId === defId && e.count > 0);
  if (!def || !entries.length) return;
  ops.log(`  ${t.name}'s ${def.name} goes off.`);
  for (const entry of entries) {
    fire(ops, t, { defId, entry, kinds: ["status"] }, (r) => TIMED.includes(r.when), { other: by === t ? undefined : by }, noResult());
    if (!held(ops, t, defId)) entry.count = decayed(def.decay, entry.count, def.decay.endsWith("TurnEnd") ? "turn" : "round");
  }
  t.effects = (t.effects ?? []).filter(keep);
}

function decayed(decay: Decay, count: number, at: "turn" | "round"): number {
  const suffix = at === "turn" ? "AtTurnEnd" : "AtRoundEnd";
  if (decay === `half${suffix}`) return Math.floor(count / 2);
  if (decay === `one${suffix}`) return Math.max(0, count - 1);
  if (decay === `all${suffix}`) return 0;
  return count;
}

/** End of the character's turn, or of the round: stacks that wear off then. */
export function decayAtEnd<T extends EffectHolder>(ops: EffectOps<T>, holder: T, at: "turn" | "round") {
  if (!holder.effects) return;
  for (const e of holder.effects) {
    const def = e.defId ? ops.def(e.defId) : undefined;
    if (!def || held(ops, holder, e.defId!)) continue;
    const before = e.count;
    e.count = decayed(def.decay, e.count, at);
    if (e.count !== before) ops.log(`  ${holder.name}'s ${def.name}: ${before} → ${e.count}.`);
  }
  holder.effects = holder.effects.filter(keep);
}

/** Start of a round: stacks given "next round" arrive. */
export function arriveAtRoundStart<T extends EffectHolder>(ops: EffectOps<T>, holder: T) {
  for (const e of holder.effects ?? []) {
    if (!e.pending) continue;
    const def = e.defId ? ops.def(e.defId) : undefined;
    e.count = Math.min(def?.maxStacks ?? MAX_STACKS, e.count + e.pending);
    ops.log(`  ${holder.name} gains ${e.pending} ${e.name} (${e.count}).`);
    delete e.pending;
  }
}

interface Scope<T extends EffectHolder> {
  ops: EffectOps<T>;
  holder: T;
  other?: T;
  die?: Dice;
  dieIsMine: boolean;
  stacks: number;
  event?: TriggerEvent;
  /** The status Effect running (missing for Passives and Dice effects). */
  entry?: HeldEffect;
  def: EffectDef;
  defId: string;
}

const whom = <T extends EffectHolder>(whose: Whose | undefined, s: Scope<T>) => (whose === "them" ? s.other : s.holder);

function amountOf<T extends EffectHolder>(a: Amount, s: Scope<T>): number {
  let n: number;
  switch (a.kind) {
    case "number":
      n = a.n ?? 0;
      break;
    case "perStack":
      n = (a.n ?? 1) * s.stacks;
      break;
    case "halfStacks":
      n = Math.floor(s.stacks / 2);
      break;
    case "roll":
      n = rollDie(a.sides ?? 6);
      break;
    case "rolls": {
      const count = Math.min(50, Math.floor((a.effectId ? stacksOf(whom(a.whose, s), a.effectId) : s.stacks) / Math.max(1, a.per ?? 1)));
      n = 0;
      for (let i = 0; i < count; i++) n += rollDie(a.sides ?? 10);
      break;
    }
    case "dieRoll":
      n = s.die ? rollDie(s.die.sides) + s.die.basePower : 0;
      break;
    case "stat":
      n = s.ops.stat(s.holder, a.stat ?? "");
      break;
    case "effectStacks":
      n = (a.n ?? 1) * stacksOf(whom(a.whose, s), a.effectId);
      break;
    case "event":
      n = s.event?.amount ?? 0;
      break;
    case "healthLost":
      n = 100 - s.ops.healthPercent(s.holder);
      break;
  }
  if (a.per && a.per > 1 && a.kind !== "rolls") n = Math.floor(n / a.per);
  n += a.plus ?? 0;
  if (a.max) n = Math.min(a.max, n);
  return Math.max(0, Math.min(999, Math.floor(n)));
}

function passes<T extends EffectHolder>(c: Check, s: Scope<T>): boolean {
  const cmp = (x: number, y: number) => (c.cmp === "atLeast" ? x >= y : x <= y);
  const who = whom(c.whose, s);
  switch (c.kind) {
    case "roll": {
      const roll = rollDie(c.sides ?? 10);
      const target = amountOf(c.amount ?? blankAmount(), s);
      const ok = cmp(roll, target);
      s.ops.log(`  ${s.holder.name} rolls d${c.sides ?? 10}: ${roll} (needs ${c.cmp === "atLeast" ? "at least" : "at most"} ${target}) ${ok ? "✓" : "✗"}`);
      return ok;
    }
    case "stacks":
      return cmp(s.stacks, c.n ?? 0);
    case "effect":
      return !!who && cmp(stacksOf(who, c.effectId, c.mine ? s.holder.id : undefined), c.n ?? 0);
    case "health":
      return !!who && cmp(s.ops.healthPercent(who), c.n ?? 50);
    case "sanity":
      return !!who && cmp(s.ops.sanityOf(who), c.n ?? 0);
    case "state":
      return !!who && s.ops.state(who, c.state ?? "staggered") === (c.is !== false);
    case "round":
      return cmp(s.ops.round(), c.n ?? 1);
    case "count":
      return cmp(s.ops.count(s.holder, c.side === "enemies", !!c.down, c.range), c.n ?? 0);
    case "damage": {
      const ev = s.event;
      if (!ev?.type) return false;
      if (c.damageType && c.damageType !== "any" && c.damageType !== ev.type) return false;
      if (c.source === "attack") return ev.source === "attack";
      if (c.source === "effect") return !!ev.source && ev.source !== "attack" && (!c.effectId || ev.source === c.effectId);
      return true;
    }
    case "die": {
      const k = s.die?.kind;
      if (!k) return false;
      if (c.dieKind === "offensive") return k === "slash" || k === "pierce" || k === "blunt";
      if (c.dieKind === "defensive") return k === "block" || k === "evade";
      return k === c.dieKind;
    }
  }
}

function targets<T extends EffectHolder>(t: Target | undefined, s: Scope<T>): T[] {
  switch (t?.who) {
    case "them":
      return s.other && !s.ops.out(s.other) ? [s.other] : [];
    case "alliesNear":
      return s.ops.near(s.holder, t.range ?? 2, false);
    case "enemiesNear":
      return s.ops.near(s.holder, t.range ?? 2, true);
    default:
      return [s.holder];
  }
}

function act<T extends EffectHolder>(a: Action, s: Scope<T>, result: TriggerResult) {
  const n = amountOf(a.amount, s);
  const { ops, entry, def } = s;
  const each = (fn: (t: T) => void) => targets(a.target, s).forEach(fn);
  const source: DamageSource<T> = { effectId: s.defId, by: s.holder };
  switch (a.kind) {
    case "damage":
      return each((t) => ops.damage(t, n, source));
    case "staggerDamage":
      return each((t) => ops.staggerDamage(t, n, source));
    case "heal":
      return each((t) => ops.heal(t, n));
    case "recoverStagger":
      return each((t) => ops.recoverStagger(t, n));
    case "gainLight":
      return each((t) => ops.light(t, n));
    case "loseLight":
      return each((t) => ops.light(t, -n));
    case "gainSanity":
      return each((t) => ops.sanity(t, n));
    case "loseSanity":
      return each((t) => ops.sanity(t, -n));
    case "give":
      return each((t) => {
        const given = a.effectId ? ops.def(a.effectId) : undefined;
        if (!given || n <= 0) return;
        giveEffect(ops, t, a.effectId!, n, { later: a.later, sourceId: s.holder.id });
        ops.log(`  ${t.name} gains ${n} ${given.name}${a.later ? " next round" : ""}.`);
        const event: TriggerEvent = { amount: n, effectId: a.effectId };
        announce(ops, "gained", t, { other: t === s.holder ? undefined : s.holder, event });
        announce(ops, "gave", s.holder, { other: t === s.holder ? undefined : t, die: s.die, dieIsMine: s.dieIsMine, event });
      });
    case "take":
      return each((t) => {
        const had = stacksOf(t, a.effectId);
        if (!a.effectId || !had || n <= 0) return;
        giveEffect(ops, t, a.effectId, -n);
        ops.log(`  ${t.name} loses ${Math.min(n, had)} ${ops.def(a.effectId)?.name ?? "stacks"}.`);
      });
    case "clear":
      return each((t) => {
        if (!a.effectId || !(t.effects ?? []).some((e) => e.defId === a.effectId)) return;
        clearEffect(t, a.effectId);
        ops.log(`  ${t.name} loses all ${ops.def(a.effectId)?.name ?? "stacks"}.`);
      });
    case "activate":
      return each((t) => a.effectId && activate(ops, t, a.effectId, s.holder));
    case "gainMovement":
      return each((t) => ops.movement(t, n));
    case "loseMovement":
      return each((t) => ops.movement(t, -n));
    case "push":
      return each((t) => t !== s.holder && ops.push(s.holder, t, n));
    case "pull":
      return each((t) => t !== s.holder && ops.push(s.holder, t, -n));
    case "addPower":
      result.power += n;
      return;
    case "lowerPower":
      result.power -= n;
      return;
    case "raiseMax":
      result.max += n;
      return;
    case "lowerMax":
      result.max -= n;
      return;
    case "advantage":
      result.advantage += 1;
      return;
    case "disadvantage":
      result.advantage -= 1;
      return;
    case "extraDamage":
      result.damage += n;
      if (n) ops.log(`  +${n} damage.`);
      return;
    case "increaseDamage":
      result.damage += n;
      if (n) ops.log(`  +${n} damage taken.`);
      return;
    case "reduceDamage":
      result.reduce += n;
      if (n) ops.log(`  −${n} damage taken.`);
      return;
    case "shield": {
      if (!entry) return;
      const left = Math.max(0, (s.event?.amount ?? 0) + result.damage - result.reduce);
      const blocked = Math.min(n, left, entry.count);
      if (!blocked) return;
      result.reduce += blocked;
      entry.count -= blocked;
      ops.log(`  ${def.name} blocks ${blocked} (${entry.count} left).`);
      return;
    }
    case "gainStacks":
    case "loseStacks":
      if (!entry) return;
      entry.count = Math.max(0, Math.min(def.maxStacks ?? MAX_STACKS, entry.count + (a.kind === "gainStacks" ? n : -n)));
      return;
    case "draw":
      return ops.draw(s.holder, n);
  }
}

// ---- Slotting library entries on characters and dice ----

/** What a Passive or Proficiency slotted from the library says: its words, or its rules as card text. */
export function slotText(def: EffectDef, library: Record<string, EffectDef>): string {
  return describeEffect(def, library);
}

/** A copy of a library Passive for an Augment, Weapon or Armor (linked by effectId, so edits to it follow). */
export function slotPassive(effectId: string, library: Record<string, EffectDef>): Passive {
  const def = library[effectId];
  return { id: newId(), effectId, name: def?.name ?? "", cost: def?.cost ?? 0, description: def ? slotText(def, library) : "" };
}

/** A copy of a library Proficiency for a character's Proficiencies. */
export function slotProficiency(effectId: string, library: Record<string, EffectDef>): Proficiency {
  const def = library[effectId];
  return { id: newId(), effectId, name: def?.name ?? "", description: def ? slotText(def, library) : "" };
}

/** A Passive or Proficiency with its name, cost and words brought up to date from the library. */
function refresh<T extends Passive | Proficiency>(p: T, library: Record<string, EffectDef>): T {
  const def = p.effectId ? library[p.effectId] : undefined;
  if (!def) return p;
  const next = { ...p, name: def.name, description: slotText(def, library) };
  if ("cost" in next) (next as Passive).cost = def.cost ?? 0;
  return next;
}

/**
 * A character (player or GM-made) with every slotted Passive and Proficiency showing what the
 * library says now, so a change in the library reaches every sheet that uses it.
 */
export function linkLibrary<T extends Pick<Character, "augment" | "weapons" | "armor" | "proficiencies">>(c: T, library: Record<string, EffectDef> | undefined): T {
  if (!library) return c;
  const passives = (list: Passive[] | undefined) => (list ?? []).map((p) => refresh(p, library));
  return {
    ...c,
    augment: c.augment ? { ...c.augment, passives: passives(c.augment.passives) } : c.augment,
    weapons: (c.weapons ?? []).map((w) => ({ ...w, passives: passives(w.passives) })),
    armor: c.armor ? { ...c.armor, passives: passives(c.armor.passives) } : c.armor,
    proficiencies: (c.proficiencies ?? []).map((p) => refresh(p, library)),
  };
}
