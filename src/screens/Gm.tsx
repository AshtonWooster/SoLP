import { useCallback, useEffect, useState } from "react";
import type { Resources, Token } from "../../shared/types.ts";
import { Grid } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { socket, store, useGameState, useJoin } from "../socket.ts";

interface GmSession {
  code: string;
  gmKey: string;
}

const RESOURCE_FIELDS: [keyof Resources, keyof Resources, string][] = [
  ["hp", "maxHp", "Health"],
  ["stagger", "maxStagger", "Stagger Resist"],
  ["light", "maxLight", "Light"],
  ["sanity", "maxSanity", "Sanity"],
];

/** The GM's laptop: runs the table and can override anything. */
export function Gm() {
  const [session, setSession] = useState<GmSession | null>(() => store<GmSession>("solp.gm"));
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const state = useGameState();

  const join = useCallback(() => {
    if (!session) return;
    socket.emit("joinGm", session, (res) => {
      if (!res.ok) {
        setError(res.error);
        setSession(null);
      }
    });
  }, [session]);
  useJoin(session ? join : null);

  const createRoom = () => {
    socket.emit("createRoom", (res) => {
      if (!res.ok) return setError(res.error);
      const s = { code: res.code, gmKey: res.gmKey };
      store("solp.gm", s);
      setError("");
      setSession(s);
    });
  };

  if (!session) {
    return (
      <main className="center">
        <h1>Game Master</h1>
        {error && <p className="error">{error} Start a new room below.</p>}
        <button className="big-button" onClick={createRoom}>Create room</button>
      </main>
    );
  }

  const selected = selectedId ? state?.tokens[selectedId] : undefined;

  const onCellClick = (x: number, y: number) => {
    if (selectedId) socket.emit("moveToken", { tokenId: selectedId, x, y }, () => {});
  };

  return (
    <main className="gm">
      <header className="gm-header">
        <h2>Room {session.code}</h2>
        <ConnectionBadge />
        <a href={`/board?room=${session.code}`} target="_blank" rel="noreferrer">Open board</a>
        <span className="muted">Players join at {location.host}/play with code {session.code}</span>
        <button
          className="link"
          onClick={() => {
            if (!confirm("Leave this room and start a new one?")) return;
            localStorage.removeItem("solp.gm");
            setSession(null);
          }}
        >
          New room
        </button>
      </header>

      <section className="gm-map">
        {state && (
          <Grid
            state={state}
            selectedId={selectedId}
            onTokenClick={(t) => setSelectedId(t.id === selectedId ? null : t.id)}
            onCellClick={onCellClick}
          />
        )}
        <p className="muted">Click a token to select it, then click a tile to move it.</p>
      </section>

      <section className="gm-side">
        <AddEnemy />
        {selected ? (
          <Override key={selected.id} token={selected} onRemoved={() => setSelectedId(null)} />
        ) : (
          <p className="muted">Select a token to override its stats.</p>
        )}
        <h3>Players</h3>
        <ul className="plain">
          {state &&
            Object.values(state.players).map((p) => (
              <li key={p.id}>
                {p.name} <span className={"dot " + (p.connected ? "ok" : "bad")} />
              </li>
            ))}
        </ul>
        <h3>Log</h3>
        <ol className="log">
          {state?.log.slice(-15).reverse().map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      </section>
    </main>
  );
}

function AddEnemy() {
  const [name, setName] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        socket.emit("gmAddToken", { name: name || "Enemy", side: "enemy", x: 10, y: 5 }, () => setName(""));
      }}
    >
      <input placeholder="Enemy name" value={name} onChange={(e) => setName(e.target.value)} />
      <button>Add enemy</button>
    </form>
  );
}

/** GM override panel: set any resource on any token directly. */
function Override({ token, onRemoved }: { token: Token; onRemoved: () => void }) {
  const [notes, setNotes] = useState(token.gmNotes ?? "");
  useEffect(() => setNotes(token.gmNotes ?? ""), [token.gmNotes]);

  const set = (key: keyof Resources, value: number) =>
    socket.emit("gmSetResources", { tokenId: token.id, patch: { [key]: value } }, () => {});

  return (
    <div className="override">
      <h3>
        <span className="swatch" style={{ background: token.color }} /> {token.name}{" "}
        <span className="muted">({token.side})</span>
      </h3>
      {RESOURCE_FIELDS.map(([cur, max, label]) => (
        <div className="resource-row" key={cur}>
          <label>{label}</label>
          <button onClick={() => set(cur, token.resources[cur] - 1)}>−</button>
          <input
            type="number"
            value={token.resources[cur]}
            onChange={(e) => set(cur, Number(e.target.value))}
          />
          <button onClick={() => set(cur, token.resources[cur] + 1)}>+</button>
          <span className="muted">/</span>
          <input
            type="number"
            value={token.resources[max]}
            onChange={(e) => set(max, Number(e.target.value))}
          />
        </div>
      ))}
      <label className="muted">GM notes (hidden from players)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => socket.emit("gmSetNotes", { tokenId: token.id, notes }, () => {})}
      />
      <button
        className="danger"
        onClick={() => socket.emit("gmRemoveToken", { tokenId: token.id }, (res) => res.ok && onRemoved())}
      >
        Remove token
      </button>
    </div>
  );
}
