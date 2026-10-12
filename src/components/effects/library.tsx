// The game's effect library as character sheets and Page editors use it: Passives, Proficiencies and
// Dice effects are picked from menus of the shared library instead of typed on each sheet.
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { collection, doc, setDoc } from "firebase/firestore";
import type { Dice, Passive, Proficiency } from "../../../shared/character.ts";
import { blankEffect, cleanEffect, effectLibrary, EFFECT_KINDS, isLive, slotPassive, slotProficiency, type EffectDef, type EffectKind } from "../../../shared/effects.ts";
import { useCollection } from "../../api.ts";
import { db, friendlyError } from "../../firebase.ts";
import { Overlay } from "../player/Overlay.tsx";
import { EffectBuilder } from "./EffectBuilder.tsx";

export interface LibraryValue {
  gameId: string;
  /** Built-in effects plus the game's own, by id. */
  library: Record<string, EffectDef>;
  uid: string;
  isGm: boolean;
  /** The GM, or a player whose GM turned on "Players can create effects": their effects work without approval. */
  autoApprove: boolean;
}

/** The effect library, for editors deep in a character sheet or Page. */
export const EffectLibraryContext = createContext<LibraryValue | null>(null);
export const useLibrary = () => useContext(EffectLibraryContext);

/** A game's effect library: the built-in effects plus the game's own, by id. */
export function useEffectLibrary(gameId: string | null): Record<string, EffectDef> {
  const game = useCollection<EffectDef>(gameId ? `games/${gameId}/effects` : null);
  return useMemo(() => effectLibrary(game), [game]);
}

/** The context value for a screen: the library, and who's using it. */
export function useLibraryValue(gameId: string, uid: string | undefined, isGm: boolean, autoApprove = isGm): LibraryValue {
  const library = useEffectLibrary(gameId || null);
  return useMemo(() => ({ gameId, library, uid: uid ?? "", isGm, autoApprove: isGm || autoApprove }), [gameId, library, uid, isGm, autoApprove]);
}

/**
 * Adds an entry to the game's library (a player's is marked as theirs, and waits for the GM's
 * approval unless the GM turned on "Players can create effects"). Returns its id.
 */
export async function addToLibrary(lib: LibraryValue, def: EffectDef): Promise<string> {
  const ref = doc(collection(db, "games", lib.gameId, "effects"));
  const clean = cleanEffect({ ...def, updatedAt: Date.now(), ...(lib.isGm ? {} : { createdBy: lib.uid, approved: lib.autoApprove }) });
  if (!lib.isGm) clean.approved = lib.autoApprove;
  await setDoc(ref, clean);
  return ref.id;
}

const kindInfo = (kind: EffectKind) => EFFECT_KINDS.find((k) => k.value === kind)!;
const automated = (d: EffectDef) => d.rules.length > 0;

/** The library entries of one kind, by name. */
export function entriesOf(library: Record<string, EffectDef>, kind: EffectKind) {
  return Object.entries(library)
    .filter(([, d]) => d.kind === kind)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
}

const NEW = "__new__";

/** Makes a new library entry in a popup, right where it's being slotted, then slots it. */
function NewEffectPopup({ kind, onCreated, onClose }: { kind: EffectKind; onCreated: (id: string, library: Record<string, EffectDef>) => void; onClose: () => void }) {
  const lib = useLibrary()!;
  const [def, setDef] = useState<EffectDef>(() => blankEffect(kind));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = kindInfo(kind);
  return (
    <Overlay title={`New ${info.label}`} onClose={onClose}>
      <EffectBuilder
        def={def}
        library={lib.library}
        onChange={(d) => setDef({ ...d, kind })}
        footer={
          <>
            {error && <span className="error small">{error}</span>}
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="chip go"
              disabled={busy || !def.name.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const id = await addToLibrary(lib, def);
                  onCreated(id, { ...lib.library, [id]: def });
                  onClose();
                } catch (err) {
                  setError(friendlyError(err));
                  setBusy(false);
                }
              }}
            >
              {busy ? "Adding…" : `Add ${info.label}`}
            </button>
          </>
        }
      />
      <p className="muted small">It goes in the game's effect library too, so everyone can use it.{lib.autoApprove ? "" : " An automated one works at the table once your GM approves it."}</p>
    </Overlay>
  );
}

/** A menu of the library's entries of one kind; its last option makes a new one right here. */
function LibrarySelect({
  kind,
  label,
  onPick,
  disabled,
  exclude = [],
  selectRef,
}: {
  kind: EffectKind;
  label: string;
  selectRef?: React.Ref<HTMLSelectElement>;
  /** With the library as it is now, including an entry just made here. */
  onPick: (id: string, library: Record<string, EffectDef>) => void;
  disabled?: boolean;
  exclude?: string[];
}) {
  const lib = useLibrary()!;
  const [making, setMaking] = useState(false);
  const list = entriesOf(lib.library, kind).filter(([id]) => !exclude.includes(id));
  return (
    <div className="library-pick row wrap">
      <select
        ref={selectRef}
        aria-label={label}
        className="piece add"
        value=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === NEW) setMaking(true);
          else if (e.target.value) onPick(e.target.value, lib.library);
        }}
      >
        <option value="">{label}</option>
        {list.map(([id, d]) => (
          <option key={id} value={id}>
            {d.name || "Unnamed"}
            {kind === "passive" ? ` (cost ${d.cost ?? 0})` : ""}
            {automated(d) ? (isLive(d) ? " · automated" : " · waiting for approval") : ""}
          </option>
        ))}
        <option value={NEW}>+ New {kindInfo(kind).label}…</option>
      </select>
      {making && <NewEffectPopup kind={kind} onCreated={onPick} onClose={() => setMaking(false)} />}
    </div>
  );
}

/** One slotted entry: name, cost, what it does, and whether it's automated. */
function SlotRow({
  name,
  cost,
  text,
  def,
  onRemove,
  onSave,
  disabled,
}: {
  name: string;
  cost?: number;
  text: string;
  def?: EffectDef;
  onRemove: () => void;
  onSave?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="slot-row">
      <div className="row-between">
        <strong>{name || "Unnamed"}</strong>
        <span className="row">
          {def && automated(def) && <span className={"chip static" + (isLive(def) ? " ok" : " warn")}>{isLive(def) ? "Automated" : "Waiting for approval"}</span>}
          {cost != null && <span className="chip static">Cost {cost}</span>}
          <button type="button" className="icon" aria-label={`Remove ${name || "it"}`} disabled={disabled} onClick={onRemove}>
            ✕
          </button>
        </span>
      </div>
      {text && <p className="muted small slot-text">{text}</p>}
      {onSave && (
        <p className="small slot-legacy">
          <span className="muted">Not in the effect library yet. </span>
          <button type="button" className="link" disabled={disabled} onClick={onSave}>
            Add it to the library
          </button>
        </p>
      )}
    </div>
  );
}

/** Passives on an Augment, Weapon or Armor: picked from the shared library, up to the max Passive Cost. */
export function PassiveSlots({ passives, max, onChange, disabled }: { passives: Passive[]; max: number; onChange: (p: Passive[]) => void; disabled?: boolean }) {
  const lib = useLibrary();
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
        <SlotRow
          key={p.id}
          name={p.name}
          cost={p.cost}
          text={p.description}
          def={p.effectId ? lib?.library[p.effectId] : undefined}
          disabled={disabled}
          onRemove={() => onChange(passives.filter((_, j) => j !== i))}
          onSave={
            lib && (!p.effectId || !lib.library[p.effectId])
              ? async () => {
                  const id = await addToLibrary(lib, { name: p.name, kind: "passive", cost: p.cost, note: p.description, decay: "none", rules: [] });
                  onChange(passives.map((x, j) => (j === i ? { ...x, effectId: id } : x)));
                }
              : undefined
          }
        />
      ))}
      {lib ? (
        <LibrarySelect kind="passive" label="+ Slot a Passive…" disabled={disabled} onPick={(id, library) => onChange([...passives, slotPassive(id, library)])} />
      ) : null}
      <p className="muted small">Passives are shared by everyone in the game. A negative cost makes a Negative Passive.</p>
    </div>
  );
}

/** A character's Proficiencies, picked from the shared library. */
export function ProficiencySlots({ proficiencies, max, onChange, disabled }: { proficiencies: Proficiency[]; max?: number; onChange: (p: Proficiency[]) => void; disabled?: boolean }) {
  const lib = useLibrary();
  const pick = useRef<HTMLSelectElement>(null);
  const full = max != null && proficiencies.length >= max;
  return (
    <div className="proficiency-slots">
      {proficiencies.map((p, i) => (
        <SlotRow
          key={p.id}
          name={p.name}
          text={p.description}
          def={p.effectId ? lib?.library[p.effectId] : undefined}
          disabled={disabled}
          onRemove={() => onChange(proficiencies.filter((_, j) => j !== i))}
          onSave={
            lib && (!p.effectId || !lib.library[p.effectId]) && p.name.trim()
              ? async () => {
                  const id = await addToLibrary(lib, { name: p.name, kind: "proficiency", note: p.description, decay: "none", rules: [] });
                  onChange(proficiencies.map((x, j) => (j === i ? { ...x, effectId: id } : x)));
                }
              : undefined
          }
        />
      ))}
      {max != null &&
        Array.from({ length: Math.max(0, max - proficiencies.length) }, (_, i) => (
          <button
            type="button"
            className="inv-row empty open-slot"
            key={`empty-${i}`}
            disabled={disabled}
            onClick={() => {
              const el = pick.current;
              if (!el) return;
              el.focus();
              try {
                el.showPicker();
              } catch {
                // Older browsers: focusing the menu is the best we can do.
              }
            }}
          >
            Open Proficiency: tap to pick one
          </button>
        ))}
      {lib && (
        <LibrarySelect
          kind="proficiency"
          selectRef={pick}
          label="+ Pick a Proficiency…"
          disabled={disabled || full}
          exclude={proficiencies.map((p) => p.effectId ?? "")}
          onPick={(id, library) => onChange([...proficiencies, slotProficiency(id, library)])}
        />
      )}
    </div>
  );
}

/** Dice effects slotted on one die of a Page being edited. */
export function DieEffectSlots({ dice, onChange }: { dice: Dice; onChange: (d: Dice) => void }) {
  const lib = useLibrary();
  if (!lib) return null;
  const ids = dice.effectIds ?? [];
  const set = (next: string[]) => {
    const { effectIds: _old, ...rest } = dice;
    onChange(next.length ? { ...rest, effectIds: next } : rest);
  };
  return (
    <div className="die-effects">
      {ids.map((id) => (
        <span key={id} className="chip static die-effect-chip" title={lib.library[id] ? undefined : "Deleted from the effect library"}>
          {lib.library[id]?.name ?? "(deleted)"}
          <button type="button" className="link" aria-label={`Remove ${lib.library[id]?.name ?? "effect"} from this die`} onClick={() => set(ids.filter((x) => x !== id))}>
            ✕
          </button>
        </span>
      ))}
      {ids.length < 3 && <LibrarySelect kind="die" label="+ Slot a Dice effect…" exclude={ids} onPick={(id) => set([...ids, id])} />}
    </div>
  );
}

/** The names of the Dice effects on a die, for showing on its card. */
export function useDieEffectNames(dice: Dice): string[] {
  const lib = useLibrary();
  return (dice.effectIds ?? []).map((id) => lib?.library[id]?.name).filter((n): n is string => !!n);
}

/** The Dice effects on a die, as text on its card. */
export function DieEffectNames({ dice }: { dice: Dice }) {
  const names = useDieEffectNames(dice);
  return names.length ? <span className="die-effect-names"> {names.join(", ")}.</span> : null;
}
