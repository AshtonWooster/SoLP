import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GameDetail, Resources, Token } from "../../shared/types.ts";
import { api } from "../api.ts";
import { Grid } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { socket, useGameState, useTable } from "../socket.ts";

const RESOURCE_FIELDS: [keyof Resources, keyof Resources, string][] = [
  ["hp", "maxHp", "Health"],
  ["stagger", "maxStagger", "Stagger Resist"],
  ["light", "maxLight", "Light"],
  ["sanity", "maxSanity", "Sanity"],
];

/** The GM's laptop: runs the table and can override anything. */
export function Gm() {
  const { id = "" } = useParams();
  const error = useTable(id, "gm");
  const state = useGameState();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api<{ game: GameDetail }>(`/games/${id}`)
      .then((r) => setGame(r.game))
      .catch(() => {});
  }, [id]);

  if (error) return <TableError error={error} gameId={id} />;

  const selected = selectedId ? state?.tokens[selectedId] : undefined;
  const online = new Set(state?.online ?? []);

  const onCellClick = (x: number, y: number) => {
    if (selectedId) socket.emit("moveToken", { tokenId: selectedId, x, y }, () => {});
  };

  return (
    <main className="gm">
      <header className="gm-header">
        <Link to={`/games/${id}`} className="muted">← {game?.name ?? "Game"}</Link>
        <ConnectionBadge />
        <a href={`/games/${id}/board`} target="_blank" rel="noreferrer">Open board</a>
        {game?.inviteCode && <span className="muted">Invite code: {game.inviteCode}</span>}
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
          {game?.members
            .filter((m) => m.role === "player")
            .map((m) => (
              <li key={m.id}>
                {m.displayName} <span className={"dot " + (online.has(m.id) ? "ok" : "bad")} />
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
