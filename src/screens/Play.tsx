import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import type { Character, ItemTemplate, Page } from "../../shared/character.ts";
import { activeToken, validTargets } from "../../shared/engine.ts";
import { blankCharacter, linkInventory, DASH_LIGHT_COST, STAGGER_UPKEEPS, STAGGERED_RESISTANCE, isMassAttack, PRIMARY_STATS, SECONDARY_STATS, STORY_DIE, useItemIn } from "../../shared/ruleset.ts";
import { partsNeedingApproval, proposeEdits, withProposals } from "../../shared/permissions.ts";
import { type Card, type GameDoc, type PageSource, type PlayerEditKey, type TableAction } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { PHASE_LABELS } from "../components/ActionPanel.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { Waiting } from "../components/Waiting.tsx";
import { useClashPlayback } from "../components/ClashFx.tsx";
import { CycleCharacters, EffectsView, Portrait } from "../components/player/CombatViews.tsx";
import { InfoPanel, PANELS, type PanelKey } from "../components/player/InfoPanels.tsx";
import { AnyStatIcon } from "../components/LorIcons.tsx";
import { Overlay } from "../components/player/Overlay.tsx";
import { PvCard } from "../components/player/LorCard.tsx";
import { PageView } from "../components/player/PageView.tsx";
import { SlotChoice } from "../components/player/SlotChoice.tsx";
import { db, friendlyError } from "../firebase.ts";
import { useClient } from "../net/hooks.ts";

type Category = "combat" | "ego" | "aux";
/** Statuses that just ask for the next pick; the target popup asks for those itself. */
const PICK_PROMPTS = ["Pick a Page", "Pick targets", "Pick a target"];
const CATEGORIES: { key: Category; label: string; source: PageSource }[] = [
  { key: "combat", label: "Combat", source: "hand" },
  { key: "ego", label: "E.G.O.", source: "ego" },
  { key: "aux", label: "Auxiliary", source: "aux" },
];
const sourceOf = (cat: Category) => CATEGORIES.find((x) => x.key === cat)!.source;

/** The buttons in the Character information popup, in order. */
const INFO_BUTTONS: { key: PanelKey; label: string }[] = [
  { key: "I", label: "Inventory" },
  { key: "S", label: "Stats" },
  { key: "W", label: "Weapons" },
  { key: "A", label: "Armor" },
  { key: "AU", label: "Augments" },
  { key: "P", label: "Proficiencies" },
];

type OverlayKey = "cycle" | "effects" | "info" | "story" | "targets";

/** A single-target Page about to be slotted, waiting on Clash or Unopposed (and which Speed Die). */
interface PendingSlot {
  category: Category;
  card: Card;
  target: string;
}

/**
 * The player's screen: a persistent top section (who you are, resources and actions) and the
 * Pages you can use below it. Character information, panels and popups sit on top without
 * touching the combat selection underneath.
 */
export function Play() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { snapshot, client } = useClient(id, user?.id, "play");
  const characterDoc = useDoc<Character>(user ? `games/${id}/characters/${user.id}` : null);
  // What the GM lets players change from their phone (game settings).
  const gameDoc = useDoc<GameDoc>(`games/${id}`);

  // UI state lives here, so opening panels and popups never resets it.
  const [panel, setPanel] = useState<PanelKey | null>(null);
  const [overlay, setOverlay] = useState<OverlayKey | null>(null);
  const [viewing, setViewing] = useState<{ page: Page; card?: Card; category?: Category } | null>(null);
  const [category, setCategory] = useState<Category>("combat");
  const [selected, setSelected] = useState<Partial<Record<Category, string>>>({});
  const [pending, setPending] = useState<PendingSlot | null>(null);
  const [target, setTarget] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The start of the log line we're waiting for after a Story Roll.
  const [awaitingRoll, setAwaitingRoll] = useState<{ prefix: string; tail: string } | null>(null);

  // Clash damage shows once its die has played on the board.
  const { table } = useClashPlayback(snapshot.table);
  const combat = table?.combat;
  const mine = table ? Object.values(table.tokens).find((t) => t.ownerId === user?.id) : undefined;
  const library = useCollection<ItemTemplate>(`games/${id}/items`);
  const c: Character | undefined = characterDoc.data && user ? linkInventory({ ...blankCharacter(user.id, ""), ...characterDoc.data }, library) : undefined;
  const deck = combat && mine ? combat.decks?.[mine.id] : undefined;
  const active = table ? activeToken(table) : undefined;
  const myTurn = !!mine && active?.id === mine.id;
  const canAct = myTurn && combat?.phase === "actions";
  const myDice = (combat && mine && combat.order?.find((x) => x.tokenId === mine.id)?.dice) || 0;

  const cardsIn = (cat: Category): Card[] => (!deck ? [] : cat === "combat" ? (deck.hand ?? []) : cat === "ego" ? (deck.ego ?? []) : (deck.aux ?? []));
  const selectedCard = cardsIn(category).find((x) => x.id === selected[category]);
  const page = selectedCard && combat ? combat.pages?.[selectedCard.pageId] : undefined;
  const source = sourceOf(category);
  const mass = !!page && isMassAttack(page.type);
  const inRange = useMemo(() => new Set(page && mine && table ? validTargets(table, mine, page).map((t) => t.id) : []), [page, mine, table]);
  const freeDice = Array.from({ length: myDice }, (_, i) => i).filter((i) => !combat?.slots?.some((s) => s.ownerId === mine?.id && s.die === i));
  // Mass Attack targets live on the host (so the board shows them too); a single target is local.
  const myAim = combat?.aim && combat.aim.tokenId === mine?.id && combat.aim.cardId === selectedCard?.id ? combat.aim : undefined;
  const targets = mass ? (myAim?.targets ?? []) : target ? [target] : [];

  // A Page that left the hand (used, e.g. from the board) is no longer selected.
  const selectedId = selected[category];
  const stillThere = !!selectedCard;
  useEffect(() => {
    if (selectedId && deck && !stillThere) setSelected((s) => ({ ...s, [category]: undefined }));
  }, [selectedId, stillThere, deck, category]);

  const act = (action: TableAction) =>
    client
      ? client.act(action).then(
          () => (setError(""), true),
          (e: Error) => (setError(e.message), false),
        )
      : Promise.resolve(false);

  // Tell the host which Page is picked, so the board lights up its targets.
  useEffect(() => {
    if (!canAct || !client) return;
    if (selectedCard) client.act({ type: "aim", source, cardId: selectedCard.id }).catch((e: Error) => setError(e.message));
    else if (combat?.aim?.tokenId === mine?.id) client.act({ type: "clearAim" }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAct, selectedCard?.id, source]);

  // Show a Story Roll's result once its log line arrives.
  const log = table?.log;
  useEffect(() => {
    if (!awaitingRoll || !log) return;
    if (log.slice(-10).join("\n") === awaitingRoll.tail) return;
    const line = [...log.slice(-10)].reverse().find((l) => l.startsWith(awaitingRoll.prefix));
    if (line) {
      setNotice(line);
      setAwaitingRoll(null);
    }
  }, [log, awaitingRoll]);

  if (!table || snapshot.status === "closed") return <Waiting snapshot={snapshot} gameId={id} />;
  const sheetUrl = `/games/${id}/characters/${user?.id}`;
  const r = mine?.resources;

  // Why the current selection can't be used yet; "" when it can.
  const problem = (() => {
    if (!combat) return "Combat hasn't started";
    if (!mine || !deck) return "You're not in this combat";
    if (!canAct) return myTurn ? "Wait for Combat Actions" : `Waiting for ${active?.name ?? "the next turn"}`;
    if (!page) return "Pick a Page";
    if ((r?.light ?? 0) < page.cost) return `Needs ${page.cost} Light`;
    if (page.type !== "instant" && freeDice.length === 0) return "No free Speed Die";
    if (targets.length === 0) return mass ? "Pick targets" : "Pick a target";
    const far = targets.find((t) => !inRange.has(t));
    if (far) return `${table.tokens[far]?.name ?? "Target"} is out of range`;
    return "";
  })();

  const clearSelection = (cat: Category = category) => {
    setSelected((s) => ({ ...s, [cat]: undefined }));
    setTarget(undefined);
  };

  /** Pay and slot a Page on the first free Speed Die against the chosen target(s). */
  const place = async (cat: Category, card: Card, withTargets?: string[], how: { targetDie?: number; unopposed?: boolean } = {}) => {
    if (!(await act({ type: "aim", source: sourceOf(cat), cardId: card.id }))) return;
    if (await act({ type: "slot", targets: withTargets, ...how })) clearSelection(cat);
  };

  /** Single-target Pages ask first: Clash (on which of the target's Speed Dice) or attack Unopposed. */
  const use = (cat: Category, card: Card, withTargets: string[]) => {
    const p = combat?.pages[card.pageId];
    if (p && !isMassAttack(p.type) && p.type !== "instant" && withTargets.length === 1) setPending({ category: cat, card, target: withTargets[0] });
    else void place(cat, card, withTargets);
  };

  const selectCard = (cat: Category, card: Card) => {
    setCategory(cat);
    setSelected((s) => ({ ...s, [cat]: card.id }));
    setViewing(null);
    // Picking a Page goes straight to picking its target.
    setTarget(undefined);
    if (combat && mine) setOverlay("targets");
  };

  const pickTarget = (tokenId: string) => {
    if (mass) {
      if (canAct) void act({ type: "aimTarget", tokenId });
      return;
    }
    setTarget(tokenId);
    setOverlay(null);
    if (page && selectedCard && canAct && inRange.has(tokenId)) use(category, selectedCard, [tokenId]);
  };

  const endTurn = () => {
    const affordable = cardsIn("combat").some((x) => (combat?.pages[x.pageId]?.cost ?? Infinity) <= (r?.light ?? 0));
    if (freeDice.length > 0 && affordable && !confirm("You still have a free Speed Die and a Page you can afford. End your turn?")) return;
    void act({ type: "endTurn" });
  };

  // On parts of the sheet the GM approves (game settings), a change waits in the sheet's pendingEdits instead.
  const needApproval = partsNeedingApproval(gameDoc.data);
  const change = (part: PlayerEditKey, direct: Record<string, unknown>, fn: (draft: Character) => void) => {
    if (!user || !characterDoc.data) return;
    const ref = doc(db, "games", id, "characters", user.id);
    if (!needApproval.includes(part)) return void updateDoc(ref, direct).catch((e) => setError(friendlyError(e)));
    const saved = { ...blankCharacter(user.id, ""), ...characterDoc.data };
    const view = structuredClone(withProposals(saved));
    fn(view);
    updateDoc(ref, { pendingEdits: proposeEdits(view, saved, needApproval).pendingEdits ?? deleteField() })
      .then(() => setNotice("Sent to your GM for approval."))
      .catch((e) => setError(friendlyError(e)));
  };
  const useItem = (itemId: string) => {
    if (!c) return;
    // Uses count down against the item's current details from the library.
    change("inventory", { "inventory.items": useItemIn(c.inventory.items, itemId) }, (d) => {
      d.inventory.items = useItemIn(linkInventory(d, library).inventory.items, itemId);
    });
  };
  const raiseStat = (group: "primary" | "secondary", key: string) => {
    if (!c) return;
    const current = (c[group] as Record<string, number>)[key] ?? 0;
    change("stats", { [`${group}.${key}`]: current + 1 }, (d) => {
      const stats = d[group] as Record<string, number>;
      stats[key] = (stats[key] ?? 0) + 1;
    });
  };

  const resources = [
    { cls: "res-hp", label: "Health", v: r?.hp, max: r?.maxHp },
    { cls: "res-stagger", label: "Stagger", v: r?.stagger, max: r?.maxStagger },
    { cls: "res-sanity", label: "Sanity", v: r?.sanity, max: r?.maxSanity },
    { cls: "res-light", label: "Light", v: r?.light, max: r?.maxLight },
  ];
  const others = Object.values(table.tokens).filter((t) => t.id !== mine?.id && !t.status?.knockedOut);
  const stats = [
    ...PRIMARY_STATS.map((s) => ({ key: s.key as string, label: s.label, v: c?.primary[s.key] ?? 0 })),
    ...SECONDARY_STATS.map((s) => ({ key: s.key, label: s.label, v: c?.secondary[s.key] ?? 0 })),
  ];
  const cards = cardsIn(category);

  return (
    <main className="player-screen">
      {/* ---- Top: who you are, resources, actions ---- */}
      <section className="player-top">
        <div className="pt-who">
          <Portrait token={mine} size={64} />
          <Link to={sheetUrl} className="pt-name">
            {mine?.name ?? c?.name ?? "…"}
          </Link>
        </div>
        <div className="pt-res">
          {resources.map((x) => (
            <div key={x.label} className={`res-box ${x.cls}`} aria-label={`${x.label} ${x.v ?? "?"} of ${x.max ?? "?"}`}>
              <span className="res-label">{x.label}</span>
              <span className="res-val">
                {x.v ?? "–"}/{x.max ?? "–"}
              </span>
            </div>
          ))}
        </div>
        <div className="pt-actions">
          <button type="button" onClick={() => setOverlay("info")}>
            Character information
          </button>
          <button type="button" disabled={!canAct} onClick={endTurn}>
            End turn
          </button>
          <button type="button" disabled={!canAct || (r?.light ?? 0) < DASH_LIGHT_COST} onClick={() => void act({ type: "dash" })}>
            Dash
          </button>
          <button type="button" disabled={!mine} onClick={() => setOverlay("story")}>
            Story roll
          </button>
        </div>
        <div className="pt-side">
          <button type="button" onClick={() => setOverlay("cycle")}>
            Cycle characters
          </button>
          <button type="button" onClick={() => setOverlay("effects")}>
            Effects{mine?.effects?.length ? ` (${mine.effects.length})` : ""}
          </button>
        </div>
      </section>

      {/* ---- Turn state ---- */}
      <div className={"turn-strip" + (myTurn ? " mine" : "")}>
        {combat ? (
          <span>
            <strong>{myTurn ? "Your turn" : `${active?.name ?? "—"}'s turn`}</strong> · Round {combat.round} · {PHASE_LABELS[combat.phase]}
            {myTurn && ` · ${combat.movementLeft} Movement, move on the board`}
          </span>
        ) : (
          <span>Not in combat. Move by tapping your token on the board.</span>
        )}
        <ConnectionBadge status={snapshot.status} />
      </div>
      {mine?.status?.staggered && (
        <div className="player-msg staggered" role="status">
          <strong>Staggered.</strong> You can't act and your Resistances are {STAGGERED_RESISTANCE}x.{" "}
          {combat && (STAGGER_UPKEEPS - (mine.status.staggerUpkeeps ?? 0) <= 1 ? "You recover at your next Upkeep." : `You recover after ${STAGGER_UPKEEPS - (mine.status.staggerUpkeeps ?? 0)} more Upkeeps.`)}
        </div>
      )}
      {(error || notice) && (
        <button type="button" className={"player-msg" + (error ? " error" : "")} onClick={() => (setError(""), setNotice(""))}>
          {error || notice}
        </button>
      )}

      {!c && (
        <div className="player-nochar">
          <p className="muted">You don't have a character in this game yet.</p>
          <Link className="big-button" to={sheetUrl}>
            Create my character
          </Link>
        </div>
      )}

      {/* ---- Bottom: Pages you can use ---- */}
      <section className="player-bottom">
        {combat && mine && deck && (
          <div className="select-strip">
            {problem && !PICK_PROMPTS.includes(problem) && (
              <span className="chip static warn" role="status">
                {problem}
              </span>
            )}
            {page && selectedCard && !problem && (
              <button type="button" className="chip go" onClick={() => use(category, selectedCard, targets)}>
                Use{mass ? ` on ${targets.length}` : ""}
              </button>
            )}
            {(page || target) && (
              <button type="button" className="chip" onClick={() => clearSelection()}>
                Clear
              </button>
            )}
          </div>
        )}
        <div className="pb-main">
          <div className="hand-row" role="list" aria-label={`${CATEGORIES.find((x) => x.key === category)!.label} Pages`}>
            {combat && deck ? (
              cards.length ? (
                cards.map((card) => {
                  const p = combat.pages?.[card.pageId];
                  if (!p) return null;
                  return (
                    <div role="listitem" key={card.id}>
                      <PvCard page={p} size="hand" selected={selected[category] === card.id} dim={p.cost > (r?.light ?? 0)} onClick={() => setViewing({ page: p, card, category })} />
                    </div>
                  );
                })
              ) : (
                <p className="muted small hand-empty">{category === "combat" ? "No Pages in hand." : "None available."}</p>
              )
            ) : (
              <p className="muted small hand-empty">
                {category === "combat" ? (
                  <>
                    Your hand is drawn when combat starts. <Link to={`${sheetUrl}?tab=decks`}>Edit decks</Link>
                  </>
                )
                  : category === "ego"
                    ? `${c?.ego?.length ?? 0} E.G.O. Page${c?.ego?.length === 1 ? "" : "s"} ready for combat.`
                    : "Your Tools' Pages are ready for combat."}
              </p>
            )}
          </div>
          <div className="pb-cats">
            {CATEGORIES.map((x) => (
              <button
                type="button"
                key={x.key}
                className={"cat" + (category === x.key ? " active" : "") + (selected[x.key] ? " has-pick" : "")}
                aria-pressed={category === x.key}
                onClick={() => setCategory(x.key)}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Popups ---- */}
      {overlay === "cycle" && <CycleCharacters table={table} meId={mine?.id} onClose={() => setOverlay(null)} onOpenPage={(p) => setViewing({ page: p })} />}
      {overlay === "effects" && <EffectsView effects={mine?.effects ?? []} onClose={() => setOverlay(null)} />}
      {overlay === "info" && (
        <Overlay title="Character information" onClose={() => setOverlay(null)}>
          {c ? (
            <div className="info-grid">
              {INFO_BUTTONS.map((b) => (
                <button type="button" key={b.key} className="info-tile" onClick={() => (setPanel(b.key), setOverlay(null))}>
                  <span className="car-letter">{b.key}</span>
                  <span className="car-label">{b.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <Link className="big-button" to={sheetUrl}>
              Create my character
            </Link>
          )}
        </Overlay>
      )}
      {panel && c && (
        <Overlay title={PANELS.find((p) => p.key === panel)!.title} onClose={() => setPanel(null)}>
          <InfoPanel panel={panel} c={c} sheetUrl={sheetUrl} onOpenPage={(p) => setViewing({ page: p })} onUseItem={useItem} onRaiseStat={raiseStat} />
          <button type="button" onClick={() => (setPanel(null), setOverlay("info"))}>
            ‹ Character information
          </button>
        </Overlay>
      )}
      {pending && combat && combat.pages[pending.card.pageId] && (
        <SlotChoice
          table={table}
          page={combat.pages[pending.card.pageId]}
          meId={mine?.id}
          targetId={pending.target}
          onClose={() => setPending(null)}
          onPick={(how) => {
            setPending(null);
            void place(pending.category, pending.card, [pending.target], how);
          }}
        />
      )}
      {overlay === "targets" && (
        <Overlay title={mass ? "Pick targets" : "Pick a target"} onClose={() => setOverlay(null)}>
          {page && <p className="muted small">For {page.name || "this Page"}: highlighted names are in range. You can also tap a lit token on the board.</p>}
          <ul className="plain target-list">
            {others.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={"target-pick" + (targets.includes(t.id) ? " active" : "") + (page ? (inRange.has(t.id) ? " near" : " far") : "")}
                  disabled={mass && !canAct}
                  onClick={() => pickTarget(t.id)}
                >
                  <Portrait token={t} size={36} />
                  <span>{t.name}</span>
                  <span className="muted small">{page ? (inRange.has(t.id) ? "in range" : "out of range") : t.side}</span>
                </button>
              </li>
            ))}
          </ul>
          {mass && selectedCard && (
            <button type="button" className="big-button" disabled={!!problem} onClick={() => (setOverlay(null), void place(category, selectedCard, targets))}>
              Use on {targets.length} target{targets.length === 1 ? "" : "s"}
            </button>
          )}
        </Overlay>
      )}
      {overlay === "story" && mine && (
        <Overlay title="Story Roll" onClose={() => setOverlay(null)}>
          <p className="muted small">Rolls 1d{STORY_DIE} + the Stat. Everyone sees the result in the table log.</p>
          <div className="story-grid">
            {stats.map((s) => (
              <button
                type="button"
                key={s.key}
                className="story-stat"
                onClick={async () => {
                  setOverlay(null);
                  const tail = table.log.slice(-10).join("\n");
                  const label = s.key.charAt(0).toUpperCase() + s.key.slice(1).toLowerCase();
                  if (await act({ type: "storyRoll", tokenId: mine.id, stat: s.key })) setAwaitingRoll({ prefix: `${mine.name} makes a ${label} Story Roll`, tail });
                }}
              >
                <span className="story-name">
                  <AnyStatIcon stat={s.key} /> {s.label}
                </span>
                <span className="muted">+{s.v}</span>
              </button>
            ))}
          </div>
        </Overlay>
      )}
      {/* Last, so a Page opened from another popup (e.g. Cycle characters) shows on top of it. */}
      {viewing && (
        <PageView
          page={viewing.page}
          onClose={() => setViewing(null)}
          action={
            viewing.card && viewing.category
              ? selected[viewing.category] === viewing.card.id
                ? { label: "Choose target", run: () => (setCategory(viewing.category!), setViewing(null), setOverlay("targets")) }
                : { label: "Select this Page", run: () => selectCard(viewing.category!, viewing.card!) }
              : undefined
          }
        />
      )}
    </main>
  );
}
