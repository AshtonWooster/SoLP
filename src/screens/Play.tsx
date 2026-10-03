import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { TableState, Token } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { pct } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { act, friendlyError } from "../firebase.ts";
import { useHeartbeat } from "../table.ts";

/** A player's phone: their own character, plus public info about allies. */
export function Play() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const table = useDoc<TableState>(`games/${id}/table/state`);
  const [error, setError] = useState("");
  useHeartbeat(id, user?.id);

  // Sitting down creates this player's token the first time they open the table.
  useEffect(() => {
    act(id, { type: "takeSeat" }).catch((err) => setError(friendlyError(err)));
  }, [id]);

  if (error || table.error) return <TableError error={error || table.error} gameId={id} />;

  const tokens = table.data ? Object.values(table.data.tokens) : [];
  const mine = tokens.find((t) => t.ownerId === user?.id);
  const allies = tokens.filter((t) => t.side === "player" && t.ownerId !== user?.id);

  const move = (dx: number, dy: number) => {
    if (mine) act(id, { type: "step", tokenId: mine.id, dx, dy }).catch(() => {});
  };

  return (
    <main className="play">
      <header className="play-header">
        <h2>{mine?.name ?? "…"}</h2>
        <ConnectionBadge offline={table.offline} />
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
