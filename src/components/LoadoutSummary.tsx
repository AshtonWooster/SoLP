import { Link } from "react-router-dom";
import type { Character } from "../../shared/character.ts";
import { auxiliaryDeck, DECK_SIZE, deckSize, equipmentPages, isUsable } from "../../shared/ruleset.ts";
import { PageSummary } from "./PageSummary.tsx";

/** A player's decks, Trinket and Inventory at a glance, with links to edit them. */
export function LoadoutSummary({
  c,
  gameId,
  uid,
  inCombat,
  onUse,
}: {
  c: Character;
  gameId: string;
  uid: string;
  inCombat: boolean;
  /** Use an item once (the GM marks which items are usable). */
  onUse?: (itemId: string) => void;
}) {
  const pages = new Map(equipmentPages(c).map((s) => [s.page.id, s.page]));
  const size = deckSize(c.deck);
  const aux = auxiliaryDeck(c);
  const sheet = (tab: string) => `/games/${gameId}/characters/${uid}?tab=${tab}`;
  return (
    <>
      <section className="loadout">
        <div className="row-between">
          <h3>
            Combat Deck <span className={size === DECK_SIZE ? "muted" : "warn-text"}>· {size}/{DECK_SIZE}</span>
          </h3>
          {inCombat ? <span className="muted small">Locked during combat</span> : <Link to={sheet("decks")}>Edit decks</Link>}
        </div>
        <ul className="deck-list compact">
          {c.deck.map((e) => {
            const page = pages.get(e.pageId);
            return page ? (
              <li key={e.pageId}>
                <PageSummary page={page} />
                <span className="deck-copies">×{e.copies}</span>
              </li>
            ) : null;
          })}
          {c.deck.length === 0 && <li className="muted">Empty</li>}
        </ul>
        <h3>Auxiliary Deck</h3>
        <ul className="deck-list compact">
          {aux.map(({ item, page, copies }) => (
            <li key={item.id}>
              <PageSummary page={page} />
              <span className="deck-copies">×{copies}</span>
            </li>
          ))}
          {aux.length === 0 && <li className="muted">No Tools</li>}
        </ul>
      </section>
      <section className="loadout">
        <div className="row-between">
          <h3>
            Inventory <span className="muted">· {c.inventory.items.length}/{c.inventory.slotCount}</span>
          </h3>
          <Link to={sheet("inventory")}>Edit</Link>
        </div>
        <div className="trinket-note">
          <strong>Trinket:</strong> {c.inventory.trinket ? `${c.inventory.trinket.name || "Unnamed"} · ${c.inventory.trinket.description}` : <span className="muted">none</span>}
        </div>
        <ul className="plain item-list">
          {c.inventory.items.map((i) => (
            <li key={i.id} className="item-row">
              <span>
                {i.name || "Unnamed"}
                {i.stacking && <span className="muted"> ×{i.count}</span>} <span className="muted small">({i.kind})</span>
                {i.consumable && isUsable(i) && (
                  <span className="muted small">
                    {" "}
                    · {i.uses ?? i.maxUses ?? 1}/{i.maxUses ?? 1} uses
                  </span>
                )}
              </span>
              {onUse && i.kind !== "tool" && isUsable(i) && (
                <button type="button" onClick={() => onUse(i.id)}>
                  Use
                </button>
              )}
            </li>
          ))}
          {c.inventory.items.length === 0 && <li className="muted">Empty</li>}
        </ul>
      </section>
    </>
  );
}
