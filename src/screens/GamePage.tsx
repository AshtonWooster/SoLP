import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import type { Character } from "../../shared/character.ts";
import { characterChecks } from "../../shared/ruleset.ts";
import { pendingCount } from "../../shared/permissions.ts";
import { playerList } from "../../shared/players.ts";
import { type GameDoc, playersCanCreateEffects, playersCanCreateItems } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { PlayerPreview } from "../components/PlayerPreview.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { db, friendlyError } from "../firebase.ts";

/** A game's home: what you can open from here depends on whether you're its GM or a player. */
export function GamePage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const characters = useCollection<Character>(game.data ? `games/${id}/characters` : null);

  if (game.error || (!game.loading && !game.data)) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">{game.error || "Game not found."}</p>
          <Link to="/">Back to your games</Link>
        </main>
      </>
    );
  }
  if (!game.data) return <main className="center muted">Loading…</main>;

  const players = playerList(id, game.data, characters, isGm);

  return (
    <>
      <TopBar />
      <main className="game-page">
        <div className="game-page-main">
          <Link to="/" className="muted">
            ← Your games
          </Link>
          <h1>
            {isGm ? <GameName gameId={id} name={game.data.name} /> : game.data.name} <span className={`role-badge role-${isGm ? "gm" : "player"}`}>{isGm ? "GM" : "Player"}</span>
          </h1>

          {isGm ? (
            <>
              <div className="screen-links">
                <Link className="big-button" to={`/games/${id}/gm`}>
                  Run the game
                  <small>GM controls, for your laptop. Keep it open during play: it hosts the table.</small>
                </Link>
                <Link className="big-button secondary" to={`/games/${id}/board`}>
                  Open the board
                  <small>Shared map, for the iPad or TV. Log in there as yourself.</small>
                </Link>
                <Link className="big-button secondary" to={`/games/${id}/gm?tab=maps`}>
                  Map editor
                  <small>Build maps in layers: background, images, tokens, pins and notes. Hide anything from players.</small>
                </Link>
                <Link className="big-button secondary" to={`/games/${id}/npcs`}>
                  Character editor
                  <small>Build enemies, allies and other characters to place on the map</small>
                </Link>
                <Link className="big-button secondary" to={`/games/${id}/items`}>
                  Item library
                  <small>Make the items players add to their inventories</small>
                </Link>
                <Link className="big-button secondary" to={`/games/${id}/effects`}>
                  Effect library
                  <small>Automate Status effects like Burn and Poise, and Passives</small>
                </Link>
                <Link className="big-button secondary" to={`/games/${id}/settings`}>
                  Game settings
                  <small>Invite players, kick them, and choose what players can edit</small>
                </Link>
              </div>
            </>
          ) : (
            <div className="screen-links">
              <Link className="big-button" to={`/games/${id}/play`}>
                Open my table view
                <small>Your character, hand and party, on your phone</small>
              </Link>
              <Link className="big-button secondary" to={`/games/${id}/board`}>
                Open the board
                <small>The shared map, on any screen</small>
              </Link>
              <Link className="big-button secondary" to={`/games/${id}/characters/${user!.id}`}>
                {characters?.[user!.id] ? "My character" : "Create my character"}
                <small>
                  {characters?.[user!.id]
                    ? `${characters[user!.id].name || "Unnamed"} · ${characterStatus(characters[user!.id])}`
                    : "Follow the rulebook's six steps"}
                </small>
              </Link>
              <Link className="big-button secondary" to={`/games/${id}/items`}>
                Item library
                <small>{playersCanCreateItems(game.data) ? "Your GM lets players make items" : "Make items for your GM to approve"}</small>
              </Link>
              <Link className="big-button secondary" to={`/games/${id}/effects`}>
                Effect library
                <small>{playersCanCreateEffects(game.data) ? "Your GM lets players make effects" : "Make effects for your GM to approve"}</small>
              </Link>
            </div>
          )}
        </div>

        <aside className="game-players">
          <h3>Players ({players.length})</h3>
          {players.length === 0 && <p className="muted">No players yet.</p>}
          <ul className="plain">
            {players.map((p) => {
              const c = characters?.[p.uid];
              return (
                <li key={p.uid} className="game-player">
                  <span className="game-player-name">{p.username}</span>
                  <PlayerPreview
                    entry={p}
                    extra={
                      isGm &&
                      c && (
                        <>
                          <span className="muted small">{characterStatus(c)}</span>
                          {pendingCount(c) > 0 && <span className="chip static warn">Changes to approve</span>}
                        </>
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        </aside>
      </main>
    </>
  );
}

/** The game's name as its title: the GM types over it to rename the game. */
function GameName({ gameId, name }: { gameId: string; name: string }) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState("");
  useEffect(() => setDraft(name), [name]);
  const commit = async () => {
    const next = draft.trim().slice(0, 60);
    if (!next || next === name) return setDraft(name);
    try {
      await updateDoc(doc(db, "games", gameId), { name: next });
      setError("");
    } catch (err) {
      setError(friendlyError(err));
      setDraft(name);
    }
  };
  return (
    <>
      <input
        className="game-name-input"
        aria-label="Game name"
        title="Rename this game"
        value={draft}
        maxLength={60}
        size={Math.max(8, draft.length)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {error && <span className="error small">{error}</span>}
    </>
  );
}

function characterStatus(c: Character): string {
  const left = characterChecks(c).filter((ch) => !ch.ok).length;
  return left === 0 ? "ready" : `${left} to finish`;
}
