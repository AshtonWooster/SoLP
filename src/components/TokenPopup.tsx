import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Page } from "../../shared/character.ts";
import { newId } from "../../shared/engine.ts";
import { isLive } from "../../shared/effects.ts";
import { NPC_SIDES } from "../../shared/ruleset.ts";
import { isSecret, SHEET_PARTS, withheld, type SheetPart } from "../../shared/secrets.ts";
import type { TokenGear } from "../../shared/tokenPreview.ts";
import type { Resources, TableAction, Token } from "../../shared/types.ts";
import { effectText } from "./effects/EffectBuilder.tsx";
import { useEffectLibrary } from "./effects/library.tsx";
import { RESOURCES, ResourceIcon } from "./LorIcons.tsx";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { NumberField } from "./NumberField.tsx";
import { Portrait } from "./player/CombatViews.tsx";
import { PageCard } from "./player/PageCard.tsx";
import { PageView } from "./player/PageView.tsx";
import { useDrag } from "./drag.ts";

/** What only the GM gets in the popup: quick adjustments, notes, and removing the token. */
export interface GmControls {
  act: (action: TableAction) => boolean;
  note: string;
  /** The character page (players) or the character editor (GM characters). */
  sheetHref?: string;
  onRemoved: () => void;
}

/**
 * A character's preview, popped up over the map when their token is clicked: resources, gear,
 * Combat Deck and effects. Read-only unless `gm` is given. `gear` is left out where the viewer
 * shouldn't see it (a GM character's deck, for players).
 */
export function TokenPopup({ token, gear, gm, onClose }: { token: Token; gear?: TokenGear; gm?: GmControls; onClose: () => void }) {
  const [viewing, setViewing] = useState<Page | null>(null);
  const drag = useDrag();
  useEffect(() => {
    // Escape closes the popup, unless a Page opened from it is on top.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".overlay") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const r = token.resources;
  const set = (key: keyof Resources, value: number) => gm?.act({ type: "setResources", tokenId: token.id, patch: { [key]: value } });
  const side = token.side === "player" ? "Player" : NPC_SIDES.find((s) => s.value === token.side)?.label;
  const st = token.status ?? {};
  // What players can't see about the GM's characters isn't sent to them; the GM sees everything.
  const shown = (part: SheetPart) => !withheld(token, part);
  const showGear = !!gear && shown("gear");
  const showDeck = !!gear && shown("deck");
  const resists = !gm && token.side !== "player" && shown("resistances") && (token.resistances || token.staggerResistances);

  return (
    <aside className="token-popup" aria-label={`${token.name} preview`} ref={drag.ref} style={drag.style}>
      <header className="tp-head" {...drag.handle}>
        <Portrait token={token} size={52} />
        <div className="tp-title">
          {gm && token.side !== "player" ? <TokenName token={token} act={gm.act} /> : <h3>{token.name}</h3>}
          <span className="muted small">
            {side}
            {shown("justice") && ` · Justice ${token.justice ?? 0}`}
          </span>
          {(st.knockedOut || st.staggered || st.panic) && (
            <span className="row wrap tp-status">
              {st.knockedOut && <span className="chip static warn">Knocked out</span>}
              {st.staggered && <span className="chip static warn">Staggered</span>}
              {st.panic && <span className="chip static warn">Panic</span>}
            </span>
          )}
        </div>
        {gm && (
          <ConfirmButton className="danger small tp-remove" confirmLabel="Remove?" ms={3000} aria-label="Remove token" onConfirm={() => gm.act({ type: "removeToken", tokenId: token.id }) && gm.onRemoved()}>
            Remove
          </ConfirmButton>
        )}
        <button type="button" className="icon" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>

      {/* Only this part scrolls, so the header and its close button stay in view. */}
      <div className="tp-body">
        <div className="tp-resources">
          {RESOURCES.map(({ key, max, label }) => (
            <div className={"tp-res" + (gm ? " editable" : "")} key={key} title={label}>
              <ResourceIcon res={key} />
              <span className="tp-res-label">{label}</span>
              {gm ? (
                <span className="tp-res-edit">
                  <button type="button" aria-label={`Lower ${label}`} onClick={() => set(key, r[key] - 1)}>
                    −
                  </button>
                  <NumberField label={label} value={r[key]} onCommit={(n) => set(key, n)} />
                  <button type="button" aria-label={`Raise ${label}`} onClick={() => set(key, r[key] + 1)}>
                    +
                  </button>
                  <span className="muted">/</span>
                  <NumberField label={`Max ${label}`} value={r[max]} onCommit={(n) => set(max, n)} />
                </span>
              ) : shown(key) ? (
                <strong>
                  {r[key]} <span className="muted">/ {r[max]}</span>
                </strong>
              ) : (
                <span className="muted small">Hidden</span>
              )}
            </div>
          ))}
          {gm && token.side !== "player" && (
            <div className="tp-res editable" title="Justice">
              <span className="res-icon" />
              <span className="tp-res-label">Justice</span>
              <span className="tp-res-edit">
                <NumberField value={token.justice ?? 0} onCommit={(n) => gm.act({ type: "setJustice", tokenId: token.id, justice: n })} />
              </span>
            </div>
          )}
        </div>

        {resists && (
          <section className="tp-gear">
            {(["resistances", "staggerResistances"] as const).map(
              (k) =>
                token[k] && (
                  <div className="tp-gear-row" key={k}>
                    <span className="tp-gear-kind">{k === "resistances" ? "Resist" : "Stagger"}</span>
                    <span>
                      Slash ×{token[k]!.slash}, Pierce ×{token[k]!.pierce}, Blunt ×{token[k]!.blunt}
                    </span>
                  </div>
                ),
            )}
          </section>
        )}

        {gear && (showGear || showDeck) && (
          <section className="tp-gear">
            {showGear && (
              <>
                <div className="tp-gear-row">
                  <span className="tp-gear-kind">Weapon</span>
                  <span>
                    {gear.weapons.length ? gear.weapons.map((w) => w.name + (w.hands === 2 ? " (two-handed)" : "")).join(", ") : <span className="muted">None</span>}
                  </span>
                </div>
                <div className="tp-gear-row">
                  <span className="tp-gear-kind">Armor</span>
                  <span>{gear.armor ? gear.armor.name : <span className="muted">None</span>}</span>
                </div>
                <div className="tp-gear-row">
                  <span className="tp-gear-kind">Augment</span>
                  <span>
                    {gear.augment ? (
                      <>
                        {gear.augment.name}
                        {gear.augment.passives.length > 0 && <span className="muted small"> · {gear.augment.passives.join(", ")}</span>}
                      </>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </span>
                </div>
              </>
            )}
            {showDeck && (
              <>
                <div className="tp-gear-kind">Deck ({gear.deck.reduce((a, e) => a + e.copies, 0)} Pages)</div>
                {gear.deck.length ? (
                  <div className="tp-deck">
                    {gear.deck.map(({ page, copies }) => (
                      <span className="tp-deck-card" key={page.id}>
                        <PageCard page={page} size="small" onClick={() => setViewing(page)} />
                        {copies > 1 && <span className="tp-copies">×{copies}</span>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="muted small">No Pages in the deck.</span>
                )}
              </>
            )}
          </section>
        )}

        {gm ? (
          <EffectsEditor token={token} act={gm.act} />
        ) : (
          shown("effects") &&
          (token.effects ?? []).length > 0 && (
            <div className="row wrap">
              {token.effects!.map((e) => (
                <span key={e.id} className="chip static" title={e.description}>
                  {e.name || "Effect"} {e.count}
                  {e.pending ? ` (+${e.pending} next round)` : ""}
                </span>
              ))}
            </div>
          )
        )}

        {gm && token.side !== "player" && <SecretsEditor token={token} act={gm.act} />}
        {gm && <GmFooter token={token} gm={gm} />}
      </div>
      {viewing && <PageView page={viewing} onClose={() => setViewing(null)} />}
    </aside>
  );
}

/** A GM character's name on its token: type over it to rename just this copy. */
function TokenName({ token, act }: { token: Token; act: (action: TableAction) => boolean }) {
  const [name, setName] = useState(token.name);
  useEffect(() => setName(token.name), [token.name]);
  const commit = () => (name.trim() && name.trim() !== token.name ? act({ type: "renameToken", tokenId: token.id, name }) : setName(token.name));
  return (
    <input
      className="tp-name-input"
      aria-label="Token name"
      title="Rename this copy"
      value={name}
      maxLength={24}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          setName(token.name);
        }
      }}
    />
  );
}

/** Which parts of a GM character's sheet players can't see. Each copy on the map has its own. */
function SecretsEditor({ token, act }: { token: Token; act: (action: TableAction) => boolean }) {
  const count = SHEET_PARTS.filter((p) => isSecret(token, p.key)).length;
  const set = (part: SheetPart, hidden: boolean) => act({ type: "setSecret", tokenId: token.id, secret: { ...token.secret, [part]: hidden } });
  return (
    <details className="enemy-pages secrets-editor">
      <summary>Hidden from players ({count})</summary>
      <p className="muted small">Players' phones and the board never receive what's ticked here, including in the log.</p>
      {SHEET_PARTS.map((p) => (
        <label className="secret-row" key={p.key} title={p.hint}>
          <input type="checkbox" checked={isSecret(token, p.key)} onChange={(e) => set(p.key, e.target.checked)} />
          <span>
            {p.label} <span className="muted small">{p.hint}</span>
          </span>
        </label>
      ))}
    </details>
  );
}

function GmFooter({ token, gm }: { token: Token; gm: GmControls }) {
  const [notes, setNotes] = useState(gm.note);
  useEffect(() => setNotes(gm.note), [gm.note]);
  return (
    <>
      <label className="muted small" htmlFor={`notes-${token.id}`}>
        GM notes (hidden from players)
      </label>
      <textarea
        id={`notes-${token.id}`}
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== gm.note && gm.act({ type: "setNote", tokenId: token.id, note: notes })}
      />
      <div className="row-between">
        {gm.sheetHref ? (
          <a href={gm.sheetHref} target="_blank" rel="noreferrer" className="small">
            {token.side === "player" ? "Open character sheet ↗" : "Open in character editor ↗"}
          </a>
        ) : (
          <span />
        )}
      </div>
    </>
  );
}

/** Effects on a character: automated ones from the effect library (with stacks), or notes tracked by hand. */
function EffectsEditor({ token, act }: { token: Token; act: (action: TableAction) => boolean }) {
  const { id = "" } = useParams();
  const library = useEffectLibrary(id);
  const effects = token.effects ?? [];
  const save = (next: typeof effects) => act({ type: "setEffects", tokenId: token.id, effects: next });
  const statuses = Object.entries(library).filter(([, d]) => d.kind === "status" && isLive(d));
  return (
    <details className="enemy-pages effects-editor">
      <summary>Effects ({effects.length})</summary>
      {effects.map((e, i) =>
        e.defId ? (
          <div className="effect-edit automated" key={e.id}>
            <div className="row">
              <strong className="effect-edit-name">
                {library[e.defId]?.name ?? e.name} <span className="chip static">Automated</span>
              </strong>
              <NumberField
                value={e.count}
                onCommit={(n) => save(effects.map((x, j) => (j === i ? { ...x, count: n } : x)).filter((x) => !x.defId || x.count > 0 || (x.pending ?? 0) > 0))}
              />
              {e.pending ? <span className="muted small">+{e.pending} next round</span> : null}
              <button type="button" className="icon" aria-label="Remove effect" onClick={() => save(effects.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            <p className="muted small">
              {library[e.defId] ? effectText(library[e.defId], library) : `${e.description} (no longer in the effect library, so it does nothing)`}
            </p>
          </div>
        ) : (
          <div className="effect-edit" key={e.id}>
            <div className="row">
              <input
                aria-label="Effect name"
                placeholder="Effect"
                value={e.name}
                onChange={(ev) => save(effects.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))}
              />
              <NumberField value={e.count} onCommit={(n) => save(effects.map((x, j) => (j === i ? { ...x, count: n } : x)))} />
              <button type="button" className="icon" aria-label="Remove effect" onClick={() => save(effects.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            <input
              aria-label="Effect description"
              placeholder="What it does"
              value={e.description}
              onChange={(ev) => save(effects.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)))}
            />
            <input
              aria-label="Effect duration"
              placeholder="Duration (optional)"
              value={e.duration ?? ""}
              onChange={(ev) => save(effects.map((x, j) => (j === i ? { ...x, duration: ev.target.value } : x)))}
            />
          </div>
        ),
      )}
      <div className="row wrap">
        <select
          aria-label="Give an automated effect"
          value=""
          onChange={(ev) => {
            const defId = ev.target.value;
            const def = library[defId];
            if (!def) return;
            const have = effects.find((x) => x.defId === defId);
            save(
              have
                ? effects.map((x) => (x === have ? { ...x, count: x.count + 1 } : x))
                : [...effects, { id: newId(), defId, name: def.name, count: 1, description: effectText(def, library) }],
            );
          }}
        >
          <option value="">+ Give an automated effect…</option>
          {statuses.map(([key, d]) => (
            <option key={key} value={key}>
              {d.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => save([...effects, { id: newId(), name: "", count: 1, description: "" }])}>
          + Add a note
        </button>
      </div>
    </details>
  );
}
