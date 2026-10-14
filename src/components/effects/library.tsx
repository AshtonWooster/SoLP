// The game's effect library as character sheets and Page editors use it: Passives, Proficiencies and
// Dice effects are picked from menus of the shared library instead of typed on each sheet.
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { collection, doc, setDoc } from "firebase/firestore";
import type { Character, Dice, Passive, Proficiency } from "../../../shared/character.ts";
import { canPick, neededBy, pickedIds, statLabel, unmetRequirements } from "../../../shared/proficiencies.ts";
import { blankEffect, cleanEffect, effectLibrary, EFFECT_KINDS, isLive, slotPassive, slotProficiency, type EffectDef, type EffectKind } from "../../../shared/effects.ts";
import { useCollection } from "../../api.ts";
import { db, friendlyError } from "../../firebase.ts";
import { Overlay } from "../player/Overlay.tsx";
import { EffectBuilder, effectText } from "./EffectBuilder.tsx";
import { type NodeState, ProficiencyTree, TreeLegend } from "./ProficiencyTree.tsx";
import { StableLabel } from "../StableLabel.tsx";

export interface LibraryValue {
  gameId: string;
  /** Built-in effects plus the game's own, by id. */
  library: Record<string, EffectDef>;
  uid: string;
  isGm: boolean;
  /** The GM, or a player whose GM turned on "Players can create effects": their effects work without approval. */
  autoApprove: boolean;
  /** The Game setting "Approve changes to the Proficiency tree": a player's new Proficiency waits for the GM. */
  approveProficiencies?: boolean;
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
export function useLibraryValue(gameId: string, uid: string | undefined, isGm: boolean, autoApprove = isGm, approveProficiencies = false): LibraryValue {
  const library = useEffectLibrary(gameId || null);
  return useMemo(
    () => ({ gameId, library, uid: uid ?? "", isGm, autoApprove: isGm || autoApprove, approveProficiencies }),
    [gameId, library, uid, isGm, autoApprove, approveProficiencies],
  );
}

/** Whether a player's change to this entry waits for the GM under "Approve changes to the Proficiency tree". */
export const treeApproval = (lib: Pick<LibraryValue, "isGm" | "approveProficiencies">, kind: EffectKind) => !lib.isGm && !!lib.approveProficiencies && kind === "proficiency";

/**
 * Adds an entry to the game's library (a player's is marked as theirs, and waits for the GM's
 * approval unless the GM turned on "Players can create effects"). Returns its id.
 */
export async function addToLibrary(lib: LibraryValue, def: EffectDef): Promise<string> {
  const ref = doc(collection(db, "games", lib.gameId, "effects"));
  const pending = treeApproval(lib, def.kind);
  const clean = cleanEffect({ ...def, updatedAt: Date.now(), ...(lib.isGm ? {} : { createdBy: lib.uid, approved: lib.autoApprove && !pending, pending }) });
  if (!lib.isGm) clean.approved = lib.autoApprove && !pending;
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
              <StableLabel labels={[`Add ${info.label}`, "Adding…"]} show={busy ? 1 : 0} />
            </button>
          </>
        }
      />
      <p className="muted small">
        It goes in the game's effect library too, so everyone can use it.
        {treeApproval(lib, kind) ? " Your GM approves it before anyone can pick it." : lib.autoApprove ? "" : " An automated one works at the table once your GM approves it."}
      </p>
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
  const list = entriesOf(lib.library, kind).filter(([id, d]) => !exclude.includes(id) && !d.pending);
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
  unmet,
  onRemove,
  onSave,
  disabled,
}: {
  name: string;
  cost?: number;
  text: string;
  def?: EffectDef;
  /** Proficiencies: requirements this character doesn't meet. */
  unmet?: string[];
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
      {unmet && unmet.length > 0 && <p className="warn-text small">{unmet.join(" · ")}</p>}
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

/** The Stats and Proficiencies a player's picks are checked against. */
export type ProficiencySheet = Pick<Character, "primary" | "secondary" | "rank">;

/**
 * A character's Proficiencies, picked from the shared library. A player's (with `sheet` and `max`)
 * are picked on the Proficiency tree, which checks each one's prerequisites and Stats; a GM's
 * character picks any of them from a menu.
 */
export function ProficiencySlots({
  proficiencies,
  max,
  onChange,
  disabled,
  sheet,
}: {
  proficiencies: Proficiency[];
  max?: number;
  onChange: (p: Proficiency[]) => void;
  disabled?: boolean;
  sheet?: ProficiencySheet;
}) {
  const lib = useLibrary();
  const pick = useRef<HTMLSelectElement>(null);
  const [tree, setTree] = useState(false);
  const full = max != null && proficiencies.length >= max;
  const onTree = !!lib && !!sheet && max != null;
  const remove = (i: number) => {
    const p = proficiencies[i];
    const needs = lib && p.effectId ? neededBy({ proficiencies }, p.effectId, lib.library) : [];
    // Taking away a prerequisite is allowed (the sheet's checks flag what it breaks), but say so first.
    if (needs.length && !window.confirm(`${needs.join(", ")} need${needs.length === 1 ? "s" : ""} ${p.name || "this"}. Remove it anyway?`)) return;
    onChange(proficiencies.filter((_, j) => j !== i));
  };
  return (
    <div className="proficiency-slots">
      {proficiencies.map((p, i) => (
        <SlotRow
          key={p.id}
          name={p.name}
          text={p.description}
          def={p.effectId ? lib?.library[p.effectId] : undefined}
          unmet={onTree && p.effectId && lib.library[p.effectId] ? unmetRequirements(sheet, lib.library[p.effectId], pickedIds({ proficiencies }), lib.library) : undefined}
          disabled={disabled}
          onRemove={() => remove(i)}
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
              if (onTree) return setTree(true);
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
      {onTree ? (
        <button type="button" className="chip go tree-open" onClick={() => setTree(true)}>
          Open the Proficiency tree
        </button>
      ) : (
        lib && (
          <LibrarySelect
            kind="proficiency"
            selectRef={pick}
            label="+ Pick a Proficiency…"
            disabled={disabled || full}
            exclude={proficiencies.map((p) => p.effectId ?? "")}
            onPick={(id, library) => onChange([...proficiencies, slotProficiency(id, library)])}
          />
        )
      )}
      {tree && onTree && (
        <TreePicker
          proficiencies={proficiencies}
          sheet={sheet}
          max={max}
          disabled={disabled}
          onChange={onChange}
          onRemove={(id) => {
            const i = proficiencies.findIndex((p) => p.effectId === id);
            if (i >= 0) remove(i);
          }}
          onClose={() => setTree(false)}
        />
      )}
    </div>
  );
}

/** The Proficiency tree in a popup: tap a node to see it, then pick it if its requirements are met. */
function TreePicker({
  proficiencies,
  sheet,
  max,
  disabled,
  onChange,
  onRemove,
  onClose,
}: {
  proficiencies: Proficiency[];
  sheet: ProficiencySheet;
  max: number;
  disabled?: boolean;
  onChange: (p: Proficiency[]) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const lib = useLibrary()!;
  const [selected, setSelected] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const c = { ...sheet, proficiencies };
  const have = pickedIds(c);
  const stateOf = (id: string, d: EffectDef): NodeState =>
    have.includes(id) ? "picked" : d.pending ? "pending" : unmetRequirements(sheet, d, have, lib.library).length ? "locked" : "open";
  const def = selected ? lib.library[selected] : undefined;
  const check = selected ? canPick(c, selected, lib.library, max) : undefined;
  return (
    <Overlay title="Proficiency tree" onClose={onClose}>
      <div className="tree-picker">
        <p className="muted small">
          {proficiencies.length} of {max} picked at Rank {sheet.rank}. You get 2 at Rank 9 and 2 more at each Rank Up. Tap one to see what it does and needs.
        </p>
        <ProficiencyTree library={lib.library} stateOf={stateOf} selected={selected} onSelect={setSelected} />
        <TreeLegend picking />
        {def && selected && (
          <div className="effect-card prof-detail" aria-label="Proficiency">
            <strong>{def.name || "Unnamed"}</strong>
            <p>{effectText(def, lib.library) || "No description yet."}</p>
            {def.page && <p className="small">Adds the Page <strong>{def.page.name || "Unnamed"}</strong> to your Auxiliary Deck.</p>}
            <RequirementList def={def} sheet={c} library={lib.library} />
            <div className="row wrap">
              {have.includes(selected) ? (
                <button type="button" disabled={disabled} onClick={() => onRemove(selected)}>
                  Remove it
                </button>
              ) : (
                <button
                  type="button"
                  className="chip go"
                  disabled={disabled || !check?.ok}
                  onClick={() => onChange([...proficiencies, slotProficiency(selected, lib.library)])}
                >
                  Pick {def.name || "it"}
                </button>
              )}
              {check && !check.ok && !have.includes(selected) && <span className="muted small">{check.why[0]}</span>}
            </div>
          </div>
        )}
        <button type="button" className="link" onClick={() => setMaking(true)}>
          + Add a Proficiency to the tree
        </button>
      </div>
      {making && <NewEffectPopup kind="proficiency" onCreated={(id) => setSelected(id)} onClose={() => setMaking(false)} />}
    </Overlay>
  );
}

/** What a Proficiency needs, each marked met or not for this character. */
export function RequirementList({ def, sheet, library }: { def: EffectDef; sheet?: Pick<Character, "primary" | "secondary" | "proficiencies">; library: Record<string, EffectDef> }) {
  const reqs = (def.requires ?? []).filter((r) => library[r]);
  const stats = Object.entries(def.minStats ?? {});
  if (!reqs.length && !stats.length) return <p className="muted small">Needs nothing first.</p>;
  const have = sheet ? pickedIds(sheet) : [];
  const unmet = sheet ? unmetRequirements(sheet, def, have, library) : [];
  const mark = (text: string) => (sheet ? (unmet.includes(text) ? "✗ " : "✓ ") : "");
  return (
    <ul className="prof-reqs small">
      {reqs.map((r) => {
        const text = `Needs ${library[r].name || "an unnamed Proficiency"}`;
        return (
          <li key={r} className={sheet ? (unmet.includes(text) ? "warn-text" : "ok-text") : ""}>
            {mark(text)}
            {text}
          </li>
        );
      })}
      {stats.map(([k, v]) => {
        const text = `Needs ${statLabel(k)} ${v}`;
        return (
          <li key={k} className={sheet ? (unmet.includes(text) ? "warn-text" : "ok-text") : ""}>
            {mark(text)}
            {text}
          </li>
        );
      })}
    </ul>
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
