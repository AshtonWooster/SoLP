import { useState } from "react";
import { withheld } from "../../shared/secrets.ts";
import type { TableState } from "../../shared/types.ts";
import { RollingSpeed } from "./SpeedRollFx.tsx";
import type { SpeedStep } from "./speedRoll.ts";

/** The turn order, highest Speed first, with whoever's turn it is highlighted. */
export function TurnOrder({
  table,
  controls,
  onMove,
  speed,
}: {
  table: TableState;
  /** GM-only buttons shown on each row. */
  controls?: (tokenId: string, index: number) => React.ReactNode;
  /** With this, the GM drags rows to reorder them. */
  onMove?: (tokenId: string, to: number) => void;
  /** A Speed roll playing now: the order waits for everyone's dice, or one newcomer's Speed tumbles. */
  speed?: SpeedStep | null;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const c = table.combat;
  if (!c) return null;
  const rolling = speed?.stage === "roll";
  if (rolling && speed.whole) return <p className="turn-order rolling-speed muted">Rolling Speed…</p>;
  // The order deals itself out once everyone's dice land.
  const dealt = speed?.stage === "settle" && speed.whole;
  return (
    <ol className={"turn-order" + (dealt ? " dealt" : "")}>
      {c.order.map((entry, i) => {
        const t = table.tokens[entry.tokenId];
        if (!t) return null;
        return (
          <li
            key={entry.tokenId}
            className={(i === c.turn ? "current " : "") + t.side + (onMove ? " draggable" : "") + (over === i && dragging && dragging !== entry.tokenId ? " drop-here" : "")}
            style={dealt ? { animationDelay: `${i * 90}ms` } : undefined}
            draggable={!!onMove}
            title={onMove ? "Drag to change the order" : undefined}
            onDragStart={onMove ? (e) => (setDragging(entry.tokenId), (e.dataTransfer.effectAllowed = "move")) : undefined}
            onDragOver={onMove && dragging ? (e) => (e.preventDefault(), setOver(i)) : undefined}
            onDragEnd={onMove ? () => (setDragging(null), setOver(null)) : undefined}
            onDrop={
              onMove && dragging
                ? (e) => {
                    e.preventDefault();
                    onMove(dragging, i);
                    setDragging(null);
                    setOver(null);
                  }
                : undefined
            }
          >
            <span className="swatch" style={{ background: t.color }} />
            <span className="turn-name">{t.name}</span>
            {t.status?.knockedOut ? <span className="badge-soft">KO</span> : t.status?.staggered && <span className="badge-soft stagger-badge">Staggered</span>}
            <span className="turn-speed" title={withheld(t, "justice") ? "Speed" : `Rolled ${entry.roll}, +${entry.bonus} Justice`}>
              {rolling && speed.entries.some((x) => x.tokenId === entry.tokenId) ? <RollingSpeed entry={entry} /> : entry.speed}
            </span>
            {controls?.(entry.tokenId, i)}
          </li>
        );
      })}
    </ol>
  );
}
