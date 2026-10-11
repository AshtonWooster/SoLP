// Stat formulas: how Rank and the Primary Stats turn into max Health, Stagger Resist, Sanity and
// Light. The GM edits them per game (game settings); a formula is a small arithmetic expression,
// worked out here without eval so a typo can't run code.

import type { Character } from "./character.ts";
import type { GameDoc, Resources } from "./types.ts";

export type StatFormulaKey = "health" | "stagger" | "sanity" | "light";
export type StatFormulas = Record<StatFormulaKey, string>;

export const STAT_FORMULA_FIELDS: { key: StatFormulaKey; label: string; max: "maxHp" | "maxStagger" | "maxSanity" | "maxLight" }[] = [
  { key: "health", label: "Health", max: "maxHp" },
  { key: "stagger", label: "Stagger Resist", max: "maxStagger" },
  { key: "sanity", label: "Sanity", max: "maxSanity" },
  { key: "light", label: "Light", max: "maxLight" },
];

/**
 * The standard formulas, which new games start with. Fixer Ranks count down (9 is the newest, 1 the
 * best), so in a formula Rank counts up: Rank = 10 - the character's Rank (1 at Rank 9, 9 at Rank 1).
 */
export const DEFAULT_STAT_FORMULAS: StatFormulas = {
  health: "64 + Rank*16 + Fortitude*10",
  stagger: "20 + Rank*2 + Temperance*4",
  sanity: "15 + Rank*1 + Prudence*2",
  light: "3 + floor(Rank/2)",
};

/**
 * The numbers games used before stat formulas existed, written as formulas. Games made before then
 * have no formulas saved and keep using these until the GM changes them.
 */
export const LEGACY_STAT_FORMULAS: StatFormulas = {
  health: "24 + Rank*6 + Fortitude",
  stagger: "16 + Rank*4 + Temperance",
  sanity: "15 + Prudence",
  light: "3",
};

/** The names a formula can use, matched without regard to case. */
export const FORMULA_VARIABLES = ["Rank", "Fortitude", "Prudence", "Justice", "Temperance"] as const;
const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
};
export const MAX_FORMULA_LENGTH = 200;

/** The value of Rank in a formula: it counts up from 1 at Fixer Rank 9 to 9 at Fixer Rank 1. */
export function formulaRank(rank: number): number {
  return 10 - rank;
}

type Vars = Record<string, number>;

/** Works out a formula, or throws an Error saying what's wrong with it. */
export function evaluateFormula(formula: string, vars: Vars): number {
  if (formula.length > MAX_FORMULA_LENGTH) throw new Error(`Keep it under ${MAX_FORMULA_LENGTH} characters.`);
  const tokens = formula.match(/\d+(?:\.\d+)?|[A-Za-z_]+|\S/g) ?? [];
  const lower: Vars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  let i = 0;
  const peek = () => tokens[i];
  const take = (want?: string) => {
    const t = tokens[i];
    if (want !== undefined && t !== want) throw new Error(t === undefined ? `Missing "${want}".` : `Expected "${want}" but found "${t}".`);
    i++;
    return t;
  };

  // expr := term (("+" | "-") term)*; term := unary (("*" | "/") unary)*; unary := "-" unary | atom
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = take() === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (peek() === "*" || peek() === "/") {
      if (take() === "*") v *= unary();
      else {
        const d = unary();
        if (d === 0) throw new Error("Can't divide by zero.");
        v /= d;
      }
    }
    return v;
  };
  const unary = (): number => {
    if (peek() === "-") return take(), -unary();
    if (peek() === "+") return take(), unary();
    return atom();
  };
  const atom = (): number => {
    const t = take();
    if (t === undefined) throw new Error("The formula ends too early.");
    if (/^\d/.test(t)) return Number(t);
    if (t === "(") {
      const v = expr();
      take(")");
      return v;
    }
    if (/^[A-Za-z_]/.test(t)) {
      const name = t.toLowerCase();
      if (peek() === "(") {
        const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
        if (!fn) throw new Error(`Unknown function "${t}".`);
        take("(");
        const args = [expr()];
        while (peek() === ",") take(), args.push(expr());
        take(")");
        return fn(...args);
      }
      if (Object.hasOwn(lower, name)) return lower[name];
      throw new Error(`Unknown name "${t}". Use ${FORMULA_VARIABLES.join(", ")}.`);
    }
    throw new Error(`Unexpected "${t}".`);
  };

  if (!tokens.length) throw new Error("Write a formula.");
  const v = expr();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}".`);
  if (!Number.isFinite(v)) throw new Error("The result isn't a number.");
  return v;
}

/** The variables a character's formulas see. */
export function formulaVars(c: Pick<Character, "rank" | "primary">): Vars {
  return {
    rank: formulaRank(c.rank),
    fortitude: c.primary.fortitude ?? 0,
    prudence: c.primary.prudence ?? 0,
    justice: c.primary.justice ?? 0,
    temperance: c.primary.temperance ?? 0,
  };
}

/** What's wrong with a formula (tried at every Rank with Stats of 0 to 10), or undefined if it works. */
export function formulaError(formula: string): string | undefined {
  try {
    for (const rank of [9, 1]) for (const s of [0, 10]) evaluateFormula(formula, formulaVars({ rank, primary: { fortitude: s, prudence: s, justice: s, temperance: s } }));
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

/** A game's formulas: the GM's, or the old numbers for a game from before formulas. */
export function gameStatFormulas(game: GameDoc | undefined): StatFormulas {
  const saved = game?.settings?.statFormulas;
  if (!saved) return LEGACY_STAT_FORMULAS;
  const out = { ...DEFAULT_STAT_FORMULAS };
  for (const { key } of STAT_FORMULA_FIELDS) if (typeof saved[key] === "string") out[key] = saved[key];
  return out;
}

/** Max Resources from Rank and Stats. A broken formula falls back to the standard one; each is a whole number, at least 1. */
export function computeMaxResources(
  c: Pick<Character, "rank" | "primary">,
  formulas: StatFormulas,
): Pick<Resources, "maxHp" | "maxStagger" | "maxSanity" | "maxLight"> {
  const vars = formulaVars(c);
  const value = (key: StatFormulaKey) => {
    let v: number;
    try {
      v = evaluateFormula(formulas[key], vars);
    } catch {
      v = evaluateFormula(DEFAULT_STAT_FORMULAS[key], vars);
    }
    return Math.max(1, Math.floor(v));
  };
  return { maxHp: value("health"), maxStagger: value("stagger"), maxSanity: value("sanity"), maxLight: value("light") };
}
