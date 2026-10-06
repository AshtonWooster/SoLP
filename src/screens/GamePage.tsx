import { Link, useParams } from "react-router-dom";
import type { Character } from "../../shared/character.ts";
import { characterChecks } from "../../shared/ruleset.ts";
import type { GameDoc, GmMeta } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { TopBar } from "../components/TopBar.tsx";

/** A game's home: what you can open from here depends on whether you're its GM or a player. */
export function GamePage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const meta = useDoc<GmMeta>(isGm ? `games/${id}/gm/meta` : null);
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

  const inviteCode = meta.data?.inviteCode;
  const inviteUrl = inviteCode ? `${location.origin}/join/${inviteCode}` : "";
  const players = Object.entries(game.data.members).filter(([, m]) => m.role === "player");

  return (
    <>
      <TopBar />
      <main className="game-page">
        <Link to="/" className="muted">← Your games</Link>
        <h1>
          {game.data.name} <span className={`role-badge role-${isGm ? "gm" : "player"}`}>{isGm ? "GM" : "Player"}</span>
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
              <Link className="big-button secondary" to={`/games/${id}/npcs`}>
                Character editor
                <small>Build enemies, allies and other characters to place on the map</small>
              </Link>
              <Link className="big-button secondary" to={`/games/${id}/items`}>
                Item library
                <small>Make the items players add to their inventories</small>
              </Link>
            </div>
            <section className="panel">
              <h3>Invite players</h3>
              <p>
                Invite code: <strong className="invite-code">{inviteCode ?? "…"}</strong>
              </p>
              {inviteUrl && (
                <p className="muted">
                  Or share this link: <a href={inviteUrl}>{inviteUrl}</a>
                </p>
              )}
            </section>
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
          </div>
        )}

        <section>
          <h3>Players ({players.length})</h3>
          {players.length === 0 && <p className="muted">No players yet.</p>}
          <ul className="plain">
            {players.map(([uid, m]) => {
              const c = characters?.[uid];
              return (
                <li key={uid} className="player-row">
                  <span>{m.displayName}</span>
                  {c ? (
                    <Link to={`/games/${id}/characters/${uid}`}>
                      {c.name || "Unnamed"} <span className="muted small">· {characterStatus(c)}</span>
                    </Link>
                  ) : (
                    <span className="muted small">No character yet</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </>
  );
}

function characterStatus(c: Character): string {
  const left = characterChecks(c).filter((ch) => !ch.ok).length;
  return left === 0 ? "ready" : `${left} to finish`;
}
