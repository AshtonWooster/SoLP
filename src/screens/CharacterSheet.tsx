import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import type { Character, ItemTemplate } from "../../shared/character.ts";
import { blankCharacter, characterChecks, linkInventory } from "../../shared/ruleset.ts";
import { approveEdits, describeEdits, partsNeedingApproval, proposeEdits, rejectEdits, withProposals } from "../../shared/permissions.ts";
import { type GameDoc, PLAYER_EDIT_OPTIONS, type PlayerEditKey, playersCanCreateEffects, type TableState } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { DeckTab } from "../components/DeckTab.tsx";
import { AugmentTab } from "../components/creator/AugmentTab.tsx";
import { CharacterCreator, type CreatorStep } from "../components/creator/CharacterCreator.tsx";
import { InventoryTab } from "../components/items/InventoryTab.tsx";
import { Section } from "../components/Fields.tsx";
import { EffectLibraryContext, useLibraryValue } from "../components/effects/library.tsx";
import { linkLibrary } from "../../shared/effects.ts";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

type SaveState = "idle" | "saving" | "saved" | "error";
const SAVE_DELAY_MS = 800;

/**
 * Loads a character and saves edits shortly after each change. Edits made elsewhere (the GM,
 * another device) are picked up whenever there are no unsaved local edits.
 *
 * The sheet's player sees their changes waiting for the GM's approval in place; their edits to
 * parts the GM approves (needApproval) are saved as proposals instead (shared/permissions.ts).
 */
function useCharacter(gameId: string, uid: string, fallbackName: string, canEdit: boolean, isPlayer: boolean, needApproval: PlayerEditKey[]) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [error, setError] = useState("");
  const [save, setSave] = useState<SaveState>("idle");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Character | null>(null);
  // The sheet as last saved, and the parts whose changes need approval right now.
  const saved = useRef<Character | null>(null);
  const approval = useRef(needApproval);
  approval.current = needApproval;
  const proposer = useRef(isPlayer);
  proposer.current = isPlayer;
  const ref = doc(db, "games", gameId, "characters", uid);

  useEffect(
    () =>
      onSnapshot(
        ref,
        (snap) => {
          if (dirty.current || snap.metadata.hasPendingWrites) return;
          const data = snap.data() as Character | undefined;
          // Fill in anything added to the sheet since this character was saved.
          const c = data ? { ...blankCharacter(uid, fallbackName), ...data } : null;
          saved.current = c;
          const view = c && proposer.current ? withProposals(c) : c;
          latest.current = view;
          setCharacter(view);
        },
        (err) => setError(friendlyError(err)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameId, uid],
  );

  const write = async () => {
    const c = latest.current;
    if (!c) return;
    setSave("saving");
    try {
      const out = { ...(proposer.current ? proposeEdits(c, saved.current ?? c, approval.current) : c), updatedAt: Date.now() };
      await setDoc(ref, out);
      saved.current = out;
      dirty.current = false;
      setSave("saved");
    } catch (err) {
      setSave("error");
      setError(friendlyError(err));
    }
  };

  // Save right away if the page closes with unsaved edits.
  useEffect(() => {
    const flush = () => {
      if (dirty.current) void write();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      clearTimeout(timer.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, uid]);

  const update = (fn: (draft: Character) => void) => {
    if (!canEdit || !latest.current) return;
    const next = structuredClone(latest.current);
    fn(next);
    latest.current = next;
    setCharacter(next);
    dirty.current = true;
    setSave("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(write, SAVE_DELAY_MS);
  };

  const create = () => {
    const c = blankCharacter(uid, fallbackName);
    latest.current = c;
    setCharacter(c);
    dirty.current = true;
    void write();
  };

  /** The player takes back their changes to a part waiting for approval. */
  const withdraw = (key: PlayerEditKey) =>
    update((d) => {
      const base = saved.current;
      if (!base) return;
      for (const f of PLAYER_EDIT_OPTIONS.find((o) => o.key === key)!.fields) (d as unknown as Record<string, unknown>)[f] = structuredClone(base[f as keyof Character]);
    });

  return { character, error, save, update, create, withdraw };
}

const TABS = [
  ["sheet", "Character"],
  ["augment", "Augment & Proficiencies"],
  ["decks", "Equipment & Decks"],
  ["inventory", "Inventory"],
] as const;
type Tab = (typeof TABS)[number][0];
const CREATOR_STEPS: CreatorStep[] = ["intro", "license", "stats", "story", "summary"];

/** For the GM: the player's changes waiting for approval, part by part, to approve or reject. */
function PendingEdits({ c, name, update }: { c: Character; name: string; update: (fn: (d: Character) => void) => void }) {
  return (
    <section className="panel pending-edits" aria-label="Changes waiting for approval">
      <h2>{name}'s changes waiting for your approval</h2>
      <ul className="plain">
        {PLAYER_EDIT_OPTIONS.filter((o) => c.pendingEdits?.[o.key]).map((o) => {
          const lines = describeEdits(c, o.key);
          return (
            <li key={o.key} className="pending-edit">
              <div>
                <strong>{o.label}</strong>
                <span className="muted small">{lines.length ? lines.join(" · ") : "No difference from the sheet now"}</span>
              </div>
              <div className="row">
                <button type="button" className="chip go" onClick={() => update((d) => approveEdits(d, o.key))}>
                  Approve
                </button>
                <button type="button" onClick={() => update((d) => rejectEdits(d, o.key))}>
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Character creation and editing: a stepped creator, then a tab each for the rest (Act 5). */
export function CharacterSheet() {
  const { id = "", uid = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const effects = useLibraryValue(id, user?.id, isGm, playersCanCreateEffects(game.data));
  const isMine = user?.id === uid;
  const canEdit = isMine || isGm;
  const ownerName = game.data?.members[uid]?.displayName ?? "";
  // Parts of the sheet whose changes the GM approves (game settings). The GM's own edits apply directly.
  const needApproval = isMine && !isGm ? partsNeedingApproval(game.data) : [];
  const { character: c, error, save, update, create, withdraw } = useCharacter(id, uid, ownerName, canEdit, isMine && !isGm, needApproval);
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some(([t]) => t === params.get("tab")) ? (params.get("tab") as Tab) : "sheet";
  // Decks can't change mid-combat (Act 6). The GM's table saves combat state every few seconds.
  const table = useDoc<TableState>(`games/${id}/table/state`);
  // The GM's item library: inventory items take their details from it.
  const library = useCollection<ItemTemplate>(`games/${id}/items`);
  const decksLocked = !!table.data?.combat && !isGm;
  // On parts the GM approves, the player's changes wait for the GM: say so, and let them take the changes back.
  const approvalNote = (key: PlayerEditKey) => {
    if (!needApproval.includes(key) || !c) return null;
    const label = PLAYER_EDIT_OPTIONS.find((o) => o.key === key)!.label;
    return c.pendingEdits?.[key] ? (
      <div className="notice small lock-note row-between">
        <span>Your changes to {label} are waiting for your GM's approval. Until then the table uses what your GM last approved.</span>
        <button type="button" onClick={() => withdraw(key)}>
          Withdraw changes
        </button>
      </div>
    ) : (
      <p className="notice small lock-note">Your GM approves changes to {label}. Edit away: your changes take effect once your GM approves them.</p>
    );
  };

  if (game.error || error) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">{game.error || error}</p>
          <Link to={`/games/${id}`}>Back to the game</Link>
        </main>
      </>
    );
  }
  if (game.loading) return <main className="center muted">Loading…</main>;
  const owner = game.data?.members[uid];
  if (!owner || owner.role !== "player") {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">That player isn't in this game.</p>
          <Link to={`/games/${id}`}>Back to the game</Link>
        </main>
      </>
    );
  }

  if (!c) {
    return (
      <>
        <TopBar />
        <main className="center">
          <Link to={`/games/${id}`} className="muted">← {game.data!.name}</Link>
          {isMine ? (
            <>
              <h1>Create your character</h1>
              <p className="muted">Everything saves as you go, so you can stop and come back anytime.</p>
              <button
                className="big-button"
                onClick={() => {
                  create();
                  setParams({ step: "intro" }, { replace: true });
                }}
              >
                Start
              </button>
            </>
          ) : (
            <p className="muted">{owner.displayName} hasn't created a character yet.</p>
          )}
        </main>
      </>
    );
  }

  // Slotted Passives and Proficiencies show what the shared effect library says now.
  const sheet = linkLibrary(c, effects.library);
  const checks = characterChecks(linkInventory(sheet, library));
  // A new character starts on the intro (Start opens it); coming back later opens the summary.
  const stepParam = params.get("step") as CreatorStep | null;
  const step: CreatorStep = stepParam && CREATOR_STEPS.includes(stepParam) ? stepParam : c.name.trim() ? "summary" : "intro";
  const setStep = (s: CreatorStep) => {
    setParams({ step: s }, { replace: true });
    window.scrollTo({ top: 0 });
  };
  const goTab = (t: Tab) => setParams(t === "sheet" ? {} : { tab: t }, { replace: true });

  return (
    <EffectLibraryContext.Provider value={effects}>
      <TopBar />
      <main className={"sheet wide" + (tab === "sheet" ? " creator-mode" : "")}>
        <header className="sheet-header">
          <Link to={`/games/${id}`} className="muted">← {game.data!.name}</Link>
          <h1>{c.name.trim() || "Unnamed character"}</h1>
          <p className="muted">
            {isMine ? "Your character" : `${owner.displayName}'s character`} · Rank {c.rank}
            <span className={`save-state ${save}`}>
              {save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "error" ? "Not saved" : ""}
            </span>
          </p>
          {!canEdit && <p className="muted">Only {owner.displayName} and the GM can edit this sheet.</p>}
          {isGm && c.pendingEdits && <PendingEdits c={c} name={owner.displayName} update={update} />}
          <nav className="tabs" role="tablist">
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "tab active" : "tab"} onClick={() => goTab(t)}>
                {label}
              </button>
            ))}
          </nav>
        </header>

        {tab === "sheet" && (
          <fieldset disabled={!canEdit} className="sheet-body">
            <CharacterCreator c={sheet} update={update} isGm={isGm} canEdit={canEdit} statsNote={approvalNote("stats")} gameId={id} uid={uid} checks={checks} step={step} setStep={setStep} goTab={goTab} />
          </fieldset>
        )}

        {tab === "augment" && (
          <fieldset disabled={!canEdit} className="sheet-body">
            {approvalNote("augment")}
            <AugmentTab c={sheet} update={update} />
          </fieldset>
        )}

        {tab === "inventory" && (
          <fieldset disabled={!canEdit} className="sheet-body">
            {approvalNote("inventory")}
            <Section id="inventory" title="Inventory" intro="Each Slot holds one item, or a stack of one stacking item. Usable items add their Page to your Auxiliary Deck. Your one Trinket is active only while in the Trinket Slot. Hover an item to see its card.">
              <InventoryTab c={c} library={library} gameId={id} isGm={isGm} canEdit={canEdit} update={update} canMakeItems={isMine} />
            </Section>
          </fieldset>
        )}

        {tab === "decks" && (
          <fieldset disabled={!canEdit} className="sheet-body">
            {approvalNote("equipment")}
            <DeckTab c={linkInventory(sheet, library)} update={update} gameId={id} uid={uid} decksLocked={decksLocked} />
          </fieldset>
        )}
      </main>
    </EffectLibraryContext.Provider>
  );
}
