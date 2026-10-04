import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { GameDoc, GmMeta, Resources, TableAction, TableState, Token } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { activeToken } from "../../shared/engine.ts";
import { Grid } from "../components/Grid.tsx";
import { TurnOrder } from "../components/TurnOrder.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { useHost } from "../net/hooks.ts";

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
  const meta = useDoc<GmMeta>(isGm ? `games/${id}/gm/meta` : null);
  const { snapshot, host } = useHost(id, user, game.data);
  const online = new Set(snapshot.online);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  if (game.error) return <TableError error={game.error} gameId={id} />;
  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!isGm) return <TableError error="Only the GM can open this screen." gameId={id} />;

  if (snapshot.status === "replaced") {
    return <TableError error="This game is now being run from another GM screen. Close this one, or reload to take over here." gameId={id} />;
  }
  if (snapshot.status === "error") return <TableError error={snapshot.error ?? "Couldn't open the table."} gameId={id} />;

  /** Actions on the GM screen apply instantly in this tab; connected devices get the update. */
  const act = (action: TableAction): boolean => {
    try {
      host?.act(action);
      setActionError("");
      return true;
    } catch (err) {
      setActionError((err as Error).message);
      return false;
    }
  };

  const table = snapshot.table;
  const selected = selectedId ? table?.tokens[selectedId] : undefined;
  const players = Object.entries(game.data!.members).filter(([, m]) => m.role === "player");

  return (
    <main className="gm">
      <header className="gm-header">
        <Link to={`/games/${id}`} className="muted">← {game.data!.name}</Link>
        <ConnectionBadge status={snapshot.status} />
        <a href={`/games/${id}/board`} target="_blank" rel="noreferrer">Open board</a>
        {meta.data && <span className="muted">Invite code: {meta.data.inviteCode}</span>}
        {actionError && <span className="error">{actionError}</span>}
      </header>

      <section className="gm-map">
        {table && (
          <Grid
            state={table}
            selectedId={selectedId}
            activeId={table.combat ? activeToken(table)?.id : undefined}
            onTokenClick={(t) => setSelectedId(t.id === selectedId ? null : t.id)}
            onCellClick={(x, y) => selectedId && act({ type: "move", tokenId: selectedId, x, y })}
          />
        )}
        <p className="muted">Click a token to select it, then click a tile to move it.</p>
      </section>

      <section className="gm-side">
        {table && <CombatPanel table={table} act={act} />}
        <AddEnemy onAdd={(name) => act({ type: "addToken", name, side: "enemy", x: 10, y: 5 })} />
        {selected ? (
          <Override
            key={selected.id}
            token={selected}
            note={snapshot.notes[selected.id] ?? ""}
            act={act}
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
          {table?.log.slice(-15).reverse().map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      </section>
    </main>
  );
}

function AddEnemy({ onAdd }: { onAdd: (name: string) => boolean }) {
  const [name, setName] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (onAdd(name || "Enemy")) setName("");
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
  token,
  note,
  act,
  onRemoved,
}: {
  token: Token;
  note: string;
  act: (action: TableAction) => boolean;
  onRemoved: () => void;
}) {
  const [notes, setNotes] = useState(note);
  useEffect(() => setNotes(note), [note]);

  const set = (key: keyof Resources, value: number) =>
    act({ type: "setResources", tokenId: token.id, patch: { [key]: value } });

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
      <div className="resource-row">
        <label>Justice</label>
        {token.side === "player" && token.ownerId ? (
          <span className="muted small">{token.justice ?? 0}, from their character sheet</span>
        ) : (
          <NumberField value={token.justice ?? 0} onCommit={(n) => act({ type: "setJustice", tokenId: token.id, justice: n })} />
        )}
      </div>
      <label className="muted">GM notes (hidden from players)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== note && act({ type: "setNote", tokenId: token.id, note: notes })}
      />
      <button
        className="danger"
        onClick={() => act({ type: "removeToken", tokenId: token.id }) && onRemoved()}
      >
        Remove token
      </button>
    </div>
  );
}

/** Start combat, run the turn order, and end combat. */
function CombatPanel({ table, act }: { table: TableState; act: (action: TableAction) => boolean }) {
  const tokens = Object.values(table.tokens);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState("");
  const combat = table.combat;

  if (!combat) {
    if (!picking) {
      return (
        <div className="combat-panel">
          <button
            className="big-button"
            onClick={() => {
              setPicked(new Set(tokens.map((t) => t.id)));
              setPicking(true);
            }}
          >
            Start combat
          </button>
        </div>
      );
    }
    return (
      <div className="combat-panel">
        <h3>Who's in this fight?</h3>
        <p className="muted small">Each rolls 1d6 + Justice for Speed.</p>
        <ul className="pick-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.has(t.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(t.id);
                    else next.delete(t.id);
                    setPicked(next);
                  }}
                />
                <span className="swatch" style={{ background: t.color }} /> {t.name}
                <span className="muted small">({t.side}, Justice {t.justice ?? 0})</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="row">
          <button
            className="big-button"
            disabled={picked.size === 0}
            onClick={() => act({ type: "startCombat", tokenIds: [...picked] }) && setPicking(false)}
          >
            Roll Speed and start
          </button>
          <button onClick={() => setPicking(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  const outside = tokens.filter((t) => !combat.order.some((c) => c.tokenId === t.id));
  const active = activeToken(table);
  return (
    <div className="combat-panel">
      <div className="row-between">
        <h3>Combat · Round {combat.round}</h3>
        <button className="danger" onClick={() => confirm("End combat?") && act({ type: "endCombat" })}>
          End combat
        </button>
      </div>
      {active && (
        <p className="muted small">
          {active.name}'s turn · {combat.movementLeft} Movement left
        </p>
      )}
      <TurnOrder
        table={table}
        controls={(tokenId, i) => (
          <>
            <button aria-label="Move up" disabled={i === 0} onClick={() => act({ type: "reorderCombatant", tokenId, dir: -1 })}>
              ↑
            </button>
            <button aria-label="Move down" disabled={i === combat.order.length - 1} onClick={() => act({ type: "reorderCombatant", tokenId, dir: 1 })}>
              ↓
            </button>
            <button aria-label="Remove from turn order" onClick={() => act({ type: "removeCombatant", tokenId })}>
              ✕
            </button>
          </>
        )}
      />
      <div className="row">
        <button className="big-button" onClick={() => act({ type: "endTurn" })}>
          Next turn
        </button>
        <button onClick={() => act({ type: "rerollSpeed" })}>Re-roll Speed</button>
      </div>
      {outside.length > 0 && (
        <div className="row">
          <select aria-label="Add to turn order" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add to turn order…</option>
            {outside.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button disabled={!adding} onClick={() => act({ type: "addCombatant", tokenId: adding }) && setAdding("")}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
