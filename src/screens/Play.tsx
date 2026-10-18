import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import type { Character, ItemTemplate, Page } from "../../shared/character.ts";
import { activeToken, canRecoverFromPanic, canRevive, revivable, validTargets } from "../../shared/engine.ts";
import { blankCharacter, linkInventory, moveCost, pageRange, PANIC_TYPES, PANIC_UPKEEPS, STAGGER_UPKEEPS, STAGGERED_RESISTANCE, asMeleeWithoutAmmo, isAmmo, isMassAttack, PRIMARY_STATS, SECONDARY_STATS, STORY_DIE, useItemIn } from "../../shared/ruleset.ts";
import { partsNeedingApproval, proposeEdits, withProposals } from "../../shared/permissions.ts";
import { playersCanStoryRoll, rangedPagesUseAmmo, type Card, type GameDoc, type PageSource, type PlayerEditKey, type TableAction } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { PHASE_LABELS } from "../components/ActionPanel.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { Waiting } from "../components/Waiting.tsx";
import { useClashPlayback } from "../components/ClashFx.tsx";
import { SpeedRollCard, useSpeedRollPlayback } from "../components/SpeedRollFx.tsx";
import { StoryRollCard, useStoryRollPlayback } from "../components/StoryRollFx.tsx";
import { CycleCharacters, Portrait, SpeedDiceRows } from "../components/player/CombatViews.tsx";
import { EffectsBar } from "../components/effects/StatusIcons.tsx";
import { useEffectLibrary } from "../components/effects/library.tsx";
import { InfoPanel, PANELS, type PanelKey } from "../components/player/InfoPanels.tsx";
import { AnyStatIcon } from "../components/LorIcons.tsx";
import { Overlay } from "../components/player/Overlay.tsx";
import { GmPopupView } from "../components/player/GmPopupView.tsx";
import { PvCard } from "../components/player/LorCard.tsx";
import { PageView } from "../components/player/PageView.tsx";
import { SlotChoice } from "../components/player/SlotChoice.tsx";
import { FullCoverChoice } from "../components/SlotPages.tsx";
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

type OverlayKey = "cycle" | "info" | "story" | "targets";

/** A single-target Page about to be slotted, waiting on Clash or Unopposed (and which Speed Die). */
/** How a Page is slotted: on which of the target's Speed Dice, Unopposed, and with which Ammo. */
type SlotHow = { targetDie?: number; unopposed?: boolean; ammo?: string; noAmmo?: boolean; resolveNow?: boolean };

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
  // A Ranged Page waiting on which Ammo to fire it with (Game setting "Ranged Pages use Ammo").
  const [loading, setLoading] = useState<{ cat: Category; card: Card; targets?: string[]; how: SlotHow } | null>(null);
  // Full Cover questions this player put off for now (the Page holds fire if it's still unanswered when it resolves).
  const [later, setLater] = useState<string[]>([]);
  const [target, setTarget] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // GM popups this player just closed, hidden before the host confirms.
  const [closedPopups, setClosedPopups] = useState<string[]>([]);

  // Clash damage shows once its die has played on the board.
  const { table } = useClashPlayback(snapshot.table);
  const speed = useSpeedRollPlayback(snapshot.table);
  // Players make their own Story Rolls unless the GM turned that off (game settings).
  const canStoryRoll = playersCanStoryRoll(gameDoc.data);
  // Your own Story Rolls play here as they do on the board.
  const story = useStoryRollPlayback(snapshot.table);
  const combat = table?.combat;
  const mine = table ? Object.values(table.tokens).find((t) => t.ownerId === user?.id) : undefined;
  const library = useCollection<ItemTemplate>(`games/${id}/items`);
  const effectLibrary = useEffectLibrary(id);
  const c: Character | undefined = characterDoc.data && user ? linkInventory({ ...blankCharacter(user.id, ""), ...characterDoc.data }, library) : undefined;
  const deck = combat && mine ? combat.decks?.[mine.id] : undefined;
  const active = table ? activeToken(table) : undefined;
  const myTurn = !!mine && active?.id === mine.id;
  const canAct = myTurn && combat?.phase === "actions";
  const myStory = story && story.tokenId === mine?.id ? story : null;
  const myDice = (combat && mine && combat.order?.find((x) => x.tokenId === mine.id)?.dice) || 0;
  const useAmmo = rangedPagesUseAmmo(gameDoc.data);
  // How I'm Panicking, if I am.
  const panic = mine?.status?.panic ? mine.status.panicType : undefined;
  const ammo = (c?.inventory.items ?? []).filter(isAmmo);
  // My Ranged Pages whose target the GM says is moving into Full Cover: fire now or hold fire.
  const coverAsk = (combat?.slots ?? []).find((s) => s.ownerId === mine?.id && s.cover === "full" && !later.includes(s.id));

  const cardsIn = (cat: Category): Card[] => (!deck ? [] : cat === "combat" ? (deck.hand ?? []) : cat === "ego" ? (deck.ego ?? []) : (deck.aux ?? []));
  const selectedCard = cardsIn(category).find((x) => x.id === selected[category]);
  const page = selectedCard && combat ? combat.pages?.[selectedCard.pageId] : undefined;
  const source = sourceOf(category);
  const mass = !!page && isMassAttack(page.type);
  // A Ranged Page with no Ammo to fire (Game setting "Ranged Pages use Ammo") reaches only as far as a Melee Page.
  const reach = page && useAmmo && page.type === "ranged" && ammo.length === 0 ? asMeleeWithoutAmmo(page) : page;
  const inRange = useMemo(() => new Set(reach && mine && table ? validTargets(table, mine, reach).map((t) => t.id) : []), [reach, mine, table]);
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

  if (!table || snapshot.status === "closed") return <Waiting snapshot={snapshot} gameId={id} />;
  const sheetUrl = `/games/${id}/characters/${user?.id}`;
  const r = mine?.resources;

  // Why the current selection can't be used yet; "" when it can.
  const problem = (() => {
    if (!combat) return "Combat hasn't started";
    if (!mine || !deck) return "You're not in this combat";
    if (!canAct) return myTurn ? "Wait for Combat Actions" : `Waiting for ${active?.name ?? "the next turn"}`;
    if (!page) return "Pick a Page";
    if (category === "aux" && panic === 4) return "Panicking: no Auxiliary Pages";
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

  /** Pay and slot a Page on the first free Speed Die against the chosen target(s). Ranged Pages may ask for Ammo first. */
  const place = async (cat: Category, card: Card, withTargets?: string[], how: SlotHow = {}) => {
    if (useAmmo && combat?.pages[card.pageId]?.type === "ranged" && !how.ammo && !how.noAmmo) return setLoading({ cat, card, targets: withTargets, how });
    if (!(await act({ type: "aim", source: sourceOf(cat), cardId: card.id }))) return;
    // With no Ammo, the host uses it as a Melee Page on its own: nothing extra to send.
    const { noAmmo: _none, ...send } = how;
    if (await act({ type: "slot", targets: withTargets, ...send })) clearSelection(cat);
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
  const others = Object.values(table.tokens).filter((t) => t.id !== mine?.id && (!t.status?.knockedOut || revivable(table, t)));
  const stats = [
    ...PRIMARY_STATS.map((s) => ({ key: s.key as string, label: s.label, v: c?.primary[s.key] ?? 0 })),
    ...SECONDARY_STATS.map((s) => ({ key: s.key, label: s.label, v: c?.secondary[s.key] ?? 0 })),
  ];
  const cards = cardsIn(category);
  const gmPopups = (snapshot.popups ?? []).filter((p) => !closedPopups.includes(p.id));
  const closeGmPopup = (popupId: string) => {
    setClosedPopups((x) => [...x, popupId]);
    void act({ type: "closePopup", popupId }).then((ok) => !ok && setClosedPopups((x) => x.filter((y) => y !== popupId)));
  };

  return (
    <main className="player-screen">
      {/* ---- Top: who you are, resources, actions ---- */}
      <section className="player-top">
        <button type="button" className="pt-who" aria-label="Character information" onClick={() => setOverlay("info")}>
          <Portrait token={mine} size={64} />
          <span className="pt-name">{mine?.name ?? c?.name ?? "…"}</span>
        </button>
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
        {/* One row under the portrait and resources; Cycle characters takes it all when Story Rolls are off. */}
        <div className="pt-actions">
          {canStoryRoll && (
            <button type="button" disabled={!mine} onClick={() => setOverlay("story")}>
              Story roll
            </button>
          )}
          <button type="button" onClick={() => setOverlay("cycle")}>
            Cycle characters
          </button>
        </div>
      </section>
      {/* Effects on you: tap an icon for what it does. Always one row tall, so nothing under it moves. */}
      <EffectsBar className="player-effects" effects={mine?.effects ?? []} library={effectLibrary} size={44} empty="No effects on you." />

      {/* ---- Turn state ---- */}
      <div className={"turn-strip" + (myTurn ? " mine" : "")}>
        {combat ? (
          <span>
            <strong>{myTurn ? "Your turn" : active ? `${active.name}'s turn` : "Someone else's turn"}</strong> · Round {combat.round} · {PHASE_LABELS[combat.phase]}
            {myTurn && ` · ${combat.movementLeft} Movement, move on the board`}
          </span>
        ) : (
          <span>Not in combat. Move by tapping your token on the board.</span>
        )}
        <ConnectionBadge status={snapshot.status} />
      </div>
      {speed && combat && <SpeedRollCard step={speed} tokenId={mine?.id} order={combat.order} />}
      {myStory && <StoryRollCard step={myStory} />}
      {mine?.status?.staggered && (
        <div className="player-msg staggered" role="status">
          <strong>Staggered.</strong> You can't act and your Resistances are {STAGGERED_RESISTANCE}x.{" "}
          {combat && (STAGGER_UPKEEPS - (mine.status.staggerUpkeeps ?? 0) <= 1 ? "You recover at your next Upkeep." : `You recover after ${STAGGER_UPKEEPS - (mine.status.staggerUpkeeps ?? 0)} more Upkeeps.`)}
        </div>
      )}
      {panic && (
        <div className="player-msg panic" role="status">
          <strong>Panic: {PANIC_TYPES[panic].label}.</strong> {PANIC_TYPES[panic].effect[0].toUpperCase() + PANIC_TYPES[panic].effect.slice(1)}, and your Sanity is stuck at its minimum.{" "}
          {PANIC_UPKEEPS - (mine?.status?.panicUpkeeps ?? 0) <= 1 ? "You recover at your next Upkeep." : `You recover after ${PANIC_UPKEEPS - (mine?.status?.panicUpkeeps ?? 0)} more Upkeeps.`}
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

      {/* ---- Middle: your slotted Pages, with a clash preview for each clash (like Cycle characters) ---- */}
      {combat && mine && myDice > 0 && (
        <section className="player-slots" aria-label="Your slotted Pages">
          <SpeedDiceRows table={table} tokenId={mine.id} onOpenPage={(p) => setViewing({ page: p })} preview />
        </section>
      )}

      {/* ---- Bottom: Pages you can use ---- */}
      <section className="player-bottom">
        {canAct && (
          <button type="button" className="big-button end-turn" onClick={endTurn}>
            End turn
          </button>
        )}
        {combat && mine && deck && (
          // Always one row tall, and Clear comes first, so picking a Page never moves End turn or Clear.
          <div className="select-strip">
            {(page || target) && (
              <button type="button" className="chip" onClick={() => clearSelection()}>
                Clear
              </button>
            )}
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
      {overlay === "cycle" && (
        <CycleCharacters
          table={table}
          meId={mine?.id}
          library={effectLibrary}
          onClose={() => setOverlay(null)}
          onOpenPage={(p) => setViewing({ page: p })}
          recovery={{
            shows: (t) => !!combat && canRecoverFromPanic(mine, t),
            blocked: !canAct ? "You can use it on your turn, during Combat Actions." : combat?.panicRecoveryUsed ? "You already tried Panic recovery this turn." : "",
            onUse: (t) => void act({ type: "panicRecovery", tokenId: t.id }).then((ok) => ok && setOverlay(null)),
          }}
          revive={{
            shows: (t) => !!combat && canRevive(table, mine, t),
            blocked: !canAct ? "You can use it on your turn, during Combat Actions." : combat?.koRecoveryUsed ? "You already tried to revive someone this turn." : "",
            onUse: (t) => void act({ type: "koRecovery", tokenId: t.id }).then((ok) => ok && setOverlay(null)),
          }}
        />
      )}
      {overlay === "info" && (
        <Overlay title="Character information" onClose={() => setOverlay(null)}>
          {c ? (
            <>
            <Link className="small" to={sheetUrl}>
              Open my full character sheet ›
            </Link>
            <div className="info-grid">
              {INFO_BUTTONS.map((b) => (
                <button type="button" key={b.key} className="info-tile" onClick={() => (setPanel(b.key), setOverlay(null))}>
                  <span className="car-letter">{b.key}</span>
                  <span className="car-label">{b.label}</span>
                </button>
              ))}
            </div>
            </>
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
      {loading && combat && (
        <Overlay title={ammo.length ? "Pick your Ammo" : "No Ammo"} onClose={() => setLoading(null)}>
          {ammo.length === 0 ? (
            <>
              <p className="small">
                You have no Ammo, so {combat.pages[loading.card.pageId]?.name || "this Ranged Page"} is used as a <strong>Melee Page</strong> and every die rolls with{" "}
                <strong>disadvantage</strong>.
              </p>
              <div className="row">
                <button type="button" onClick={() => setLoading(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="big-button"
                  onClick={() => {
                    const l = loading;
                    setLoading(null);
                    void place(l.cat, l.card, l.targets, { ...l.how, noAmmo: true });
                  }}
                >
                  Use it as a Melee Page
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">Firing {combat.pages[loading.card.pageId]?.name || "this Ranged Page"} spends one.</p>
              <ul className="plain target-list">
                {ammo.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className="target-pick ammo-pick"
                      onClick={() => {
                        const l = loading;
                        setLoading(null);
                        void place(l.cat, l.card, l.targets, { ...l.how, ammo: i.id });
                      }}
                    >
                      <strong>{i.name || "Ammo"}</strong>
                      <span className="muted small">{i.count} left</span>
                      {i.description && <span className="muted small ammo-desc">{i.description}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Overlay>
      )}
      {coverAsk && combat && combat.pages[coverAsk.pageId] && (
        <Overlay title="Full Cover" onClose={() => setLater((x) => [...x, coverAsk.id])}>
          <FullCoverChoice
            slot={coverAsk}
            page={combat.pages[coverAsk.pageId]}
            target={table.tokens[coverAsk.targets[0]?.tokenId]?.name ?? "Your target"}
            owner={mine?.name ?? "You"}
            decides
            act={(a) => void act(a)}
          />
          <p className="muted small">If you don't answer, it holds fire when it would resolve.</p>
        </Overlay>
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
                  <span className="muted small">
                    {page ? (!inRange.has(t.id) ? "out of range" : reach && mine && moveCost(mine, t) > pageRange(reach) ? "attacking an ally: Clash to guard" : "in range") : t.side}
                  </span>
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
      {overlay === "story" && mine && canStoryRoll && (
        <Overlay title="Story Roll" onClose={() => setOverlay(null)}>
          <p className="muted small">Rolls 1d{STORY_DIE} + the Stat. Everyone sees the result in the table log.</p>
          <div className="story-grid">
            {stats.map((s) => (
              <button
                type="button"
                key={s.key}
                className="story-stat"
                onClick={() => {
                  setOverlay(null);
                  // The dice show the result here and on the board.
                  void act({ type: "storyRoll", tokenId: mine.id, stat: s.key });
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
      {/* The GM's popups, oldest first, one at a time. */}
      {gmPopups[0] && (
        <GmPopupView
          key={gmPopups[0].id}
          popup={gmPopups[0]}
          more={gmPopups.length - 1}
          stats={Object.fromEntries(stats.map((s) => [s.key, s.v]))}
          canRoll={!!mine}
          onRoll={async (stat) => {
            const popup = gmPopups[0];
            // The dice show the roll on this screen, so the popup closes, unless it has a deal to settle.
            if ((await act({ type: "popupRoll", popupId: popup.id, stat })) && !popup.deal) closeGmPopup(popup.id);
          }}
          onBuy={() => void act({ type: "popupBuy", popupId: gmPopups[0].id })}
          ahn={characterDoc.data?.ahn ?? 0}
          onClose={() => closeGmPopup(gmPopups[0].id)}
        />
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
