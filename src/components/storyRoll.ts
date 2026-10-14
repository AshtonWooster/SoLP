import { STORY_DIE } from "../../shared/ruleset.ts";
import type { TableState } from "../../shared/types.ts";

type Stage = "roll" | "settle";

/** What the Story Roll animation is showing right now. */
export interface StoryStep {
  id: string;
  tokenId: string;
  /** The Stat rolled, as shown: "Insight". */
  label: string;
  roll: number;
  /** The Stat added to the roll; missing when it's hidden from this screen. */
  bonus?: number;
  stage: Stage;
}

/** How long each stage lasts, in ms. The result stays up a little longer than a Speed roll's. */
export const STORY_TIMES: Record<Stage, number> = { roll: 1200, settle: 2400 };

/**
 * The Story Roll this screen should play, if any. `seen` is the roll it already knows about, or
 * undefined on its first look: opening a screen doesn't replay the last roll.
 */
export function storyRollToPlay(seen: string | null | undefined, table: TableState | undefined): StoryStep | null {
  const roll = table?.storyRoll;
  if (seen === undefined || !roll || roll.id === seen || !table.tokens[roll.tokenId]) return null;
  const label = roll.stat.charAt(0).toUpperCase() + roll.stat.slice(1);
  return { id: roll.id, tokenId: roll.tokenId, label, roll: roll.roll, ...(roll.bonus !== undefined ? { bonus: roll.bonus } : {}), stage: "roll" };
}

export function nextStoryStep(step: StoryStep): StoryStep | null {
  return step.stage === "roll" ? { ...step, stage: "settle" } : null;
}

/** What the die lands on: the roll plus the Stat, or the bare roll when the Stat is hidden. */
export function storyTotal(step: Pick<StoryStep, "roll" | "bonus">): number {
  return step.roll + (step.bonus ?? 0);
}

/** "14 + 3", or "14" when there's no Stat to show. */
export function storyBreakdown(step: Pick<StoryStep, "roll" | "bonus">): string {
  if (step.bonus === undefined) return String(step.roll);
  return `${step.roll} ${step.bonus < 0 ? "−" : "+"} ${Math.abs(step.bonus)}`;
}

/** A face the die might show while it's still rolling. */
export function rollingStory(step: Pick<StoryStep, "bonus">, random = Math.random): number {
  return 1 + Math.floor(random() * STORY_DIE) + (step.bonus ?? 0);
}
