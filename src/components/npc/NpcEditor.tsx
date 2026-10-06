import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { doc, setDoc } from "firebase/firestore";
import type { ItemTemplate, NpcTemplate, ResistanceSet } from "../../../shared/character.ts";
import {
  blankPage,
  cloneAugment,
  cloneEquipment,
  clonePage,
  NPC_SIDES,
  npcPages,
  npcStats,
  PRIMARY_STATS,
  RANKS,
  rankTable,
  SECONDARY_STATS,
} from "../../../shared/ruleset.ts";
import { db, friendlyError } from "../../firebase.ts";
import { DeckRow, type Peek, PageHoverCard } from "../DeckTab.tsx";
import { EquipmentStudio, PageEditor, PassiveList } from "../EquipmentEditor.tsx";
import { NumberInput, Stepper } from "../Fields.tsx";
import { ImageUpload } from "../ImageUpload.tsx";
import { ResistanceGrid, StatIcon } from "../LorIcons.tsx";
import { InventoryTab } from "../items/InventoryTab.tsx";
import { PEEK_WIDTH } from "../peek.ts";
import { PvCard } from "../player/LorCard.tsx";
import { type GearEntry, GearLibrary } from "./GearLibrary.tsx";

const SAVE_DELAY_MS = 600;
const TABS = [
  ["profile", "Profile"],
  ["loadout", "Augment, Weapons & Armor"],
  ["deck", "Combat Deck"],
  ["inventory", "Inventory"],
] as const;
type Tab = (typeof TABS)[number][0];
type Update = (fn: (d: NpcTemplate) => void) => void;

const RESOURCES = [
  ["maxHp", "Health", "rb-hp"],
  ["maxStagger", "Stagger Resist", "rb-stagger"],
  ["maxSanity", "Sanity", "rb-sanity"],
  ["maxLight", "Light", "rb-light"],
] as const;

/** Loads nothing itself: edits a template held by the caller, saving shortly after each change. */
function useNpcSave(gameId: string, id: string, template: NpcTemplate) {
  const [t, setT] = useState(template);
  const [status, setStatus] = useState("");
  const latest = useRef(template);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Follow changes from elsewhere unless there are unsaved local edits.
  useEffect(() => {
    if (dirty.current) return;
    latest.current = template;
    setT(template);
  }, [template]);
  const write = async () => {
    try {
      await setDoc(doc(db, "games", gameId, "enemies", id), { ...latest.current, updatedAt: Date.now() });
      dirty.current = false;
      setStatus("Saved");
    } catch (err) {
      setStatus(friendlyError(err));
    }
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) void write();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const update: Update = (fn) => {
    const next = structuredClone(latest.current);
    fn(next);
    latest.current = next;
    setT(next);
    dirty.current = true;
    setStatus("Saving…");
    clearTimeout(timer.current);
    timer.current = setTimeout(write, SAVE_DELAY_MS);
  };
  return { t, update, status };
}

/** A resource worked out from Rank and Stats, which the GM can override. */
function ResourceOverride({ label, cls, calculated, override, onChange }: { label: string; cls: string; calculated: number; override?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div className={`rb-box npc-res ${cls}${override !== undefined ? " overridden" : ""}`}>
      <span className="rb-label">{label}</span>
      <NumberInput label={label} value={override ?? calculated} min={1} onChange={(n) => onChange(Math.max(1, Math.round(n)))} />
      {override !== undefined ? (
        <button type="button" className="link small" onClick={() => onChange(undefined)} title={`Back to ${calculated} from Rank and Stats`}>
          Reset to {calculated}
        </button>
      ) : (
        <span className="muted small">from Stats</span>
      )}
    </div>
  );
}

/** Damage and Stagger resistances: the Armor's, unless the GM typed over them. */
function ResistanceOverride({ t, update }: { t: NpcTemplate; update: Update }) {
  const s = npcStats(t);
  const overridden = !!(t.overrides.resistances || t.overrides.staggerResistances);
  return (
    <div className="npc-resist">
      <div className="row-between">
        <span className="muted small">Resistances</span>
        {overridden ? (
          <button type="button" className="link small" onClick={() => update((d) => void (delete d.overrides.resistances, delete d.overrides.staggerResistances))}>
            Use the Armor's
          </button>
        ) : (
          <span className="muted small">{t.armor ? `from ${t.armor.name || "Armor"}` : "no Armor"}</span>
        )}
      </div>
      <ResistanceGrid
        resistances={s.resistances}
        staggerResistances={s.staggerResistances}
        labelFor={(field, k) => `${field === "resistances" ? "Damage" : "Stagger"} resistances ${k}`}
        onChange={(field, r) => update((d) => void (d.overrides[field] = r))}
      />
    </div>
  );
}

function ProfileTab({ t, update, gameId }: { t: NpcTemplate; update: Update; gameId: string }) {
  const s = npcStats(t);
  return (
    <div className="npc-profile">
      <section className="npc-id panel">
        <ImageUpload folder={`games/${gameId}/assets/enemies`} label="Portrait" value={t.portrait} onChange={(url) => update((d) => void (url ? (d.portrait = url) : delete d.portrait))} />
        <label className="field">
          <span>Name</span>
          <input aria-label="Name" value={t.name} onChange={(e) => update((d) => void (d.name = e.target.value))} />
        </label>
        <div className="field">
          <span>Side</span>
          <div className="row wrap">
            {NPC_SIDES.map((side) => (
              <button
                key={side.value}
                type="button"
                className={"chip" + (t.side === side.value ? " active" : "")}
                onClick={() =>
                  update((d) => {
                    // Keep a custom color; swap the default one for the new side's.
                    if (NPC_SIDES.some((x) => x.color === d.color)) d.color = side.color;
                    d.side = side.value;
                  })
                }
              >
                {side.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row wrap">
          <label className="field">
            <span>Rank</span>
            <select aria-label="Rank" value={t.rank} onChange={(e) => update((d) => void (d.rank = Number(e.target.value)))}>
              {RANKS.map((r) => (
                <option key={r} value={r}>
                  Rank {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Token color</span>
            <input type="color" aria-label="Token color" value={t.color} onChange={(e) => update((d) => void (d.color = e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>GM notes</span>
          <textarea aria-label="GM notes" value={t.notes} placeholder="Tactics, motives, where they turn up…" onChange={(e) => update((d) => void (d.notes = e.target.value))} />
        </label>
      </section>

      <div className="npc-numbers">
        <section className="stat-panel">
          <header>
            <h3>Stats</h3>
            <span className="muted small">Set freely: no point budget for GM characters</span>
          </header>
          <div className="npc-stat-grid">
            {PRIMARY_STATS.map((st) => (
              <div className="primary-tile" key={st.key}>
                <span className="tile-name">
                  <StatIcon stat={st.key} /> {st.label}
                </span>
                <span className="tile-value">{t.primary[st.key]}</span>
                <span className="muted small">{st.effect}</span>
                <Stepper label={st.label} value={t.primary[st.key]} max={99} onChange={(n) => update((d) => void (d.primary[st.key] = n))} />
              </div>
            ))}
          </div>
          {SECONDARY_STATS.map((st) => (
            <div className="stat-row" key={st.key}>
              <div>
                <strong>{st.label}</strong>
                <div className="muted small">{st.effect}</div>
              </div>
              <Stepper label={st.label} value={t.secondary[st.key] ?? 0} max={99} onChange={(n) => update((d) => void (d.secondary[st.key] = n))} />
            </div>
          ))}
        </section>
        <section className="stat-panel">
          <header>
            <h3>Resources</h3>
            <span className="muted small">Type a number to override</span>
          </header>
          <div className="npc-res-grid">
            {RESOURCES.map(([key, label, cls]) => (
              <ResourceOverride
                key={key}
                label={label}
                cls={cls}
                calculated={s.calculated[key]}
                override={t.overrides[key]}
                onChange={(v) => update((d) => void (v === undefined ? delete d.overrides[key] : (d.overrides[key] = v)))}
              />
            ))}
            <div className="rb-box rb-speed">
              <span className="rb-label">Speed</span>
              <span className="rb-val">1d6+{t.primary.justice}</span>
            </div>
          </div>
          <ResistanceOverride t={t} update={update} />
        </section>
      </div>
    </div>
  );
}

function LoadoutTab({ t, update, gameId, gear }: { t: NpcTemplate; update: Update; gameId: string; gear: GearEntry[] }) {
  const [message, setMessage] = useState("");
  const copies = (pageId: string) => t.deck.find((e) => e.pageId === pageId)?.copies ?? 0;
  const setCopies = (pageId: string, n: number) =>
    update((d) => {
      d.deck = [...d.deck.filter((e) => e.pageId !== pageId), ...(n > 0 ? [{ pageId, copies: n }] : [])];
    });
  const pick = (e: GearEntry) => {
    update((d) => {
      if (e.kind === "augment") d.augment = cloneAugment(e.augment);
      else if (e.kind === "weapon") d.weapons.push(cloneEquipment(e.item));
      else if (e.kind === "armor") d.armor = cloneEquipment(e.item);
    });
    setMessage(e.kind === "weapon" ? `Added ${e.name}.` : `${e.kind === "augment" ? "Augment" : "Armor"} is now ${e.name}.`);
  };
  return (
    <div className="npc-loadout">
      <div className="npc-loadout-main">
        <section className="augment-card" id="augment" aria-label="Augment">
          <div className="augment-head">
            <span className="kicker">Augment</span>
            <span className="muted small">Max Passive Cost {rankTable(t.rank).augmentMaxCost} at Rank {t.rank}</span>
          </div>
          <input className="augment-name" aria-label="Augment name" placeholder="No Augment" value={t.augment.name} onChange={(e) => update((d) => void (d.augment.name = e.target.value))} />
          <textarea aria-label="Description" placeholder="What it is" value={t.augment.description} onChange={(e) => update((d) => void (d.augment.description = e.target.value))} />
          <PassiveList passives={t.augment.passives} max={rankTable(t.rank).augmentMaxCost} onChange={(p) => update((d) => void (d.augment.passives = p))} />
        </section>
        <section className="sheet-section" id="equipment">
          <h2>Weapons and Armor</h2>
          <p className="muted small">Use − and + under a Page to put copies in this character's Combat Deck.</p>
          <EquipmentStudio
            weapons={t.weapons}
            armor={t.armor}
            characterRank={t.rank}
            artFolder={`games/${gameId}/assets/pages`}
            canAddWeapon
            onWeapons={(w) => update((d) => void (d.weapons = w))}
            onArmor={(a) => update((d) => void (d.armor = a))}
            deck={{ copies, max: () => 99, set: setCopies, locked: false }}
          />
        </section>
      </div>
      <aside className="npc-loadout-side">
        {message && (
          <p className="muted small" role="status">
            {message}
          </p>
        )}
        <GearLibrary
          title="Reuse gear"
          hint="Augments, Weapons and Armor from your characters and your players'. Picking one copies it here, so editing it won't change the original."
          entries={gear}
          kinds={["augment", "weapon", "armor"]}
          onPick={pick}
        />
      </aside>
    </div>
  );
}

function DeckTab({ t, update, gameId, gear }: { t: NpcTemplate; update: Update; gameId: string; gear: GearEntry[] }) {
  const [peek, setPeek] = useState<Peek>(null);
  const [open, setOpen] = useState<string | null>(null);
  const sources = npcPages(t);
  const copies = (pageId: string) => t.deck.find((e) => e.pageId === pageId)?.copies ?? 0;
  const setCopies = (pageId: string, n: number) =>
    update((d) => {
      const at = d.deck.findIndex((e) => e.pageId === pageId);
      if (at >= 0) d.deck[at].copies = n;
      else d.deck.push({ pageId, copies: n });
      d.deck = d.deck.filter((e) => e.copies > 0);
    });
  const total = sources.reduce((n, s) => n + copies(s.page.id), 0);
  const openPage = t.pages.find((p) => p.id === open);

  return (
    <div className="npc-deck-tab">
      <div className="inv-tab">
        <aside className="inv-list" aria-label="Combat Deck">
          <div className="inv-head">
            <h3>Combat Deck</h3>
            <span className="muted">{total} Pages</span>
          </div>
          <p className="muted small">No size limit. GM characters draw 3 to start and 1 each Upkeep.</p>
          {total === 0 && <div className="inv-row empty">{sources.length ? "Empty: in play it uses one of each Page" : "No Pages yet"}</div>}
          {sources
            .filter(({ page }) => copies(page.id) > 0)
            .map(({ page, from }) => (
              <DeckRow
                key={page.id}
                page={page}
                copies={copies(page.id)}
                note={from ? `on ${from}` : undefined}
                onPeek={setPeek}
                controls={
                  <>
                    <button type="button" className="icon" aria-label={`One less ${page.name || "page"}`} onClick={() => setCopies(page.id, copies(page.id) - 1)}>
                      −
                    </button>
                    <button type="button" className="icon" aria-label={`One more ${page.name || "page"}`} onClick={() => setCopies(page.id, copies(page.id) + 1)}>
                      +
                    </button>
                    <button type="button" className="icon" aria-label={`Take ${page.name || "page"} out of the deck`} onClick={() => setCopies(page.id, 0)}>
                      ✕
                    </button>
                  </>
                }
              />
            ))}
        </aside>
        <div className="npc-pages">
          <section className="sheet-section">
            <h2>Pages</h2>
            <p className="muted small">Use − and + under a Page to set its copies in the deck. Own Pages aren't on a Weapon or Armor, like a beast's claws: tap one to edit it. Equipment Pages are edited on the Augment, Weapons &amp; Armor tab.</p>
            {sources.some((x) => x.from) && (
              <div className="npc-own-pages">
                {sources
                  .filter((x) => x.from)
                  .map(({ page, from }) => (
                    <div key={page.id} className={"thumb-wrap" + (copies(page.id) ? " in-deck" : "")}>
                      <PvCard page={page} size="thumb" />
                      <span className="muted small thumb-from">{from}</span>
                      <Stepper label={`copies of ${page.name || "page"}`} value={copies(page.id)} max={99} onChange={(n) => setCopies(page.id, n)} />
                    </div>
                  ))}
              </div>
            )}
            <h4>Own Pages</h4>
            <div className="npc-own-pages">
              {t.pages.map((p) => (
                <div key={p.id} className={"thumb-wrap" + (copies(p.id) ? " in-deck" : "")}>
                  <PvCard page={p} size="thumb" selected={p.id === open} onClick={() => setOpen(p.id === open ? null : p.id)} />
                  <Stepper label={`copies of ${p.name || "page"}`} value={copies(p.id)} max={99} onChange={(n) => setCopies(p.id, n)} />
                </div>
              ))}
              <button
                type="button"
                className="equip-add-page"
                aria-label="New Page"
                onClick={() => {
                  const page = { ...blankPage("basic"), name: `Attack ${t.pages.length + 1}` };
                  update((d) => {
                    d.pages.push(page);
                    d.deck.push({ pageId: page.id, copies: 1 });
                  });
                  setOpen(page.id);
                }}
              >
                +
              </button>
            </div>
            {openPage && (
              <PageEditor
                key={openPage.id}
                page={openPage}
                artFolder={`games/${gameId}/assets/pages`}
                onChange={(np) => update((d) => void (d.pages = d.pages.map((p) => (p.id === np.id ? np : p))))}
                onRemove={() => {
                  update((d) => {
                    d.pages = d.pages.filter((p) => p.id !== openPage.id);
                    d.deck = d.deck.filter((e) => e.pageId !== openPage.id);
                  });
                  setOpen(null);
                }}
              />
            )}
          </section>
          <GearLibrary
            title="Reuse Pages"
            hint="Tap a Page to copy it into this character's own Pages, with one copy in the deck."
            entries={gear}
            kinds={["page"]}
            onPick={(e) => {
              if (e.kind !== "page") return;
              const page = clonePage(e.page);
              update((d) => {
                d.pages.push(page);
                d.deck.push({ pageId: page.id, copies: 1 });
              });
            }}
          />
        </div>
      </div>
      {peek &&
        createPortal(
          <div className="inv-peek" style={{ top: peek.top, left: peek.left, width: PEEK_WIDTH }} aria-hidden="true">
            <PageHoverCard page={peek.page} />
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Everything about one GM character, in three tabs. */
export function NpcEditor({
  gameId,
  id,
  template,
  gear,
  items,
  onExport,
  onDuplicate,
  onDelete,
}: {
  gameId: string;
  id: string;
  template: NpcTemplate;
  gear: GearEntry[];
  items: Record<string, ItemTemplate> | undefined;
  onExport: (t: NpcTemplate) => void;
  onDuplicate: (t: NpcTemplate) => void;
  onDelete: () => void;
}) {
  const { t, update, status } = useNpcSave(gameId, id, template);
  const [tab, setTab] = useState<Tab>("profile");
  return (
    <div className="npc-editor">
      <div className="npc-editor-head">
        <div className="npc-editor-title">
          <h2>{t.name || "Unnamed character"}</h2>
          <span className={status === "Saved" ? "ok-text small" : "muted small"}>{status}</span>
        </div>
        <div className="row wrap">
          <button type="button" onClick={() => onExport(t)}>
            Export
          </button>
          <button type="button" onClick={() => onDuplicate(t)}>
            Duplicate
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      <nav className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "profile" && <ProfileTab t={t} update={update} gameId={gameId} />}
      {tab === "loadout" && <LoadoutTab t={t} update={update} gameId={gameId} gear={gear} />}
      {tab === "deck" && <DeckTab t={t} update={update} gameId={gameId} gear={gear} />}
      {tab === "inventory" && (
        <section className="npc-inventory" id="inventory">
          <InventoryTab c={t} library={items} gameId={gameId} isGm canEdit update={update} />
        </section>
      )}
    </div>
  );
}
