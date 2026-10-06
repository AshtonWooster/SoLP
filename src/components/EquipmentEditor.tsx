import { useState } from "react";
import type { Armor, Dice, DiceKind, Equipment, Page, PageType, Passive, Weapon } from "../../shared/character.ts";
import { blankArmor, blankPage, blankPassive, blankWeapon, clonePage, equipmentMaxCost, RANKS } from "../../shared/ruleset.ts";
import { NumberInput, Stepper, TextField } from "./Fields.tsx";
import { ResistanceGrid } from "./LorIcons.tsx";
import { PageCardEditor, PvCard } from "./player/LorCard.tsx";

export const PAGE_TYPES: { value: PageType; label: string }[] = [
  { value: "melee", label: "Melee" },
  { value: "ranged", label: "Ranged" },
  { value: "massSummation", label: "Mass Attack (Summation)" },
  { value: "massIndividual", label: "Mass Attack (Individual)" },
  { value: "instant", label: "Instant" },
];

const DICE_KINDS: { value: DiceKind; label: string }[] = [
  { value: "slash", label: "Slash" },
  { value: "pierce", label: "Pierce" },
  { value: "blunt", label: "Blunt" },
  { value: "block", label: "Block" },
  { value: "evade", label: "Evade" },
];

export function diceLabel(d: Dice): string {
  const kind = DICE_KINDS.find((k) => k.value === d.kind)?.label ?? d.kind;
  return `${d.counter ? "Counter " : ""}${kind} 1d${d.sides}${d.basePower >= 0 ? "+" : ""}${d.basePower}`;
}

/** Edit an item in a list by index, returning a new list. */
function replaceAt<T>(list: T[], i: number, item: T): T[] {
  return list.map((x, j) => (j === i ? item : x));
}

export function PassiveList({
  passives,
  max,
  onChange,
}: {
  passives: Passive[];
  max: number;
  onChange: (p: Passive[]) => void;
}) {
  const net = passives.reduce((a, p) => a + p.cost, 0);
  const negative = -passives.filter((p) => p.cost < 0).reduce((a, p) => a + p.cost, 0);
  return (
    <div className="passives">
      <div className="row-between">
        <h4>Passives</h4>
        <span className={net > max || negative > max ? "error" : "muted"}>
          Cost {net} / {max}
          {negative > 0 && ` · negative ${negative} / ${max}`}
        </span>
      </div>
      {passives.map((p, i) => (
        <div className="passive" key={p.id}>
          <div className="row">
            <input aria-label="Passive name" placeholder="Passive name" value={p.name} onChange={(e) => onChange(replaceAt(passives, i, { ...p, name: e.target.value }))} />
            <label className="inline">
              Cost
              <NumberInput label="Passive cost" value={p.cost} onChange={(cost) => onChange(replaceAt(passives, i, { ...p, cost: Math.round(cost) }))} />
            </label>
            <button type="button" className="icon" aria-label="Remove passive" onClick={() => onChange(passives.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
          <textarea
            aria-label="Passive effect"
            placeholder="What it does"
            value={p.description}
            onChange={(e) => onChange(replaceAt(passives, i, { ...p, description: e.target.value }))}
          />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...passives, blankPassive()])}>
        + Add passive
      </button>
      <p className="muted small">Use a negative cost for a Negative Passive.</p>
    </div>
  );
}

/** Edit one Page on its card (see PageCardEditor). */
export function PageEditor(props: { page: Page; onChange: (p: Page) => void; onRemove?: () => void; artFolder?: string }) {
  return <PageCardEditor {...props} />;
}

/**
 * A weapon or armor on the left of the studio, edited like a Page card: name, its own Rank (which
 * sets the max Passive Cost), hands or resistances, description, and Passives one by one.
 */
function EquipmentCardEditor<T extends Weapon | Armor>({
  item,
  characterRank,
  onChange,
  onRemove,
}: {
  item: T;
  characterRank: number;
  onChange: (item: T) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<Equipment>) => onChange({ ...item, ...patch });
  const isWeapon = "hands" in item;
  const label = isWeapon ? "Weapon" : "Armor";
  const rank = item.rank ?? characterRank;
  const max = equipmentMaxCost(item, characterRank);
  return (
    <div className={`pv-card edit full equip-card ${isWeapon ? "weapon" : "armor"}`}>
      <div className="pv-top">
        <span className="equip-kind">{label}</span>
        <label className="equip-rank">
          Rank
          <select aria-label={`${label} rank`} value={rank} onChange={(e) => set({ rank: Number(e.target.value) })}>
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input className="pv-name pv-name-input" aria-label={`${label} name`} placeholder={`${label} name`} value={item.name} onChange={(e) => set({ name: e.target.value })} />
      <p className="muted small equip-rank-note">
        Rank {rank}: Passives up to {max} Passive Cost, plus Negative Passives up to {max}.
      </p>
      {isWeapon && (
        <label className="inline">
          Hands
          <select aria-label="Hands" value={(item as Weapon).hands} onChange={(e) => onChange({ ...item, hands: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>One-handed</option>
            <option value={2}>Two-handed</option>
          </select>
        </label>
      )}
      {"resistances" in item && (
        <div className="equip-res">
          <h4 title="Damage (red) and Stagger damage (yellow) taken are multiplied by these. Lower is tougher.">Resistances</h4>
          <ResistanceGrid
            resistances={item.resistances ?? { slash: 1, pierce: 1, blunt: 1 }}
            staggerResistances={item.staggerResistances ?? { slash: 1, pierce: 1, blunt: 1 }}
            labelFor={(field, k) => `${field === "resistances" ? "" : "stagger "}${k} resistance`}
            onChange={(field, r) => onChange({ ...item, [field]: r })}
          />
        </div>
      )}
      <textarea className="pv-effect-in" aria-label={`${label} description`} placeholder="Description" value={item.description} onChange={(e) => set({ description: e.target.value })} />
      <PassiveList passives={item.passives} max={max} onChange={(passives) => set({ passives })} />
      <div className="pv-edit-foot">
        <span className="muted small">
          {item.pages.length} Page{item.pages.length === 1 ? "" : "s"}: tap one on the right to edit it
        </span>
        <button type="button" className="danger" onClick={onRemove}>
          Remove {label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

/** Drag data type for a Page being dragged between pieces of equipment. */
const PAGE_DRAG = "application/x-solp-page";

/** Lets the studio add Pages to the Combat Deck: copies of each, the most allowed, and whether decks are locked (combat). */
export interface DeckHooks {
  copies: (pageId: string) => number;
  max: (page: Page) => number;
  set: (pageId: string, copies: number) => void;
  locked: boolean;
}

/** One weapon or armor on the right of the studio: tap it to edit it; its Pages as cards (tap to edit, + to add). */
function EquipmentBox<T extends Weapon | Armor>({
  item,
  characterRank,
  selected,
  selectedPageId,
  onSelect,
  onSelectPage,
  onChange,
  onDropPage,
  deck,
}: {
  item: T;
  characterRank: number;
  deck?: DeckHooks;
  /** A Page from another piece of equipment was dropped here: copy it in. */
  onDropPage: (fromEquipId: string, pageId: string) => void;
  /** The equipment itself is open in the editor. */
  selected: boolean;
  selectedPageId?: string;
  onSelect: () => void;
  onSelectPage: (pageId: string) => void;
  onChange: (item: T) => void;
}) {
  const isWeapon = "hands" in item;
  const label = isWeapon ? "Weapon" : "Armor";
  const max = equipmentMaxCost(item, characterRank);
  const passiveCost = item.passives.reduce((a, p) => a + p.cost, 0);
  const [dropping, setDropping] = useState(false);
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(PAGE_DRAG) && !e.dataTransfer.types.includes(`${PAGE_DRAG}-from-${item.id}`.toLowerCase());
  return (
    <section
      className={`equip-box ${isWeapon ? "weapon" : "armor"}${selected ? " selected" : ""}${dropping ? " drop-target" : ""}`}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        if (!accepts(e)) return;
        e.preventDefault();
        const { from, pageId } = JSON.parse(e.dataTransfer.getData(PAGE_DRAG)) as { from: string; pageId: string };
        onDropPage(from, pageId);
      }}
    >
      <button type="button" className="equip-head" aria-pressed={selected} aria-label={`Edit ${item.name || `this ${label.toLowerCase()}`}`} onClick={onSelect}>
        <span className="equip-kind">{label}</span>
        <strong className="equip-name">{item.name || "Unnamed"}</strong>
        <span className="muted small">Rank {item.rank ?? characterRank}</span>
      </button>
      <button type="button" className="equip-passives" onClick={onSelect}>
        <strong>Passives</strong>{" "}
        <span className="muted small">
          {item.passives.length ? item.passives.map((p) => p.name || "Unnamed").join(", ") : "none"} · cost {passiveCost}/{max}
          {isWeapon ? ` · ${(item as Weapon).hands === 2 ? "two" : "one"}-handed` : ""}
        </span>
      </button>
      <div className="equip-pages">
        {item.pages.map((p) => (
          <div
            key={p.id}
            className={"thumb-wrap" + (deck?.copies(p.id) ? " in-deck" : "")}
            draggable
            title="Drag onto another weapon or armor to copy it there"
            onDragStart={(e) => {
              e.dataTransfer.setData(PAGE_DRAG, JSON.stringify({ from: item.id, pageId: p.id }));
              // Lets other boxes tell, while dragging, that the Page came from here.
              e.dataTransfer.setData(`${PAGE_DRAG}-from-${item.id}`.toLowerCase(), "");
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <PvCard page={p} size="thumb" selected={p.id === selectedPageId} onClick={() => onSelectPage(p.id)} />
            {deck && (
              <fieldset className="thumb-deck" disabled={deck.locked} title="Copies in the Combat Deck">
                <Stepper label={`copies of ${p.name || "page"}`} value={deck.copies(p.id)} max={deck.max(p)} onChange={(n) => deck.set(p.id, n)} />
              </fieldset>
            )}
          </div>
        ))}
        <button
          type="button"
          className="equip-add-page"
          aria-label={`Add a Page to ${item.name || `this ${label.toLowerCase()}`}`}
          onClick={() => {
            const page = blankPage("basic");
            onChange({ ...item, pages: [...item.pages, page] });
            onSelectPage(page.id);
          }}
        >
          +
        </button>
      </div>
    </section>
  );
}

/**
 * Weapons and Armor, laid out like the design sketch: the selected Page on the left as an
 * editable card, and on the right each piece of equipment with its Pages (tap one to edit it, + to
 * add one). The big + adds a weapon or armor.
 */
export function EquipmentStudio({
  weapons,
  armor,
  characterRank,
  artFolder,
  canAddWeapon,
  onWeapons,
  onArmor,
  deck,
}: {
  /** With these, Pages can be added to the Combat Deck right from the studio. */
  deck?: DeckHooks;
  weapons: Weapon[];
  armor: Armor | null;
  /** Equipment without its own Rank uses this. */
  characterRank: number;
  artFolder?: string;
  canAddWeapon: boolean;
  onWeapons: (w: Weapon[]) => void;
  onArmor: (a: Armor | null) => void;
}) {
  const all: (Weapon | Armor)[] = [...weapons, ...(armor ? [armor] : [])];
  // What's open on the left: a piece of equipment itself, or one of its Pages.
  const [picked, setPicked] = useState<{ equipId: string; pageId?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const valid = (sel: { equipId: string; pageId?: string } | null) => {
    const e = sel && all.find((x) => x.id === sel.equipId);
    return !!e && (!sel!.pageId || e.pages.some((p) => p.id === sel!.pageId));
  };
  // Default to the first piece of equipment; drop a selection that was removed.
  const current = valid(picked) ? picked : all[0] ? { equipId: all[0].id } : null;
  const owner = current ? all.find((e) => e.id === current.equipId) : undefined;
  const page = current?.pageId ? owner?.pages.find((p) => p.id === current.pageId) : undefined;

  const change = (item: Weapon | Armor) => {
    if (armor && item.id === armor.id) onArmor(item as Armor);
    else onWeapons(weapons.map((w) => (w.id === item.id ? (item as Weapon) : w)));
  };
  /** Copies a Page onto another piece of equipment and opens the copy. */
  const copyPage = (fromEquipId: string, pageId: string, toEquipId: string) => {
    const src = all.find((e) => e.id === fromEquipId)?.pages.find((p) => p.id === pageId);
    const target = all.find((e) => e.id === toEquipId);
    if (!src || !target || fromEquipId === toEquipId) return;
    const copy = clonePage(src);
    change({ ...target, pages: [...target.pages, copy] });
    setPicked({ equipId: target.id, pageId: copy.id });
  };
  const remove = (item: Weapon | Armor) => {
    if (armor && item.id === armor.id) onArmor(null);
    else onWeapons(weapons.filter((w) => w.id !== item.id));
  };

  return (
    <div className="equip-studio">
      <div className="equip-editor">
        {page && owner ? (
          <>
            <PageCardEditor
              key={page.id}
              page={page}
              artFolder={artFolder}
              onChange={(np) => change({ ...owner, pages: owner.pages.map((p) => (p.id === np.id ? np : p)) })}
              onRemove={() => change({ ...owner, pages: owner.pages.filter((p) => p.id !== page.id) })}
            />
            {all.length > 1 && (
              <label className="editor-copy">
                <span>Copy this Page to</span>
                <select aria-label="Copy this Page to" value="" onChange={(e) => copyPage(owner.id, page.id, e.target.value)}>
                  <option value="">Pick a weapon or armor…</option>
                  {all
                    .filter((e) => e.id !== owner.id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name || ("hands" in e ? "Unnamed weapon" : "Unnamed armor")}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {deck && (
              <fieldset className="editor-deck" disabled={deck.locked}>
                <span>Copies in the Combat Deck</span>
                <Stepper label={`deck copies of ${page.name || "page"}`} value={deck.copies(page.id)} max={deck.max(page)} onChange={(n) => deck.set(page.id, n)} />
              </fieldset>
            )}
          </>
        ) : owner ? (
          <EquipmentCardEditor key={owner.id} item={owner} characterRank={characterRank} onChange={change} onRemove={() => remove(owner)} />
        ) : (
          <p className="muted equip-empty">Tap the + below to add a weapon or armor.</p>
        )}
      </div>
      <div className="equip-list">
        <div className="equip-scroll">
          {all.map((item) => (
            <EquipmentBox
              key={item.id}
              item={item}
              characterRank={characterRank}
              selected={current?.equipId === item.id && !current.pageId}
              selectedPageId={current?.equipId === item.id ? current.pageId : undefined}
              onSelect={() => setPicked({ equipId: item.id })}
              onSelectPage={(pageId) => setPicked({ equipId: item.id, pageId })}
              onChange={change}
              onDropPage={(from, pageId) => copyPage(from, pageId, item.id)}
              deck={deck}
            />
          ))}
          {all.length === 0 && <p className="muted">No equipment yet.</p>}
        </div>
        <div className="equip-add">
          {adding ? (
            <div className="row">
              <button
                type="button"
                disabled={!canAddWeapon}
                title={canAddWeapon ? undefined : "Both hands are full"}
                onClick={() => {
                  const w = blankWeapon();
                  onWeapons([...weapons, w]);
                  setPicked({ equipId: w.id });
                  setAdding(false);
                }}
              >
                + Add weapon
              </button>
              <button
                type="button"
                disabled={!!armor}
                title={armor ? "One armor at a time" : undefined}
                onClick={() => {
                  const a = blankArmor();
                  onArmor(a);
                  setPicked({ equipId: a.id });
                  setAdding(false);
                }}
              >
                + Add armor
              </button>
              <button type="button" className="link" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="equip-add-big" aria-label="Add equipment" onClick={() => setAdding(true)}>
              +
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
