import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import type { GameDoc, GmMeta, GmNotes, Resources, TableState, Token } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { Grid } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { act, db, friendlyError } from "../firebase.ts";
import { useHeartbeat, useOnline } from "../table.ts";

const RESOURCE_FIELDS: [keyof Resources, keyof Resources, string][] = [
  ["hp", "maxHp", "Health"],
  ["stagger", "maxStagger", "Stagger Resist"],
  ["light", "maxLight", "Light"],
  ["sanity", "maxSanity", "Sanity"],
];

/** The GM's laptop: runs the table and can override anything. */
export function Gm() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const table = useDoc<TableState>(isGm ? `games/${id}/table/state` : null);
  const meta = useDoc<GmMeta>(isGm ? `games/${id}/gm/meta` : null);
  const notes = useDoc<GmNotes>(isGm ? `games/${id}/gm/notes` : null);
  const online = useOnline(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  useHeartbeat(id, user?.id);

  if (game.error) return <TableError error={game.error} gameId={id} />;
  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!isGm) return <TableError error="Only the GM can open this screen." gameId={id} />;

  const run = (p: Promise<unknown>) =>
    p.then(() => setActionError("")).catch((err) => setActionError(friendlyError(err)));

  const selected = selectedId ? table.data?.tokens[selectedId] : undefined;
  const players = Object.entries(game.data!.members).filter(([, m]) => m.role === "player");

  return (
    <main className="gm">
      <header className="gm-header">
        <Link to={`/games/${id}`} className="muted">← {game.data!.name}</Link>
        <ConnectionBadge offline={table.offline} />
        <a href={`/games/${id}/board`} target="_blank" rel="noreferrer">Open board</a>
        {meta.data && <span className="muted">Invite code: {meta.data.inviteCode}</span>}
        {actionError && <span className="error">{actionError}</span>}
      </header>

      <section className="gm-map">
        {table.data && (
          <Grid
            state={table.data}
            selectedId={selectedId}
            onTokenClick={(t) => setSelectedId(t.id === selectedId ? null : t.id)}
            onCellClick={(x, y) => selectedId && run(act(id, { type: "move", tokenId: selectedId, x, y }))}
          />
        )}
        <p className="muted">Click a token to select it, then click a tile to move it.</p>
      </section>

      <section className="gm-side">
        <AddEnemy onAdd={(name) => run(act(id, { type: "addToken", name, side: "enemy", x: 10, y: 5 }))} />
        {selected ? (
          <Override
            key={selected.id}
            gameId={id}
            token={selected}
            note={notes.data?.tokens?.[selected.id] ?? ""}
            run={run}
            onRemoved={() => setSelectedId(null)}
          />
        ) : (
          <p className="muted">Select a token to override its stats.</p>
        )}
        <h3>Players</h3>
        <ul className="plain">
          {players.length === 0 && <li className="muted">No players yet.</li>}
          {players.map(([uid, m]) => (
            <li key={uid}>
              {m.displayName} <span className={"dot " + (online.has(uid) ? "ok" : "bad")} />
            </li>
          ))}
        </ul>
        <h3>Log</h3>
        <ol className="log">
          {table.data?.log.slice(-15).reverse().map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      </section>
    </main>
  );
}

function AddEnemy({ onAdd }: { onAdd: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name || "Enemy").then(() => setName(""));
      }}
    >
      <input placeholder="Enemy name" value={name} onChange={(e) => setName(e.target.value)} />
      <button>Add enemy</button>
    </form>
  );
}

/** A number box that saves on Enter or when you click away, and follows changes made elsewhere. */
function NumberField({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <input
      type="number"
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

/** GM override panel: set any resource on any token directly. */
function Override({
  gameId,
  token,
  note,
  run,
  onRemoved,
}: {
  gameId: string;
  token: Token;
  note: string;
  run: (p: Promise<unknown>) => Promise<unknown>;
  onRemoved: () => void;
}) {
  const [notes, setNotes] = useState(note);
  useEffect(() => setNotes(note), [note]);

  const set = (key: keyof Resources, value: number) =>
    run(act(gameId, { type: "setResources", tokenId: token.id, patch: { [key]: value } }));

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
          <NumberField value={token.resources[cur]} onCommit={(n) => set(cur, n)} />
          <button onClick={() => set(cur, token.resources[cur] + 1)}>+</button>
          <span className="muted">/</span>
          <NumberField value={token.resources[max]} onCommit={(n) => set(max, n)} />
        </div>
      ))}
      <label className="muted">GM notes (hidden from players)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() =>
          notes !== note &&
          run(updateDoc(doc(db, "games", gameId, "gm", "notes"), { [`tokens.${token.id}`]: notes.slice(0, 2000) }))
        }
      />
      <button
        className="danger"
        onClick={() => run(act(gameId, { type: "removeToken", tokenId: token.id }).then(onRemoved))}
      >
        Remove token
      </button>
    </div>
  );
}
