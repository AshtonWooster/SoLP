import type { Character, InventoryItem } from "../../shared/character.ts";
import { blankItem, isUsable, useItemIn } from "../../shared/ruleset.ts";
import { PageEditor } from "./EquipmentEditor.tsx";
import { NumberInput, Stepper, TextField } from "./Fields.tsx";

const KINDS: { value: InventoryItem["kind"]; label: string; hint: string }[] = [
  { value: "item", label: "Item", hint: "Material, Ammo or story piece" },
  { value: "tool", label: "Tool", hint: "Adds its Page to the Auxiliary Deck" },
  { value: "trinket", label: "Trinket", hint: "Only active in the Trinket Slot" },
];

/** Usable / Consumable / Max uses: set by the GM, shown to the player. */
function UseControls({ item, isGm, onChange, onUse }: { item: InventoryItem; isGm: boolean; onChange: (i: InventoryItem) => void; onUse?: () => void }) {
  const usable = isUsable(item);
  const max = Math.max(1, item.maxUses ?? 1);
  const left = item.uses ?? max;
  return (
    <div className="row wrap use-controls">
      {isGm ? (
        <>
          {item.kind !== "tool" && (
            <label className="inline check">
              <input type="checkbox" checked={!!item.usable} onChange={(e) => onChange({ ...item, usable: e.target.checked })} />
              Usable
            </label>
          )}
          {usable && (
            <label className="inline check">
              <input
                type="checkbox"
                checked={!!item.consumable}
                onChange={(e) => onChange({ ...item, consumable: e.target.checked, maxUses: max, uses: max })}
              />
              Consumable
            </label>
          )}
          {usable && item.consumable && (
            <label className="inline">
              Max uses
              <NumberInput label="Max uses" value={max} min={1} onChange={(n) => onChange({ ...item, maxUses: Math.max(1, Math.round(n)), uses: Math.max(1, Math.round(n)) })} />
            </label>
          )}
          <span className="muted small">(GM only)</span>
        </>
      ) : (
        usable && <span className="badge-soft">{item.kind === "tool" ? "Used from the Auxiliary Deck" : "Usable"}</span>
      )}
      {usable && item.consumable && (
        <span className="muted small">
          {left} of {max} use{max === 1 ? "" : "s"} left{item.stacking ? ` on this one (×${item.count})` : ""}
        </span>
      )}
      {onUse && (
        <button type="button" onClick={onUse}>
          Use
        </button>
      )}
    </div>
  );
}

function ItemCard({
  item,
  isGm,
  onChange,
  onRemove,
  onEquip,
  onUse,
}: {
  item: InventoryItem;
  isGm: boolean;
  onChange: (i: InventoryItem) => void;
  onRemove: () => void;
  onEquip?: () => void;
  onUse?: () => void;
}) {
  return (
    <div className={`item-card ${item.kind}`}>
      <div className="row">
        <input aria-label="Item name" placeholder="Name" value={item.name} onChange={(e) => onChange({ ...item, name: e.target.value })} />
        <select
          aria-label="Kind"
          value={item.kind}
          onChange={(e) => {
            const kind = e.target.value as InventoryItem["kind"];
            onChange({ ...blankItem(kind), ...item, kind, page: kind === "tool" ? item.page ?? blankItem("tool").page : item.page });
          }}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <button type="button" className="icon" aria-label="Remove item" onClick={onRemove}>
          ✕
        </button>
      </div>
      <p className="muted small">{KINDS.find((k) => k.value === item.kind)?.hint}</p>
      <textarea aria-label="Item description" placeholder="Description" value={item.description} onChange={(e) => onChange({ ...item, description: e.target.value })} />
      <div className="row wrap">
        <label className="inline check">
          <input type="checkbox" checked={item.stacking} onChange={(e) => onChange({ ...item, stacking: e.target.checked, count: 1, maxStack: e.target.checked ? Math.max(item.maxStack, 2) : 1 })} />
          Stacking
        </label>
        {item.stacking && (
          <>
            <span className="inline">
              Count
              <Stepper label="count" value={item.count} min={1} max={item.maxStack} onChange={(count) => onChange({ ...item, count })} />
            </span>
            <label className="inline">
              Max stack
              <NumberInput label="Max stack" value={item.maxStack} min={1} onChange={(n) => onChange({ ...item, maxStack: Math.max(1, Math.round(n)), count: Math.min(item.count, Math.max(1, Math.round(n))) })} />
            </label>
          </>
        )}
        {onEquip && (
          <button type="button" onClick={onEquip}>
            Equip as Trinket
          </button>
        )}
      </div>
      <UseControls item={item} isGm={isGm} onChange={onChange} onUse={onUse} />
      {item.kind === "tool" && item.page && (
        <>
          <h5>Tool Page</h5>
          <PageEditor page={item.page} onChange={(page) => onChange({ ...item, page })} />
        </>
      )}
    </div>
  );
}

/** Inventory (Act 7): Slots of Items and Tools, plus the one Trinket Slot. */
export function InventoryEditor({
  c,
  canSetSlots,
  update,
}: {
  c: Character;
  canSetSlots: boolean;
  update: (fn: (d: Character) => void) => void;
}) {
  const inv = c.inventory;
  const full = inv.items.length >= inv.slotCount;
  return (
    <div className="inventory">
      <div className="trinket-slot">
        <h3>Trinket Slot</h3>
        {inv.trinket ? (
          <div className="item-card trinket equipped">
            <div className="row-between">
              <strong>{inv.trinket.name || "Unnamed Trinket"}</strong>
              <button
                type="button"
                disabled={full}
                title={full ? "No free Slot to put it in" : undefined}
                onClick={() =>
                  update((d) => {
                    d.inventory.items.push(d.inventory.trinket!);
                    d.inventory.trinket = null;
                  })
                }
              >
                Unequip
              </button>
            </div>
            <TextField label="Benefit (always active)" multiline value={inv.trinket.description} onChange={(v) => update((d) => void (d.inventory.trinket!.description = v))} />
          </div>
        ) : (
          <p className="muted">Empty. Add a Trinket to your Inventory, then equip it here.</p>
        )}
      </div>

      <div className="row-between">
        <h3>
          Slots <span className={inv.items.length > inv.slotCount ? "error" : "muted"}>· {inv.items.length} of {inv.slotCount} used</span>
        </h3>
        {canSetSlots && (
          <span className="inline">
            Slot count
            <Stepper label="slot count" value={inv.slotCount} min={1} max={40} onChange={(n) => update((d) => void (d.inventory.slotCount = n))} />
          </span>
        )}
      </div>
      {inv.items.length === 0 && <p className="muted">Nothing here yet.</p>}
      {inv.items.map((item, i) => (
        <ItemCard
          key={item.id}
          item={item}
          isGm={canSetSlots}
          onChange={(ni) => update((d) => void (d.inventory.items[i] = ni))}
          onRemove={() => update((d) => void d.inventory.items.splice(i, 1))}
          onUse={item.kind !== "tool" && isUsable(item) ? () => update((d) => void (d.inventory.items = useItemIn(d.inventory.items, item.id))) : undefined}
          onEquip={
            item.kind === "trinket"
              ? () =>
                  update((d) => {
                    // Swap with whatever Trinket was equipped.
                    const [picked] = d.inventory.items.splice(i, 1);
                    if (d.inventory.trinket) d.inventory.items.splice(i, 0, d.inventory.trinket);
                    d.inventory.trinket = picked;
                  })
              : undefined
          }
        />
      ))}
      <div className="row wrap">
        {KINDS.map((k) => (
          <button key={k.value} type="button" disabled={full} onClick={() => update((d) => void d.inventory.items.push(blankItem(k.value)))}>
            + {k.label}
          </button>
        ))}
      </div>
      {full && <p className="muted small">All Slots are full.</p>}
    </div>
  );
}
