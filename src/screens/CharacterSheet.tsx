import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import type { Character } from "../../shared/character.ts";
import { newId } from "../../shared/engine.ts";
import {
  blankArmor,
  blankCharacter,
  blankPage,
  blankWeapon,
  characterChecks,
  maxResources,
  PRIMARY_STATS,
  proficiencyCount,
  RANKS,
  rankTable,
  SECONDARY_STATS,
} from "../../shared/ruleset.ts";
import type { GameDoc, TableState } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { DeckEditor } from "../components/DeckEditor.tsx";
import { EquipmentStudio, PageEditor, PassiveList } from "../components/EquipmentEditor.tsx";
import { ImageUpload } from "../components/ImageUpload.tsx";
import { InventoryEditor } from "../components/InventoryEditor.tsx";
import { NumberInput, Section, Stepper, TextField } from "../components/Fields.tsx";
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
  ["inventory", "Inventory"],
  ["decks", "Decks"],
] as const;
type Tab = (typeof TABS)[number][0];

const STEPS = [
  ["rank", "1 · Rank"],
  ["stats", "2 · Stats"],
  ["proficiencies", "3 · Proficiencies"],
  ["augment", "4 · Augment"],
  ["equipment", "5 · Equipment"],
  ["details", "6 · Finishing Touches"],
] as const;

/** Character creation and editing, following Act 5 of the ruleset step by step. */
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
  const decksLocked = !!table.data?.combat && !isGm;

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
              <p className="muted">
                You'll go through the six steps from the rulebook. Everything saves as you go, so you can stop and come back anytime.
              </p>
              <button className="big-button" onClick={create}>
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

  const t = rankTable(c.rank);
  const max = maxResources(c);
  const checks = characterChecks(c);
  const ready = checks.every((ch) => ch.ok);
  const primaryLeft = t.primaryPoints - Object.values(c.primary).reduce((a, b) => a + b, 0);
  const secondaryLeft = t.secondaryPoints - Object.values(c.secondary).reduce((a, b) => a + b, 0);
  const hands = c.weapons.reduce((a, w) => a + w.hands, 0);
  const profMax = proficiencyCount(c.rank);

  return (
    <>
      <TopBar />
      <main className="sheet">
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
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "tab active" : "tab"}
                onClick={() => setParams(t === "sheet" ? {} : { tab: t }, { replace: true })}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "sheet" && (
            <nav className="step-nav">
              {STEPS.map(([anchor, label]) => (
                <a key={anchor} href={`#${anchor}`}>
                  {label}
                </a>
              ))}
            </nav>
          )}
        </header>

        <aside className="sheet-summary panel">
          <div className="summary-stats">
            <div><span className="muted">Health</span><strong>{max.maxHp}</strong></div>
            <div><span className="muted">Stagger</span><strong>{max.maxStagger}</strong></div>
            <div><span className="muted">Sanity</span><strong>{max.maxSanity}</strong></div>
            <div><span className="muted">Light</span><strong>{max.maxLight}</strong></div>
            <div><span className="muted">Speed</span><strong>1d6+{c.primary.justice}</strong></div>
          </div>
          <details open={!ready && tab === "sheet"} key={tab}>
            <summary className={ready ? "ok-text" : "warn-text"}>
              {ready ? "✓ Ready for the table" : `${checks.filter((ch) => !ch.ok).length} left to finish`}
            </summary>
            <ul className="checklist">
              {checks.map((ch, i) => (
                <li key={i} className={ch.ok ? "ok" : "todo"}>
                  {ch.ok ? "✓" : "○"} {ch.text}
                </li>
              ))}
            </ul>
          </details>
        </aside>

        {tab === "inventory" && (
          <fieldset disabled={!canEdit} className="sheet-body">
            <Section id="inventory" title="Inventory" intro="Items and Tools take one Slot each. Tools add their Page to your Auxiliary Deck. Your one Trinket is active only while in the Trinket Slot.">
              <InventoryEditor c={c} canSetSlots={isGm} update={update} />
            </Section>
          </fieldset>
        )}

        {tab === "decks" && (
          <fieldset disabled={!canEdit || decksLocked} className="sheet-body">
            {decksLocked && <div className="notice">Combat is on. Decks can be changed again once it ends.</div>}
            <Section id="decks" title="Decks" intro="You have two decks: a Combat Deck built from your Equipment's Pages, and an Auxiliary Deck from the Tools in your Inventory.">
              <DeckEditor c={c} update={update} />
            </Section>
            <Section id="ego" title="E.G.O. Pages" intro="Unique Pages from your character's progression, made with your GM. In combat they're available from the start, and each can be used once per combat.">
              {(c.ego ?? []).map((p, i) => (
                <PageEditor
                  key={p.id}
                  page={p}
                  artFolder={`games/${id}/users/${uid}/art`}
                  onChange={(np) => update((d) => void (d.ego[i] = np))}
                  onRemove={() => update((d) => void d.ego.splice(i, 1))}
                />
              ))}
              <button type="button" onClick={() => update((d) => void (d.ego = [...(d.ego ?? []), { ...blankPage("special"), name: "E.G.O." }]))}>
                + Add E.G.O. Page
              </button>
            </Section>
          </fieldset>
        )}

        {tab === "sheet" && (
        <fieldset disabled={!canEdit} className="sheet-body">
          <Section id="rank" title="1 · Rank" intro="Your Fixer Grade (or equivalent). It sets how many points and how much Passive Cost you get. Agree on it with your GM.">
            {isGm ? (
              <label className="inline">
                Rank
                <select value={c.rank} onChange={(e) => update((d) => void (d.rank = Number(e.target.value)))}>
                  {RANKS.map((r) => (
                    <option key={r} value={r}>
                      Rank {r}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>
                <strong>Rank {c.rank}</strong> <span className="muted">(only the GM can change this)</span>
              </p>
            )}
            <ul className="plain muted small">
              <li>Primary Stat Points: {t.primaryPoints}</li>
              <li>Secondary Stat Points: {t.secondaryPoints}</li>
              <li>Proficiencies: {profMax}</li>
              <li>Max Passive Cost: Augment {t.augmentMaxCost}, each piece of Equipment {t.equipmentMaxCost}</li>
            </ul>
          </Section>

          <Section id="stats" title="2 · Stats" intro="Spend your points. Primary Stats shape your Resources; Secondary Stats shape Story Rolls.">
            <h3>
              Primary <span className={primaryLeft < 0 ? "error" : "muted"}>· {primaryLeft} left</span>
            </h3>
            {PRIMARY_STATS.map((s) => (
              <div className="stat-row" key={s.key}>
                <div>
                  <strong>{s.label}</strong>
                  <div className="muted small">{s.effect}</div>
                </div>
                <Stepper label={s.label} value={c.primary[s.key]} max={c.primary[s.key] + Math.max(0, primaryLeft)} onChange={(n) => update((d) => void (d.primary[s.key] = n))} />
              </div>
            ))}
            <h3>
              Secondary <span className={secondaryLeft < 0 ? "error" : "muted"}>· {secondaryLeft} left</span>
            </h3>
            {SECONDARY_STATS.map((s) => (
              <div className="stat-row" key={s.key}>
                <div>
                  <strong>{s.label}</strong>
                  <div className="muted small">{s.effect}</div>
                </div>
                <Stepper
                  label={s.label}
                  value={c.secondary[s.key] ?? 0}
                  max={(c.secondary[s.key] ?? 0) + Math.max(0, secondaryLeft)}
                  onChange={(n) => update((d) => void (d.secondary[s.key] = n))}
                />
              </div>
            ))}
          </Section>

          <Section
            id="proficiencies"
            title="3 · Proficiencies"
            intro={`Choose ${profMax}. They reflect your background, like a workshop Fixer with Proficiencies in modifying weapons. Each one may need minimum Stats.`}
          >
            <p className={c.proficiencies.length > profMax ? "error" : "muted"}>
              {c.proficiencies.length} of {profMax} chosen
            </p>
            {c.proficiencies.map((p, i) => (
              <div className="row" key={p.id}>
                <input
                  aria-label="Proficiency"
                  placeholder="Proficiency"
                  value={p.name}
                  onChange={(e) => update((d) => void (d.proficiencies[i].name = e.target.value))}
                />
                <input
                  aria-label="Notes"
                  placeholder="Notes or requirement"
                  value={p.description}
                  onChange={(e) => update((d) => void (d.proficiencies[i].description = e.target.value))}
                />
                <button type="button" className="icon" aria-label="Remove proficiency" onClick={() => update((d) => void d.proficiencies.splice(i, 1))}>
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={c.proficiencies.length >= profMax}
              onClick={() => update((d) => void d.proficiencies.push({ id: newId(), name: "", description: "" }))}
            >
              + Add proficiency
            </button>
          </Section>

          <Section id="augment" title="4 · Augment" intro="Your unique modification. Slot Passives up to your max Passive Cost. Work with your GM on something that fits your build and story.">
            <TextField label="Augment name" value={c.augment.name} onChange={(v) => update((d) => void (d.augment.name = v))} />
            <TextField label="Description" multiline value={c.augment.description} onChange={(v) => update((d) => void (d.augment.description = v))} />
            <PassiveList passives={c.augment.passives} max={t.augmentMaxCost} onChange={(p) => update((d) => void (d.augment.passives = p))} />
          </Section>

          <Section
            id="equipment"
            title="5 · Weapons and Armor"
            intro="Up to two hands of Weapons and one Armor. Each gets Passives up to the max cost, plus one Basic Page and one Special Page made with your GM. Start weaker than your ideal gear to leave room for upgrades."
          >
            <p className={hands > 2 ? "error" : "muted"}>
              Weapons use {hands} of 2 hands{c.armor ? "" : " · no armor yet"}.
            </p>
            <EquipmentStudio
              weapons={c.weapons}
              armor={c.armor}
              characterRank={c.rank}
              artFolder={`games/${id}/users/${uid}/art`}
              canAddWeapon={hands < 2}
              onWeapons={(w) => update((d) => void (d.weapons = w))}
              onArmor={(a) => update((d) => void (d.armor = a))}
            />
          </Section>

          <Section id="details" title="6 · Finishing Touches" intro="Who your character is. These help your GM weave you into the City.">
            <ImageUpload folder={`games/${id}/users/${uid}/portrait`} label="Portrait" value={c.portrait} onChange={(url) => update((d) => void (url ? (d.portrait = url) : delete d.portrait))} />
            <TextField label="Name" value={c.name} onChange={(v) => update((d) => void (d.name = v))} />
            <div className="row wrap">
              <TextField label="Age" value={c.details.age} onChange={(v) => update((d) => void (d.details.age = v))} />
              <TextField label="Height" value={c.details.height} onChange={(v) => update((d) => void (d.details.height = v))} />
            </div>
            <TextField label="Occupation" value={c.details.occupation} onChange={(v) => update((d) => void (d.details.occupation = v))} placeholder="Office, Syndicate, Wing…" />
            <div className="row wrap">
              <TextField label="Birthplace" value={c.details.birthplace} onChange={(v) => update((d) => void (d.details.birthplace = v))} />
              <TextField label="Residence" value={c.details.residence} onChange={(v) => update((d) => void (d.details.residence = v))} />
            </div>
            <TextField label="Appearance" multiline value={c.details.appearance} onChange={(v) => update((d) => void (d.details.appearance = v))} />
            <TextField label="Personality" multiline value={c.details.personality} onChange={(v) => update((d) => void (d.details.personality = v))} placeholder="How do they handle stress, excitement, fear?" />
            <TextField label="Relationships" multiline value={c.details.relationships} onChange={(v) => update((d) => void (d.details.relationships = v))} />
            <label className="field">
              <span>Starting Ahn</span>
              <NumberInput label="Starting Ahn" value={c.ahn} min={0} onChange={(n) => update((d) => void (d.ahn = Math.max(0, Math.round(n))))} />
            </label>
          </Section>
        </fieldset>
        )}
      </main>
    </>
  );
}
