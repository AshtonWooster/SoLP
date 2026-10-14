// The Proficiency tree (shared/proficiencies.ts) drawn like a skill tree: one row per tier, with a
// line from each prerequisite down to the Proficiencies that need it. The character sheet uses it to
// pick Proficiencies; the effect library uses it to see and edit the whole tree.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EffectDef } from "../../../shared/effects.ts";
import {
  matchesStatFilter,
  proficiencyMode,
  proficiencyTree,
  STAT_CMP_OPTIONS,
  statLabel,
  type ProficiencyMode,
  type StatCmp,
  type StatFilter,
} from "../../../shared/proficiencies.ts";
import { PRIMARY_STATS, SECONDARY_STATS } from "../../../shared/ruleset.ts";

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
  filter,
}: {
  library: Record<string, EffectDef>;
  stateOf?: (id: string, def: EffectDef) => NodeState;
  selected?: string | null;
  onSelect: (id: string) => void;
  empty?: React.ReactNode;
  /** Nodes that don't match are dimmed, so the tree keeps its shape. */
  filter?: StatFilter;
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
                  className={`prof-node ${state}` + (selected === n.id ? " selected" : "") + (matchesStatFilter(n.def, filter) ? (filter?.rows.length ? " match" : "") : " dimmed")}
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

const FILTER_STATS = [...PRIMARY_STATS, ...SECONDARY_STATS];

/**
 * Filter the tree by the Stats a Proficiency needs: "Fortitude at least 2 and Insight". Tap a Stat
 * to add it; each one can be any amount, at least, exactly or at most a number.
 */
export function StatFilterBar({ filter, onChange, matches, total }: { filter: StatFilter; onChange: (f: StatFilter) => void; matches: number; total: number }) {
  const on = (stat: string) => filter.rows.some((r) => r.stat === stat);
  const toggle = (stat: string) =>
    onChange({ ...filter, rows: on(stat) ? filter.rows.filter((r) => r.stat !== stat) : [...filter.rows, { stat, cmp: "any", n: 2 }] });
  const set = (i: number, patch: Partial<StatFilter["rows"][number]>) => onChange({ ...filter, rows: filter.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="stat-filter" role="group" aria-label="Filter by required Stats">
      <div className="row wrap stat-filter-stats">
        <span className="muted small">Needs</span>
        {FILTER_STATS.map((s) => (
          <button key={s.key} type="button" className={"chip" + (on(s.key) ? " active" : "")} aria-pressed={on(s.key)} onClick={() => toggle(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {filter.rows.length > 0 && (
        <div className="stat-filter-rows">
          {filter.rows.map((r, i) => (
            <div className="row wrap stat-filter-row" key={r.stat}>
              {i > 0 && (
                <select aria-label="Match all or any" className="stat-filter-mode" value={filter.mode} onChange={(e) => onChange({ ...filter, mode: e.target.value as StatFilter["mode"] })}>
                  <option value="and">and</option>
                  <option value="or">or</option>
                </select>
              )}
              <strong>{statLabel(r.stat)}</strong>
              <select aria-label={`How much ${statLabel(r.stat)}`} value={r.cmp} onChange={(e) => set(i, { cmp: e.target.value as StatCmp })}>
                {STAT_CMP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {r.cmp !== "any" && (
                <input
                  type="number"
                  aria-label={`${statLabel(r.stat)} amount`}
                  className="stat-filter-n"
                  min={1}
                  max={99}
                  value={r.n}
                  onChange={(e) => set(i, { n: Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0))) })}
                />
              )}
              <button type="button" className="link" aria-label={`Stop filtering by ${statLabel(r.stat)}`} onClick={() => toggle(r.stat)}>
                ✕
              </button>
            </div>
          ))}
          <p className="muted small stat-filter-count" role="status">
            {matches} of {total} match.{" "}
            <button type="button" className="link" onClick={() => onChange({ ...filter, rows: [] })}>
              Clear
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
