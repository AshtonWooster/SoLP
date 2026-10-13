import { useEffect, useRef, useState } from "react";
import type { Combatant, TableState } from "../../shared/types.ts";
import { SPEED_TIMES, nextSpeedStep, ordinal, rollingSpeed, speedRollToPlay, type SpeedStep } from "./speedRoll.ts";

/** Plays each new Speed roll from the table: the dice tumble, then land on everyone's Speed. */
export function useSpeedRollPlayback(table: TableState | undefined): SpeedStep | null {
  const c = table?.combat;
  const id = c?.speedRoll?.id;
  const seen = useRef<string | null | undefined>(undefined);
  const [step, setStep] = useState<SpeedStep | null>(null);

  useEffect(() => {
    if (!table) return;
    const play = speedRollToPlay(seen.current, c);
    seen.current = id ?? null;
    if (play) setStep(play);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!table]);

  // Combat ending stops the roll.
  useEffect(() => {
    if (!c) setStep(null);
  }, [c]);

  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => setStep(nextSpeedStep(step)), SPEED_TIMES[step.stage]);
    return () => clearTimeout(t);
  }, [step]);

  return step;
}

/** A Speed number that keeps changing while the die rolls. */
export function RollingSpeed({ entry }: { entry: Combatant }) {
  const [n, setN] = useState(() => rollingSpeed(entry));
  useEffect(() => {
    const i = setInterval(() => setN(rollingSpeed(entry)), 70);
    return () => clearInterval(i);
  }, [entry]);
  return <>{n}</>;
}

/** The Speed die above one character on the map, then where it put them in the turn order. */
export function SpeedBubble({ step, entry, place }: { step: SpeedStep; entry: Combatant; place: number }) {
  const rolling = step.stage === "roll";
  return (
    <div className="fx-stack">
      <div className={"fx-die speed" + (rolling ? " rolling" : " settled")}>
        <span className="fx-num">{rolling ? <RollingSpeed entry={entry} /> : entry.speed}</span>
        <span className="fx-kind">Speed</span>
      </div>
      {!rolling && place > 0 && <div className="fx-tag">{ordinal(place)}</div>}
    </div>
  );
}

/** On a phone: your own Speed roll, while the board plays everyone's. */
export function SpeedRollCard({ step, tokenId, order }: { step: SpeedStep; tokenId?: string; order: Combatant[] }) {
  const entry = step.entries.find((x) => x.tokenId === tokenId);
  if (!entry) return null;
  const rolling = step.stage === "roll";
  const place = order.findIndex((x) => x.tokenId === tokenId) + 1;
  return (
    <div className="speed-roll-card" role="status">
      <div className={"fx-die speed" + (rolling ? " rolling" : " settled")}>
        <span className="fx-num">{rolling ? <RollingSpeed entry={entry} /> : entry.speed}</span>
        <span className="fx-kind">Speed</span>
      </div>
      <span>{rolling ? "Rolling Speed…" : place > 0 ? `Speed ${entry.speed}: you go ${ordinal(place)}.` : `Speed ${entry.speed}.`}</span>
    </div>
  );
}
