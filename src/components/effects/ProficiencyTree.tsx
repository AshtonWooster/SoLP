// The Proficiency tree (shared/proficiencies.ts) drawn like a skill tree: one row per tier, with a
// line from each prerequisite down to the Proficiencies that need it. The character sheet uses it to
// pick Proficiencies; the effect library uses it to see and edit the whole tree.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EffectDef } from "../../../shared/effects.ts";
import { proficiencyMode, proficiencyTree, statLabel, type ProficiencyMode } from "../../../shared/proficiencies.ts";

/** How a node looks: picked by the character, open to pick, locked by its requirements, or waiting on the GM. */
export type NodeState = "picked" | "open" | "locked" | "pending" | "plain";

const MODE_BADGE: Record<ProficiencyMode, { icon: string; label: string }> = {
  automated: { icon: "⚙", label: "Automated" },
  page: { icon: "🂠", label: "Adds a Page" },
  manual: { icon: "✎", label: "Words only" },
};

/** "Justice 2 · Prudence 3": a node's Stat requirements, short. */
export function statNeeds(def: EffectDef): string {
  return Object.entries(def.minStats ?? {})
    .map(([k, v]) => `${statLabel(k)} ${v}`)
    .join(" · ");
}

interface Line {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lit: boolean;
}

export function ProficiencyTree({
  library,
  stateOf = () => "plain",
  selected,
  onSelect,
  empty,
}: {
  library: Record<string, EffectDef>;
  stateOf?: (id: string, def: EffectDef) => NodeState;
  selected?: string | null;
  onSelect: (id: string) => void;
  empty?: React.ReactNode;
}) {
  const nodes = useMemo(() => proficiencyTree(library), [library]);
  const tiers = useMemo(() => {
    const out: (typeof nodes)[] = [];
    for (const n of nodes) (out[n.tier] ??= []).push(n);
    return out.filter(Boolean);
  }, [nodes]);
  const box = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Lines are measured from where the nodes ended up, so the tree can wrap on a phone.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const at = el.getBoundingClientRect();
      const rect = (id: string) => el.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      const next: Line[] = [];
      for (const n of nodes) {
        const to = rect(n.id);
        if (!to) continue;
        for (const r of n.requires) {
          const from = rect(r);
          if (!from) continue;
          next.push({
            key: `${r}>${n.id}`,
            x1: from.left + from.width / 2 - at.left,
            y1: from.bottom - at.top,
            x2: to.left + to.width / 2 - at.left,
            y2: to.top - at.top,
            lit: stateOf(r, library[r]) === "picked",
          });
        }
      }
      setLines(next);
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // stateOf changes every render; the lit lines follow `library` and the picks through `nodes`.
  }, [nodes, library, selected]);

  if (!nodes.length) return <div className="prof-tree-empty muted">{empty ?? "No Proficiencies in the tree yet."}</div>;
  return (
    <div className="prof-tree" ref={box}>
      <svg className="prof-tree-lines" width={size.w} height={size.h} aria-hidden="true">
        {lines.map((l) => {
          const mid = (l.y1 + l.y2) / 2;
          return <path key={l.key} className={l.lit ? "lit" : ""} d={`M${l.x1},${l.y1} C${l.x1},${mid} ${l.x2},${mid} ${l.x2},${l.y2}`} />;
        })}
      </svg>
      {tiers.map((row, t) => (
        <div className="prof-tier" key={t}>
          <span className="prof-tier-label muted small">Tier {t + 1}</span>
          <div className="prof-tier-nodes">
            {row.map((n) => {
              const state = stateOf(n.id, n.def);
              const mode = MODE_BADGE[proficiencyMode(n.def)];
              const needs = statNeeds(n.def);
              return (
                <button
                  type="button"
                  key={n.id}
                  data-node={n.id}
                  className={`prof-node ${state}` + (selected === n.id ? " selected" : "")}
                  aria-pressed={selected === n.id}
                  onClick={() => onSelect(n.id)}
                >
                  <span className="prof-node-head">
                    <span className="prof-node-mode" title={mode.label} aria-label={mode.label}>
                      {mode.icon}
                    </span>
                    <strong>{n.def.name || "Unnamed"}</strong>
                    {state === "picked" && <span className="prof-node-check" aria-label="Picked">✓</span>}
                  </span>
                  {needs && <span className="prof-node-needs small">{needs}</span>}
                  {state === "pending" && <span className="prof-node-needs small warn-text">Waiting for approval</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The legend under a tree. */
export function TreeLegend({ picking }: { picking?: boolean }) {
  return (
    <p className="prof-legend muted small">
      ⚙ Automated · 🂠 Adds a Page to the Auxiliary Deck · ✎ Words only (the GM handles it)
      {picking ? " · Lines show what each one needs first." : ""}
    </p>
  );
}
