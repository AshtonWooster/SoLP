import { useState } from "react";
import { withheld } from "../../shared/secrets.ts";
import type { TableState } from "../../shared/types.ts";

/** The turn order, highest Speed first, with whoever's turn it is highlighted. */
export function TurnOrder({
  table,
  controls,
  onMove,
}: {
  table: TableState;
  /** GM-only buttons shown on each row. */
  controls?: (tokenId: string, index: number) => React.ReactNode;
  /** With this, the GM drags rows to reorder them. */
  onMove?: (tokenId: string, to: number) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const c = table.combat;
  if (!c) return null;
  return (
    <ol className="turn-order">
      {c.order.map((entry, i) => {
        const t = table.tokens[entry.tokenId];
        if (!t) return null;
        return (
          <li
            key={entry.tokenId}
            className={(i === c.turn ? "current " : "") + t.side + (onMove ? " draggable" : "") + (over === i && dragging && dragging !== entry.tokenId ? " drop-here" : "")}
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
            {t.emotion && (
              <span className="badge-soft emotion-badge" title={`Emotion Level ${t.emotion.level} (${t.emotion.points} Emotion ${t.emotion.points === 1 ? "Point" : "Points"} toward the next)`}>
                Emotion {t.emotion.level}
              </span>
            )}
            <span className="turn-speed" title={withheld(t, "justice") ? "Speed" : `Rolled ${entry.roll}, +${entry.bonus} Justice`}>
              {entry.speed}
            </span>
            {controls?.(entry.tokenId, i)}
          </li>
        );
      })}
    </ol>
  );
}
