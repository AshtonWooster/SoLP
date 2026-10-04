import type { Character } from "../../shared/character.ts";
import { auxiliaryDeck, cleanDeck, DECK_SIZE, deckSize, equipmentPages, maxCopies } from "../../shared/ruleset.ts";
import { Stepper } from "./Fields.tsx";
import { PageSummary } from "./PageSummary.tsx";

/** Build the Combat Deck from Equipment Pages; see the Auxiliary Deck made from Tools (Act 6). */
export function DeckEditor({ c, update }: { c: Character; update: (fn: (d: Character) => void) => void }) {
  const sources = equipmentPages(c);
  const size = deckSize(c.deck);
  const room = DECK_SIZE - size;
  const copiesOf = (pageId: string) => c.deck.find((e) => e.pageId === pageId)?.copies ?? 0;
  const stale = cleanDeck(c).length !== c.deck.length || cleanDeck(c).some((e, i) => e.copies !== c.deck[i]?.copies);
  const setCopies = (pageId: string, copies: number) =>
    update((d) => {
      const entry = d.deck.find((e) => e.pageId === pageId);
      if (entry) entry.copies = copies;
      else d.deck.push({ pageId, copies });
      d.deck = d.deck.filter((e) => e.copies > 0);
    });
  const aux = auxiliaryDeck(c);

  return (
    <div className="decks">
      <section className="deck">
        <div className="row-between">
          <h3>Combat Deck</h3>
          <span className={"deck-count " + (size === DECK_SIZE ? "ok-text" : size > DECK_SIZE ? "error" : "warn-text")}>
            {size} / {DECK_SIZE}
          </span>
        </div>
        <p className="muted small">
          Add copies of Pages from your Equipment. Basic Pages can go in any number of times; Special Pages once. It's shuffled at the start of combat.
        </p>
        {stale && (
          <div className="notice">
            Some Pages in your deck are no longer on your Equipment.{" "}
            <button type="button" onClick={() => update((d) => void (d.deck = cleanDeck(d)))}>
              Remove them
            </button>
          </div>
        )}
        {sources.length === 0 && <p className="muted">Add Weapons or Armor with Pages on the Character tab first.</p>}
        <ul className="deck-list">
          {sources.map(({ page, from }) => {
            const copies = copiesOf(page.id);
            return (
              <li key={page.id} className={copies ? "in-deck" : ""}>
                <div className="deck-page">
                  <PageSummary page={page} />
                  <span className="muted small">from {from}</span>
                </div>
                <Stepper
                  label={`copies of ${page.name || "page"}`}
                  value={copies}
                  max={Math.min(maxCopies(page), copies + Math.max(0, room))}
                  onChange={(n) => setCopies(page.id, n)}
                />
              </li>
            );
          })}
        </ul>
        {size > 0 && (
          <button type="button" className="link" onClick={() => update((d) => void (d.deck = []))}>
            Clear the deck
          </button>
        )}
      </section>

      <section className="deck">
        <h3>Auxiliary Deck</h3>
        <p className="muted small">Your Tools' Pages, from your Inventory. Usable at any time unless a Page says otherwise.</p>
        {aux.length === 0 && <p className="muted">No Tools in your Inventory.</p>}
        <ul className="deck-list">
          {aux.map(({ item, page, copies }) => (
            <li key={item.id}>
              <div className="deck-page">
                <PageSummary page={page} />
                <span className="muted small">
                  {item.name || "Unnamed Tool"}
                  {item.consumable ? " · consumed on use" : " · reusable"}
                </span>
              </div>
              <span className="deck-copies">×{copies}</span>
            </li>
          ))}
        </ul>
        <div className="trinket-note">
          <strong>Trinket (always active):</strong>{" "}
          {c.inventory.trinket ? (
            <>
              {c.inventory.trinket.name || "Unnamed"} <span className="muted">· {c.inventory.trinket.description || "no description"}</span>
            </>
          ) : (
            <span className="muted">none equipped</span>
          )}
        </div>
      </section>
    </div>
  );
}
