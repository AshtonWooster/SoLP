import { Link } from "react-router-dom";

export function TableError({ error, gameId }: { error: string; gameId: string }) {
  return (
    <main className="center">
      <p className="error">{error}</p>
      <Link to={`/games/${gameId}`}>Back to the game</Link>
    </main>
  );
}
