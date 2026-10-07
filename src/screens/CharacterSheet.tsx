import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import type { Character, ItemTemplate } from "../../shared/character.ts";
import { blankCharacter, characterChecks, linkInventory } from "../../shared/ruleset.ts";
import { type GameDoc, PLAYER_EDIT_OPTIONS, type PlayerEditKey, playerCanEdit, type TableState } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { DeckTab } from "../components/DeckTab.tsx";
import { AugmentTab } from "../components/creator/AugmentTab.tsx";
import { CharacterCreator, type CreatorStep } from "../components/creator/CharacterCreator.tsx";
import { InventoryTab } from "../components/items/InventoryTab.tsx";
import { Section } from "../components/Fields.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

type SaveState = "idle" | "saving" | "saved" | "error";
const SAVE_DELAY_MS = 800;

/**
 * Loads a character and saves edits shortly after each change. Edits made elsewhere (the GM,
 * another device) are picked up whenever there are no unsaved local edits.
 */
function useCharacter(gameId: string, uid: string, fallbackName: string, canEdit: boolean) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [error, setError] = useState("");
  const [save, setSave] = useState<SaveState>("idle");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Character | null>(null);
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
          latest.current = c;
          setCharacter(c);
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
      await setDoc(ref, { ...c, updatedAt: Date.now() });
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

  return { character, error, save, update, create };
}

const TABS = [
  ["sheet", "Character"],
  ["augment", "Augment & Proficiencies"],
  ["decks", "Equipment & Decks"],
  ["inventory", "Inventory"],
] as const;
type Tab = (typeof TABS)[number][0];
const CREATOR_STEPS: CreatorStep[] = ["intro", "license", "stats", "story", "summary"];

/** Character creation and editing: a stepped creator, then a tab each for the rest (Act 5). */
export function CharacterSheet() {
  const { id = "", uid = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const isMine = user?.id === uid;
  const canEdit = isMine || isGm;
  const ownerName = game.data?.members[uid]?.displayName ?? "";
  const { character: c, error, save, update, create } = useCharacter(id, uid, ownerName, canEdit);
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some(([t]) => t === params.get("tab")) ? (params.get("tab") as Tab) : "sheet";
  // Decks can't change mid-combat (Act 6). The GM's table saves combat state every few seconds.
  const table = useDoc<TableState>(`games/${id}/table/state`);
  // The GM's item library: inventory items take their details from it.
  const library = useCollection<ItemTemplate>(`games/${id}/items`);
  const decksLocked = !!table.data?.combat && !isGm;
  // Parts of the sheet the GM lets players edit (game settings). The GM can always edit.
  const may = (key: PlayerEditKey) => canEdit && (isGm || playerCanEdit(game.data, key));
  const lockNote = (key: PlayerEditKey) =>
    isMine && !isGm && !playerCanEdit(game.data, key) ? (
      <p className="notice small lock-note">Your GM has locked {PLAYER_EDIT_OPTIONS.find((o) => o.key === key)!.label}. Ask them to make changes.</p>
    ) : null;

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

  const checks = characterChecks(linkInventory(c, library));
  // A new character starts on the intro (Start opens it); coming back later opens the summary.
  const stepParam = params.get("step") as CreatorStep | null;
  const step: CreatorStep = stepParam && CREATOR_STEPS.includes(stepParam) ? stepParam : c.name.trim() ? "summary" : "intro";
  const setStep = (s: CreatorStep) => {
    setParams({ step: s }, { replace: true });
    window.scrollTo({ top: 0 });
  };
  const goTab = (t: Tab) => setParams(t === "sheet" ? {} : { tab: t }, { replace: true });

  return (
    <>
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
            <CharacterCreator c={c} update={update} isGm={isGm} canEdit={canEdit} statsLocked={isMine && !isGm && !playerCanEdit(game.data, "stats")} gameId={id} uid={uid} checks={checks} step={step} setStep={setStep} goTab={goTab} />
          </fieldset>
        )}

        {tab === "augment" && (
          <fieldset disabled={!may("augment")} className="sheet-body">
            {lockNote("augment")}
            <AugmentTab c={c} update={update} />
          </fieldset>
        )}

        {tab === "inventory" && (
          <fieldset disabled={!may("inventory")} className="sheet-body">
            {lockNote("inventory")}
            <Section id="inventory" title="Inventory" intro="Each Slot holds one item, or a stack of one stacking item. Usable items add their Page to your Auxiliary Deck. Your one Trinket is active only while in the Trinket Slot. Hover an item to see its card.">
              <InventoryTab c={c} library={library} gameId={id} isGm={isGm} canEdit={may("inventory")} update={update} />
            </Section>
          </fieldset>
        )}

        {tab === "decks" && (
          <fieldset disabled={!may("equipment")} className="sheet-body">
            {lockNote("equipment")}
            <DeckTab c={linkInventory(c, library)} update={update} gameId={id} uid={uid} decksLocked={decksLocked} />
          </fieldset>
        )}
      </main>
    </>
  );
}
