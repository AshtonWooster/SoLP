import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { arrayRemove, deleteField, doc, updateDoc } from "firebase/firestore";
import type { Character } from "../../shared/character.ts";
import { blankCharacter, characterChecks, maxResources } from "../../shared/ruleset.ts";
import { pendingCount } from "../../shared/permissions.ts";
import {
  effectsClearAfterCombat,
  type GameDoc,
  type GmMeta,
  PLAYER_EDIT_OPTIONS,
  type PlayerEditKey,
  playerCanEdit,
  playersCanCreateEffects,
  playersCanCreateItems,
} from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

/** One player: their character at a glance, a link to the sheet, and Kick. */
function PlayerCard({ gameId, uid, displayName, character, onKick }: { gameId: string; uid: string; displayName: string; character?: Character; onKick: () => void }) {
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
          {c && ` · Rank ${c.rank} · ${maxResources(c).maxHp} HP · ${todo ? `${todo} left to finish` : "ready"}`}
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
        <ConfirmButton className="danger" confirmLabel={`Kick ${displayName}?`} ms={3000} aria-label={`Kick ${displayName}`} onConfirm={onKick}>
          Kick
        </ConfirmButton>
      </div>
    </li>
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

/** The GM's game settings: the players (open their sheets, kick them) and what players may edit. */
export function Settings() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const meta = useDoc<GmMeta>(isGm ? `games/${id}/gm/meta` : null);
  const characters = useCollection<Character>(isGm ? `games/${id}/characters` : null);
  const [message, setMessage] = useState("");

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

  const kick = async (uid: string, name: string) => {
    try {
      await updateDoc(ref, { memberIds: arrayRemove(uid), [`members.${uid}`]: deleteField() });
      setMessage(`${name} was removed from the game.`);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  };
  const setEdit = async (key: PlayerEditKey, on: boolean) => {
    try {
      await updateDoc(ref, { [`settings.playerEdit.${key}`]: on });
    } catch (err) {
      setMessage(friendlyError(err));
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
          {message && (
            <p className="muted" role="status">
              {message}
            </p>
          )}
        </header>

        <section className="panel settings-section" aria-label="Players">
          <div className="row-between">
            <h2>Players ({players.length})</h2>
            {meta.data?.inviteCode && (
              <span className="muted small">
                Invite code <strong className="invite-code">{meta.data.inviteCode}</strong>
              </span>
            )}
          </div>
          {players.length === 0 ? (
            <p className="muted">No players yet. Share the invite code to bring some in.</p>
          ) : (
            <ul className="plain settings-players">
              {players.map(([uid, m]) => (
                <PlayerCard key={uid} gameId={id} uid={uid} displayName={m.displayName} character={characters?.[uid]} onKick={() => kick(uid, m.displayName)} />
              ))}
            </ul>
          )}
          <p className="muted small">
            Kicking removes a player from the game and disconnects them from the table. Their character is kept, so it comes back if they rejoin with the invite code.
          </p>
        </section>

        <section className="panel settings-section" aria-label="Player permissions">
          <h2>What players can edit</h2>
          <p className="muted small">
            On: players change that part of their sheet freely. Off: their changes wait for your approval on their sheet, and the table keeps using what you last approved. You can always edit any sheet. Decks also lock on their own during combat.
          </p>
          {PLAYER_EDIT_OPTIONS.map((o) => (
            <Toggle key={o.key} label={o.label} hint={o.hint} on={playerCanEdit(g, o.key)} onChange={(on) => setEdit(o.key, on)} />
          ))}
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
                setMessage(friendlyError(err));
              }
            }}
          />
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
                setMessage(friendlyError(err));
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
                setMessage(friendlyError(err));
              }
            }}
          />
        </section>
      </main>
    </>
  );
}
