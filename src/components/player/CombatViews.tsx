import { useState } from "react";
import type { Page } from "../../../shared/character.ts";
import { isMassAttack } from "../../../shared/ruleset.ts";
import { withheld } from "../../../shared/secrets.ts";
import type { EffectDef } from "../../../shared/effects.ts";
import type { SlottedPage, TableState, Token } from "../../../shared/types.ts";
import { EffectsBar } from "../effects/StatusIcons.tsx";
import { Overlay } from "./Overlay.tsx";
import { PageCard } from "./PageCard.tsx";

const MAX = { hp: "maxHp", sanity: "maxSanity", stagger: "maxStagger", light: "maxLight" } as const;

/** A character's portrait, or their initial on their token color. */
export function Portrait({ token, size = 48 }: { token?: Token; size?: number }) {
  return (
    <span className="portrait" style={{ width: size, height: size, background: token?.portrait ? undefined : token?.color }}>
      {token?.portrait ? <img src={token.portrait} alt="" /> : <span>{(token?.name ?? "?").charAt(0).toUpperCase()}</span>}
    </span>
  );
}

/** The Page answering this one: clashing with it, or defending against this Mass Attack on that target. */
function responseTo(table: TableState, slot: SlottedPage, targetId: string): SlottedPage | undefined {
  const c = table.combat!;
  return c.slots.find((s) => s.ownerId === targetId && (s.clashWith === slot.id || slot.clashWith === s.id));
}

/** Inspect other characters: their Speed Dice, the Page on each, and its targets with any response. */
export function CycleCharacters({
  table,
  meId,
  library,
  onClose,
  onOpenPage,
}: {
  table: TableState;
  meId?: string;
  library: Record<string, EffectDef>;
  onClose: () => void;
  onOpenPage: (p: Page) => void;
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
              {!c && <p className="muted">Not in combat.</p>}
              {c && dice === 0 && <p className="muted">Not in the turn order.</p>}
              {c &&
                Array.from({ length: dice }, (_, i) => {
                  const slot = c.slots.find((s) => s.ownerId === who.id && s.die === i);
                  const page = slot && c.pages[slot.pageId];
                  // Only a Mass Attack's many targets get a scrolling list.
                  const mass = !!page && isMassAttack(page.type);
                  return (
                    <section className="speed-die-row" key={i}>
                      <h4>Speed Dice {i + 1}</h4>
                      <div className="sd-body">
                        <div className="sd-page">
                          <span className="sd-col">Page</span>
                          {page ? <PageCard page={page} size="small" onClick={() => onOpenPage(page)} /> : <span className="muted small">No Page</span>}
                        </div>
                        <div className={"sd-targets" + (mass ? " mass" : "")}>
                          <span className="sd-col">Targets</span>
                          <span className="sd-col">Response</span>
                          {slot?.targets.map((t) => {
                            const target = table.tokens[t.tokenId];
                            const resp = responseTo(table, slot, t.tokenId);
                            const rp = resp && c.pages[resp.pageId];
                            return (
                              <div className="sd-target" key={t.tokenId}>
                                <span className="sd-who">
                                  <Portrait token={target} size={44} />
                                  <span className="small">{target?.name}</span>
                                </span>
                                <span className="sd-resp">{rp ? <PageCard page={rp} size="small" onClick={() => onOpenPage(rp)} /> : <span className="muted small">One-Sided</span>}</span>
                              </div>
                            );
                          })}
                          {!slot && <span className="muted small">—</span>}
                        </div>
                      </div>
                      {mass && slot.targets.length > 2 && <p className="muted small sd-more">Scroll for all {slot.targets.length} targets</p>}
                    </section>
                  );
                })}
            </div>
          )}
        </>
      )}
    </Overlay>
  );
}
