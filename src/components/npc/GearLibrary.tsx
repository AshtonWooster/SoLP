import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Armor, Character, Page, Passive, Weapon } from "../../../shared/character.ts";
import { equipmentPages } from "../../../shared/ruleset.ts";
import { type Peek, PageHoverCard } from "../DeckTab.tsx";
import { PEEK_WIDTH, peekPosition } from "../peek.ts";
import { PvCard } from "../player/LorCard.tsx";

export type GearKind = "augment" | "weapon" | "armor" | "page";
export type GearEntry =
  | { kind: "augment"; key: string; name: string; from: string; augment: Character["augment"] }
  | { kind: "weapon"; key: string; name: string; from: string; item: Weapon }
  | { kind: "armor"; key: string; name: string; from: string; item: Armor }
  | { kind: "page"; key: string; name: string; from: string; page: Page };

const KIND_LABEL: Record<GearKind, string> = { augment: "Augment", weapon: "Weapon", armor: "Armor", page: "Page" };

/** The same thing made twice (or copied) counts once: ids don't matter, only what's in it. */
const signature = (kind: string, v: unknown) => kind + JSON.stringify(v, (k, x) => (k === "id" ? undefined : x));

/**
 * Everything already built in this game that a GM character could reuse: Augments, Weapons, Armor
 * and Pages from the GM's characters and the players' characters.
 */
export function gearLibrary(sources: { from: string; c: Character & { pages?: Page[] } }[]): GearEntry[] {
  const seen = new Set<string>();
  const out: GearEntry[] = [];
  const add = (e: GearEntry, value: unknown) => {
    const sig = signature(e.kind, value);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(e);
  };
  for (const { from, c } of sources) {
    if (c.augment?.name?.trim()) add({ kind: "augment", key: `${from}-aug`, name: c.augment.name, from, augment: c.augment }, c.augment);
    for (const w of c.weapons ?? []) if (w.name.trim()) add({ kind: "weapon", key: `${from}-${w.id}`, name: w.name, from, item: w }, w);
    if (c.armor?.name.trim()) add({ kind: "armor", key: `${from}-${c.armor.id}`, name: c.armor.name, from, item: c.armor }, c.armor);
    const pages = [...equipmentPages({ ...c, weapons: c.weapons ?? [], armor: c.armor ?? null }).map((s) => s.page), ...(c.pages ?? []), ...(c.ego ?? [])];
    for (const p of pages) if (p.name.trim()) add({ kind: "page", key: `${from}-${p.id}`, name: p.name, from, page: p }, p);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function PassiveNames({ passives }: { passives: Passive[] }) {
  if (!passives.length) return <span className="muted small">No Passives</span>;
  return <span className="small">{passives.map((p) => `${p.name || "Unnamed"} (${p.cost})`).join(", ")}</span>;
}

/** One Augment, Weapon or Armor in the library. */
function GearCard({ entry, onPick, action }: { entry: Exclude<GearEntry, { kind: "page" }>; onPick: () => void; action: string }) {
  const item = entry.kind === "augment" ? null : entry.item;
  return (
    <div className={`gear-card ${entry.kind}`}>
      <div className="gear-card-head">
        <span className="gear-kind">{KIND_LABEL[entry.kind]}</span>
        {item?.rank && <span className="muted small">Rank {item.rank}</span>}
        {entry.kind === "weapon" && <span className="muted small">{entry.item.hands}-handed</span>}
      </div>
      <strong className="gear-name">{entry.name}</strong>
      <PassiveNames passives={entry.kind === "augment" ? entry.augment.passives : entry.item.passives} />
      {item && item.pages.length > 0 && <span className="muted small">Pages: {item.pages.map((p) => p.name || "Unnamed").join(", ")}</span>}
      {entry.kind === "armor" && (
        <span className="muted small">
          Resist S{entry.item.resistances.slash} P{entry.item.resistances.pierce} B{entry.item.resistances.blunt}
        </span>
      )}
      <div className="gear-card-foot">
        <span className="muted small">from {entry.from}</span>
        <button type="button" className="small" aria-label={`${action} ${entry.name}`} onClick={onPick}>
          {action}
        </button>
      </div>
    </div>
  );
}

/**
 * A searchable library of reusable gear. `kinds` picks what's shown (e.g. just Pages); picking
 * an entry hands it to `onPick`, which copies it onto the character.
 */
export function GearLibrary({
  entries,
  kinds,
  onPick,
  title,
  hint,
}: {
  entries: GearEntry[];
  kinds: GearKind[];
  onPick: (e: GearEntry) => void;
  title: string;
  hint?: string;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<GearKind | "all">("all");
  const [peek, setPeek] = useState<Peek>(null);
  const shown = useMemo(
    () => entries.filter((e) => kinds.includes(e.kind) && (kind === "all" || e.kind === kind) && (e.name + " " + e.from).toLowerCase().includes(search.trim().toLowerCase())),
    [entries, kinds, kind, search],
  );
  const action = (e: GearEntry) => (e.kind === "weapon" || e.kind === "page" ? "Add" : "Use");

  return (
    <section className="gear-library" aria-label={title}>
      <h3>{title}</h3>
      {hint && <p className="muted small">{hint}</p>}
      <div className="row wrap library-filters">
        <input aria-label={`Search ${title.toLowerCase()}`} placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        {kinds.length > 1 &&
          (["all", ...kinds] as const).map((k) => (
            <button key={k} type="button" className={"chip" + (kind === k ? " active" : "")} onClick={() => setKind(k)}>
              {k === "all" ? "All" : KIND_LABEL[k]}
            </button>
          ))}
      </div>
      {shown.length === 0 ? (
        <p className="muted small">{entries.some((e) => kinds.includes(e.kind)) ? "Nothing matches." : "Nothing to reuse yet. Anything built on your characters or your players' shows up here."}</p>
      ) : kinds.length === 1 && kinds[0] === "page" ? (
        <div className="library-grid gear-pages">
          {shown.map((e) =>
            e.kind === "page" ? (
              <div key={e.key} className="gear-page" onMouseEnter={(ev) => setPeek({ page: e.page, ...peekPosition(ev.currentTarget) })} onMouseLeave={() => setPeek(null)}>
                <PvCard page={e.page} size="thumb" onClick={() => onPick(e)} />
                <span className="muted small">from {e.from}</span>
              </div>
            ) : null,
          )}
        </div>
      ) : (
        <div className="gear-grid">{shown.map((e) => (e.kind === "page" ? null : <GearCard key={e.key} entry={e} action={action(e)} onPick={() => onPick(e)} />))}</div>
      )}
      {peek &&
        createPortal(
          <div className="inv-peek" style={{ top: peek.top, left: peek.left, width: PEEK_WIDTH }} aria-hidden="true">
            <PageHoverCard page={peek.page} />
          </div>,
          document.body,
        )}
    </section>
  );
}
