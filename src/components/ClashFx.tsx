import { useEffect, useRef, useState } from "react";
import type { ClashFx, FxDie, TableState } from "../../shared/types.ts";

type Stage = "intro" | "roll" | "reveal" | "result";
/** What the clash animation is showing right now. */
export interface FxStep {
  fx: ClashFx;
  round: number;
  stage: Stage;
}

/** How long each stage lasts, in ms. */
const TIMES: Record<Stage, number> = { intro: 700, roll: 750, reveal: 450, result: 850 };

function next(step: FxStep): FxStep | null {
  if (step.stage === "intro") return { ...step, stage: "roll" };
  if (step.stage === "roll") return { ...step, stage: "reveal" };
  if (step.stage === "reveal") return { ...step, stage: "result" };
  return step.round + 1 < step.fx.rounds.length ? { ...step, round: step.round + 1, stage: "roll" } : null;
}

/**
 * Plays each new Page resolution from the table, one die at a time: the dice roll, show their
 * Final Power, then win, lose or Draw. Resolutions that happened before this screen opened are skipped.
 */
export function useClashPlayback(table: TableState | undefined): FxStep | null {
  const c = table?.combat;
  const seq = c?.fxSeq ?? 0;
  const seen = useRef<number | null>(null);
  const [queue, setQueue] = useState<ClashFx[]>([]);
  const [step, setStep] = useState<FxStep | null>(null);

  useEffect(() => {
    if (!table) return;
    if (seen.current === null) {
      seen.current = seq;
      return;
    }
    // A new combat starts counting again.
    if (seq < seen.current) seen.current = 0;
    const fresh = (c?.fx ?? []).filter((f) => f.id > seen.current!);
    seen.current = seq;
    if (fresh.length) setQueue((q) => [...q, ...fresh]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, !!table]);

  useEffect(() => {
    if (!step) {
      if (queue.length) {
        setStep({ fx: queue[0], round: 0, stage: "intro" });
        setQueue((q) => q.slice(1));
      }
      return;
    }
    // Catch up faster when several resolutions are waiting.
    const t = setTimeout(() => setStep(next(step)), TIMES[step.stage] * (queue.length > 1 ? 0.5 : 1));
    return () => clearTimeout(t);
  }, [step, queue]);

  return step;
}

const KIND_LABELS: Record<FxDie["kind"], string> = { slash: "Slash", pierce: "Pierce", blunt: "Blunt", block: "Block", evade: "Evade" };

function RollingNumber({ die }: { die: FxDie }) {
  const roll = () => 1 + Math.floor(Math.random() * Math.max(1, die.sides)) + die.basePower;
  const [n, setN] = useState(roll);
  useEffect(() => {
    const i = setInterval(() => setN(roll()), 70);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [die]);
  return <>{n}</>;
}

/** The animation above one character: their Page's name, then the die they're rolling. */
export function FxBubble({ step, side }: { step: FxStep; side: "a" | "b" }) {
  const { fx, round, stage } = step;
  const pageName = side === "a" ? fx.pageA : fx.pageB;
  const r = fx.rounds[round];
  const die = r?.[side];
  const other = side === "a" ? "b" : "a";
  if (stage === "intro") return pageName ? <div className="fx-page" title={pageName}>{pageName}</div> : null;

  const done = stage === "result";
  // Struck by an unopposed die: an impact instead of a die.
  if (!die) return done && r.result === "hit" && r[other] ? <div className="fx-impact">✸</div> : null;

  const outcome = !done ? "" : r.result === "hit" ? " hit" : r.result === "draw" ? " draw" : r.result === side ? " win" : " lose";
  return (
    <div className="fx-stack">
      {fx.rounds.length > 1 && (
        <div className="fx-page small">
          {round + 1}/{fx.rounds.length}
        </div>
      )}
      <div className={`fx-die ${die.kind}${stage === "roll" ? " rolling" : ""}${outcome}`}>
        <span className="fx-num">{stage === "roll" ? <RollingNumber die={die} /> : die.power}</span>
        <span className="fx-kind">
          {die.counter ? "Counter " : ""}
          {KIND_LABELS[die.kind]}
        </span>
      </div>
      {done && r.result === "draw" && <div className="fx-tag">Draw</div>}
    </div>
  );
}
