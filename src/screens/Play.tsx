import { useCallback, useState } from "react";
import type { Token } from "../../shared/types.ts";
import { pct } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { query, socket, store, useGameState, useJoin } from "../socket.ts";

interface PlayerSession {
  code: string;
  playerId: string;
}

/** A player's phone: their own character, plus public info about allies. */
export function Play() {
  const [session, setSession] = useState<PlayerSession | null>(() => {
    const saved = store<PlayerSession>("solp.player");
    const room = query("room").toUpperCase();
    return saved && (!room || saved.code === room) ? saved : null;
  });
  const [code, setCode] = useState(query("room").toUpperCase());
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const state = useGameState();

  const join = useCallback(() => {
    if (!session) return;
    socket.emit("joinPlayer", { code: session.code, name: "", playerId: session.playerId }, (res) => {
      if (!res.ok) {
        setError(res.error);
        localStorage.removeItem("solp.player");
        setSession(null);
      }
    });
  }, [session]);
  useJoin(session ? join : null);

  if (!session) {
    return (
      <main className="center">
        <h1>Join game</h1>
        {error && <p className="error">{error}</p>}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const room = code.toUpperCase();
            socket.emit("joinPlayer", { code: room, name }, (res) => {
              if (!res.ok) return setError(res.error);
              const s = { code: room, playerId: res.playerId };
              store("solp.player", s);
              setError("");
              setSession(s);
            });
          }}
        >
          <input placeholder="Room code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={4} />
          <input placeholder="Character name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
          <button className="big-button">Join</button>
        </form>
      </main>
    );
  }

  const tokens = state ? Object.values(state.tokens) : [];
  const mine = tokens.find((t) => t.ownerId === session.playerId);
  const allies = tokens.filter((t) => t.side === "player" && t.ownerId !== session.playerId);

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

      <button
        className="link"
        onClick={() => {
          if (!confirm("Leave this game?")) return;
          localStorage.removeItem("solp.player");
          setSession(null);
        }}
      >
        Leave game
      </button>
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
