// Draws VFX (shared/vfx.ts) on a token: auras, particles, tints and icons as plain elements animated
// with CSS (vfx.css), and motion as a style for the token itself. Nothing here is saved or sent.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  gainedStatuses,
  GAIN_MS,
  loopSeconds,
  particleCount,
  particleSpots,
  stackStrength,
  tokenVfx,
  type TokenVfx,
  type VfxDef,
  type VfxLayer,
} from "../../../shared/vfx.ts";
import type { Effect, Token } from "../../../shared/types.ts";
import "./vfx.css";

export type VfxByStatus = Map<string, { id: string; def: VfxDef }[]>;

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function Layer({ layer, strength, once }: { layer: VfxLayer; strength: number; once: boolean }) {
  const dur = loopSeconds(layer);
  const base = vars({
    "--c": layer.color,
    "--c2": layer.color2 ?? layer.color,
    "--size": layer.size,
    "--op": Math.min(1, layer.opacity * (0.5 + strength / 2)),
    "--dur": `${dur}s`,
    "--amp": layer.size * strength,
  });
  switch (layer.type) {
    case "aura":
      return layer.aura === "ripple" ? (
        <span className="vfx-layer vfx-aura ripple" style={base}>
          <i />
          <i style={{ animationDelay: once ? "0s" : `${-dur / 2}s` }} />
        </span>
      ) : (
        <span className={`vfx-layer vfx-aura ${layer.aura ?? "glow"}`} style={base} />
      );
    case "tint":
      return <span className={`vfx-layer vfx-tint ${layer.tint ?? "pulse"}`} style={base} />;
    case "icon":
      return (
        <span className={`vfx-layer vfx-icon ${layer.spot ?? "topRight"}`} style={base}>
          {layer.glyph}
        </span>
      );
    case "particles": {
      const n = particleCount(layer, strength);
      return (
        <span className={`vfx-layer vfx-particles ${layer.flow ?? "rise"} ${layer.shape ?? "dot"}`} style={base}>
          {particleSpots(layer, n).map((p, i) => (
            <i
              key={i}
              data-g={layer.shape === "glyph" ? layer.glyph : undefined}
              style={vars({
                "--x": `${p.x * 100}%`,
                "--s": p.scale,
                "--drift": p.drift,
                "--a": `${p.angle}deg`,
                // Looping particles start part-way through, so the effect is already full when it appears.
                animationDelay: once ? `${p.delay * dur * 0.25}s` : `${-p.delay * dur}s`,
                ...(p.alt ? { "--c": layer.color2! } : {}),
              })}
            />
          ))}
        </span>
      );
    }
    case "motion":
      return null;
  }
}

/** One VFX's look on a token (motion aside: see motionStyle). Fills the element it's in, which must be positioned. */
export function VfxView({ def, stacks, once = false }: { def: VfxDef; stacks: number; once?: boolean }) {
  const strength = stackStrength(def, stacks);
  return (
    <span className={"vfx" + (once ? " once" : "")} aria-hidden="true">
      {def.layers.map((l) => (
        <Layer key={l.id} layer={l} strength={strength} once={once} />
      ))}
    </span>
  );
}

/**
 * The token's own animation for the first Motion layer among its VFX, with the turn glow kept when
 * it's that character's turn. Nothing when there's no Motion layer.
 */
export function motionStyle(list: { def: VfxDef; stacks: number; once?: boolean }[], active = false): CSSProperties | undefined {
  for (const v of list) {
    const m = v.def.layers.find((l) => l.type === "motion");
    if (!m) continue;
    const dur = loopSeconds(m);
    const count = v.once ? Math.max(1, Math.round(GAIN_MS / 1000 / dur)) : "infinite";
    const anim = `vfx-${m.motion ?? "shake"} ${dur}s ease-in-out ${count}`;
    return vars({
      "--amp": m.size * stackStrength(v.def, v.stacks),
      animation: active ? `pulse 1.4s ease-in-out infinite, ${anim}` : anim,
    });
  }
  return undefined;
}

/** How long a "When gained" VFX plays before it's taken off. */
export const gainMs = (def: VfxDef) => Math.round(GAIN_MS / Math.max(0.5, Math.min(...def.layers.map((l) => l.speed), 1)));

export interface Burst extends TokenVfx {
  key: number;
}

/**
 * "When gained" VFX playing right now, by token id: each starts when a character gains an Effect (or
 * more stacks of it) that one plays on, and stops after it has played once. Characters appearing
 * (a new map, a device connecting) don't count as gaining their Effects.
 */
export function useVfxBursts(tokens: Record<string, Token>, byStatus: VfxByStatus | undefined): Record<string, Burst[]> {
  const seen = useRef<Map<string, Effect[] | undefined> | null>(null);
  const [bursts, setBursts] = useState<Record<string, Burst[]>>({});
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(Object.values(tokens).map((t) => [t.id, t.effects]));
    if (!before || !byStatus?.size) return;
    const started: Record<string, Burst[]> = {};
    for (const t of Object.values(tokens)) {
      if (!before.has(t.id) || before.get(t.id) === t.effects) continue;
      const gained = new Set(gainedStatuses(before.get(t.id), t.effects));
      if (gained.size === 0) continue;
      const list = tokenVfx(t.effects, byStatus).filter((v) => v.def.play === "gain" && v.def.statuses.some((s) => gained.has(s)));
      if (list.length) started[t.id] = list.map((v) => ({ ...v, key: Date.now() + Math.random() }));
    }
    if (Object.keys(started).length === 0) return;
    setBursts((b) => {
      const next = { ...b };
      for (const [id, list] of Object.entries(started)) next[id] = [...(next[id] ?? []).filter((x) => !list.some((y) => y.id === x.id)), ...list];
      return next;
    });
    for (const [id, list] of Object.entries(started)) {
      for (const v of list) {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          setBursts((b) => ({ ...b, [id]: (b[id] ?? []).filter((x) => x.key !== v.key) }));
        }, gainMs(v.def));
        timers.current.add(timer);
      }
    }
  }, [tokens, byStatus]);
  return bursts;
}
