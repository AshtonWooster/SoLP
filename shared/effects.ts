// Automated Effects and Passives (Act 7, "Effects" and "Passives"), built from menu pieces so
// anyone can make one without writing code. An Effect is a few rules shaped like
//   When <something happens>, if <checks>, do <actions>
// where every blank is picked from a list (WHEN_OPTIONS, CHECK_OPTIONS, ACTION_OPTIONS, AMOUNT_OPTIONS,
// WHO_OPTIONS), plus how its stacks go away (DECAY_OPTIONS). describeEffect turns the pieces back into card
// text. The host runs them from shared/combat.ts through runTrigger, which never runs anything but these pieces.
//
// Firestore: games/{gameId}/effects/{effectId}  EffectDef  members read; GM write (players too when the
// GM's Game settings allow, but their effects only work once the GM approves them).
import type { Dice, DiceKind } from "./character.ts";
import { newId, rollDie } from "./id.ts";

// ---- The pieces ----

/** When a rule runs. "Me" is the character the Effect is on (or whose Passive it is). */
export type When = "combatStart" | "turnStart" | "turnEnd" | "roll" | "hit" | "wasHit" | "clashWin" | "clashLose";

export const WHEN_OPTIONS: { value: When; label: string; hint: string }[] = [
  { value: "turnEnd", label: "At the end of my turn", hint: "After Combat Actions" },
  { value: "turnStart", label: "At the start of my turn", hint: "After Upkeep, before Combat Actions" },
  { value: "combatStart", label: "When combat starts", hint: "Once, when the Combat Encounter begins" },
  { value: "roll", label: "When I roll a die", hint: "Change the die's Power here" },
  { value: "hit", label: "When I hit someone", hint: "One of my Offensive Dice lands; add damage here" },
  { value: "wasHit", label: "When I'm hit", hint: "After an Offensive Die deals me damage" },
  { value: "clashWin", label: "When I win a Clash", hint: "One of my dice beats theirs" },
  { value: "clashLose", label: "When I lose a Clash", hint: "One of their dice beats mine" },
];

/** Who "them" is depends on When: the one I hit, who hit me, or who I clashed with. */
const HAS_OTHER: Record<When, boolean> = {
  combatStart: false,
  turnStart: false,
  turnEnd: false,
  roll: true,
  hit: true,
  wasHit: true,
  clashWin: true,
  clashLose: true,
};
/** Triggers that involve one of the dice, so "the die" checks and amounts make sense. */
const HAS_DIE: Record<When, boolean> = { ...HAS_OTHER };

/** How much: picked from a list, never typed as a formula. */
export type AmountKind = "number" | "perStack" | "halfStacks" | "roll" | "dieRoll" | "stat";

export interface Amount {
  kind: AmountKind;
  /** number: the number. perStack: how much per stack. */
  n?: number;
  /** roll: the die size (1d4 to 1d20). */
  sides?: number;
  /** stat: which Stat (Primary or Secondary). */
  stat?: string;
}

export const AMOUNT_OPTIONS: { value: AmountKind; label: string }[] = [
  { value: "number", label: "A number" },
  { value: "perStack", label: "Per stack" },
  { value: "halfStacks", label: "Half the stacks" },
  { value: "roll", label: "A die roll" },
  { value: "dieRoll", label: "Another roll of this die" },
  { value: "stat", label: "One of my Stats" },
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

export type CheckKind = "roll" | "stacks" | "die" | "health";

/** One "only if" condition. Every check on a rule must pass. */
export interface Check {
  kind: CheckKind;
  /** roll: the die rolled (d4 to d20). */
  sides?: number;
  /** roll / stacks / health: compare at most or at least. */
  cmp?: "atMost" | "atLeast";
  /** roll: what the roll is compared to. */
  amount?: Amount;
  /** stacks: how many. health: the percent of max Health. */
  n?: number;
  /** die: the kind of die rolled. */
  dieKind?: DiceKind | "offensive" | "defensive";
}

export const CHECK_OPTIONS: { value: CheckKind; label: string }[] = [
  { value: "roll", label: "A die roll" },
  { value: "stacks", label: "My stacks" },
  { value: "die", label: "The kind of die" },
  { value: "health", label: "My Health" },
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
  | "extraDamage"
  | "give"
  | "gainStacks"
  | "loseStacks"
  | "draw";

/** One thing a rule does. */
export interface Action {
  kind: ActionKind;
  /** Who it happens to (actions that only make sense for "me" ignore this). */
  target?: Target;
  amount: Amount;
  /** give: the Effect given. */
  effectId?: string;
}

/** Every action, its menu label, and which When it makes sense with (missing = any). */
export const ACTION_OPTIONS: { value: ActionKind; label: string; targets: boolean; only?: When[] }[] = [
  { value: "damage", label: "Take damage", targets: true },
  { value: "staggerDamage", label: "Take Stagger damage", targets: true },
  { value: "heal", label: "Recover Health", targets: true },
  { value: "recoverStagger", label: "Recover Stagger Resist", targets: true },
  { value: "gainLight", label: "Gain Light", targets: true },
  { value: "loseLight", label: "Lose Light", targets: true },
  { value: "gainSanity", label: "Gain Sanity", targets: true },
  { value: "loseSanity", label: "Lose Sanity", targets: true },
  { value: "give", label: "Gain an Effect", targets: true },
  { value: "addPower", label: "Add Power to the die", targets: false, only: ["roll"] },
  { value: "lowerPower", label: "Lower the die's Power", targets: false, only: ["roll"] },
  { value: "extraDamage", label: "Deal extra damage", targets: false, only: ["hit"] },
  { value: "gainStacks", label: "This gains stacks", targets: false },
  { value: "loseStacks", label: "This loses stacks", targets: false },
  { value: "draw", label: "Draw Pages", targets: false },
];

/** How a status Effect's stacks go away on their own. */
export type Decay = "none" | "halfAtTurnEnd" | "oneAtTurnEnd" | "allAtTurnEnd" | "allAfterTrigger" | "oneAfterTrigger";

export const DECAY_OPTIONS: { value: Decay; label: string }[] = [
  { value: "none", label: "Never goes away on its own" },
  { value: "halfAtTurnEnd", label: "Lose half at the end of my turn" },
  { value: "oneAtTurnEnd", label: "Lose 1 at the end of my turn" },
  { value: "allAtTurnEnd", label: "Lose all at the end of my turn" },
  { value: "allAfterTrigger", label: "Lose all after it triggers" },
  { value: "oneAfterTrigger", label: "Lose 1 after it triggers" },
];

export interface Rule {
  id: string;
  when: When;
  checks: Check[];
  actions: Action[];
}

/**
 * An automated Effect. Status Effects (Burn, Poise…) sit on a character with a number of stacks;
 * Passive ones are always on while a Passive or Proficiency links to them.
 */
export interface EffectDef {
  name: string;
  kind: "status" | "passive";
  /** Anything to add to the generated card text. */
  note?: string;
  decay: Decay;
  /** Stacks can't go above this (missing: 99). */
  maxStacks?: number;
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
  return { ...PRESET_EFFECTS, ...(game ?? {}) };
}

// ---- Blank pieces, for the editor ----

export const blankAmount = (): Amount => ({ kind: "number", n: 1 });

export const blankAction = (kind: ActionKind = "damage"): Action => {
  const a: Action = { kind, amount: blankAmount() };
  if (ACTION_OPTIONS.find((o) => o.value === kind)?.targets) a.target = { who: "me" };
  if (kind === "give") a.effectId = "preset:burn";
  if (kind === "extraDamage") a.amount = { kind: "roll", sides: 4 };
  return a;
};

export function blankCheck(kind: CheckKind = "roll"): Check {
  switch (kind) {
    case "roll":
      return { kind, sides: 10, cmp: "atMost", amount: { kind: "perStack", n: 1 } };
    case "stacks":
      return { kind, cmp: "atLeast", n: 3 };
    case "die":
      return { kind, dieKind: "offensive" };
    case "health":
      return { kind, cmp: "atMost", n: 50 };
  }
}

export const blankRule = (when: When = "turnEnd"): Rule => ({ id: newId(), when, checks: [], actions: [blankAction()] });

export const blankEffect = (kind: EffectDef["kind"] = "status"): EffectDef => ({
  name: "",
  kind,
  decay: kind === "status" ? "halfAtTurnEnd" : "none",
  rules: [blankRule()],
});

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
const DIE_KIND_CHECKS = ["slash", "pierce", "blunt", "block", "evade", "offensive", "defensive"] as const;

function cleanAmount(raw: unknown): Amount {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Amount>;
  const kind = oneOf(r.kind, AMOUNT_OPTIONS, "number");
  if (kind === "number") return { kind, n: int(r.n, 0, 99, 1) };
  if (kind === "perStack") return { kind, n: int(r.n, 1, 20, 1) };
  if (kind === "roll") return { kind, sides: DIE_SIZES.includes(Number(r.sides)) ? Number(r.sides) : 6 };
  if (kind === "stat") return { kind, stat: String(r.stat ?? "justice").slice(0, 40) };
  return { kind };
}

function cleanTarget(raw: unknown): Target {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Target>;
  const who = oneOf(r.who, WHO_OPTIONS, "me");
  return who === "alliesNear" || who === "enemiesNear" ? { who, range: int(r.range, 1, 20, 2) } : { who };
}

function cleanCheck(raw: unknown): Check {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Check>;
  const c = blankCheck(oneOf(r.kind, CHECK_OPTIONS, "roll"));
  const cmp = r.cmp === "atLeast" || r.cmp === "atMost" ? r.cmp : c.cmp;
  switch (c.kind) {
    case "roll":
      return { kind: "roll", sides: DIE_SIZES.includes(Number(r.sides)) ? Number(r.sides) : 10, cmp, amount: cleanAmount(r.amount) };
    case "stacks":
      return { kind: "stacks", cmp, n: int(r.n, 0, MAX_STACKS, 3) };
    case "health":
      return { kind: "health", cmp, n: int(r.n, 0, 100, 50) };
    case "die":
      return { kind: "die", dieKind: (DIE_KIND_CHECKS as readonly string[]).includes(String(r.dieKind)) ? (r.dieKind as Check["dieKind"]) : "offensive" };
  }
}

function cleanAction(raw: unknown): Action {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Action>;
  const kind = oneOf(r.kind, ACTION_OPTIONS, "damage");
  const a: Action = { kind, amount: cleanAmount(r.amount) };
  if (ACTION_OPTIONS.find((o) => o.value === kind)!.targets) a.target = cleanTarget(r.target);
  if (kind === "give") a.effectId = String(r.effectId ?? "").slice(0, 80);
  return a;
}

/** An effect as it may be saved: only known pieces, sensible numbers, and limits on size. */
export function cleanEffect(raw: unknown): EffectDef {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<EffectDef>;
  const kind = r.kind === "passive" ? "passive" : "status";
  const def: EffectDef = {
    name: String(r.name ?? "").slice(0, 60),
    kind,
    decay: kind === "passive" ? "none" : oneOf(r.decay, DECAY_OPTIONS, "none"),
    rules: (Array.isArray(r.rules) ? r.rules : []).slice(0, 8).map((rule) => ({
      id: String(rule?.id || newId()).slice(0, 40),
      when: oneOf(rule?.when, WHEN_OPTIONS, "turnEnd"),
      checks: (Array.isArray(rule?.checks) ? rule.checks : []).slice(0, 4).map(cleanCheck),
      actions: (Array.isArray(rule?.actions) ? rule.actions : []).slice(0, 6).map(cleanAction),
    })),
  };
  if (r.note) def.note = String(r.note).slice(0, 500);
  if (kind === "status" && r.maxStacks != null && r.maxStacks !== ("" as unknown)) def.maxStacks = int(r.maxStacks, 1, MAX_STACKS, MAX_STACKS);
  if (r.createdBy) def.createdBy = String(r.createdBy);
  if (r.createdBy && r.approved === true) def.approved = true;
  if (r.updatedAt) def.updatedAt = Number(r.updatedAt) || 0;
  return def;
}

// ---- Card text ----

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);

function amountText(a: Amount, unit: string, stats: Record<string, string> = {}): string {
  const u = unit ? ` ${unit}` : "";
  switch (a.kind) {
    case "number":
      return `${a.n ?? 0}${u}`;
    case "perStack":
      return `${a.n ?? 1}${u} per stack`;
    case "halfStacks":
      return unit ? `${unit} equal to half the stacks` : "half the stacks";
    case "roll":
      return `1d${a.sides ?? 6}${u}`;
    case "dieRoll":
      return unit ? `${unit} equal to another roll of this die` : "another roll of this die";
    case "stat":
      return unit ? `${unit} equal to my ${stats[a.stat ?? ""] ?? a.stat}` : `my ${stats[a.stat ?? ""] ?? a.stat}`;
  }
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

const DIE_KIND_TEXT: Record<NonNullable<Check["dieKind"]>, string> = {
  slash: "a Slash die",
  pierce: "a Pierce die",
  blunt: "a Blunt die",
  block: "a Block die",
  evade: "an Evade die",
  offensive: "an Offensive die",
  defensive: "a Defensive die",
};

function checkText(c: Check): string {
  const cmp = c.cmp === "atLeast" ? "at least" : "at most";
  switch (c.kind) {
    case "roll":
      return `a d${c.sides} roll is ${cmp} ${amountText(c.amount ?? blankAmount(), "").replace(/^(\d+) per stack$/, (_, n) => (n === "1" ? "my stacks" : `${n} × my stacks`))}`;
    case "stacks":
      return `I have ${cmp} ${c.n} ${plural(c.n ?? 0, "stack")}`;
    case "die":
      return `the die is ${DIE_KIND_TEXT[c.dieKind ?? "offensive"]}`;
    case "health":
      return `my Health is ${cmp} ${c.n}%`;
  }
}

function actionText(a: Action, library: Record<string, EffectDef>, stats?: Record<string, string>): string {
  const who = whoText(a.target);
  const amount = (unit: string) => amountText(a.amount, unit, stats);
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
      return `${who} gain ${amount(library[a.effectId ?? ""]?.name || "an Effect")}`;
    case "addPower":
      return `the die gets +${amount("Power")}`;
    case "lowerPower":
      return `the die gets −${amount("Power")}`;
    case "extraDamage":
      return `deal ${amount("extra damage")}`;
    case "gainStacks":
      return `this gains ${amount("")}${a.amount.kind === "number" ? ` ${plural(a.amount.n ?? 0, "stack")}` : ""}`;
    case "loseStacks":
      return `this loses ${amount("")}${a.amount.kind === "number" ? ` ${plural(a.amount.n ?? 0, "stack")}` : ""}`;
    case "draw":
      return `I draw ${amountText(a.amount, "")}${a.amount.kind === "number" ? ` ${plural(a.amount.n ?? 0, "Page")}` : " Pages"}`;
  }
}

const joinAnd = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One rule as a sentence: "At the end of my turn, I take 1 damage per stack." */
export function describeRule(rule: Rule, library: Record<string, EffectDef> = PRESET_EFFECTS, stats?: Record<string, string>): string {
  const when = WHEN_OPTIONS.find((o) => o.value === rule.when)?.label ?? rule.when;
  const checks = rule.checks.length ? `, if ${joinAnd(rule.checks.map(checkText))}` : "";
  const actions = rule.actions.length ? joinAnd(rule.actions.map((a) => actionText(a, library, stats))) : "nothing happens";
  return `${when}${checks}, ${actions}.`;
}

const DECAY_TEXT: Record<Decay, string> = {
  none: "",
  halfAtTurnEnd: "At the end of my turn, lose half the stacks (rounded down).",
  oneAtTurnEnd: "At the end of my turn, lose 1 stack.",
  allAtTurnEnd: "At the end of my turn, lose all the stacks.",
  allAfterTrigger: "Lose all the stacks after it triggers.",
  oneAfterTrigger: "Lose 1 stack after it triggers.",
};

/** The effect's card text, written from its pieces. */
export function describeEffect(def: EffectDef, library: Record<string, EffectDef> = PRESET_EFFECTS, stats?: Record<string, string>): string {
  const lines = def.rules.map((r) => describeRule(r, library, stats));
  if (def.kind === "status" && DECAY_TEXT[def.decay]) lines.push(DECAY_TEXT[def.decay]);
  if (def.maxStacks && def.maxStacks < MAX_STACKS) lines.push(`Up to ${def.maxStacks} ${plural(def.maxStacks, "stack")}.`);
  if (def.note?.trim()) lines.push(def.note.trim());
  return lines.map(capital).join(" ");
}

/** Plain-English nudges for things that are allowed but probably not meant. */
export function effectWarnings(def: EffectDef): string[] {
  const out: string[] = [];
  if (!def.name.trim()) out.push("Give it a name.");
  if (def.rules.length === 0) out.push("It has no rules yet, so it won't do anything.");
  for (const [i, r] of def.rules.entries()) {
    const n = def.rules.length > 1 ? `Rule ${i + 1}: ` : "";
    if (r.actions.length === 0) out.push(`${n}it doesn't do anything yet.`);
    for (const a of r.actions) {
      const opt = ACTION_OPTIONS.find((o) => o.value === a.kind)!;
      if (opt.only && !opt.only.includes(r.when)) {
        out.push(`${n}"${opt.label}" only works with "${WHEN_OPTIONS.find((w) => w.value === opt.only![0])!.label}".`);
      }
      if (a.target?.who === "them" && !HAS_OTHER[r.when]) out.push(`${n}there's no "they" ${WHEN_OPTIONS.find((w) => w.value === r.when)!.label.toLowerCase()}; pick someone else.`);
      if (a.amount.kind === "dieRoll" && !HAS_DIE[r.when]) out.push(`${n}there's no die to roll again here.`);
      if (def.kind === "passive" && (a.amount.kind === "perStack" || a.amount.kind === "halfStacks")) out.push(`${n}Passives don't have stacks; they count as 1.`);
    }
    for (const c of r.checks) if (c.kind === "die" && !HAS_DIE[r.when]) out.push(`${n}there's no die to check here.`);
  }
  if (def.kind === "status" && def.decay === "none" && !def.rules.some((r) => r.actions.some((a) => a.kind === "loseStacks"))) {
    out.push("It never loses stacks on its own. Is that on purpose?");
  }
  return out;
}

// ---- Running effects (the host calls these from shared/combat.ts) ----

/** A character's view of the table, as effects need it. Implemented by shared/combat.ts. */
export interface EffectHolder {
  id: string;
  name: string;
  /** Status Effects on the character: their library id and stacks. */
  effects?: { id: string; defId?: string; name: string; count: number; description: string }[];
}

/** What the rules can do to the table; shared/combat.ts provides it so the rules stay in one place. */
export interface EffectOps<T extends EffectHolder> {
  def(id: string): EffectDef | undefined;
  /** Library ids of the always-on Passive effects a character has. */
  passives(t: T): string[];
  stat(t: T, key: string): number;
  healthPercent(t: T): number;
  /** Characters within range on the same side (allies) or the other (enemies), never t itself. */
  near(t: T, range: number, enemies: boolean): T[];
  out(t: T): boolean;
  damage(t: T, n: number): void;
  staggerDamage(t: T, n: number): void;
  heal(t: T, n: number): void;
  recoverStagger(t: T, n: number): void;
  light(t: T, n: number): void;
  sanity(t: T, n: number): void;
  draw(t: T, n: number): void;
  log(line: string): void;
}

/** What a trigger hands back to the dice: Power and damage to add. */
export interface TriggerResult {
  power: number;
  damage: number;
}

let depth = 0;

/** Adds stacks of an Effect to a character (a new entry if they don't have it). Stacks at 0 remove it. */
export function giveEffect<T extends EffectHolder>(ops: EffectOps<T>, t: T, defId: string, stacks: number) {
  const def = ops.def(defId);
  if (!def || stacks === 0) return;
  const list = (t.effects ??= []);
  const have = list.find((e) => e.defId === defId);
  const max = def.maxStacks ?? MAX_STACKS;
  if (have) have.count = Math.max(0, Math.min(max, have.count + stacks));
  else if (stacks > 0) list.push({ id: newId(), defId, name: def.name, count: Math.min(max, stacks), description: describeEffect(def) });
  t.effects = list.filter((e) => !e.defId || e.count > 0);
}

/**
 * Runs every rule listening for this moment on a character: their status Effects (with their
 * stacks), then their Passives. Returns any Power or damage the rules add to the die.
 */
export function runTrigger<T extends EffectHolder>(ops: EffectOps<T>, when: When, holder: T, other?: T, die?: Dice): TriggerResult {
  const result: TriggerResult = { power: 0, damage: 0 };
  if (depth >= MAX_DEPTH || ops.out(holder)) return result;
  depth++;
  try {
    const sources = [
      ...(holder.effects ?? []).filter((e) => e.defId).map((e) => ({ defId: e.defId!, entry: e })),
      ...ops.passives(holder).map((defId) => ({ defId, entry: undefined })),
    ];
    for (const { defId, entry } of sources) {
      const def = ops.def(defId);
      if (!def || (entry && entry.count <= 0)) continue;
      const rules = def.rules.filter((r) => r.when === when);
      if (!rules.length) continue;
      let fired = false;
      for (const rule of rules) {
        const stacks = entry ? entry.count : 1;
        const scope = { ops, holder, other, die, stacks };
        if (!rule.checks.every((c) => passes(c, scope))) continue;
        fired = true;
        ops.log(`  ${holder.name}'s ${def.name}${entry ? ` ${stacks}` : ""} triggers.`);
        for (const action of rule.actions) act(action, scope, result, entry, def);
      }
      if (fired && entry) {
        if (def.decay === "allAfterTrigger") entry.count = 0;
        else if (def.decay === "oneAfterTrigger") entry.count = Math.max(0, entry.count - 1);
      }
    }
    if (holder.effects) holder.effects = holder.effects.filter((e) => !e.defId || e.count > 0);
  } finally {
    depth--;
  }
  return result;
}

/** End of turn: stacks that wear off at the end of the character's turn. */
export function decayAtTurnEnd<T extends EffectHolder>(ops: EffectOps<T>, holder: T) {
  if (!holder.effects) return;
  for (const e of holder.effects) {
    const def = e.defId ? ops.def(e.defId) : undefined;
    if (!def) continue;
    const before = e.count;
    if (def.decay === "halfAtTurnEnd") e.count = Math.floor(e.count / 2);
    else if (def.decay === "oneAtTurnEnd") e.count = Math.max(0, e.count - 1);
    else if (def.decay === "allAtTurnEnd") e.count = 0;
    if (e.count !== before) ops.log(`  ${holder.name}'s ${def.name}: ${before} → ${e.count}.`);
  }
  holder.effects = holder.effects.filter((e) => !e.defId || e.count > 0);
}

interface Scope<T extends EffectHolder> {
  ops: EffectOps<T>;
  holder: T;
  other?: T;
  die?: Dice;
  stacks: number;
}

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
    case "dieRoll":
      n = s.die ? rollDie(s.die.sides) + s.die.basePower : 0;
      break;
    case "stat":
      n = s.ops.stat(s.holder, a.stat ?? "");
      break;
  }
  return Math.max(0, Math.min(999, Math.round(n)));
}

function passes<T extends EffectHolder>(c: Check, s: Scope<T>): boolean {
  const cmp = (x: number, y: number) => (c.cmp === "atLeast" ? x >= y : x <= y);
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
    case "health":
      return cmp(s.ops.healthPercent(s.holder), c.n ?? 50);
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

function act<T extends EffectHolder>(a: Action, s: Scope<T>, result: TriggerResult, entry: { count: number } | undefined, def: EffectDef) {
  const n = amountOf(a.amount, s);
  const { ops } = s;
  const each = (fn: (t: T) => void) => targets(a.target, s).forEach(fn);
  switch (a.kind) {
    case "damage":
      return each((t) => ops.damage(t, n));
    case "staggerDamage":
      return each((t) => ops.staggerDamage(t, n));
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
        if (!given) return;
        giveEffect(ops, t, a.effectId!, n);
        ops.log(`  ${t.name} gains ${n} ${given.name}.`);
      });
    case "addPower":
      result.power += n;
      return;
    case "lowerPower":
      result.power -= n;
      return;
    case "extraDamage":
      result.damage += n;
      if (n) ops.log(`  +${n} damage.`);
      return;
    case "gainStacks":
    case "loseStacks":
      if (!entry) return;
      entry.count = Math.max(0, Math.min(def.maxStacks ?? MAX_STACKS, entry.count + (a.kind === "gainStacks" ? n : -n)));
      return;
    case "draw":
      return ops.draw(s.holder, n);
  }
}
