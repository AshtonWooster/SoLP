import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { validTargets } from "../../shared/engine.ts";
import { withheld } from "../../shared/secrets.ts";
import { dragItemTo, type TableLayer } from "../../shared/maps.ts";
import type { MapItem, TableState, Token } from "../../shared/types.ts";
import { arrowHitSegment, boardArrows } from "./arrows.ts";
import { FxBubble, type FxStep } from "./ClashFx.tsx";
import { SlotPages } from "./SlotPages.tsx";
import { SpeedBubble } from "./SpeedRollFx.tsx";
import { StoryBubble } from "./StoryRollFx.tsx";
import type { StoryStep } from "./storyRoll.ts";
import type { SpeedStep } from "./speedRoll.ts";
import { AssetLayer, PinLayer, type GrabItem } from "./maps/MapLayers.tsx";
import { FogLayer } from "./maps/Fog.tsx";
import { tokenVfx } from "../../shared/vfx.ts";
import { motionStyle, useVfxBursts, VfxView, type VfxByStatus } from "./vfx/VfxView.tsx";

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
  /** The Speed roll to draw above the characters who rolled, if any. */
  speed?: SpeedStep | null;
  /** The Story Roll to draw above the character who rolled, if any. */
  story?: StoryStep | null;
  /** How to draw fog of war: a tint the GM sees through, or the players' solid cover. Missing: no fog. */
  fog?: "gm" | "players";
  /**
   * The GM's layer: on "assets" or "pins" those can be dragged around (tokens can't be clicked then).
   * Missing or "tokens": the map works as usual.
   */
  layer?: TableLayer;
  /** Snap dragged assets and pins to the grid (Alt flips it for one drag). */
  snap?: boolean;
  /** An asset or pin was dragged to a new spot, in tiles. */
  onMoveItem?: (itemId: string, to: { x: number; y: number }) => void;
  /** The game's VFX by the status Effect they play on, when "Status effect VFX" is on (shared/vfx.ts). Missing: none play. */
  vfx?: VfxByStatus;
  /** Drawn over the whole map (the GM's fog drawing tool). */
  children?: ReactNode;
}

type ItemDrag = { item: MapItem; pointer: number; sx: number; sy: number; to?: { x: number; y: number } };

/** Tokens the Page being aimed can target, and those already picked (Mass Attacks). */
export function aimTargets(table: TableState): { targetable: Set<string>; picked: Set<string> } {
  const c = table.combat;
  const aim = c?.aim;
  const user = aim && table.tokens[aim.tokenId];
  const page = aim && (c.pages[aim.pageId] ?? user?.pages?.find((p) => p.id === aim.pageId));
  if (!aim || !user || !page) return { targetable: new Set(), picked: new Set() };
  return { targetable: new Set(validTargets(table, user, page).map((t) => t.id)), picked: new Set(aim.targets) };
}

/**
 * The battle map: the background image, the assets layer, a tile grid with tokens on it, and pins on
 * top. Used full-screen on the board, smaller on the GM screen (where hidden things show faded).
 */
export function Grid({ state, selectedId, activeId, reachable, onTokenClick, onCellClick, fx, speed, story, fog, layer = "tokens", snap = true, onMoveItem, vfx, children }: Props) {
  const { width, height } = state.map;
  const { targetable, picked } = aimTargets(state);
  const gridRef = useRef<HTMLDivElement>(null);
  const tokenEls = useRef(new Map<string, HTMLButtonElement>());
  const last = useRef<{ mapId?: string; at: Map<string, { x: number; y: number }> }>({ at: new Map() });
  // The arrow tapped to see its Page(s), by the slots it stands for.
  const [openSlots, setOpenSlots] = useState<string[] | null>(null);
  const bursts = useVfxBursts(state.tokens, vfx, state.combat?.procs);

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
  // Dragging an asset or pin: it follows the pointer, and is saved once on release.
  const [drag, setDrag] = useState<ItemDrag | null>(null);
  const dragged = useRef(false);
  const editing = layer !== "tokens" && !!onMoveItem;
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointer) return;
      // Measured each time, so it stays right however the map is zoomed or scaled.
      const r = gridRef.current?.getBoundingClientRect();
      if (!r || !r.width) return;
      if (!drag.to && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) <= 3) return;
      const to = dragItemTo(drag.item, layer, ((e.clientX - drag.sx) / r.width) * width, ((e.clientY - drag.sy) / r.height) * height, e.altKey ? !snap : snap);
      if (to) setDrag({ ...drag, to });
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointer) return;
      setDrag(null);
      dragged.current = !!drag.to;
      if (drag.to && (drag.to.x !== drag.item.x || drag.to.y !== drag.item.y)) onMoveItem?.(drag.item.id, drag.to);
    };
    // A second finger (a pinch to zoom) drops the drag without moving anything.
    const onDown = (e: PointerEvent) => e.pointerId !== drag.pointer && setDrag(null);
    const onCancel = (e: PointerEvent) => e.pointerId === drag.pointer && setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("pointerdown", onDown, true);
    };
  });
  const grab: GrabItem = (e, item) => {
    if (e.button !== 0 || !dragItemTo(item, layer, 0, 0, false)) return;
    e.stopPropagation();
    e.preventDefault();
    dragged.current = false;
    setDrag({ item, pointer: e.pointerId, sx: e.clientX, sy: e.clientY });
  };
  // The map as drawn, with the item being dragged where the pointer has it.
  const drawn = drag?.to ? { ...state.map, items: state.map.items?.map((i) => (i.id === drag.item.id ? { ...i, ...drag.to } : i)) } : state.map;

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
  // A Mass Attack plays above the attacker and every target at once.
  const fxSides = fx
    ? ([["a", fx.fx.a], ...(fx.fx.targets ? fx.fx.targets.map((id) => [id, id]) : [["b", fx.fx.b]])] as [string, string][])
        .map(([side, id]) => [side, state.tokens[id]] as const)
        .filter(([, t]) => t)
    : [];
  return (
    <div
      ref={gridRef}
      className={"grid" + (state.map.hideGrid ? " no-lines" : "") + (editing ? ` layer-${layer}` : "") + (drag?.to ? " dragging-item" : "")}
      style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`,
        aspectRatio: `${width} / ${height}`,
        ...(state.map.background ? { backgroundImage: `url("${state.map.background}")`, backgroundSize: "100% 100%" } : {}),
      }}
    >
      <AssetLayer map={drawn} onGrab={editing && layer === "assets" ? grab : undefined} />
      {cells}
      {fog && <FogLayer map={state.map} gm={fog === "gm"} />}
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
          t.hidden && "is-hidden",
        ].filter(Boolean);
        // Looping VFX for the Effects on it, and any "When gained" ones playing right now.
        const looks = [
          ...(vfx ? tokenVfx(t.effects, vfx) : []).map((v) => ({ ...v, once: false, key: v.id })),
          ...(bursts[t.id] ?? []).map((v) => ({ ...v, once: true, key: `${v.id}-${v.key}` })),
        ];
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
              ...(looks.length ? motionStyle(looks, t.id === activeId) : undefined),
            }}
            onClick={(e) => {
              e.stopPropagation();
              onTokenClick?.(t);
            }}
            title={t.hidden ? `${t.name} (hidden from players)` : t.name}
          >
            {looks.map((v) => (
              <VfxView key={v.key} def={v.def} stacks={v.stacks} once={v.once} />
            ))}
            <span className="token-name">{t.name}</span>
            {!withheld(t, "hp") && <span className="bar hp" style={{ width: `${pct(t.resources.hp, t.resources.maxHp)}%` }} />}
            {!withheld(t, "stagger") && <span className="bar stagger" style={{ width: `${pct(t.resources.stagger, t.resources.maxStagger)}%` }} />}
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
      {speed?.entries.map((entry) => {
        const t = state.tokens[entry.tokenId];
        if (!t) return null;
        const place = state.combat?.order.findIndex((x) => x.tokenId === t.id) ?? -1;
        return (
          <div key={`${speed.id}-${t.id}`} className={"fx-anchor" + (t.y < 2 ? " below" : "")} style={{ gridColumn: t.x + 1, gridRow: t.y + 1 }} aria-hidden="true">
            <div className="fx-float">
              <SpeedBubble step={speed} entry={entry} place={place + 1} />
            </div>
          </div>
        );
      })}
      {story &&
        (() => {
          const t = state.tokens[story.tokenId];
          if (!t) return null;
          return (
            <div key={story.id} className={"fx-anchor" + (t.y < 2 ? " below" : "")} style={{ gridColumn: t.x + 1, gridRow: t.y + 1 }} aria-hidden="true">
              <div className="fx-float">
                <StoryBubble step={story} />
              </div>
            </div>
          );
        })()}
      <PinLayer map={drawn} onGrab={editing && layer === "pins" ? grab : undefined} wasDragged={() => dragged.current} />
      {openSlots && <SlotPages state={state} slotIds={openSlots} onClose={() => setOpenSlots(null)} />}
      {children}
    </div>
  );
}

export function pct(v: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
}
