import { useEffect, useRef, useState } from "react";
import type { ClashFx, FxDie, FxMassSide, FxRound, FxState, TableState } from "../../shared/types.ts";

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

/** The characters' state at this point of the animation: before the first die, or after the last one shown. */
function stateAt(step: FxStep): FxState | undefined {
  const { fx, round, stage } = step;
  if (stage === "result") return fx.rounds[round]?.after;
  if (stage === "intro" || round === 0) return fx.before;
  return fx.rounds[round - 1]?.after;
}

/**
 * The table as it should look right now: characters in a resolution that hasn't finished playing
 * show the Health, Stagger and Sanity they had at that point, so damage lands when its die does.
 */
function shownTable(table: TableState, step: FxStep | null, waiting: ClashFx[]): TableState {
  const at: FxState = {};
  // The earliest waiting resolution's "before" wins; the one playing now wins over all of them.
  for (const fx of [...waiting].reverse()) Object.assign(at, fx.before ?? {});
  if (step) Object.assign(at, stateAt(step) ?? {});
  if (Object.keys(at).length === 0) return table;
  const tokens = Object.fromEntries(
    Object.entries(table.tokens).map(([id, t]) => [id, at[id] ? { ...t, resources: at[id].resources, status: at[id].status } : t]),
  );
  return { ...table, tokens };
}

/**
 * Plays each new Page resolution from the table, one die at a time: the dice roll, show their
 * Final Power, then win, lose or Draw. Resolutions that happened before this screen opened are skipped.
 * Returns the step to draw, and the table to show (damage held back until its die has played).
 */
export function useClashPlayback<T extends TableState | undefined>(table: T): { step: FxStep | null; table: T } {
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

  // Resolutions that just arrived (this render, before the effect above queues them) also hold back their damage.
  const unseen = seen.current === null || !c ? [] : (c.fx ?? []).filter((f) => f.id > seen.current!);
  const waiting = [...queue, ...unseen];
  const shown = table && (step || waiting.length) ? shownTable(table, step, waiting) : table;
  return { step, table: shown as T };
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

/** "1/3" over a die; a Mass Summation check is labelled "Sum" and the dice after it count from 1. */
function stepLabel(fx: ClashFx, round: number) {
  const r = fx.rounds[round];
  if (r?.aDice) return "Sum";
  const offset = fx.rounds[0]?.aDice ? 1 : 0;
  const n = fx.rounds.length - offset;
  return n > 1 ? `${round + 1 - offset}/${n}` : null;
}

/** How a die looks once the step plays out, from its owner's side ("a" is the attacker). */
function outcomeClass(result: FxRound["result"], mine: "a" | "b") {
  return result === "hit" ? " hit" : result === "draw" ? " draw" : result === mine ? " win" : " lose";
}

function OneDie({ die, stage, outcome, mini }: { die: FxDie; stage: Stage; outcome: string; mini?: boolean }) {
  return (
    <div className={`fx-die ${die.kind}${mini ? " mini" : ""}${stage === "roll" ? " rolling" : ""}${outcome}`}>
      <span className="fx-num">{stage === "roll" ? <RollingNumber die={die} /> : die.power}</span>
      <span className="fx-kind">
        {die.counter ? "Counter " : ""}
        {mini ? KIND_LABELS[die.kind].slice(0, 2) : KIND_LABELS[die.kind]}
      </span>
    </div>
  );
}

/** A Summation check: every die rolled together, then their sum. */
function DiceSum({ dice, stage, outcome }: { dice: FxDie[]; stage: Stage; outcome: string }) {
  const settled = stage !== "roll";
  return (
    <div className="fx-sum">
      <div className="fx-sum-dice">
        {dice.map((d, i) => (
          <OneDie key={i} die={d} stage={stage} outcome="" mini />
        ))}
      </div>
      <div className={"fx-total" + (settled ? outcome : " rolling")}>{settled ? dice.reduce((x, d) => x + d.power, 0) : "Σ"}</div>
    </div>
  );
}

const MASS_TAGS: Partial<Record<FxRound["result"], string>> = { a: "Negated", b: "Held", draw: "Tie" };

/** A Mass Attack target's side of a step: their die or dice (if they answered), then how it went. */
function MassTarget({ step, side }: { step: FxStep; side: FxMassSide | undefined }) {
  const { stage } = step;
  const done = stage === "result";
  if (!side) return null;
  const outcome = done ? outcomeClass(side.result, "b") : "";
  if (side.dice?.length) {
    return (
      <div className="fx-stack">
        <DiceSum dice={side.dice} stage={stage} outcome={outcome} />
        {done && MASS_TAGS[side.result] && <div className="fx-tag">{MASS_TAGS[side.result]}</div>}
      </div>
    );
  }
  if (side.die) {
    return (
      <div className="fx-stack">
        <OneDie die={side.die} stage={stage} outcome={outcome} />
        {done && side.result === "draw" && <div className="fx-tag">Draw</div>}
        {done && side.result === "a" && !step.fx.rounds[step.round].aDice && <div className="fx-impact">✸</div>}
      </div>
    );
  }
  // Struck unopposed: an impact once it lands. The Summation check isn't a hit yet.
  return done && side.result === "hit" && !step.fx.rounds[step.round].aDice ? <div className="fx-impact">✸</div> : null;
}

/** The animation above one character: their Page's name, then the die they're rolling. `side` is "a", "b" or a Mass Attack target's id. */
export function FxBubble({ step, side }: { step: FxStep; side: string }) {
  const { fx, round, stage } = step;
  const mass = !!fx.targets && side !== "a";
  const pageName = side === "a" ? fx.pageA : mass ? fx.pages?.[side] : fx.pageB;
  if (stage === "intro") return pageName ? <div className="fx-page" title={pageName}>{pageName}</div> : null;
  const r = fx.rounds[round];
  if (!r) return null;
  const label = stepLabel(fx, round);
  if (mass) {
    const vs = r.vs?.[side];
    return vs ? (
      <div className="fx-stack">
        {label && (vs.die || vs.dice) && <div className="fx-page small">{label}</div>}
        <MassTarget step={step} side={vs} />
      </div>
    ) : null;
  }

  const done = stage === "result";
  const me = side === "b" ? "b" : "a";
  const other = me === "a" ? "b" : "a";
  const outcome = done ? outcomeClass(r.result, me) : "";
  if (me === "a" && r.aDice) {
    return (
      <div className="fx-stack">
        <div className="fx-page small">{label}</div>
        <DiceSum dice={r.aDice} stage={stage} outcome={outcome} />
      </div>
    );
  }
  const die = r[me];
  // Struck by an unopposed die: an impact instead of a die.
  if (!die) return done && r.result === "hit" && r[other] ? <div className="fx-impact">✸</div> : null;

  return (
    <div className="fx-stack">
      {label && <div className="fx-page small">{label}</div>}
      <OneDie die={die} stage={stage} outcome={outcome} />
      {done && r.result === "draw" && <div className="fx-tag">Draw</div>}
    </div>
  );
}
