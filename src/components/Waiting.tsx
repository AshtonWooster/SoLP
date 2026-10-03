import { Link } from "react-router-dom";
import type { ClientSnapshot } from "../net/client.ts";

/** Shown on a board or phone until it has the table from the GM's screen. */
export function Waiting({ snapshot, gameId }: { snapshot: ClientSnapshot; gameId: string }) {
  const text =
    snapshot.message ??
    (snapshot.status === "waiting"
      ? "Waiting for the GM to open the table."
      : snapshot.status === "connecting"
        ? "Connecting to the GM's screen…"
        : "Can't reach the GM's screen. Retrying…");
  return (
    <main className="center">
      <p className={snapshot.status === "closed" ? "error" : "muted"}>{text}</p>
      <Link to={`/games/${gameId}`}>Back to the game</Link>
    </main>
  );
}
