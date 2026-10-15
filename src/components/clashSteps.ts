import type { ClashFx } from "../../shared/types.ts";

export type Stage = "intro" | "roll" | "reveal" | "result";
/** What the clash animation is showing right now. */
export interface FxStep {
  fx: ClashFx;
  round: number;
  stage: Stage;
}

/**
 * A Mass Summation die after the check: its number was rolled with the rest for the sum, so it
 * shows straight away instead of rolling again.
 */
export function alreadyRolled(fx: ClashFx, round: number): boolean {
  return round > 0 && !!fx.rounds[0]?.aDice && !fx.rounds[round]?.aDice;
}

/** The next step of the animation, or null when it's over. A step whose dice are all already rolled skips the roll. */
export function nextStep(step: FxStep): FxStep | null {
  if (step.stage === "intro") return { ...step, stage: "roll" };
  if (step.stage === "roll") return { ...step, stage: "reveal" };
  if (step.stage === "reveal") return { ...step, stage: "result" };
  const round = step.round + 1;
  if (round >= step.fx.rounds.length) return null;
  // A Counter Die answering it is a fresh roll, so that step still rolls.
  const fresh = Object.values(step.fx.rounds[round].vs ?? {}).some((v) => v.die);
  return { ...step, round, stage: alreadyRolled(step.fx, round) && !fresh ? "reveal" : "roll" };
}
