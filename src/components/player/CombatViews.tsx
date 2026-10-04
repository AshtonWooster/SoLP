import { useState } from "react";
import type { Page } from "../../../shared/character.ts";
import type { Effect, SlottedPage, TableState, Token } from "../../../shared/types.ts";
import { Overlay } from "./Overlay.tsx";
import { PageCard } from "./PageCard.tsx";

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
  onClose,
  onOpenPage,
}: {
  table: TableState;
  meId?: string;
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
                    <span className="res-hp">{r.hp}/{r.maxHp}</span>
                    <span className="res-sanity">{r.sanity}/{r.maxSanity}</span>
                    <span className="res-stagger">{r.stagger}/{r.maxStagger}</span>
                    <span className="res-light">{r.light}/{r.maxLight}</span>
                  </div>
                  {(who.effects ?? []).length > 0 && <p className="muted small">Effects: {who.effects!.map((e) => `${e.name} ${e.count}`).join(", ")}</p>}
                </div>
              </div>
              {!c && <p className="muted">Not in combat.</p>}
              {c && dice === 0 && <p className="muted">Not in the turn order.</p>}
              {c &&
                Array.from({ length: dice }, (_, i) => {
                  const slot = c.slots.find((s) => s.ownerId === who.id && s.die === i);
                  const page = slot && c.pages[slot.pageId];
                  return (
                    <section className="speed-die-row" key={i}>
                      <h4>Speed Dice {i + 1}</h4>
                      <div className="sd-body">
                        <div className="sd-page">{page ? <PageCard page={page} size="small" onClick={() => onOpenPage(page)} /> : <span className="muted small">No Page</span>}</div>
                        <div className="sd-targets">
                          <div className="sd-cols">
                            <span>Targets</span>
                            <span>Response</span>
                          </div>
                          <div className="sd-scroll">
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
                                  <span>{rp ? <PageCard page={rp} size="small" onClick={() => onOpenPage(rp)} /> : <span className="muted small">One-Sided</span>}</span>
                                </div>
                              );
                            })}
                            {!slot && <span className="muted small">—</span>}
                          </div>
                          {slot && slot.targets.length > 2 && <span className="muted small">Scroll for {slot.targets.length} targets</span>}
                        </div>
                      </div>
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

/** Every Effect on the character: count, icon, name, description and duration. */
export function EffectsView({ effects, onClose }: { effects: Effect[]; onClose: () => void }) {
  return (
    <Overlay title="Effects" onClose={onClose}>
      <table className="nd-table effects-table">
        <thead>
          <tr>
            <th>#</th>
            <th />
            <th>Name</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {effects.map((e) => (
            <tr key={e.id}>
              <td className="effect-count">{e.count}</td>
              <td>
                <span className="effect-icon">{(e.name || "?").charAt(0).toUpperCase()}</span>
              </td>
              <td>
                <strong>{e.name || "Effect"}</strong>
                {e.duration && <div className="muted small">{e.duration}</div>}
              </td>
              <td className="pre">{e.description}</td>
            </tr>
          ))}
          {effects.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No effects right now.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Overlay>
  );
}
