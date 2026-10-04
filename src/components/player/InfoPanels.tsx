import { Link } from "react-router-dom";
import type { Character, Page } from "../../../shared/character.ts";
import { isUsable, PRIMARY_STATS, rankTable, SECONDARY_STATS } from "../../../shared/ruleset.ts";
import { PageCard } from "./PageCard.tsx";

export type PanelKey = "I" | "S" | "W" | "A" | "AU" | "P";

export const PANELS: { key: PanelKey; title: string }[] = [
  { key: "I", title: "Inventory" },
  { key: "S", title: "Primary / Secondary Stats" },
  { key: "W", title: "Weapons" },
  { key: "A", title: "Armor" },
  { key: "AU", title: "Augments" },
  { key: "P", title: "Proficiencies" },
];

interface Props {
  c: Character;
  sheetUrl: string;
  onOpenPage: (page: Page) => void;
  onUseItem?: (itemId: string) => void;
  /** Spend a point on a Stat (the player's own sheet). */
  onRaiseStat?: (group: "primary" | "secondary", key: string) => void;
}

function NameDescription({ rows, empty }: { rows: { id: string; name: string; description: string; extra?: React.ReactNode }[]; empty: string }) {
  return (
    <table className="nd-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <strong>{r.name || "Unnamed"}</strong>
              {r.extra}
            </td>
            <td className="pre">{r.description || <span className="muted">—</span>}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={2} className="muted">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function PageRow({ name, pages, onOpenPage }: { name: string; pages: Page[]; onOpenPage: (p: Page) => void }) {
  return (
    <div className="gear-row">
      <div className="gear-name">{name}</div>
      <div className="gear-pages">
        {pages.map((p) => (
          <PageCard key={p.id} page={p} size="small" onClick={() => onOpenPage(p)} />
        ))}
        {pages.length === 0 && <span className="muted small">No Pages</span>}
      </div>
    </div>
  );
}

/** The body of one information panel, driven by the character sheet. */
export function InfoPanel({ panel, c, sheetUrl, onOpenPage, onUseItem, onRaiseStat }: Props & { panel: PanelKey }) {
  const edit = (tab?: string) => (
    <Link className="small" to={`${sheetUrl}${tab ? `?tab=${tab}` : ""}`}>
      Edit on character sheet
    </Link>
  );
  switch (panel) {
    case "I": {
      const rows = [
        ...(c.inventory.trinket
          ? [{ id: c.inventory.trinket.id, name: c.inventory.trinket.name, description: c.inventory.trinket.description, extra: <span className="badge-soft">Trinket · equipped</span> }]
          : []),
        ...c.inventory.items.map((i) => ({
          id: i.id,
          name: `${i.name || "Unnamed"}${i.stacking ? ` ×${i.count}` : ""}`,
          description: i.description,
          extra: (
            <span className="nd-extra">
              <span className="muted small">{i.kind === "tool" ? "Tool" : i.kind === "trinket" ? "Trinket" : "Item"}</span>
              {i.consumable && isUsable(i) && <span className="muted small"> · {i.uses ?? i.maxUses ?? 1}/{i.maxUses ?? 1} uses</span>}
              {onUseItem && i.kind !== "tool" && isUsable(i) && (
                <button type="button" onClick={() => onUseItem(i.id)}>
                  Use
                </button>
              )}
            </span>
          ),
        })),
      ];
      return (
        <>
          <NameDescription rows={rows} empty="Nothing in your inventory." />
          {edit("inventory")}
        </>
      );
    }
    case "S": {
      const t = rankTable(c.rank);
      const primaryLeft = t.primaryPoints - Object.values(c.primary).reduce((a, b) => a + b, 0);
      const secondaryLeft = t.secondaryPoints - Object.values(c.secondary).reduce((a, b) => a + b, 0);
      return (
        <>
          <h3 className="center-text">
            Primary <span className="muted small">· {Math.max(0, primaryLeft)} point{primaryLeft === 1 ? "" : "s"} to spend</span>
          </h3>
          <div className="stat-boxes">
            {PRIMARY_STATS.map((s) => (
              <div className="stat-box" key={s.key} title={s.effect}>
                <span className="stat-name">{s.label}</span>
                <span className="stat-num">{c.primary[s.key]}</span>
                {onRaiseStat && (
                  <button type="button" aria-label={`Raise ${s.label}`} disabled={primaryLeft <= 0} onClick={() => onRaiseStat("primary", s.key)}>
                    +
                  </button>
                )}
              </div>
            ))}
          </div>
          <h3 className="center-text">
            Secondary <span className="muted small">· {Math.max(0, secondaryLeft)} to spend</span>
          </h3>
          <table className="nd-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Value</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {SECONDARY_STATS.map((s) => (
                <tr key={s.key}>
                  <td>
                    <strong>{s.label}</strong>
                  </td>
                  <td className="stat-value">
                    {c.secondary[s.key] ?? 0}
                    {onRaiseStat && (
                      <button type="button" aria-label={`Raise ${s.label}`} disabled={secondaryLeft <= 0} onClick={() => onRaiseStat("secondary", s.key)}>
                        +
                      </button>
                    )}
                  </td>
                  <td>{s.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
    }
    case "W":
      return (
        <>
          {c.weapons.map((w) => (
            <PageRow key={w.id} name={`${w.name || "Unnamed weapon"}${w.hands === 2 ? " (two-handed)" : ""}`} pages={w.pages} onOpenPage={onOpenPage} />
          ))}
          {c.weapons.length === 0 && <p className="muted">No weapons equipped.</p>}
          {edit()}
        </>
      );
    case "A":
      return (
        <>
          {c.armor ? <PageRow name={c.armor.name || "Unnamed armor"} pages={c.armor.pages} onOpenPage={onOpenPage} /> : <p className="muted">No armor equipped.</p>}
          {c.armor && (
            <p className="muted small">
              Resistances: Slash ×{c.armor.resistances.slash}, Pierce ×{c.armor.resistances.pierce}, Blunt ×{c.armor.resistances.blunt}
              {c.armor.staggerResistances &&
                ` · Stagger: Slash ×${c.armor.staggerResistances.slash}, Pierce ×${c.armor.staggerResistances.pierce}, Blunt ×${c.armor.staggerResistances.blunt}`}
            </p>
          )}
          {edit()}
        </>
      );
    case "AU":
      return (
        <>
          <NameDescription
            rows={[
              ...(c.augment.name || c.augment.description ? [{ id: "augment", name: c.augment.name, description: c.augment.description }] : []),
              ...c.augment.passives.map((p) => ({ id: p.id, name: p.name, description: p.description, extra: <span className="muted small"> · Passive, cost {p.cost}</span> })),
            ]}
            empty="No Augment yet."
          />
          {edit()}
        </>
      );
    case "P":
      return (
        <>
          <NameDescription rows={c.proficiencies} empty="No Proficiencies yet." />
          {edit()}
        </>
      );
  }
}
