import type { Armor, Dice, DiceKind, Equipment, Page, PageType, Passive, Weapon } from "../../shared/character.ts";
import { blankDice, blankPage, blankPassive } from "../../shared/ruleset.ts";
import { NumberInput, TextField } from "./Fields.tsx";

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

const DIE_SIZES = [4, 6, 8, 10, 12, 20];

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

function DiceRow({ dice, onChange, onRemove }: { dice: Dice; onChange: (d: Dice) => void; onRemove: () => void }) {
  return (
    <div className="dice-row">
      <select aria-label="Dice type" value={dice.kind} onChange={(e) => onChange({ ...dice, kind: e.target.value as DiceKind })}>
        {DICE_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <select aria-label="Roll" value={dice.sides} onChange={(e) => onChange({ ...dice, sides: Number(e.target.value) })}>
        {DIE_SIZES.map((n) => (
          <option key={n} value={n}>
            1d{n}
          </option>
        ))}
      </select>
      <label className="inline">
        +
        <NumberInput label="Base Power" value={dice.basePower} onChange={(basePower) => onChange({ ...dice, basePower: Math.round(basePower) })} />
      </label>
      <label className="inline check">
        <input type="checkbox" checked={dice.counter} onChange={(e) => onChange({ ...dice, counter: e.target.checked })} />
        Counter
      </label>
      <button type="button" className="icon" aria-label="Remove dice" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

export function PageEditor({ page, onChange, onRemove }: { page: Page; onChange: (p: Page) => void; onRemove?: () => void }) {
  return (
    <div className={`page-card ${page.kind}`}>
      <div className="row">
        <input aria-label="Page name" placeholder="Page name" value={page.name} onChange={(e) => onChange({ ...page, name: e.target.value })} />
        {onRemove && (
          <button type="button" className="icon" aria-label="Remove page" onClick={onRemove}>
            ✕
          </button>
        )}
      </div>
      <div className="row wrap">
        <select aria-label="Basic or Special" value={page.kind} onChange={(e) => onChange({ ...page, kind: e.target.value as Page["kind"] })}>
          <option value="basic">Basic Page</option>
          <option value="special">Special Page</option>
        </select>
        <select aria-label="Page type" value={page.type} onChange={(e) => onChange({ ...page, type: e.target.value as PageType })}>
          {PAGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <label className="inline">
          Light cost
          <NumberInput label="Light cost" value={page.cost} min={0} onChange={(cost) => onChange({ ...page, cost: Math.max(0, Math.round(cost)) })} />
        </label>
      </div>
      <h5>Dice (resolved top to bottom)</h5>
      {page.dice.map((d, i) => (
        <DiceRow
          key={d.id}
          dice={d}
          onChange={(nd) => onChange({ ...page, dice: replaceAt(page.dice, i, nd) })}
          onRemove={() => onChange({ ...page, dice: page.dice.filter((_, j) => j !== i) })}
        />
      ))}
      <button type="button" onClick={() => onChange({ ...page, dice: [...page.dice, blankDice()] })}>
        + Add dice
      </button>
      <textarea aria-label="Page effect" placeholder="On Use / On Hit effects" value={page.effect} onChange={(e) => onChange({ ...page, effect: e.target.value })} />
    </div>
  );
}

export function EquipmentEditor<T extends Weapon | Armor>({
  item,
  maxCost,
  onChange,
  onRemove,
}: {
  item: T;
  maxCost: number;
  onChange: (item: T) => void;
  onRemove?: () => void;
}) {
  const set = (patch: Partial<Equipment>) => onChange({ ...item, ...patch });
  return (
    <div className="equipment-card">
      <div className="row-between">
        <TextField label={"hands" in item ? "Weapon name" : "Armor name"} value={item.name} onChange={(name) => set({ name })} />
        {onRemove && (
          <button type="button" className="danger" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {"hands" in item && (
        <label className="inline">
          Hands
          <select value={item.hands} onChange={(e) => onChange({ ...item, hands: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>One-handed</option>
            <option value={2}>Two-handed</option>
          </select>
        </label>
      )}
      {"resistances" in item && (
        <div>
          {(
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
                  const set = item[field] ?? { slash: 1, pierce: 1, blunt: 1 };
                  return (
                    <label className="inline" key={k}>
                      {k[0].toUpperCase() + k.slice(1)} ×
                      <NumberInput
                        label={`${field === "resistances" ? "" : "stagger "}${k} resistance`}
                        value={set[k]}
                        step={0.1}
                        min={0}
                        onChange={(v) => onChange({ ...item, [field]: { ...set, [k]: Math.max(0, v) } })}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <TextField label="Description" value={item.description} onChange={(description) => set({ description })} multiline />
      <PassiveList passives={item.passives} max={maxCost} onChange={(passives) => set({ passives })} />
      <h4>Pages</h4>
      {item.pages.map((p, i) => (
        <PageEditor
          key={p.id}
          page={p}
          onChange={(np) => set({ pages: replaceAt(item.pages, i, np) })}
          onRemove={() => set({ pages: item.pages.filter((_, j) => j !== i) })}
        />
      ))}
      <div className="row">
        <button type="button" onClick={() => set({ pages: [...item.pages, blankPage("basic")] })}>
          + Basic Page
        </button>
        <button type="button" onClick={() => set({ pages: [...item.pages, blankPage("special")] })}>
          + Special Page
        </button>
      </div>
    </div>
  );
}
