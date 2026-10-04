import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Character } from "../../shared/character.ts";
import { blankCharacter } from "../../shared/ruleset.ts";
import type { Token } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { LoadoutSummary } from "../components/LoadoutSummary.tsx";
import { activeToken } from "../../shared/engine.ts";
import { pct } from "../components/Grid.tsx";
import { TurnOrder } from "../components/TurnOrder.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { Waiting } from "../components/Waiting.tsx";
import { useClient } from "../net/hooks.ts";

/** A player's phone: their own character, plus public info about allies. */
export function Play() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { snapshot, client } = useClient(id, user?.id, "play");
  const character = useDoc<Character>(user ? `games/${id}/characters/${user.id}` : null);
  const [error, setError] = useState("");

  if (!snapshot.table) return <Waiting snapshot={snapshot} gameId={id} />;

  const tokens = Object.values(snapshot.table.tokens);
  const mine = tokens.find((t) => t.ownerId === user?.id);
  const allies = tokens.filter((t) => t.side === "player" && t.ownerId !== user?.id);

  const table = snapshot.table;
  const combat = table.combat;
  const active = activeToken(table);
  const myTurn = !!mine && active?.id === mine.id;
  // Outside combat you can always move; in combat only on your turn.
  const canMove = !!mine && (!combat || myTurn);
  const send = (action: Parameters<NonNullable<typeof client>["act"]>[0]) =>
    client?.act(action).then(() => setError(""), (e: Error) => setError(e.message));

  const move = (dx: number, dy: number) => {
    if (mine) client?.act({ type: "step", tokenId: mine.id, dx, dy }).then(() => setError(""), (e) => setError(e.message));
  };

  return (
    <main className="play">
      <header className="play-header">
        <h2>{mine?.name ?? "…"}</h2>
        <ConnectionBadge status={snapshot.status} />
      </header>
      {error && <p className="error">{error}</p>}
      {mine && <ResourceBars token={mine} />}

      {combat && (
        <section className={"combat-banner" + (myTurn ? "" : " waiting")}>
          <div>
            <strong>{myTurn ? "Your turn" : active ? `${active.name}'s turn` : "Combat"}</strong>
            <div className="muted small">
              Round {combat.round}
              {myTurn && ` · ${combat.movementLeft} Movement left · move here or tap your token on the board`}
            </div>
          </div>
          {myTurn && <button onClick={() => send({ type: "endTurn" })}>End turn</button>}
        </section>
      )}

      <section>
        <h3>Move</h3>
        <div className="dpad">
          <button style={{ gridArea: "up" }} disabled={!canMove} onClick={() => move(0, -1)}>▲</button>
          <button style={{ gridArea: "left" }} disabled={!canMove} onClick={() => move(-1, 0)}>◀</button>
          <button style={{ gridArea: "right" }} disabled={!canMove} onClick={() => move(1, 0)}>▶</button>
          <button style={{ gridArea: "down" }} disabled={!canMove} onClick={() => move(0, 1)}>▼</button>
        </div>
      </section>

      {combat && (
        <section>
          <h3>Turn order</h3>
          <TurnOrder table={table} />
        </section>
      )}

      {character.data && user && (
        <LoadoutSummary c={{ ...blankCharacter(user.id, ""), ...character.data }} gameId={id} uid={user.id} inCombat={!!combat} />
      )}

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

      <Link to={`/games/${id}/characters/${user?.id}`}>My character sheet</Link>
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
