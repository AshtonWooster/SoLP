import { useState } from "react";
import { createPortal } from "react-dom";
import type { Character, Page } from "../../shared/character.ts";
import { auxiliaryDeck, blankPage, cleanDeck, DECK_SIZE, deckSize, equipmentPages, maxCopies } from "../../shared/ruleset.ts";
import { EquipmentStudio, PageEditor } from "./EquipmentEditor.tsx";
import { Section } from "./Fields.tsx";
import { ItemKindIcon } from "./items/ItemCard.tsx";
import { PEEK_WIDTH, peekPosition } from "./peek.ts";
import { DiceIcon, DIE_NAMES, dieClass, dieRange } from "./player/DiceIcon.tsx";
import { PvCard } from "./player/LorCard.tsx";

type Peek = { page: Page; top: number; left: number } | null;

/** The full card for a hovered row: the Page with each die's range and effects. */
function PageHoverCard({ page }: { page: Page }) {
  return (
    <div className="page-hover">
      <PvCard page={page} />
      {(page.effect || page.dice.some((d) => d.effect || d.counter)) && (
        <div className="page-hover-detail">
          {page.effect && <p className="pv-page-effect">{page.effect}</p>}
          <ul className="pv-dice-list compact">
            {page.dice.map((d) => (
              <li key={d.id} className={dieClass(d.kind)}>
                <DiceIcon dice={d} size={24} />
                <span className="pv-range">{dieRange(d)}</span>
                <span className="pv-die-text">
                  {d.counter && <span className="pv-counter">Counter {DIE_NAMES[d.kind]}. </span>}
                  {d.effect}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One row of the deck list: copies, name, dice, Light cost; hover for the full card. */
function DeckRow({
  page,
  copies,
  note,
  onPeek,
  controls,
}: {
  page: Page;
  copies: number | string;
  note?: string;
  onPeek: (p: Peek) => void;
  controls?: React.ReactNode;
}) {
  const show = (e: React.SyntheticEvent<HTMLElement>) => onPeek({ page, ...peekPosition(e.currentTarget) });
  return (
    <div className={`inv-row deck-row ${page.kind}`} onMouseEnter={show} onMouseLeave={() => onPeek(null)}>
      <span className="inv-count">{copies}</span>
      <button type="button" className="inv-name" onClick={show} onFocus={show} onBlur={() => onPeek(null)}>
        {page.name || "Unnamed"}
        {note && <span className="muted small"> · {note}</span>}
      </button>
      <span className="deck-row-dice" aria-hidden="true">
        {page.dice.map((d) => (
          <DiceIcon key={d.id} dice={d} size={16} />
        ))}
      </span>
      <span className="deck-row-cost" title={`${page.cost} Light`}>
        {page.cost}
      </span>
      {controls && <span className="inv-actions">{controls}</span>}
    </div>
  );
}

/**
 * The Equipment & Decks tab, laid out like the Inventory: the Combat Deck as a slim list on the
 * left (hover a row for its card), with the Auxiliary Deck and Trinket below; on the right, Weapons
 * and Armor (add copies of their Pages to the deck right there) and E.G.O. Pages.
 */
export function DeckTab({
  c,
  update,
  gameId,
  uid,
  decksLocked,
}: {
  /** With inventory details linked from the item library. */
  c: Character;
  update: (fn: (d: Character) => void) => void;
  gameId: string;
  uid: string;
  /** Combat is on: the deck and E.G.O. Pages can't change. */
  decksLocked: boolean;
}) {
  const [peek, setPeek] = useState<Peek>(null);
  const sources = equipmentPages(c);
  const pageById = new Map(sources.map((s) => [s.page.id, s]));
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
  const maxFor = (page: Page) => Math.min(maxCopies(page), copiesOf(page.id) + Math.max(0, room));
  const aux = auxiliaryDeck(c);
  const hands = c.weapons.reduce((n, w) => n + w.hands, 0);
  const ego = c.ego ?? [];

  return (
    <div className="inv-tab deck-tab">
      <aside className="inv-list" aria-label="Decks">
        <div className="inv-head">
          <h3>Combat Deck</h3>
          <span className={"deck-count " + (size === DECK_SIZE ? "ok-text" : size > DECK_SIZE ? "error" : "warn-text")}>
            {size} / {DECK_SIZE}
          </span>
        </div>
        {decksLocked && <div className="notice small">Combat is on. The deck can change again once it ends.</div>}
        {stale && (
          <div className="notice small">
            Some Pages in your deck are no longer on your Equipment.{" "}
            <button type="button" disabled={decksLocked} onClick={() => update((d) => void (d.deck = cleanDeck(d)))}>
              Remove them
            </button>
          </div>
        )}
        {c.deck.map((e) => {
          const src = pageById.get(e.pageId);
          if (!src) return null;
          return (
            <DeckRow
              key={e.pageId}
              page={src.page}
              copies={e.copies}
              onPeek={setPeek}
              controls={
                !decksLocked && (
                  <>
                    <button type="button" className="icon" aria-label={`One less ${src.page.name || "page"}`} onClick={() => setCopies(e.pageId, e.copies - 1)}>
                      −
                    </button>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`One more ${src.page.name || "page"}`}
                      disabled={e.copies >= maxFor(src.page)}
                      onClick={() => setCopies(e.pageId, e.copies + 1)}
                    >
                      +
                    </button>
                    <button type="button" className="icon" aria-label={`Take ${src.page.name || "page"} out of the deck`} onClick={() => setCopies(e.pageId, 0)}>
                      ✕
                    </button>
                  </>
                )
              }
            />
          );
        })}
        {room > 0 && (
          <div className="inv-row empty">
            {room} more Page{room === 1 ? "" : "s"} to add: use + under a Page
          </div>
        )}
        {size > 0 && !decksLocked && (
          <button type="button" className="link small" onClick={() => update((d) => void (d.deck = []))}>
            Clear the deck
          </button>
        )}

        <div className="inv-section">Auxiliary Deck</div>
        {aux.length === 0 && <div className="inv-row empty">No Usable items in your Inventory</div>}
        <div className="deck-aux">
          {aux.map(({ item, page, copies }) => (
            <DeckRow key={item.id} page={page} copies={copies} note={item.consumable ? "consumed on use" : undefined} onPeek={setPeek} />
          ))}
          {ego.map((p) => (
            <DeckRow key={p.id} page={p} copies="E" note="E.G.O., once per combat" onPeek={setPeek} />
          ))}
        </div>

        <div className="inv-section">Trinket (always active)</div>
        {c.inventory.trinket ? (
          <div className="inv-row equipped kind-trinket">
            <span className="inv-count">1</span>
            <ItemKindIcon kind="trinket" size={20} />
            <span className="inv-name" title={c.inventory.trinket.description}>
              {c.inventory.trinket.name || "Unnamed"}
            </span>
          </div>
        ) : (
          <div className="inv-row empty">None equipped</div>
        )}
      </aside>

      <div className="deck-side">
        <Section
          id="equipment"
          title="Weapons and Armor"
          intro="Up to two hands of Weapons and one Armor, each with Passives up to its max cost and one Basic and one Special Page made with your GM. Use − and + under a Page to put copies in your Combat Deck: Basic Pages any number of times, Special Pages once."
        >
          <p className={hands > 2 ? "error" : "muted"}>
            Weapons use {hands} of 2 hands{c.armor ? "" : " · no armor yet"}.
          </p>
          <EquipmentStudio
            weapons={c.weapons}
            armor={c.armor}
            characterRank={c.rank}
            artFolder={`games/${gameId}/users/${uid}/art`}
            canAddWeapon={hands < 2}
            onWeapons={(w) => update((d) => void (d.weapons = w))}
            onArmor={(a) => update((d) => void (d.armor = a))}
            deck={{ copies: copiesOf, max: maxFor, set: setCopies, locked: decksLocked }}
          />
        </Section>

        <fieldset className="sheet-body plain-fieldset" disabled={decksLocked}>
          <Section id="ego" title="E.G.O. Pages" intro="Unique Pages from your character's progression, made with your GM. In combat they're available from the start, and each can be used once per combat.">
            <div className="ego-grid">
              {ego.map((p, i) => (
                <PageEditor
                  key={p.id}
                  page={p}
                  artFolder={`games/${gameId}/users/${uid}/art`}
                  onChange={(np) => update((d) => void (d.ego[i] = np))}
                  onRemove={() => update((d) => void d.ego.splice(i, 1))}
                />
              ))}
            </div>
            <button type="button" onClick={() => update((d) => void (d.ego = [...(d.ego ?? []), { ...blankPage("special"), name: "E.G.O." }]))}>
              + Add E.G.O. Page
            </button>
          </Section>
        </fieldset>
      </div>

      {peek &&
        createPortal(
          <div className="inv-peek" style={{ top: peek.top, left: peek.left, width: PEEK_WIDTH }} aria-hidden="true">
            <PageHoverCard page={peek.page} />
          </div>,
          document.body,
        )}
    </div>
  );
}
