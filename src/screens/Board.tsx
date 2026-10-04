import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import type { GameDoc, GmMeta } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { activeToken, reachableTiles } from "../../shared/engine.ts";
import { Grid } from "../components/Grid.tsx";
import { TurnOrder } from "../components/TurnOrder.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { Waiting } from "../components/Waiting.tsx";
import { useClient } from "../net/hooks.ts";

/**
 * The shared table display, run by the GM on a big screen. Outside combat it's view-only.
 * In combat, whoever's turn it is can tap their glowing token to see where they can move.
 */
export function Board() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const { snapshot, client } = useClient(id, isGm ? user.id : undefined, "board");
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const table = snapshot.table;
  const active = table ? activeToken(table) : undefined;
  // Only players take their turn at the board; the GM runs enemies from the GM screen.
  const playerTurn = active?.side === "player" ? active : undefined;
  const combat = table?.combat;
  const reachable = useMemo(
    () => (moving && playerTurn && table && combat ? reachableTiles(table, playerTurn, combat.movementLeft) : undefined),
    [moving, playerTurn, table, combat],
  );
  // A new turn (or the end of combat) clears any half-finished move.
  useEffect(() => {
    setMoving(false);
    setError("");
  }, [active?.id, combat?.round]);
  const meta = useDoc<GmMeta>(isGm ? `games/${id}/gm/meta` : null);
  const inviteCode = meta.data?.inviteCode;
  const [qr, setQr] = useState("");

  useEffect(() => {
    if (!inviteCode) return;
    QRCode.toDataURL(`${location.origin}/join/${inviteCode}`, { margin: 1, width: 240 }).then(setQr);
  }, [inviteCode]);

  if (game.error) return <TableError error={game.error} gameId={id} />;
  if (game.loading) return <main className="center muted">Loading…</main>;
  if (!isGm) return <TableError error="Only the GM can open this screen." gameId={id} />;
  if (!table) return <Waiting snapshot={snapshot} gameId={id} />;

  const send = (action: Parameters<NonNullable<typeof client>["act"]>[0]) =>
    client?.act(action).then(() => setError(""), (e: Error) => setError(e.message));

  return (
    <main className="board">
      <header className="board-header">
        <h2>{table.map.name}</h2>
        <ConnectionBadge status={snapshot.status} />
        {combat && <span className="muted">Round {combat.round}</span>}
      </header>
      <div className={combat ? "board-layout" : ""}>
        <Grid
          state={table}
          activeId={active?.id}
          selectedId={moving ? playerTurn?.id : null}
          reachable={reachable}
          onTokenClick={(t) => {
            if (playerTurn && t.id === playerTurn.id) setMoving((m) => !m);
          }}
          onCellClick={(x, y) => {
            if (!reachable?.has(`${x},${y}`)) return setMoving(false);
            send({ type: "turnMove", x, y })?.then(() => setMoving(false));
          }}
        />
        {combat && (
          <aside className="board-side">
            <div className="board-turn">
              {active ? (
                <>
                  <strong>{active.name}'s turn</strong>
                  {playerTurn ? (
                    <>
                      <span className="muted">
                        {moving ? "Tap a lit tile to move there." : "Tap your glowing token to move."} {combat.movementLeft} Movement left.
                      </span>
                      <button className="big-button" onClick={() => send({ type: "endTurn" })}>
                        End {active.name}'s turn
                      </button>
                    </>
                  ) : (
                    <span className="muted">The GM is taking this turn.</span>
                  )}
                </>
              ) : null}
              {error && <span className="error">{error}</span>}
            </div>
            <TurnOrder table={table} />
          </aside>
        )}
      </div>
      {inviteCode && (
        <aside className="join-card">
          {qr && <img src={qr} alt="Scan to join" />}
          <div>
            <div className="muted">Scan to join, or enter code</div>
            <div className="room-code">{inviteCode}</div>
          </div>
        </aside>
      )}
    </main>
  );
}
