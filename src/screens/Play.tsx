import { Link, useParams } from "react-router-dom";
import type { Token } from "../../shared/types.ts";
import { useAuth } from "../api.ts";
import { pct } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { socket, useGameState, useTable } from "../socket.ts";

/** A player's phone: their own character, plus public info about allies. */
export function Play() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const error = useTable(id, "play");
  const state = useGameState();

  if (error) return <TableError error={error} gameId={id} />;

  const tokens = state ? Object.values(state.tokens) : [];
  const mine = tokens.find((t) => t.ownerId === user?.id);
  const allies = tokens.filter((t) => t.side === "player" && t.ownerId !== user?.id);

  const move = (dx: number, dy: number) => {
    if (mine) socket.emit("moveToken", { tokenId: mine.id, x: mine.x + dx, y: mine.y + dy }, () => {});
  };

  return (
    <main className="play">
      <header className="play-header">
        <h2>{mine?.name ?? "…"}</h2>
        <ConnectionBadge />
      </header>
      {mine && <ResourceBars token={mine} />}

      <section>
        <h3>Move</h3>
        <div className="dpad">
          <button style={{ gridArea: "up" }} onClick={() => move(0, -1)}>▲</button>
          <button style={{ gridArea: "left" }} onClick={() => move(-1, 0)}>◀</button>
          <button style={{ gridArea: "right" }} onClick={() => move(1, 0)}>▶</button>
          <button style={{ gridArea: "down" }} onClick={() => move(0, 1)}>▼</button>
        </div>
      </section>

      <section>
        <h3>Allies</h3>
        {allies.length === 0 && <p className="muted">No one else has joined yet.</p>}
        {allies.map((t) => (
          <div className="ally" key={t.id}>
            <strong>{t.name}</strong>
            <ResourceBars token={t} compact />
          </div>
        ))}
      </section>

      <Link to={`/games/${id}`} className="muted">← Back to the game</Link>
    </main>
  );
}

function ResourceBars({ token, compact }: { token: Token; compact?: boolean }) {
  const r = token.resources;
  const rows: [string, number, number, string][] = [
    ["Health", r.hp, r.maxHp, "hp"],
    ["Stagger", r.stagger, r.maxStagger, "stagger"],
    ["Light", r.light, r.maxLight, "light"],
    ["Sanity", r.sanity, r.maxSanity, "sanity"],
  ];
  return (
    <div className={"resources" + (compact ? " compact" : "")}>
      {rows.map(([label, v, max, cls]) => (
        <div className="resource" key={label}>
          <span>{label}</span>
          <div className="meter">
            <div className={"fill " + cls} style={{ width: `${pct(v, max)}%` }} />
          </div>
          <span className="num">
            {v}/{max}
          </span>
        </div>
      ))}
    </div>
  );
}
