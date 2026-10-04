import { useState } from "react";
import type { Dice, DiceKind, Page, PageType } from "../../../shared/character.ts";
import { blankDice } from "../../../shared/ruleset.ts";
import { friendlyError } from "../../firebase.ts";
import { NumberInput } from "../Fields.tsx";
import { uploadImage } from "../ImageUpload.tsx";
import { DiceIcon, DIE_NAMES, dieClass } from "./DiceIcon.tsx";

export const TYPE_ICONS: Record<PageType, string> = {
  melee: "⚔",
  ranged: "➶",
  massSummation: "✸",
  massIndividual: "✸",
  instant: "⚡",
};

export const TYPE_LABELS: Record<PageType, string> = {
  melee: "Melee",
  ranged: "Ranged",
  massSummation: "Mass Attack (Summation)",
  massIndividual: "Mass Attack (Individual)",
  instant: "Instant",
};

/**
 * A Page as a Library of Ruina card: Light cost, type, name banner, 4:3 art and dice icons.
 * "full" is the left side of the enlarged view, "hand" the cards in a player's hand, "thumb" a small preview.
 */
export function PvCard({
  page,
  size = "full",
  selected,
  dim,
  onClick,
}: {
  page: Page;
  size?: "full" | "hand" | "thumb";
  selected?: boolean;
  /** Can't be used right now (e.g. not enough Light). */
  dim?: boolean;
  onClick?: () => void;
}) {
  const className = `pv-card ${size} ${page.kind}${selected ? " selected" : ""}${dim ? " dim" : ""}`;
  const body = (
    <>
      <div className="pv-top">
        <span className="pv-cost" aria-label={`${page.cost} Light`}>
          {page.cost}
        </span>
        <span className="pv-type" title={TYPE_LABELS[page.type]}>
          {TYPE_ICONS[page.type]}
        </span>
      </div>
      <div className="pv-name">{page.name || "Unnamed"}</div>
      <div className="pv-art">{page.image ? <img src={page.image} alt="" /> : <span className="pc-icon big">{TYPE_ICONS[page.type]}</span>}</div>
      <div className="pv-bottom">
        {page.dice.map((d) => (
          <DiceIcon key={d.id} dice={d} size={size === "thumb" ? 14 : size === "hand" ? 20 : 24} />
        ))}
      </div>
      {size === "full" && (
        <div className="pv-kind">
          {page.kind === "special" ? "Special" : "Basic"} · {TYPE_LABELS[page.type]} · {page.cost} Light
        </div>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-label={`${page.name || "Unnamed Page"}, ${page.cost} Light`} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

const KINDS: DiceKind[] = ["slash", "pierce", "blunt", "block", "evade"];

/** One die on the card being edited: type (tap the icon), Power range, Counter, and its effect. */
function DieEditor({ dice, onChange, onRemove }: { dice: Dice; onChange: (d: Dice) => void; onRemove: () => void }) {
  const lo = 1 + dice.basePower;
  const hi = dice.sides + dice.basePower;
  // Typing a range sets the die: the low end fixes Base Power, the spread fixes the die size.
  const setRange = (min: number, max: number) => {
    const a = Math.round(min);
    const b = Math.max(a, Math.round(max));
    onChange({ ...dice, basePower: a - 1, sides: b - a + 1 });
  };
  return (
    <li className={`pv-edit-die ${dieClass(dice.kind)}`}>
      <span className="die-kind-pick">
        <DiceIcon dice={dice} size={30} />
        <select aria-label="Dice type" value={dice.kind} onChange={(e) => onChange({ ...dice, kind: e.target.value as DiceKind })}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {DIE_NAMES[k]}
            </option>
          ))}
        </select>
      </span>
      <span className="pv-range-edit" title={`1d${dice.sides}${dice.basePower >= 0 ? "+" : ""}${dice.basePower}`}>
        <NumberInput label="Lowest roll" value={lo} onChange={(n) => setRange(n, hi)} />
        <span>-</span>
        <NumberInput label="Highest roll" value={hi} onChange={(n) => setRange(lo, n)} />
      </span>
      <button
        type="button"
        className={"die-counter" + (dice.counter ? " on" : "")}
        aria-pressed={dice.counter}
        title="Counter Die: stored and used against One-Sided attacks"
        onClick={() => onChange({ ...dice, counter: !dice.counter })}
      >
        Counter
      </button>
      <button type="button" className="icon die-remove" aria-label="Remove dice" onClick={onRemove}>
        ✕
      </button>
      <input
        className="die-effect-in"
        aria-label="Dice effect"
        placeholder="Effect, e.g. On Hit: Inflict 1 Fragile"
        value={dice.effect ?? ""}
        onChange={(e) => onChange({ ...dice, effect: e.target.value || undefined })}
      />
    </li>
  );
}

/**
 * Edit a Page right on the card: type the cost and name where they show, tap the art to upload
 * an image, tap a die's icon to change its type, and type its range and effect.
 */
export function PageCardEditor({
  page,
  onChange,
  onRemove,
  artFolder,
}: {
  page: Page;
  onChange: (p: Page) => void;
  onRemove?: () => void;
  /** Where art uploads go; without it the art can't be changed. */
  artFolder?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<Page>) => onChange({ ...page, ...patch });
  return (
    <div className={`pv-card edit full ${page.kind}`}>
      <div className="pv-top">
        <span className="pv-cost edit">
          <NumberInput label="Light cost" value={page.cost} min={0} onChange={(cost) => set({ cost: Math.max(0, Math.round(cost)) })} />
        </span>
        <select className="pv-type-select" aria-label="Page type" value={page.type} onChange={(e) => set({ type: e.target.value as PageType })}>
          {(Object.keys(TYPE_LABELS) as PageType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_ICONS[t]} {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <input className="pv-name pv-name-input" aria-label="Page name" placeholder="Page name" value={page.name} onChange={(e) => set({ name: e.target.value })} />
      {artFolder ? (
        <label className={"pv-art pickable" + (busy ? " busy" : "")} title={page.image ? "Change art" : "Add art"}>
          {page.image ? <img src={page.image} alt="" /> : <span className="pv-art-hint">{busy ? "Uploading…" : "Tap to add art (4:3)"}</span>}
          {busy && page.image && <span className="pv-art-hint over">Uploading…</span>}
          <input
            type="file"
            accept="image/*"
            hidden
            aria-label="Page art"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError("");
              try {
                set({ image: await uploadImage(artFolder, file) });
              } catch (err) {
                setError(friendlyError(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      ) : (
        <div className="pv-art">{page.image ? <img src={page.image} alt="" /> : <span className="pc-icon big">{TYPE_ICONS[page.type]}</span>}</div>
      )}
      {page.image && artFolder && (
        <button type="button" className="link small pv-art-remove" onClick={() => set({ image: undefined })}>
          Remove art
        </button>
      )}
      {error && <span className="error small">{error}</span>}
      <ul className="pv-edit-dice">
        {page.dice.map((d, i) => (
          <DieEditor
            key={d.id}
            dice={d}
            onChange={(nd) => set({ dice: page.dice.map((x, j) => (j === i ? nd : x)) })}
            onRemove={() => set({ dice: page.dice.filter((_, j) => j !== i) })}
          />
        ))}
      </ul>
      <button type="button" className="pv-add-die" onClick={() => set({ dice: [...page.dice, blankDice()] })}>
        + Add dice
      </button>
      <textarea className="pv-effect-in" aria-label="Page effect" placeholder="Page effect (On Use, On Play…)" value={page.effect} onChange={(e) => set({ effect: e.target.value })} />
      <div className="pv-edit-foot">
        <select aria-label="Basic or Special" value={page.kind} onChange={(e) => set({ kind: e.target.value as Page["kind"] })}>
          <option value="basic">Basic Page</option>
          <option value="special">Special Page</option>
        </select>
        {onRemove && (
          <button type="button" className="danger" aria-label="Remove page" onClick={onRemove}>
            Remove Page
          </button>
        )}
      </div>
    </div>
  );
}
