import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import type { Character } from "../../shared/character.ts";
import { statusVfxOn } from "../../shared/vfx.ts";
import { deleteNameMatches } from "../../shared/deleteGame.ts";
import { inviteLink } from "../../shared/invites.ts";
import { blankCharacter, characterChecks, maxResources, RANKS } from "../../shared/ruleset.ts";
import {
  DEFAULT_STAT_FORMULAS,
  formulaError,
  formulaRank,
  gameStatFormulas,
  LEGACY_STAT_FORMULAS,
  STAT_FORMULA_FIELDS,
  type StatFormulas,
} from "../../shared/formulas.ts";
import { pendingCount } from "../../shared/permissions.ts";
import {
  effectsClearAfterCombat,
  type GameDoc,
  type GmMeta,
  PLAYER_EDIT_OPTIONS,
  type PlayerEditKey,
  playerCanEdit,
  playersCanCreateEffects,
  proficienciesNeedApproval,
  playersCanCreateItems,
  storyRollsOnPhone,
} from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import { ImageUpload } from "../components/ImageUpload.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, deleteGameFn, friendlyError, newInviteCodeFn, removePlayerFn } from "../firebase.ts";
import { StableLabel } from "../components/StableLabel.tsx";

/** One player: their character at a glance, a link to the sheet, and Kick. */
function PlayerCard({ gameId, uid, displayName, character, formulas, onKick }: { gameId: string; uid: string; displayName: string; character?: Character; formulas: StatFormulas; onKick: () => void }) {
  const c = character ? { ...blankCharacter(uid, displayName), ...character } : undefined;
  const todo = c ? characterChecks(c).filter((ch) => !ch.ok).length : 0;
  const waiting = pendingCount(c);
  return (
    <li className="settings-player">
      <span className="npc-portrait">{c?.portrait ? <img src={c.portrait} alt="" /> : <span>{(c?.name.trim() || displayName || "?")[0].toUpperCase()}</span>}</span>
      <div className="settings-player-text">
        <strong>{c ? c.name || "Unnamed character" : "No character yet"}</strong>
        <span className="muted small">
          Played by {displayName}
          {c && ` · Rank ${c.rank} · ${maxResources(c, formulas).maxHp} HP · ${todo ? `${todo} left to finish` : "ready"}`}
        </span>
        {waiting > 0 && (
          <Link className="chip warn" to={`/games/${gameId}/characters/${uid}`}>
            {waiting} change{waiting === 1 ? "" : "s"} waiting for your approval
          </Link>
        )}
      </div>
      <div className="row wrap settings-player-actions">
        {c && (
          <Link className="button-like" to={`/games/${gameId}/characters/${uid}`}>
            Open sheet
          </Link>
        )}
        <ConfirmButton className="danger" confirmLabel="Kick?" confirmHint={`Removes ${displayName} and deletes their sheet`} ms={3000} aria-label={`Kick ${displayName}`} onConfirm={onKick}>
          Kick
        </ConfirmButton>
      </div>
    </li>
  );
}

/** The game's name and image: the name titles the game everywhere, the image shows on its page and its box on the front page. */
function GameSection({ gameId, game }: { gameId: string; game: GameDoc }) {
  const [draft, setDraft] = useState(game.name);
  // The name's note shows beside Save name, so it doesn't push the page down; the image's shows under it.
  const [note, setNote] = useState<{ at: "name" | "image"; text: string } | null>(null);
  // Follow a rename from elsewhere unless the GM is typing a new name here.
  const [lastName, setLastName] = useState(game.name);
  if (game.name !== lastName) {
    if (draft === lastName) setDraft(game.name);
    setLastName(game.name);
  }
  const next = draft.trim();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!next || next === game.name) return;
    try {
      await updateDoc(doc(db, "games", gameId), { name: next });
      setDraft(next);
      setNote({ at: "name", text: "Name saved." });
    } catch (err) {
      setNote({ at: "name", text: friendlyError(err) });
    }
  };
  const setImage = async (url: string | undefined) => {
    try {
      await updateDoc(doc(db, "games", gameId), { image: url ?? deleteField() });
      setNote({ at: "image", text: url ? "Image saved. It shows on the game's page and on everyone's front page." : "Image removed." });
    } catch (err) {
      setNote({ at: "image", text: friendlyError(err) });
    }
  };
  return (
    <section className="panel settings-section" aria-label="Game">
      <h2>Game</h2>
      <form className="row wrap game-name-form" onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input aria-label="Game name" value={draft} maxLength={60} required onChange={(e) => (setDraft(e.target.value), setNote(null))} />
        </label>
        <button type="submit" disabled={!next || next === game.name}>
          Save name
        </button>
        {note?.at === "name" && (
          <span className="muted small inline-note" role="status">
            {note.text}
          </span>
        )}
      </form>
      <div className="field">
        <span>Image</span>
        <span className="muted small">Shown at the top of the game's page and behind its box on everyone's front page.</span>
        <ImageUpload folder={`games/${gameId}/assets/cover`} kind="gameCover" shape="cover" label="Game image" value={game.image} onChange={setImage} />
      </div>
      {note?.at === "image" && (
        <p className="muted settings-note" role="status">
          {note.text}
        </p>
      )}
    </section>
  );
}

/** A labelled on/off switch. */
function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <span className="muted small">{hint}</span>
      </span>
      <input type="checkbox" role="switch" className="switch" aria-label={label} checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const sameFormulas = (a: StatFormulas, b: StatFormulas) => STAT_FORMULA_FIELDS.every(({ key }) => a[key].trim() === b[key].trim());

/** The GM edits how Rank and Stats set max Health, Stagger Resist, Sanity and Light, with a preview by Rank. */
function StatFormulasSection({ game, note, onSave }: { game: GameDoc; note: string; onSave: (f: StatFormulas) => Promise<void> }) {
  const saved = gameStatFormulas(game);
  const [draft, setDraft] = useState<StatFormulas>(saved);
  const [stat, setStat] = useState(0);
  // Follow saves from elsewhere while nothing here is being edited.
  const savedKey = JSON.stringify(saved);
  const [lastSaved, setLastSaved] = useState(savedKey);
  if (savedKey !== lastSaved) {
    if (sameFormulas(draft, JSON.parse(lastSaved) as StatFormulas)) setDraft(saved);
    setLastSaved(savedKey);
  }
  const errors = Object.fromEntries(STAT_FORMULA_FIELDS.map(({ key }) => [key, formulaError(draft[key])]));
  const valid = STAT_FORMULA_FIELDS.every(({ key }) => !errors[key]);
  const dirty = !sameFormulas(draft, saved);
  const legacy = !game.settings?.statFormulas;
  const isDefault = sameFormulas(draft, DEFAULT_STAT_FORMULAS);
  // Formulas change every character at once, so they wait for Save; leaving with edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const primary = { fortitude: stat, prudence: stat, justice: stat, temperance: stat };
  return (
    <section className="panel settings-section" aria-label="Stat formulas">
      <h2>Stat formulas</h2>
      <p className="muted small">
        How Rank and Stats set every character's max Health, Stagger Resist, Sanity and Light. Ranks count down, so in a formula <strong>Rank</strong> counts up:
        Rank 9 is 1, Rank 8 is 2, down to Rank 1 as 9. You can also use Fortitude, Prudence, Justice and Temperance, + − × ÷ and brackets, and floor(), ceil(),
        round(), min() and max(). Results are rounded down. Characters you set numbers for by hand keep them.
      </p>
      {legacy && (
        <p className="chip warn formula-legacy">
          This game is older than stat formulas, so it uses its original numbers (shown below). Use the standard formulas to switch to the new ones.
        </p>
      )}
      <div className="formula-fields">
        {STAT_FORMULA_FIELDS.map(({ key, label }) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input
              aria-label={`${label} formula`}
              className={errors[key] ? "invalid" : undefined}
              value={draft[key]}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
            {errors[key] ? <span className="error small">{errors[key]}</span> : <span className="muted small">Default: {DEFAULT_STAT_FORMULAS[key]}</span>}
          </label>
        ))}
      </div>
      <div className="formula-preview">
        <div className="row-between wrap">
          <strong className="small">Preview</strong>
          <label className="muted small formula-stat">
            Each Stat at{" "}
            <input type="number" min={0} max={20} aria-label="Preview Stat value" value={stat} onChange={(e) => setStat(Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0))))} />
          </label>
        </div>
        <div className="formula-table-wrap">
          <table className="formula-table">
            <thead>
              <tr>
                <th>Rank</th>
                {STAT_FORMULA_FIELDS.map(({ key, label }) => (
                  <th key={key}>{label.replace(" Resist", "")}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RANKS.map((rank) => {
                const m = maxResources({ rank, primary }, valid ? draft : saved);
                return (
                  <tr key={rank}>
                    <th>
                      {rank} <span className="muted small rank-note">(Rank = {formulaRank(rank)})</span>
                    </th>
                    {STAT_FORMULA_FIELDS.map(({ key, max }) => (
                      <td key={key}>{m[max]}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="row wrap">
        <button type="button" disabled={!valid || (!dirty && !legacy)} onClick={() => onSave(draft)}>
          Save formulas
        </button>
        <button type="button" disabled={isDefault} onClick={() => setDraft({ ...DEFAULT_STAT_FORMULAS })}>
          Use the standard formulas
        </button>
        {legacy && !sameFormulas(draft, LEGACY_STAT_FORMULAS) && (
          <button type="button" className="link" onClick={() => setDraft({ ...LEGACY_STAT_FORMULAS })}>
            Back to the original numbers
          </button>
        )}
        {dirty && (
          <button type="button" className="link" onClick={() => setDraft(saved)}>
            Undo changes
          </button>
        )}
        {dirty && <span className="chip static warn">Not saved yet</span>}
        {/* In the button row, so the sections below don't move when it shows. */}
        {note && !dirty && (
          <span className="muted small inline-note" role="status">
            {note}
          </span>
        )}
      </div>
    </section>
  );
}

/** Clearing the table log: the GM says they're sure first, since the lines can't come back. */
function ClearLogSection({ gameId }: { gameId: string }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const clear = async () => {
    setBusy(true);
    setNote("");
    try {
      // Empty the saved log, then stamp the game so a GM screen hosting right now empties its live log too.
      await setDoc(doc(db, "games", gameId, "table", "state"), { log: [] }, { merge: true });
      await updateDoc(doc(db, "games", gameId), { "settings.logClearedAt": Date.now() });
      setNote("Log cleared for everyone.");
      setSure(false);
    } catch (err) {
      setNote(friendlyError(err));
    }
    setBusy(false);
  };
  return (
    <section className="panel settings-section" aria-label="Table log">
      <h2>Table log</h2>
      <p className="muted small">Clears every line of the log on the GM screen, the board and players' phones. This can't be undone.</p>
      {sure ? (
        <div className="clear-log-step" role="alertdialog" aria-label="Clear the log?">
          <p>
            <strong>Clear the whole log?</strong> Rolls, damage and everything else in it so far will be gone.
          </p>
          <div className="row wrap">
            <button type="button" className="danger" onClick={clear} disabled={busy}>
              <StableLabel labels={["Yes, clear it", "Clearing…"]} show={busy ? 1 : 0} />
            </button>
            <button type="button" onClick={() => setSure(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <button type="button" className="danger" onClick={() => (setSure(true), setNote(""))}>
            Clear log…
          </button>
        </div>
      )}
      {note && <p className="muted settings-note" role="status">{note}</p>}
    </section>
  );
}

/** Deleting the game: the GM says they're sure, then types the game's name. */
function DeleteGameSection({ gameId, name }: { gameId: string; name: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<"idle" | "sure" | "name">("idle");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancel = () => {
    setStep("idle");
    setTyped("");
    setError("");
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await deleteGameFn({ gameId, name: typed });
      navigate("/", { replace: true });
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };
  return (
    <section className="panel settings-section delete-game" aria-label="Delete game">
      <h2>Delete game</h2>
      <p className="muted small">
        Deletes the game for everyone: every character sheet, the maps and the table, the item and effect libraries, your enemies and notes, the invite code, and uploaded images.
        This can't be undone.
      </p>
      {step === "idle" && (
        <div className="row wrap">
          <button type="button" className="danger" onClick={() => setStep("sure")}>
            Delete game…
          </button>
        </div>
      )}
      {step === "sure" && (
        <div className="delete-game-step" role="alertdialog" aria-label="Are you sure?">
          <p>
            <strong>Are you sure you want to delete {name}?</strong> Your players lose their characters in it too.
          </p>
          <div className="row wrap">
            <button type="button" className="danger" onClick={() => setStep("name")}>
              Yes, I'm sure
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {step === "name" && (
        <form
          className="delete-game-step"
          onSubmit={(e) => {
            e.preventDefault();
            if (deleteNameMatches(typed, name) && !busy) remove();
          }}
        >
          <label className="field">
            <span>
              Type <strong className="delete-game-name">{name}</strong> to delete it
            </span>
            <input aria-label="Game name" value={typed} autoFocus autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
          </label>
          {error && <p className="error small">{error}</p>}
          <div className="row wrap">
            <button type="submit" className="danger" disabled={!deleteNameMatches(typed, name) || busy}>
              <StableLabel labels={["Delete this game forever", "Deleting…"]} show={busy ? 1 : 0} />
            </button>
            <button type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type Area = "invite" | "players" | "permissions" | "story" | "items" | "effects" | "formulas";

/** The GM's game settings: the game's name and image, inviting players, the players (open their sheets, kick them) and what players may edit. */
export function Settings() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const meta = useDoc<GmMeta>(isGm ? `games/${id}/gm/meta` : null);
  const characters = useCollection<Character>(isGm ? `games/${id}/characters` : null);
  // Each message shows in the section whose control it's about, not at the top of the page.
  const [message, setMessage] = useState<{ at: Area; text: string } | null>(null);

  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!isGm) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">Only the GM can change this game's settings.</p>
          <Link to={`/games/${id}`}>Back to the game</Link>
        </main>
      </>
    );
  }
  const g = game.data!;
  const players = Object.entries(g.members)
    .filter(([, m]) => m.role === "player")
    .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName));
  const ref = doc(db, "games", id);
  const inviteCode = meta.data?.inviteCode;
  const inviteUrl = inviteLink(location.origin, inviteCode);

  const kick = async (uid: string, name: string) => {
    try {
      await removePlayerFn({ gameId: id, uid });
      setMessage({ at: "players", text: `${name} was removed from the game, with their character, items, effects and images.` });
    } catch (err) {
      setMessage({ at: "players", text: friendlyError(err) });
    }
  };
  const newCode = async () => {
    try {
      const { data } = await newInviteCodeFn({ gameId: id });
      setMessage({ at: "invite", text: `New invite code: ${data.code}. The old one no longer works.` });
    } catch (err) {
      setMessage({ at: "invite", text: friendlyError(err) });
    }
  };
  const setEdit = async (key: PlayerEditKey, on: boolean) => {
    try {
      await updateDoc(ref, { [`settings.playerEdit.${key}`]: on });
    } catch (err) {
      setMessage({ at: "permissions", text: friendlyError(err) });
    }
  };

  return (
    <>
      <TopBar />
      <main className="settings-page">
        <header className="sheet-header">
          <Link to={`/games/${id}`} className="muted">
            ← {g.name}
          </Link>
          <h1>Game settings</h1>
        </header>

        <GameSection gameId={id} game={g} />

        <section className="panel settings-section" aria-label="Invite players">
          <h2>Invite players</h2>
          <p className="row wrap">
            Invite code: <strong className="invite-code">{inviteCode ?? "…"}</strong>
            {inviteCode && <CopyButton text={inviteCode} label="Copy code" />}
            {inviteCode && (
              <ConfirmButton className="link small" confirmLabel="Sure?" confirmHint="The old code stops working" ms={3000} onConfirm={newCode}>
                New code
              </ConfirmButton>
            )}
          </p>
          {inviteUrl && (
            <p className="muted row wrap">
              Or share this link: <a href={inviteUrl}>{inviteUrl}</a>
              <CopyButton text={inviteUrl} label="Copy link" />
            </p>
          )}
          {message?.at === "invite" && <p className="muted settings-note" role="status">{message.text}</p>}
        </section>

        <section className="panel settings-section" aria-label="Players">
          <h2>Players ({players.length})</h2>
          {players.length === 0 ? (
            <p className="muted">No players yet. Share the invite code to bring some in.</p>
          ) : (
            <ul className="plain settings-players">
              {players.map(([uid, m]) => (
                <PlayerCard key={uid} gameId={id} uid={uid} displayName={m.displayName} character={characters?.[uid]} formulas={gameStatFormulas(g)} onKick={() => kick(uid, m.displayName)} />
              ))}
            </ul>
          )}
          <p className="muted small">
            Kicking removes a player from the game and disconnects them from the table. Their character sheet, the items and effects they made, and the images they uploaded are deleted for good. To keep them out, make a new code too.
          </p>
          {message?.at === "players" && <p className="muted settings-note" role="status">{message.text}</p>}
        </section>

        <section className="panel settings-section" aria-label="Player permissions">
          <h2>What players can edit</h2>
          <p className="muted small">
            On: players change that part of their sheet freely. Off: their changes wait for your approval on their sheet, and the table keeps using what you last approved. You can always edit any sheet. Decks also lock on their own during combat.
          </p>
          {PLAYER_EDIT_OPTIONS.map((o) => (
            <Toggle key={o.key} label={o.label} hint={o.hint} on={playerCanEdit(g, o.key)} onChange={(on) => setEdit(o.key, on)} />
          ))}
          {message?.at === "permissions" && <p className="muted settings-note" role="status">{message.text}</p>}
        </section>

        <section className="panel settings-section" aria-label="Story Rolls">
          <h2>Story Rolls</h2>
          <Toggle
            label="Story Rolls on players' phones"
            hint="Every Story Roll plays its dice on the board. On: a player's own Story Rolls also play on their phone, and a popup closes once they've rolled for it (unless it has a reward or cost to show). Off: their phone shows the result as text."
            on={storyRollsOnPhone(g)}
            onChange={async (on) => {
              try {
                await updateDoc(ref, { "settings.storyRollsOnPhone": on });
              } catch (err) {
                setMessage({ at: "story", text: friendlyError(err) });
              }
            }}
          />
          {message?.at === "story" && <p className="muted settings-note" role="status">{message.text}</p>}
        </section>

        <section className="panel settings-section" aria-label="Item library">
          <h2>Item library</h2>
          <Toggle
            label="Players can create items"
            hint="Players make items in the item library and can change only the ones they made. On: their new items and changes reach inventories right away. Off: each waits for your approval in the item library."
            on={playersCanCreateItems(g)}
            onChange={async (on) => {
              try {
                await updateDoc(ref, { "settings.playersCreateItems": on });
              } catch (err) {
                setMessage({ at: "items", text: friendlyError(err) });
              }
            }}
          />
          {message?.at === "items" && <p className="muted settings-note" role="status">{message.text}</p>}
        </section>

        <section className="panel settings-section" aria-label="Effect library">
          <h2>Effect library</h2>
          <Toggle
            label="Players can create effects"
            hint="Players build automated effects in the effect library and can change only the ones they made. On: their effects work at the table right away. Off: a new or changed effect does nothing until you approve it there."
            on={playersCanCreateEffects(g)}
            onChange={async (on) => {
              try {
                await updateDoc(ref, { "settings.playersCreateEffects": on });
              } catch (err) {
                setMessage({ at: "effects", text: friendlyError(err) });
              }
            }}
          />
          <Toggle
            label="Approve changes to the Proficiency tree"
            hint="Players add Proficiencies to the shared tree and change the ones they made. On: each new or changed one waits for your approval in the effect library, and nobody can pick it until then. Off: they join the tree right away."
            on={proficienciesNeedApproval(g)}
            onChange={async (on) => {
              try {
                await updateDoc(ref, { "settings.approveProficiencies": on });
              } catch (err) {
                setMessage({ at: "effects", text: friendlyError(err) });
              }
            }}
          />
          <Toggle
            label="Effects wear off when combat ends"
            hint="On: when you end combat, every automated status Effect (Burn, Poise…) comes off the characters who fought. Effects you track by hand stay. Off: they stay until they wear off or you remove them."
            on={effectsClearAfterCombat(g)}
            onChange={async (on) => {
              try {
                await updateDoc(ref, { "settings.clearEffectsAfterCombat": on });
              } catch (err) {
                setMessage({ at: "effects", text: friendlyError(err) });
              }
            }}
          />
          <Toggle
            label="Status effect VFX"
            hint="On: status effects play the VFX you built for them in the VFX editor (flames for Burn, a glow for a shield…) on the map, on every screen. Off: the map looks as it always has."
            on={statusVfxOn(g)}
            onChange={async (on) => {
              try {
                await updateDoc(ref, { "settings.statusVfx": on });
              } catch (err) {
                setMessage({ at: "effects", text: friendlyError(err) });
              }
            }}
          />
          {message?.at === "effects" && <p className="muted settings-note" role="status">{message.text}</p>}
        </section>

        <StatFormulasSection
          game={g}
          note={message?.at === "formulas" ? message.text : ""}
          onSave={async (f) => {
            try {
              await updateDoc(ref, { "settings.statFormulas": Object.fromEntries(STAT_FORMULA_FIELDS.map(({ key }) => [key, f[key].trim()])) });
              setMessage({ at: "formulas", text: "Stat formulas saved. Characters at the table update right away." });
            } catch (err) {
              setMessage({ at: "formulas", text: friendlyError(err) });
            }
          }}
        />

        <ClearLogSection gameId={id} />

        <DeleteGameSection gameId={id} name={g.name} />
      </main>
    </>
  );
}
