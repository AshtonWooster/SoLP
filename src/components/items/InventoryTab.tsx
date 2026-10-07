import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { Character, InventoryItem, ItemTemplate } from "../../../shared/character.ts";
import { addFromLibrary, isUsable, ITEM_KINDS, linkInventory, useItemIn } from "../../../shared/ruleset.ts";
import { NumberInput, Stepper } from "../Fields.tsx";
import { PEEK_WIDTH, peekPosition } from "../peek.ts";
import { ItemCard, ItemKindIcon } from "./ItemCard.tsx";

type Peek = { item: InventoryItem | ItemTemplate; top: number; left: number } | null;

function peekAt(el: HTMLElement, item: InventoryItem | ItemTemplate): Peek {
  return { item, ...peekPosition(el) };
}

function InventoryRow({
  item,
  canEdit,
  equipped,
  onPeek,
  onCount,
  onRemove,
  onEquip,
  onUse,
}: {
  item: InventoryItem;
  canEdit: boolean;
  equipped?: boolean;
  onPeek: (p: Peek) => void;
  onCount?: (n: number) => void;
  onRemove?: () => void;
  onEquip?: () => void;
  onUse?: () => void;
}) {
  const show = (e: React.SyntheticEvent<HTMLElement>) => onPeek(peekAt(e.currentTarget, item));
  return (
    <div className={`inv-row kind-${item.kind}${equipped ? " equipped" : ""}`} onMouseEnter={show} onMouseLeave={() => onPeek(null)}>
      <span className="inv-count" title={item.stacking ? `${item.count} of ${item.maxStack} in this Slot` : undefined}>
        {item.stacking ? item.count : 1}
      </span>
      <ItemKindIcon kind={item.kind} size={20} />
      <button type="button" className="inv-name" onClick={show} onFocus={show} onBlur={() => onPeek(null)}>
        {item.name || "Unnamed"}
        {item.consumable && (
          <span className="muted small">
            {" "}
            · {item.uses ?? item.maxUses ?? 1}/{item.maxUses ?? 1} uses
          </span>
        )}
      </button>
      {canEdit && (
        <span className="inv-actions">
          {item.stacking && onCount && <Stepper label={`${item.name || "item"} count`} value={item.count} min={1} max={item.maxStack} onChange={onCount} />}
          {onEquip && (
            <button type="button" className="icon" title={equipped ? "Unequip" : "Equip in the Trinket Slot"} aria-label={equipped ? `Unequip ${item.name}` : `Equip ${item.name}`} onClick={onEquip}>
              {equipped ? "⇣" : "⇡"}
            </button>
          )}
          {onUse && (
            <button type="button" className="icon" title="Use" aria-label={`Use ${item.name}`} onClick={onUse}>
              Use
            </button>
          )}
          {onRemove && (
            <button type="button" className="icon" aria-label={`Remove ${item.name || "item"}`} onClick={onRemove}>
              ✕
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * The Inventory tab: the character's Trinket Slot and Slots as a slim list on the left (hover a
 * row for its full card), and the GM's item library on the right to add from. Players can only
 * add the GM's items; the GM can also change the number of Slots.
 */
export function InventoryTab({
  c,
  library,
  gameId,
  isGm,
  canEdit,
  update,
  canMakeItems,
}: {
  /** The GM lets players make items (game settings): link to the item library. */
  canMakeItems?: boolean;
  c: Character;
  library: Record<string, ItemTemplate> | undefined;
  gameId: string;
  isGm: boolean;
  canEdit: boolean;
  update: (fn: (d: Character) => void) => void;
}) {
  const inv = linkInventory(c, library).inventory;
  const [peek, setPeek] = useState<Peek>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<InventoryItem["kind"] | "all">("all");
  const [message, setMessage] = useState("");
  const held = (templateId: string) => inv.items.filter((i) => i.templateId === templateId).reduce((n, i) => n + i.count, 0) + (inv.trinket?.templateId === templateId ? 1 : 0);
  const entries = useMemo(
    () =>
      Object.entries(library ?? {})
        .filter(([, t]) => (kind === "all" || t.kind === kind) && t.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => a[1].name.localeCompare(b[1].name)),
    [library, kind, search],
  );
  const empty = Math.max(0, inv.slotCount - inv.items.length);

  const add = (templateId: string, t: ItemTemplate) => {
    let error = "";
    update((d) => {
      const r = addFromLibrary(d.inventory, templateId, t);
      if ("error" in r) error = r.error;
      else d.inventory.items = r.items;
    });
    setMessage(error || `Added ${t.name || "the item"}.`);
  };

  return (
    <div className="inv-tab">
      <aside className="inv-list" aria-label="Inventory">
        <div className="inv-head">
          <h3>Inventory</h3>
          <span className={inv.items.length > inv.slotCount ? "error" : "muted"}>
            {inv.items.length} / {inv.slotCount} Slots
          </span>
        </div>
        <label className="inv-ahn">
          <span>Ahn</span>
          {canEdit ? <NumberInput label="Ahn" value={c.ahn ?? 0} min={0} onChange={(n) => update((d) => void (d.ahn = Math.max(0, Math.round(n))))} /> : <strong>{c.ahn ?? 0}</strong>}
        </label>
        {isGm && (
          <span className="inline small inv-slots">
            Slots
            <Stepper label="slot count" value={inv.slotCount} min={1} max={40} onChange={(n) => update((d) => void (d.inventory.slotCount = n))} />
          </span>
        )}

        <div className="inv-section">Trinket Slot</div>
        {inv.trinket ? (
          <InventoryRow
            item={inv.trinket}
            canEdit={canEdit}
            equipped
            onPeek={setPeek}
            onEquip={
              inv.items.length < inv.slotCount
                ? () =>
                    update((d) => {
                      d.inventory.items.push(d.inventory.trinket!);
                      d.inventory.trinket = null;
                    })
                : undefined
            }
          />
        ) : (
          <div className="inv-row empty">No Trinket equipped</div>
        )}

        <div className="inv-section">Slots</div>
        {inv.items.map((item, i) => (
          <InventoryRow
            key={item.id}
            item={item}
            canEdit={canEdit}
            onPeek={setPeek}
            onCount={(n) => update((d) => void (d.inventory.items[i].count = n))}
            onRemove={() => update((d) => void d.inventory.items.splice(i, 1))}
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
            onUse={item.consumable && isUsable(item) ? () => update((d) => void (d.inventory.items = useItemIn(inv.items, item.id))) : undefined}
          />
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <div className="inv-row empty" key={`empty-${i}`}>
            Empty Slot
          </div>
        ))}
      </aside>

      <section className="inv-library" aria-label="Item library">
        <div className="inv-library-head">
          <h3>{isGm ? "Your items" : "The GM's items"}</h3>
          {isGm ? <Link to={`/games/${gameId}/items`}>Edit the item library ↗</Link> : canMakeItems && <Link to={`/games/${gameId}/items`}>Make an item ↗</Link>}
        </div>
        <div className="row wrap library-filters">
          <input aria-label="Search items" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
          {(["all", ...ITEM_KINDS.map((k) => k.value)] as const).map((k) => (
            <button key={k} type="button" className={"chip" + (kind === k ? " active" : "")} onClick={() => setKind(k)}>
              {k === "all" ? "All" : ITEM_KINDS.find((x) => x.value === k)!.label}
            </button>
          ))}
        </div>
        {message && (
          <p className={"small " + (/full/.test(message) ? "error" : "muted")} role="status">
            {message}
          </p>
        )}
        {library === undefined ? (
          <p className="muted">Loading items…</p>
        ) : Object.keys(library).length === 0 ? (
          <p className="muted">{isGm ? "No items yet. Make some in the item library." : "Your GM hasn't made any items yet."}</p>
        ) : (
          <div className="library-grid">
            {entries.map(([tid, t]) => {
              const n = held(tid);
              return (
                <div key={tid} className="library-pick" onMouseEnter={(e) => setPeek(peekAt(e.currentTarget, t))} onMouseLeave={() => setPeek(null)}>
                  <ItemCard item={t} size="thumb" note={n ? `In inventory ×${n}` : undefined} onClick={canEdit ? () => add(tid, t) : undefined} />
                </div>
              );
            })}
          </div>
        )}
        {canEdit && Object.keys(library ?? {}).length > 0 && <p className="muted small">Click an item to add one to your inventory.</p>}
      </section>

      {peek &&
        createPortal(
          <div className="inv-peek" style={{ top: peek.top, left: peek.left, width: PEEK_WIDTH }} aria-hidden="true">
            <ItemCard item={peek.item} />
          </div>,
          document.body,
        )}
    </div>
  );
}
