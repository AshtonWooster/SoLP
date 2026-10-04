import type { TableState, Token } from "../../shared/types.ts";

interface Props {
  state: TableState;
  selectedId?: string | null;
  /** Whose turn it is in combat; that token glows. */
  activeId?: string;
  /** Tiles the selected token can move to, as "x,y". */
  reachable?: Set<string>;
  onTokenClick?: (t: Token) => void;
  onCellClick?: (x: number, y: number) => void;
}

/** The battle map: a tile grid with tokens on it. Used full-screen on the board, smaller on the GM screen. */
export function Grid({ state, selectedId, activeId, reachable, onTokenClick, onCellClick }: Props) {
  const { width, height } = state.map;
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push(
        <div
          key={`${x},${y}`}
          className={"cell" + (onCellClick ? " clickable" : "") + (reachable?.has(`${x},${y}`) ? " reachable" : "")}
          style={{ gridColumn: x + 1, gridRow: y + 1 }}
          onClick={() => onCellClick?.(x, y)}
        />,
      );
    }
  }
  return (
    <div className="grid" style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`,
        aspectRatio: `${width} / ${height}`,
      }}>
      {cells}
      {Object.values(state.tokens).map((t) => (
        <button
          key={t.id}
          className={`token ${t.side}` + (t.id === selectedId ? " selected" : "") + (t.id === activeId ? " active" : "")}
          style={{ gridColumn: t.x + 1, gridRow: t.y + 1, background: t.color }}
          onClick={(e) => {
            e.stopPropagation();
            onTokenClick?.(t);
          }}
          title={t.name}
        >
          <span className="token-name">{t.name}</span>
          <span className="bar hp" style={{ width: `${pct(t.resources.hp, t.resources.maxHp)}%` }} />
          <span className="bar stagger" style={{ width: `${pct(t.resources.stagger, t.resources.maxStagger)}%` }} />
        </button>
      ))}
    </div>
  );
}

export function pct(v: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
}
