import { useState } from "react";
import type { Page } from "../../../shared/character.ts";
import { withheld } from "../../../shared/secrets.ts";
import { KO_RECOVERY_ROLL, KO_UPKEEPS, PANIC_RECOVERY_ROLL } from "../../../shared/ruleset.ts";
import type { EffectDef } from "../../../shared/effects.ts";
import type { TableState, Token } from "../../../shared/types.ts";
import { EffectsBar } from "../effects/StatusIcons.tsx";
import { Overlay } from "./Overlay.tsx";
import { PageCard } from "./PageCard.tsx";
import { ClashPreview } from "./SlotChoice.tsx";
import { speedDiceOf } from "./speedDice.ts";

const MAX = { hp: "maxHp", sanity: "maxSanity", stagger: "maxStagger", light: "maxLight" } as const;

/** A character's portrait, or their initial on their token color. */
export function Portrait({ token, size = 48 }: { token?: Token; size?: number }) {
  return (
    <span className="portrait" style={{ width: size, height: size, background: token?.portrait ? undefined : token?.color }}>
      {token?.portrait ? <img src={token.portrait} alt="" /> : <span>{(token?.name ?? "?").charAt(0).toUpperCase()}</span>}
    </span>
  );
}

/** Inspect other characters: their Speed Dice, the Page on each, and its targets with any response. */
export function CycleCharacters({
  table,
  meId,
  library,
  onClose,
  onOpenPage,
  recovery,
  revive,
}: {
  table: TableState;
  meId?: string;
  library: Record<string, EffectDef>;
  onClose: () => void;
  onOpenPage: (p: Page) => void;
  /** Panic recovery on a Panicking ally: which characters get the button, and why it can't be used now ("" when it can). */
  recovery?: { shows: (t: Token) => boolean; blocked: string; onUse: (t: Token) => void };
  /** Reviving a Knocked Out ally (Game setting "Knocked Out rules"), the same way. */
  revive?: { shows: (t: Token) => boolean; blocked: string; onUse: (t: Token) => void };
}) {
  const c = table.combat;
  const ids = c ? c.order.map((x) => x.tokenId) : Object.keys(table.tokens);
  const others = ids.map((id) => table.tokens[id]).filter((t): t is Token => !!t && t.id !== meId);
  const [pickedId, setPickedId] = useState(others[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const who = table.tokens[pickedId];
  const dice = c?.order.find((x) => x.tokenId === pickedId)?.dice ?? 0;
  const r = who?.resources;

  return (
    <Overlay title="Cycle Characters" onClose={onClose}>
      {others.length === 0 ? (
        <p className="muted">No one else is here yet.</p>
      ) : (
        <>
          <div className="char-dropdown">
            <button type="button" className="char-dropdown-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <Portrait token={who} size={32} /> <span>{who?.name ?? "Pick a character"}</span> <span className="muted">▾</span>
            </button>
            {open && (
              <ul className="char-dropdown-list" role="listbox">
                {others.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={t.id === pickedId}
                      onClick={() => {
                        setPickedId(t.id);
                        setOpen(false);
                      }}
                    >
                      <Portrait token={t} size={28} /> {t.name} <span className="muted small">({t.side})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {who && r && (
            <div className="cycle-char">
              <div className="cycle-head">
                <Portrait token={who} size={88} />
                <div>
                  <h3>{who.name}</h3>
                  <div className="mini-res">
                    {(["hp", "sanity", "stagger", "light"] as const).map((k) => (
                      <span className={`res-${k}`} key={k}>
                        {withheld(who, k) ? "?" : `${r[k]}/${r[MAX[k]]}`}
                      </span>
                    ))}
                  </div>
                  <EffectsBar key={who.id} className="cycle-effects" effects={who.effects ?? []} library={library} size={40} />
                </div>
              </div>
              {recovery?.shows(who) && (
                <div className="panic-recovery">
                  <button type="button" className="big-button" disabled={!!recovery.blocked} onClick={() => recovery.onUse(who)}>
                    Panic recovery
                  </button>
                  <span className="muted small">{recovery.blocked ||
                      `Use your action: a Prudence Story Roll${who.status?.panicRecoveryFails ? ` +${who.status.panicRecoveryFails} from failed attempts` : ""}. ${PANIC_RECOVERY_ROLL} or more and ${who.name} recovers from Panic.`}</span>
                </div>
              )}
              {who.status?.dead ? (
                <p className="ko-note">Dead.</p>
              ) : (
                who.status?.knockedOut &&
                c?.knockOutRules &&
                who.side === "player" && (
                  <p className="ko-note">
                    Knocked Out: Dead in {KO_UPKEEPS - (who.status.koUpkeeps ?? 0)} more Upkeep{KO_UPKEEPS - (who.status.koUpkeeps ?? 0) === 1 ? "" : "s"} unless revived.
                  </p>
                )
              )}
              {revive?.shows(who) && (
                <div className="panic-recovery">
                  <button type="button" className="big-button" disabled={!!revive.blocked} onClick={() => revive.onUse(who)}>
                    Revive
                  </button>
                  <span className="muted small">{revive.blocked ||
                      `Use your action: a Temperance Story Roll${who.status?.koRecoveryFails ? ` +${who.status.koRecoveryFails} from failed attempts` : ""}. ${KO_RECOVERY_ROLL} or more and ${who.name} is back up with a quarter of their Health.`}</span>
                </div>
              )}
              {!c && <p className="muted">Not in combat.</p>}
              {c && dice === 0 && <p className="muted">Not in the turn order.</p>}
              {c && <SpeedDiceRows table={table} tokenId={who.id} onOpenPage={onOpenPage} />}
            </div>
          )}
        </>
      )}
    </Overlay>
  );
}

/**
 * A character's Speed Dice, one row each: the Page on it, its targets and each target's response.
 * With `preview`, a target answering with a Page also shows the clash preview against it.
 */
export function SpeedDiceRows({
  table,
  tokenId,
  onOpenPage,
  preview = false,
}: {
  table: TableState;
  tokenId: string;
  onOpenPage: (p: Page) => void;
  preview?: boolean;
}) {
  return (
    <>
      {speedDiceOf(table, tokenId).map(({ die, slot, page, mass, targets }) => (
        <section className="speed-die-row" key={die}>
          <h4>Speed Dice {die + 1}</h4>
          <div className="sd-body">
            <div className="sd-page">
              <span className="sd-col">Page</span>
              {page ? <PageCard page={page} size="small" onClick={() => onOpenPage(page)} /> : <span className="muted small">No Page</span>}
            </div>
            {/* Only a Mass Attack's many targets get a scrolling list; with previews, the whole panel scrolls instead. */}
            <div className={"sd-targets" + (mass && !preview ? " mass" : "")}>
              <span className="sd-col">Targets</span>
              <span className="sd-col">Response</span>
              {targets.map((t) => {
                const target = table.tokens[t.tokenId];
                const rp = t.responsePage;
                return (
                  <div className="sd-target" key={t.tokenId}>
                    <span className="sd-who">
                      <Portrait token={target} size={44} />
                      <span className="small">{target?.name}</span>
                    </span>
                    <span className="sd-resp">{rp ? <PageCard page={rp} size="small" onClick={() => onOpenPage(rp)} /> : <span className="muted small">One-Sided</span>}</span>
                    {preview && page && rp && <ClashPreview mine={page} theirs={rp} theirName={target?.name ?? "Their"} />}
                  </div>
                );
              })}
              {!slot && <span className="muted small">—</span>}
            </div>
          </div>
          {mass && !preview && targets.length > 2 && <p className="muted small sd-more">Scroll for all {targets.length} targets</p>}
        </section>
      ))}
    </>
  );
}
