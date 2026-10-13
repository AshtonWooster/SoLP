import { SPEED_DIE } from "../../shared/ruleset.ts";
import type { Combatant, CombatState } from "../../shared/types.ts";

type Stage = "roll" | "settle";

/** What the Speed roll animation is showing right now. */
export interface SpeedStep {
  id: string;
  /** The characters who rolled, as they now stand in the turn order. */
  entries: Combatant[];
  /** Everyone in the order rolled (combat starting, or a re-roll), so the order waits for the dice. */
  whole: boolean;
  stage: Stage;
}

/** How long each stage lasts, in ms. */
export const SPEED_TIMES: Record<Stage, number> = { roll: 1200, settle: 1100 };

/**
 * The Speed roll this screen should play, if any. `seen` is the roll it already knows about, or
 * undefined on its first look: a screen opened in the middle of combat doesn't replay the last roll.
 */
export function speedRollToPlay(seen: string | null | undefined, combat: CombatState | undefined): SpeedStep | null {
  const roll = combat?.speedRoll;
  if (seen === undefined || !roll || roll.id === seen) return null;
  const ids = new Set(roll.tokenIds);
  const entries = combat.order.filter((x) => ids.has(x.tokenId));
  if (!entries.length) return null;
  return { id: roll.id, entries, whole: entries.length === combat.order.length, stage: "roll" };
}

export function nextSpeedStep(step: SpeedStep): SpeedStep | null {
  return step.stage === "roll" ? { ...step, stage: "settle" } : null;
}

/** A face the die might show while it's still rolling. */
export function rollingSpeed(entry: Combatant, random = Math.random): number {
  return 1 + Math.floor(random() * SPEED_DIE) + entry.bonus;
}

/** "1st", "2nd", "3rd", "4th"… */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
