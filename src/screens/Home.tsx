import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { GameDoc, GameRole } from "../../shared/types.ts";
import { useAuth } from "../api.ts";
import { createGameFn, db, friendlyError } from "../firebase.ts";
import { TopBar } from "../components/TopBar.tsx";

export function Home() {
  const { user } = useAuth();
  if (user === undefined) return <main className="center muted">Loading…</main>;
  if (!user) {
    return (
      <main className="center">
        <h1 className="brand-hero">SoLP</h1>
        <p className="muted">A digital table for the LoR PMTTRPG. Run the board on a big screen, the game from your laptop, and play from your phone.</p>
        <Link className="big-button" to="/signup">Create an account</Link>
        <Link className="big-button secondary" to="/login">Log in</Link>
      </main>
    );
  }
  return <Dashboard uid={user.id} />;
}

interface GameSummary {
  id: string;
  name: string;
  role: GameRole;
  gmName: string;
  playerCount: number;
  createdAt: number;
}

/** The logged-in front page: every game you run or play in. */
function Dashboard({ uid }: { uid: string }) {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // Live list: a game you join or create on another device shows up here right away.
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "games"), where("memberIds", "array-contains", uid)),
        (snap) =>
          setGames(
            snap.docs
              .map((d) => {
                const g = d.data() as GameDoc;
                return {
                  id: d.id,
                  name: g.name,
                  role: g.members[uid]?.role ?? "player",
                  gmName: g.members[g.gmId]?.displayName ?? "",
                  playerCount: Object.values(g.members).filter((m) => m.role === "player").length,
                  createdAt: g.createdAt,
                };
              })
              .sort((a, b) => b.createdAt - a.createdAt),
          ),
        (err) => setError(friendlyError(err)),
      ),
    [uid],
  );

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await createGameFn({ name });
      navigate(`/games/${data.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/join/${encodeURIComponent(code.trim().toUpperCase())}`);
  };

  return (
    <>
      <TopBar />
      <main className="dashboard">
        <section>
          <h2>Your games</h2>
          {error && <p className="error">{error}</p>}
          {games === null && !error && <p className="muted">Loading…</p>}
          {games?.length === 0 && <p className="muted">You're not in any games yet. Create one or join with an invite code.</p>}
          <ul className="game-list">
            {games?.map((g) => (
              <li key={g.id}>
                <Link to={`/games/${g.id}`} className="game-card">
                  <span className="game-name">{g.name}</span>
                  <span className={`role-badge role-${g.role}`}>{g.role === "gm" ? "GM" : "Player"}</span>
                  <span className="muted">
                    GM: {g.gmName} · {g.playerCount} player{g.playerCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="dashboard-actions">
          <form className="panel stack" onSubmit={create}>
            <h3>Create a game</h3>
            <p className="muted">You'll be the GM.</p>
            <input placeholder="Game name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
            <button disabled={busy}>{busy ? "Creating…" : "Create game"}</button>
          </form>
          <form className="panel stack" onSubmit={join}>
            <h3>Join a game</h3>
            <input placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} required />
            <button>Join</button>
          </form>
        </section>
      </main>
    </>
  );
}
