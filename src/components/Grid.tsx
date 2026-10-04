import { validTargets } from "../../shared/engine.ts";
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

/** Tokens the Page being aimed can target, and those already picked (Mass Attacks). */
export function aimTargets(table: TableState): { targetable: Set<string>; picked: Set<string> } {
  const c = table.combat;
  const aim = c?.aim;
  const user = aim && table.tokens[aim.tokenId];
  const page = aim && (c.pages[aim.pageId] ?? user?.pages?.find((p) => p.id === aim.pageId));
  if (!aim || !user || !page) return { targetable: new Set(), picked: new Set() };
  return { targetable: new Set(validTargets(table, user, page).map((t) => t.id)), picked: new Set(aim.targets) };
}

/** The battle map: a tile grid with tokens on it. Used full-screen on the board, smaller on the GM screen. */
export function Grid({ state, selectedId, activeId, reachable, onTokenClick, onCellClick }: Props) {
  const { width, height } = state.map;
  const { targetable, picked } = aimTargets(state);
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
  // An arrow from each slotted Page's owner to its target(s); clashing Pages are drawn in orange.
  const arrows = (state.combat?.slots ?? []).flatMap((s) =>
    s.targets
      .map((t) => ({ id: `${s.id}-${t.tokenId}`, from: state.tokens[s.ownerId], to: state.tokens[t.tokenId], clash: !!s.clashWith }))
      .filter((a) => a.from && a.to),
  );
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`,
        aspectRatio: `${width} / ${height}`,
      }}
    >
      {cells}
      {Object.values(state.tokens).map((t) => {
        const st = t.status ?? {};
        const classes = [
          "token",
          t.side,
          t.id === selectedId && "selected",
          t.id === activeId && "active",
          targetable.has(t.id) && "targetable",
          picked.has(t.id) && "picked",
          st.knockedOut && "ko",
          st.staggered && "staggered",
        ].filter(Boolean);
        return (
          <button
            key={t.id}
            className={classes.join(" ")}
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
            {(st.knockedOut || st.staggered || st.panic) && (
              <span className="token-status">{st.knockedOut ? "KO" : st.staggered ? "Staggered" : "Panic"}</span>
            )}
          </button>
        );
      })}
      {arrows.length > 0 && (
        <svg className="arrows" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
            </marker>
          </defs>
          {arrows.map((a) => (
            <line
              key={a.id}
              className={a.clash ? "arrow clash" : "arrow"}
              x1={a.from.x + 0.5}
              y1={a.from.y + 0.5}
              x2={a.to.x + 0.5}
              y2={a.to.y + 0.5}
              markerEnd="url(#head)"
            />
          ))}
        </svg>
      )}
    </div>
  );
}

export function pct(v: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
}
