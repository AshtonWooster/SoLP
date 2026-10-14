import { useEffect, useRef, useState } from "react";
import type { TableState } from "../../shared/types.ts";
import { STORY_TIMES, nextStoryStep, rollingStory, storyBreakdown, storyRollToPlay, storyTotal, type StoryStep } from "./storyRoll.ts";

/** Plays each new Story Roll from the table: the die tumbles, then lands on the result. */
export function useStoryRollPlayback(table: TableState | undefined): StoryStep | null {
  const id = table?.storyRoll?.id;
  const seen = useRef<string | null | undefined>(undefined);
  const [step, setStep] = useState<StoryStep | null>(null);

  useEffect(() => {
    if (!table) return;
    const play = storyRollToPlay(seen.current, table);
    seen.current = id ?? null;
    if (play) setStep(play);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!table]);

  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => setStep(nextStoryStep(step)), STORY_TIMES[step.stage]);
    return () => clearTimeout(t);
  }, [step]);

  return step;
}

/** A Story Roll's number that keeps changing while the die rolls, then its result. */
function StoryDie({ step }: { step: StoryStep }) {
  const rolling = step.stage === "roll";
  const [n, setN] = useState(() => rollingStory(step));
  useEffect(() => {
    if (!rolling) return;
    const i = setInterval(() => setN(rollingStory(step)), 70);
    return () => clearInterval(i);
  }, [rolling, step]);
  return (
    <div className={"fx-die story" + (rolling ? " rolling" : " settled")}>
      <span className="fx-num">{rolling ? n : storyTotal(step)}</span>
      <span className="fx-kind">{step.label}</span>
    </div>
  );
}

/** The Story Roll die above the character on the map, then the roll and Stat that made it. */
export function StoryBubble({ step }: { step: StoryStep }) {
  return (
    <div className="fx-stack">
      <StoryDie step={step} />
      {step.stage === "settle" && step.bonus !== undefined && <div className="fx-tag">{storyBreakdown(step)}</div>}
    </div>
  );
}

/** On a phone: your own Story Roll, while the board plays it too. */
export function StoryRollCard({ step }: { step: StoryStep }) {
  const rolling = step.stage === "roll";
  return (
    <div className="speed-roll-card story-roll-card" role="status">
      <StoryDie step={step} />
      <span>{rolling ? `Rolling ${step.label}…` : step.bonus === undefined ? `${step.label} Story Roll: ${step.roll}.` : `${step.label} Story Roll: ${storyBreakdown(step)} = ${storyTotal(step)}.`}</span>
    </div>
  );
}
