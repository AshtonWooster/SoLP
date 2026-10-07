import { useLayoutEffect, useRef, useState } from "react";
import { validTargets } from "../../shared/engine.ts";
import type { TableState, Token } from "../../shared/types.ts";
import { arrowHitSegment, boardArrows } from "./arrows.ts";
import { FxBubble, type FxStep } from "./ClashFx.tsx";
import { SlotPages } from "./SlotPages.tsx";

interface Props {
  state: TableState;
  selectedId?: string | null;
  /** Whose turn it is in combat; that token glows. */
  activeId?: string;
  /** Tiles the selected token can move to, as "x,y". */
  reachable?: Set<string>;
  onTokenClick?: (t: Token) => void;
  onCellClick?: (x: number, y: number) => void;
  /** The clash animation step to draw above the characters, if any. */
  fx?: FxStep | null;
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
export function Grid({ state, selectedId, activeId, reachable, onTokenClick, onCellClick, fx }: Props) {
  const { width, height } = state.map;
  const { targetable, picked } = aimTargets(state);
  const gridRef = useRef<HTMLDivElement>(null);
  const tokenEls = useRef(new Map<string, HTMLButtonElement>());
  const last = useRef<{ mapId?: string; at: Map<string, { x: number; y: number }> }>({ at: new Map() });
  // The arrow tapped to see its Page(s), by the slots it stands for.
  const [openSlots, setOpenSlots] = useState<string[] | null>(null);

  // Moving tokens slide in a straight line from their old tile to the new one.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const sameMap = last.current.mapId === state.map.id;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (grid && sameMap && !still) {
      const cw = grid.clientWidth / width;
      const ch = grid.clientHeight / height;
      for (const t of Object.values(state.tokens)) {
        const was = last.current.at.get(t.id);
        const el = tokenEls.current.get(t.id);
        if (!was || !el || (was.x === t.x && was.y === t.y)) continue;
        const tiles = Math.max(Math.abs(was.x - t.x), Math.abs(was.y - t.y));
        el.animate([{ translate: `${(was.x - t.x) * cw}px ${(was.y - t.y) * ch}px` }, { translate: "0 0" }], {
          duration: Math.min(450, 120 + tiles * 70),
          easing: "linear",
        });
      }
    }
    last.current = { mapId: state.map.id, at: new Map(Object.values(state.tokens).map((t) => [t.id, { x: t.x, y: t.y }])) };
  });
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
  const arrows = boardArrows(state);
  // While a Page is being aimed, taps go to the lit tokens, not to the arrows over them.
  const arrowsTappable = targetable.size === 0;
  const fxSides = fx
    ? ([
        ["a", state.tokens[fx.fx.a]],
        ["b", state.tokens[fx.fx.b]],
      ] as const).filter(([, t]) => t)
    : [];
  return (
    <div
      ref={gridRef}
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`,
        aspectRatio: `${width} / ${height}`,
        ...(state.map.background ? { backgroundImage: `url("${state.map.background}")`, backgroundSize: "100% 100%" } : {}),
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
            ref={(el) => {
              if (el) tokenEls.current.set(t.id, el);
              else tokenEls.current.delete(t.id);
            }}
            className={classes.join(" ")}
            style={{
              gridColumn: t.x + 1,
              gridRow: t.y + 1,
              background: t.portrait ? `center / cover no-repeat url("${t.portrait}"), ${t.color}` : t.color,
            }}
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
        <svg className="arrows" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
            </marker>
          </defs>
          {arrows.map((a) => {
            const open = () => setOpenSlots(a.slotIds);
            return (
              <g key={a.id} className="arrow-group">
                <line
                  className={a.clash ? "arrow clash" : "arrow"}
                  x1={a.from.x + 0.5}
                  y1={a.from.y + 0.5}
                  x2={a.to.x + 0.5}
                  y2={a.to.y + 0.5}
                  markerEnd="url(#head)"
                  markerStart={a.both ? "url(#head)" : undefined}
                />
                {arrowsTappable && (
                  <line
                    className="arrow-hit"
                    {...arrowHitSegment(a)}
                    role="button"
                    tabIndex={0}
                    aria-label={a.clash ? `See the clash between ${a.from.name} and ${a.to.name}` : `See ${a.from.name}'s Page aimed at ${a.to.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      open();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open();
                      }
                    }}
                  >
                    <title>{a.clash ? "Tap to see both Pages" : "Tap to see the Page"}</title>
                  </line>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {fx &&
        fxSides.map(([side, t]) => (
          <div key={`${fx.fx.id}-${side}`} className={"fx-anchor" + (t!.y < 2 ? " below" : "")} style={{ gridColumn: t!.x + 1, gridRow: t!.y + 1 }} aria-hidden="true">
            <div className="fx-float">
              <FxBubble step={fx} side={side} />
            </div>
          </div>
        ))}
      {openSlots && <SlotPages state={state} slotIds={openSlots} onClose={() => setOpenSlots(null)} />}
    </div>
  );
}

export function pct(v: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
}
