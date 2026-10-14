// Status effects as icons with their stacks: in a character's preview, the player's effects bar
// and Cycle Characters. Hover (or tap, on a phone) an icon for its details.
import { useEffect, useRef, useState } from "react";
import type { EffectDef } from "../../../shared/effects.ts";
import { effectDetailLines, effectLabel, type StatusGlyph, statusIconInfo } from "../../../shared/statusIcons.ts";
import type { Effect } from "../../../shared/types.ts";
import { effectText } from "./EffectBuilder.tsx";

/** The built-in statuses' glyphs: a 24×24 path and the color behind it. */
const GLYPHS: Record<StatusGlyph, { color: string; d: string }> = {
  burn: { color: "#d4602a", d: "M12 2c.6 3.6 5.5 5.9 5.5 11.2A5.5 5.5 0 0 1 6.5 13.4c0-2.7 1.6-4.3 2.4-6.3 1 1.2 1.6 2.6 1.6 4.2 1.4-1.9 1.7-5.6 1.5-9.3z" },
  rupture: { color: "#2f9c8f", d: "M13.5 2 6 13h5l-2.5 9L18 10h-5.2l2.7-8z" },
  poise: { color: "#3f7fc4", d: "M11 2h2v3.1A7 7 0 0 1 18.9 11H22v2h-3.1A7 7 0 0 1 13 18.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" },
  bleed: { color: "#a8233a", d: "M12 2.5s-6 7-6 11.7a6 6 0 0 0 12 0C18 9.5 12 2.5 12 2.5z" },
  strength: { color: "#b8902c", d: "M12 3 4 12h5v9h6v-9h5z" },
  feeble: { color: "#6f5d93", d: "M12 21 4 12h5V3h6v9h5z" },
  endurance: { color: "#4f8240", d: "M12 2 4 5v6.2c0 5 3.4 9.2 8 10.8 4.6-1.6 8-5.8 8-10.8V5z" },
};

/** One effect's picture and its stacks in a corner. */
export function StatusIcon({ effect, library, size = 32, bare }: { effect: Effect; library: Record<string, EffectDef>; size?: number; bare?: boolean }) {
  const info = statusIconInfo(effect, library);
  const glyph = info.glyph && GLYPHS[info.glyph];
  const background = info.image ? undefined : glyph ? glyph.color : `hsl(${info.hue} 45% 34%)`;
  return (
    <span className="status-icon" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      <span className="status-icon-face" style={{ background }}>
        {info.image ? (
          <img src={info.image} alt="" />
        ) : glyph ? (
          <svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden="true">
            <path d={glyph.d} fill="currentColor" fillRule="evenodd" />
          </svg>
        ) : (
          <span className="status-icon-initials">{info.initials}</span>
        )}
      </span>
      {!bare && <span className="status-icon-count">{effect.count}</span>}
      {!bare && effect.pending ? <span className="status-icon-pending">+{effect.pending}</span> : null}
    </span>
  );
}

/** A library status effect's icon on its own, with no stacks (the effect library, the icon picker). */
export function LibraryStatusIcon({ id, def, size = 28 }: { id: string; def: EffectDef; size?: number }) {
  return <StatusIcon effect={{ id, name: def.name, count: 0, description: "", defId: id }} library={{ [id]: def }} size={size} bare />;
}

/** An effect's name, stacks, duration and what it does. */
function EffectDetails({ effect, library }: { effect: Effect; library: Record<string, EffectDef> }) {
  const def = effect.defId ? library[effect.defId] : undefined;
  const description = effect.description || (def ? effectText(def, library) : "");
  return (
    <div className="status-details" role="note">
      <StatusIcon effect={effect} library={library} size={36} />
      <div>
        <strong>{statusIconInfo(effect, library).name}</strong> <span className="muted small">× {effect.count}</span>
        {effectDetailLines(effect).map((l) => (
          <div className="muted small" key={l}>
            {l}
          </div>
        ))}
        {description && <p className="pre small">{description}</p>}
      </div>
    </div>
  );
}

/**
 * A row of effect icons. Hovering one with a mouse shows its details; tapping or clicking keeps
 * them open until it's tapped again, another is picked, or the viewer clicks elsewhere.
 * `floating`: the details hang over what's below instead of pushing it down (the player screen,
 * where nothing under the bar should move).
 */
export function EffectsBar({
  effects,
  library,
  size = 32,
  floating,
  empty,
  className = "",
}: {
  effects: Effect[];
  library: Record<string, EffectDef>;
  size?: number;
  floating?: boolean;
  /** Shown when there are none; without it the bar isn't drawn at all. */
  empty?: string;
  className?: string;
}) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setPinned(null);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);
  if (!effects.length && !empty) return null;
  const openId = hovered ?? pinned;
  const open = effects.find((e) => e.id === openId);
  return (
    <div className={`effects-bar ${floating ? "floating" : ""} ${className}`} ref={ref} onPointerLeave={() => setHovered(null)}>
      <div className="effects-bar-icons" role="group" aria-label="Effects">
        {effects.map((e) => (
          <button
            type="button"
            key={e.id}
            className={"status-icon-btn" + (e.id === openId ? " open" : "")}
            aria-label={effectLabel({ ...e, name: statusIconInfo(e, library).name })}
            aria-expanded={e.id === openId}
            onPointerEnter={(ev) => ev.pointerType === "mouse" && setHovered(e.id)}
            onClick={() => setPinned((p) => (p === e.id ? null : e.id))}
          >
            <StatusIcon effect={e} library={library} size={size} />
          </button>
        ))}
        {!effects.length && <span className="muted small">{empty}</span>}
      </div>
      {open && <EffectDetails effect={open} library={library} />}
    </div>
  );
}
