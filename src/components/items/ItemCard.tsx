import type { InventoryItem, ItemTemplate, PageType } from "../../../shared/character.ts";
import { DieEffectNames } from "../effects/library.tsx";
import { blankDice, blankTemplate, ITEM_KINDS } from "../../../shared/ruleset.ts";
import { ConfirmButton } from "../ConfirmButton.tsx";
import { NumberInput } from "../Fields.tsx";
import { DiceIcon, DIE_NAMES, dieClass, dieRange } from "../player/DiceIcon.tsx";
import { ArtPicker, DieEditor, TYPE_ICONS, TYPE_LABELS } from "../player/LorCard.tsx";

type ItemLike = ItemTemplate | InventoryItem;
type Kind = InventoryItem["kind"];

const KIND_PATHS: Record<Kind, string> = {
  // A gem for Trinkets, a flask for Usable items, a crate for everything else.
  trinket: "M7 4 H17 L21 9 L12 21 L3 9 Z M3 9 H21 M9 4 L12 9 L15 4 M12 9 V21",
  tool: "M9 3 H15 M10 3 V9 L5 18 C4 20 5 21 7 21 H17 C19 21 20 20 19 18 L14 9 V3 M7.5 14 H16.5",
  item: "M4 8 L12 4 L20 8 V17 L12 21 L4 17 Z M4 8 L12 12 L20 8 M12 12 V21",
};

export const kindLabel = (k: Kind) => ITEM_KINDS.find((x) => x.value === k)?.label ?? "Item";

/** The item's type as a small icon: Trinket (gem), Usable (flask) or Item (crate). */
export function ItemKindIcon({ kind, size = 20 }: { kind: Kind; size?: number }) {
  return (
    <span className={`item-kind-icon ${kind}`} style={{ width: size, height: size }} title={kindLabel(kind)} aria-label={kindLabel(kind)} role="img">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={KIND_PATHS[kind]} />
      </svg>
    </span>
  );
}

/**
 * An item as a card, like a Page: Usable items show their Light cost, type and dice; other Items
 * and Trinkets show their description. "full" lists everything; "thumb" is a small preview.
 */
export function ItemCard({ item, size = "full", onClick, selected, note }: { item: ItemLike; size?: "full" | "thumb"; onClick?: () => void; selected?: boolean; note?: string }) {
  const usable = item.kind === "tool" && item.page;
  const page = item.page;
  const className = `pv-card item-card-ui ${size} kind-${item.kind}${selected ? " selected" : ""}`;
  const body = (
    <>
      <div className="pv-top">
        {usable ? (
          <span className="pv-cost" aria-label={`${page!.cost} Light`}>
            {page!.cost}
          </span>
        ) : (
          <ItemKindIcon kind={item.kind} size={size === "thumb" ? 18 : 24} />
        )}
        <span className="item-kind-label">
          {usable && <ItemKindIcon kind="tool" size={size === "thumb" ? 14 : 18} />}
          {kindLabel(item.kind)}
        </span>
      </div>
      <div className="pv-name">{item.name || "Unnamed"}</div>
      <div className="pv-art">{item.image ? <img src={item.image} alt="" /> : <ItemKindIcon kind={item.kind} size={size === "thumb" ? 34 : 64} />}</div>
      {usable && page!.dice.length > 0 && (
        <div className="pv-bottom">
          {page!.dice.map((d) => (
            <DiceIcon key={d.id} dice={d} size={size === "thumb" ? 14 : 22} />
          ))}
        </div>
      )}
      {size === "full" && (
        <div className="item-card-body">
          {usable && (
            <>
              <div className="muted small">
                {TYPE_ICONS[page!.type]} {TYPE_LABELS[page!.type]} · {page!.cost} Light
              </div>
              {page!.effect && <p className="pv-page-effect">{page!.effect}</p>}
              <ul className="pv-dice-list compact">
                {page!.dice.map((d) => (
                  <li key={d.id} className={dieClass(d.kind)}>
                    <DiceIcon dice={d} size={24} />
                    <span className="pv-range">{dieRange(d)}</span>
                    <span className="pv-die-text">
                      {d.counter && <span className="pv-counter">Counter {DIE_NAMES[d.kind]}. </span>}
                      {d.effect}
                      <DieEffectNames dice={d} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {item.description && <p className="item-desc">{item.description}</p>}
          <div className="item-tags">
            {item.stacking ? <span className="badge-soft">Stacks to {item.maxStack}</span> : <span className="badge-soft">One per Slot</span>}
            {item.consumable && <span className="badge-soft">{item.maxUses ?? 1} use{(item.maxUses ?? 1) === 1 ? "" : "s"}</span>}
            {item.kind === "trinket" && <span className="badge-soft">Active in the Trinket Slot</span>}
          </div>
        </div>
      )}
      {note && <div className="item-note">{note}</div>}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-pressed={selected} aria-label={`${item.name || "Unnamed item"} (${kindLabel(item.kind)})`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Edit a library item right on its card: pick its type, type the name, tap the art to upload.
 * Usable items get a cost, type and dice like any Page; others get a description.
 */
export function ItemCardEditor({ item, onChange, onRemove, artFolder }: { item: ItemTemplate; onChange: (t: ItemTemplate) => void; onRemove?: () => void; artFolder?: string }) {
  const set = (patch: Partial<ItemTemplate>) => onChange({ ...item, ...patch });
  const usable = item.kind === "tool";
  const page = item.page ?? blankTemplate("tool").page!;
  const setPage = (patch: Partial<typeof page>) => set({ page: { ...page, ...patch } });
  return (
    <div className={`pv-card edit full item-card-ui kind-${item.kind}`}>
      <div className="pv-top">
        {usable ? (
          <span className="pv-cost edit">
            <NumberInput label="Light cost" value={page.cost} min={0} onChange={(cost) => setPage({ cost: Math.max(0, Math.round(cost)) })} />
          </span>
        ) : (
          <ItemKindIcon kind={item.kind} size={26} />
        )}
        <select
          className="pv-type-select"
          aria-label="Item type"
          value={item.kind}
          onChange={(e) => {
            const kind = e.target.value as Kind;
            set({ kind, ...(kind === "tool" ? { page } : {}), ...(kind !== "tool" ? { consumable: false } : {}) });
          }}
        >
          {ITEM_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small item-kind-hint">{ITEM_KINDS.find((k) => k.value === item.kind)?.hint}</p>
      <input className="pv-name pv-name-input" aria-label="Item name" placeholder="Item name" value={item.name} onChange={(e) => set({ name: e.target.value })} />
      <ArtPicker folder={artFolder} image={item.image} fallback="✦" onChange={(image) => set({ image })} />
      {usable && (
        <>
          <label className="inline small">
            Page type
            <select aria-label="Page type" value={page.type} onChange={(e) => setPage({ type: e.target.value as PageType })}>
              {(Object.keys(TYPE_LABELS) as PageType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_ICONS[t]} {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <ul className="pv-edit-dice">
            {page.dice.map((d, i) => (
              <DieEditor
                key={d.id}
                dice={d}
                onChange={(nd) => setPage({ dice: page.dice.map((x, j) => (j === i ? nd : x)) })}
                onRemove={() => setPage({ dice: page.dice.filter((_, j) => j !== i) })}
              />
            ))}
          </ul>
          <button type="button" className="pv-add-die" onClick={() => setPage({ dice: [...page.dice, blankDice()] })}>
            + Add dice
          </button>
          <textarea className="pv-effect-in" aria-label="Page effect" placeholder="Page effect (On Use…)" value={page.effect} onChange={(e) => setPage({ effect: e.target.value })} />
        </>
      )}
      <textarea
        className="pv-effect-in item-desc-in"
        aria-label="Item description"
        placeholder={usable ? "Description (optional)" : "What it is or does"}
        value={item.description}
        onChange={(e) => set({ description: e.target.value })}
      />
      <div className="item-edit-opts">
        <label className="inline check">
          <input type="checkbox" checked={item.stacking} onChange={(e) => set({ stacking: e.target.checked, maxStack: e.target.checked ? Math.max(item.maxStack, 5) : 1 })} />
          Stacking
        </label>
        {item.stacking && (
          <label className="inline">
            Max per Slot
            <NumberInput label="Max stack" value={item.maxStack} min={1} onChange={(n) => set({ maxStack: Math.max(1, Math.round(n)) })} />
          </label>
        )}
        {usable && (
          <label className="inline check">
            <input type="checkbox" checked={!!item.consumable} onChange={(e) => set({ consumable: e.target.checked, maxUses: Math.max(1, item.maxUses ?? 1) })} />
            Consumable
          </label>
        )}
        {usable && item.consumable && (
          <label className="inline">
            Uses
            <NumberInput label="Max uses" value={item.maxUses ?? 1} min={1} onChange={(n) => set({ maxUses: Math.max(1, Math.round(n)) })} />
          </label>
        )}
      </div>
      {onRemove && (
        <div className="pv-edit-foot">
          <span className="muted small">Changes reach every inventory holding it.</span>
          <ConfirmButton className="danger" confirmLabel="Confirm delete" onConfirm={onRemove}>
            Delete item
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
