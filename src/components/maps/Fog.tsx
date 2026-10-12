import { useEffect, useId, useState } from "react";
import { fogAreas, type FogRect } from "../../../shared/fog.ts";
import type { MapInfo } from "../../../shared/types.ts";
import { ConfirmButton } from "../ConfirmButton.tsx";

/** Drawing a box that hides, or one that reveals; null when not drawing. */
export type FogMode = "hide" | "reveal" | null;

/**
 * The fog over a map. Players (and the board) get a solid cover over hidden tiles; the GM sees a
 * tint so they can still see what's under it. What's under the fog isn't sent to players at all
 * (shared/maps.ts `playerView`), so the cover only has the map's own picture left to hide.
 */
export function FogLayer({ map, gm }: { map: MapInfo; gm?: boolean }) {
  const areas = fogAreas(map);
  const hatch = useId();
  if (!areas.length) return null;
  return (
    <svg className={"map-layer fog " + (gm ? "fog-gm" : "fog-players")} viewBox={`0 0 ${map.width} ${map.height}`} preserveAspectRatio="none" aria-hidden="true">
      {gm && (
        <defs>
          <pattern id={hatch} width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="0.5" />
          </pattern>
        </defs>
      )}
      {areas.map((r) => (
        // A hair wider, so no seam shows between boxes.
        <rect key={`${r.x},${r.y}`} x={r.x - 0.01} y={r.y - 0.01} width={r.w + 0.02} height={r.h + 0.02} fill={gm ? undefined : "#0b0908"} />
      ))}
      {gm && areas.map((r) => <rect key={`h${r.x},${r.y}`} className="fog-hatch" x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${hatch})`} />)}
    </svg>
  );
}

/** While the GM is drawing fog: drag across tiles to hide or reveal them. Sits over the whole map. */
export function FogDraw({ map, mode, onDraw }: { map: MapInfo; mode: Exclude<FogMode, null>; onDraw: (r: FogRect) => void }) {
  const [drag, setDrag] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const tileAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(map.width - 1, Math.floor(((e.clientX - b.left) / b.width) * map.width))),
      y: Math.max(0, Math.min(map.height - 1, Math.floor(((e.clientY - b.top) / b.height) * map.height))),
    };
  };
  const box = drag && {
    x: Math.min(drag.from.x, drag.to.x),
    y: Math.min(drag.from.y, drag.to.y),
    w: Math.abs(drag.from.x - drag.to.x) + 1,
    h: Math.abs(drag.from.y - drag.to.y) + 1,
  };
  return (
    <div
      className={"fog-draw " + mode}
      role="application"
      aria-label={mode === "hide" ? "Drag across the map to hide that area" : "Drag across the map to reveal that area"}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const at = tileAt(e);
        setDrag({ from: at, to: at });
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, to: tileAt(e) })}
      onPointerUp={() => {
        if (box) onDraw({ ...box, ...(mode === "reveal" ? { reveal: true } : {}) });
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onClick={(e) => e.stopPropagation()}
    >
      {box && (
        <span
          className="fog-draw-box"
          style={{
            left: `${(box.x / map.width) * 100}%`,
            top: `${(box.y / map.height) * 100}%`,
            width: `${(box.w / map.width) * 100}%`,
            height: `${(box.h / map.height) * 100}%`,
          }}
        >
          {box.w}×{box.h}
        </span>
      )}
    </div>
  );
}

/** The GM's fog buttons: draw a box that hides or reveals, or hide or reveal the whole map. Esc stops drawing. */
export function FogTools({ mode, setMode, onAll }: { mode: FogMode; setMode: (m: FogMode) => void; onAll: (hidden: boolean) => void }) {
  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMode(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, setMode]);
  const pick = (m: Exclude<FogMode, null>) => setMode(mode === m ? null : m);
  return (
    <span className="fog-tools" role="group" aria-label="Fog of war">
      <span className="muted small">Fog</span>
      <span className="seg">
        <button className={mode === "hide" ? "on" : ""} aria-pressed={mode === "hide"} onClick={() => pick("hide")} title="Drag across the map to hide an area from players (Esc to stop)">
          ▦ Hide area
        </button>
        <button className={mode === "reveal" ? "on" : ""} aria-pressed={mode === "reveal"} onClick={() => pick("reveal")} title="Drag across the map to show an area to players (Esc to stop)">
          ▢ Reveal area
        </button>
      </span>
      <button onClick={() => onAll(true)} title="Cover the whole map; then reveal areas as the party explores">
        Hide all
      </button>
      <ConfirmButton onConfirm={() => onAll(false)} confirmLabel="Reveal everything?" title="Show the whole map to players">
        Reveal all
      </ConfirmButton>
    </span>
  );
}
