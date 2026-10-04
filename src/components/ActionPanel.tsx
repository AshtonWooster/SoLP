import type { Page } from "../../shared/character.ts";
import { pinnedBy, validTargets } from "../../shared/engine.ts";
import { DASH_LIGHT_COST, DASH_MOVEMENT, isMassAttack } from "../../shared/ruleset.ts";
import type { Card, PageSource, TableAction, TableState, Token } from "../../shared/types.ts";
import { PageSummary } from "./PageSummary.tsx";

export const PHASE_LABELS = {
  resolve: "Resolving Pages",
  upkeep: "Upkeep",
  actions: "Combat Actions",
  endstep: "Endstep",
} as const;

interface Props {
  table: TableState;
  /** The character acting: the active combatant. */
  token: Token;
  /** Whether this screen may act for them right now. */
  canAct: boolean;
  send: (a: TableAction) => void;
}

/** One playable Page: tap to pick it, then pick targets here or on the board. */
function PageButton({
  page,
  selected,
  affordable,
  disabled,
  onPick,
}: {
  page: Page;
  selected: boolean;
  affordable: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button type="button" className={"card" + (selected ? " selected" : "") + (affordable ? "" : " unaffordable")} disabled={disabled} onClick={onPick}>
      <PageSummary page={page} />
      {page.effect && <span className="muted small card-effect">{page.effect}</span>}
    </button>
  );
}

/**
 * Combat Actions for whoever's turn it is: use a Page from the hand, Auxiliary Deck or (for
 * enemies) their page list, pick targets, Dash, and end the turn.
 */
export function ActionPanel({ table, token, canAct, send }: Props) {
  const c = table.combat!;
  const actions = c.phase === "actions";
  const live = canAct && actions;
  const deck = c.decks[token.id];
  const aim = c.aim?.tokenId === token.id ? c.aim : undefined;
  const light = token.resources.light;
  const pageOf = (card: Card) => c.pages[card.pageId];
  const aimedPage = aim && (c.pages[aim.pageId] ?? token.pages?.find((p) => p.id === aim.pageId));
  const targets = aimedPage ? validTargets(table, token, aimedPage) : [];
  const mass = aimedPage && isMassAttack(aimedPage.type);
  const pinned = pinnedBy(table, token);
  const mySlots = c.slots.filter((s) => s.ownerId === token.id);
  const counters = c.counters[token.id] ?? [];
  const pick = (source: PageSource, card?: Card, page?: Page) =>
    aim && (aim.cardId ? aim.cardId === card?.id : aim.pageId === page?.id) ? send({ type: "clearAim" }) : send({ type: "aim", source, cardId: card?.id, pageId: page?.id });

  return (
    <div className="action-panel">
      <div className="row-between">
        <strong>{PHASE_LABELS[c.phase]}</strong>
        <span className="muted small">
          {light} Light · {c.movementLeft} Movement
        </span>
      </div>

      {deck && (
        <>
          <h4>
            Hand <span className="muted small">· draw {deck.draw.length} · discard {deck.discard.length}</span>
          </h4>
          <div className="hand">
            {deck.hand.length === 0 && <p className="muted small">No Pages in hand.</p>}
            {deck.hand.map((card) => (
              <PageButton
                key={card.id}
                page={pageOf(card)}
                selected={aim?.cardId === card.id}
                affordable={pageOf(card).cost <= light}
                disabled={!live}
                onPick={() => pick("hand", card)}
              />
            ))}
          </div>
          {deck.aux.length > 0 && (
            <>
              <h4>Auxiliary Deck</h4>
              <div className="hand">
                {deck.aux.map((card) => (
                  <PageButton
                    key={card.id}
                    page={pageOf(card)}
                    selected={aim?.cardId === card.id}
                    affordable={pageOf(card).cost <= light}
                    disabled={!live}
                    onPick={() => pick("aux", card)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {token.side === "enemy" && (
        <>
          <h4>{token.name}'s Pages</h4>
          <div className="hand">
            {(token.pages ?? []).length === 0 && <p className="muted small">No Pages yet. Add some in this enemy's token panel.</p>}
            {(token.pages ?? []).map((page) => (
              <PageButton key={page.id} page={page} selected={aim?.pageId === page.id} affordable={page.cost <= light} disabled={!live} onPick={() => pick("enemy", undefined, page)} />
            ))}
          </div>
        </>
      )}

      {aim && aimedPage && live && (
        <div className="aim-box">
          <strong>
            {aimedPage.name}: {mass ? "pick targets" : "pick a target"}
          </strong>
          <span className="muted small">Tap one here, or tap a lit token on the board.</span>
          <div className="row wrap">
            {targets.length === 0 && <span className="muted small">No one in range ({aimedPage.type}).</span>}
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                className={aim.targets.includes(t.id) ? "picked" : ""}
                onClick={() => send(mass ? { type: "aimTarget", tokenId: t.id } : { type: "slot", targets: [t.id] })}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="row">
            {mass && (
              <button type="button" className="big-button" disabled={aim.targets.length === 0} onClick={() => send({ type: "slot" })}>
                Use on {aim.targets.length} target{aim.targets.length === 1 ? "" : "s"}
              </button>
            )}
            <button type="button" onClick={() => send({ type: "clearAim" })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mySlots.length > 0 && (
        <div>
          <h4>Slotted (resolve at the start of {token.name}'s next turn)</h4>
          <ul className="plain slot-list">
            {mySlots.map((s) => (
              <li key={s.id}>
                <strong>{c.pages[s.pageId]?.name}</strong> → {s.targets.map((t) => table.tokens[t.tokenId]?.name).join(", ")}
                {s.clashWith && <span className="clash-tag">Clash</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {counters.length > 0 && (
        <p className="muted small">
          Counter Dice ready: {counters.map((x) => `${x.die.kind} 1d${x.die.sides}+${x.die.basePower}`).join(", ")}
        </p>
      )}

      {live && (
        <div className="row wrap">
          <button type="button" disabled={light < DASH_LIGHT_COST} onClick={() => send({ type: "dash" })}>
            Dash (−{DASH_LIGHT_COST} Light, +{DASH_MOVEMENT} Movement)
          </button>
          <button type="button" className="big-button" onClick={() => send({ type: "endTurn" })}>
            End turn
          </button>
        </div>
      )}
      {pinned && <p className="muted small">{token.name} is targeted by {pinned.name}'s attack and can't move.</p>}
    </div>
  );
}

/** A player's hand when it isn't their turn (hands are public to the party). */
export function HandPreview({ table, tokenId }: { table: TableState; tokenId: string }) {
  const c = table.combat;
  const deck = c?.decks[tokenId];
  if (!c || !deck) return null;
  return (
    <div className="hand compact">
      {deck.hand.map((card) => (
        <div key={card.id} className="card static">
          <PageSummary page={c.pages[card.pageId]} />
        </div>
      ))}
      {deck.hand.length === 0 && <span className="muted small">Empty hand</span>}
    </div>
  );
}
