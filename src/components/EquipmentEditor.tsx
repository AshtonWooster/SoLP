import { useState } from "react";
import type { Armor, Dice, DiceKind, Equipment, Page, PageType, Passive, Weapon } from "../../shared/character.ts";
import { blankArmor, blankPage, blankPassive, blankWeapon } from "../../shared/ruleset.ts";
import { NumberInput, TextField } from "./Fields.tsx";
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

/** Hands, resistances, description and Passives of one piece of equipment. */
function EquipmentDetails<T extends Weapon | Armor>({ item, maxCost, onChange, onRemove }: { item: T; maxCost: number; onChange: (item: T) => void; onRemove: () => void }) {
  const set = (patch: Partial<Equipment>) => onChange({ ...item, ...patch });
  return (
    <div className="equip-details">
      {"hands" in item && (
        <label className="inline">
          Hands
          <select value={item.hands} onChange={(e) => onChange({ ...item, hands: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>One-handed</option>
            <option value={2}>Two-handed</option>
          </select>
        </label>
      )}
      {"resistances" in item &&
        (
          [
            ["resistances", "Resistances", "Damage taken is multiplied by these. Lower is tougher."],
            ["staggerResistances", "Stagger resistances", "Stagger damage taken is multiplied by these, the same way."],
          ] as const
        ).map(([field, title, hint]) => (
          <div key={field}>
            <h4>{title}</h4>
            <p className="muted small">{hint}</p>
            <div className="row wrap">
              {(["slash", "pierce", "blunt"] as const).map((k) => {
                const r = item[field] ?? { slash: 1, pierce: 1, blunt: 1 };
                return (
                  <label className="inline" key={k}>
                    {k[0].toUpperCase() + k.slice(1)} ×
                    <NumberInput
                      label={`${field === "resistances" ? "" : "stagger "}${k} resistance`}
                      value={r[k]}
                      step={0.1}
                      min={0}
                      onChange={(v) => onChange({ ...item, [field]: { ...r, [k]: Math.max(0, v) } })}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      <TextField label="Description" value={item.description} onChange={(description) => set({ description })} multiline />
      <PassiveList passives={item.passives} max={maxCost} onChange={(passives) => set({ passives })} />
      <button type="button" className="danger" onClick={onRemove}>
        Remove {"hands" in item ? "weapon" : "armor"}
      </button>
    </div>
  );
}

/** One weapon or armor on the right of the studio: its name, Passives, and its Pages as cards with a + to add one. */
function EquipmentBox<T extends Weapon | Armor>({
  item,
  maxCost,
  selectedPageId,
  onSelectPage,
  onChange,
  onRemove,
}: {
  item: T;
  maxCost: number;
  selectedPageId?: string;
  onSelectPage: (pageId: string) => void;
  onChange: (item: T) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isWeapon = "hands" in item;
  const label = isWeapon ? "Weapon" : "Armor";
  const passiveCost = item.passives.reduce((a, p) => a + p.cost, 0);
  return (
    <section className={`equip-box ${isWeapon ? "weapon" : "armor"}`}>
      <header className="equip-head">
        <span className="equip-kind">{label}</span>
        <input aria-label={`${label} name`} placeholder={`${label} name`} value={item.name} onChange={(e) => onChange({ ...item, name: e.target.value })} />
      </header>
      <button type="button" className="equip-passives" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <strong>Passives</strong>{" "}
        <span className="muted small">
          {item.passives.length ? item.passives.map((p) => p.name || "Unnamed").join(", ") : "none"} · cost {passiveCost}/{maxCost}
          {isWeapon ? ` · ${(item as Weapon).hands === 2 ? "two" : "one"}-handed` : ""}
        </span>
        <span className="equip-toggle">{open ? "▴" : "▾ Details"}</span>
      </button>
      {open && <EquipmentDetails item={item} maxCost={maxCost} onChange={onChange} onRemove={onRemove} />}
      <div className="equip-pages">
        {item.pages.map((p) => (
          <PvCard key={p.id} page={p} size="thumb" selected={p.id === selectedPageId} onClick={() => onSelectPage(p.id)} />
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
  maxCost,
  artFolder,
  canAddWeapon,
  onWeapons,
  onArmor,
}: {
  weapons: Weapon[];
  armor: Armor | null;
  maxCost: number;
  artFolder?: string;
  canAddWeapon: boolean;
  onWeapons: (w: Weapon[]) => void;
  onArmor: (a: Armor | null) => void;
}) {
  const all: (Weapon | Armor)[] = [...weapons, ...(armor ? [armor] : [])];
  const [picked, setPicked] = useState<{ equipId: string; pageId: string } | null>(null);
  const [adding, setAdding] = useState(false);
  // Default to the first Page there is; drop a selection whose Page was removed.
  const current =
    (picked && all.find((e) => e.id === picked.equipId)?.pages.some((p) => p.id === picked.pageId) ? picked : null) ??
    (all.find((e) => e.pages.length) ? { equipId: all.find((e) => e.pages.length)!.id, pageId: all.find((e) => e.pages.length)!.pages[0].id } : null);
  const owner = current ? all.find((e) => e.id === current.equipId) : undefined;
  const page = owner?.pages.find((p) => p.id === current!.pageId);

  const change = (item: Weapon | Armor) => {
    if (armor && item.id === armor.id) onArmor(item as Armor);
    else onWeapons(weapons.map((w) => (w.id === item.id ? (item as Weapon) : w)));
  };
  const remove = (item: Weapon | Armor) => {
    if (armor && item.id === armor.id) onArmor(null);
    else onWeapons(weapons.filter((w) => w.id !== item.id));
  };

  return (
    <div className="equip-studio">
      <div className="equip-editor">
        {page && owner ? (
          <PageCardEditor
            key={page.id}
            page={page}
            artFolder={artFolder}
            onChange={(np) => change({ ...owner, pages: owner.pages.map((p) => (p.id === np.id ? np : p)) })}
            onRemove={() => change({ ...owner, pages: owner.pages.filter((p) => p.id !== page.id) })}
          />
        ) : (
          <p className="muted equip-empty">Add a weapon or armor, then tap + to give it a Page.</p>
        )}
      </div>
      <div className="equip-list">
        <div className="equip-scroll">
          {all.map((item) => (
            <EquipmentBox
              key={item.id}
              item={item}
              maxCost={maxCost}
              selectedPageId={current?.equipId === item.id ? current.pageId : undefined}
              onSelectPage={(pageId) => setPicked({ equipId: item.id, pageId })}
              onChange={change}
              onRemove={() => remove(item)}
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
                  setPicked({ equipId: w.id, pageId: w.pages[0].id });
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
                  setPicked({ equipId: a.id, pageId: a.pages[0].id });
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
