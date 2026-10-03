import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GameDetail } from "../../shared/types.ts";
import { api } from "../api.ts";
import { TopBar } from "../components/TopBar.tsx";

/** A game's home: what you can open from here depends on whether you're its GM or a player. */
export function GamePage() {
  const { id = "" } = useParams();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ game: GameDetail }>(`/games/${id}`)
      .then((r) => setGame(r.game))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <>
        <TopBar />
        <main className="center">
          <p className="error">{error}</p>
          <Link to="/">Back to your games</Link>
        </main>
      </>
    );
  }
  if (!game) return <main className="center muted">Loading…</main>;

  const inviteUrl = game.inviteCode ? `${location.origin}/join/${game.inviteCode}` : "";
  const players = game.members.filter((m) => m.role === "player");

  return (
    <>
      <TopBar />
      <main className="game-page">
        <Link to="/" className="muted">← Your games</Link>
        <h1>
          {game.name} <span className={`role-badge role-${game.role}`}>{game.role === "gm" ? "GM" : "Player"}</span>
        </h1>

        {game.role === "gm" ? (
          <>
            <div className="screen-links">
              <Link className="big-button" to={`/games/${id}/gm`}>
                Run the game
                <small>GM controls, for your laptop</small>
              </Link>
              <Link className="big-button secondary" to={`/games/${id}/board`}>
                Open the board
                <small>Shared map, for the iPad or TV. Log in there as yourself.</small>
              </Link>
            </div>
            <section className="panel">
              <h3>Invite players</h3>
              <p>
                Invite code: <strong className="invite-code">{game.inviteCode}</strong>
              </p>
              <p className="muted">
                Or share this link: <a href={inviteUrl}>{inviteUrl}</a>
              </p>
            </section>
          </>
        ) : (
          <div className="screen-links">
            <Link className="big-button" to={`/games/${id}/play`}>
              Open my table view
              <small>Your character, hand and party, on your phone</small>
            </Link>
          </div>
        )}

        <section>
          <h3>Players ({players.length})</h3>
          {players.length === 0 && <p className="muted">No players yet.</p>}
          <ul className="plain">
            {players.map((m) => (
              <li key={m.id}>{m.displayName}</li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
