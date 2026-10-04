import type { TableState } from "../../shared/types.ts";

/** The turn order, highest Speed first, with whoever's turn it is highlighted. */
export function TurnOrder({
  table,
  controls,
}: {
  table: TableState;
  /** GM-only buttons shown on each row. */
  controls?: (tokenId: string, index: number) => React.ReactNode;
}) {
  const c = table.combat;
  if (!c) return null;
  return (
    <ol className="turn-order">
      {c.order.map((entry, i) => {
        const t = table.tokens[entry.tokenId];
        if (!t) return null;
        return (
          <li key={entry.tokenId} className={(i === c.turn ? "current " : "") + t.side}>
            <span className="swatch" style={{ background: t.color }} />
            <span className="turn-name">{t.name}</span>
            {t.status?.knockedOut ? <span className="badge-soft">KO</span> : t.status?.staggered && <span className="badge-soft stagger-badge">Staggered</span>}
            <span className="turn-speed" title={`Rolled ${entry.roll}, +${entry.bonus} Justice`}>
              {entry.speed}
            </span>
            {controls?.(entry.tokenId, i)}
          </li>
        );
      })}
    </ol>
  );
}
