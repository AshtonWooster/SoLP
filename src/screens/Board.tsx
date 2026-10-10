import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import type { Character } from "../../shared/character.ts";
import { tokenGear } from "../../shared/tokenPreview.ts";
import type { GameDoc, GmMeta, TableAction } from "../../shared/types.ts";
import { useAuth, useCollection, useDoc } from "../api.ts";
import { TokenPopup } from "../components/TokenPopup.tsx";
import { activeToken, reachableTiles } from "../../shared/engine.ts";
import { isMassAttack } from "../../shared/ruleset.ts";
import { PHASE_LABELS } from "../components/ActionPanel.tsx";
import { aimTargets, Grid } from "../components/Grid.tsx";
import { useClashPlayback } from "../components/ClashFx.tsx";
import { TurnOrder } from "../components/TurnOrder.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { Waiting } from "../components/Waiting.tsx";
import { useClient } from "../net/hooks.ts";

/**
 * The shared table display, usually on a big screen; any member can open it. In combat it shows
 * slotted Pages as arrows. Whoever's turn it is can tap their glowing token to move, and while
 * they're aiming a Page (picked on their phone), tap a lit token to target it.
 */
export function Board() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const isMember = !!user && !!game.data?.members[user.id];
  const { snapshot, client } = useClient(id, isMember ? user.id : undefined, "board");
  const [moving, setMoving] = useState(false);
  // Outside combat: the token picked up to move anywhere (your own, or any on the GM's account).
  const [carrying, setCarrying] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The token tapped to see its character (when the tap does nothing else).
  const [peekId, setPeekId] = useState<string | null>(null);
  const characters = useCollection<Character>(isMember ? `games/${id}/characters` : null);
  // Damage from a clash shows once its die has played on the board.
  const { step: fx, table } = useClashPlayback(snapshot.table);
  const active = table ? activeToken(table) : undefined;
  const combat = table?.combat;
  // Players take their turns at the board; the GM runs enemies from the GM screen.
  const playerTurn = active?.side === "player" && combat?.phase === "actions" ? active : undefined;
  // The GM's account can act for whoever's turn it is; a player only for themselves.
  const mayAct = !!playerTurn && (isGm || playerTurn.ownerId === user?.id);
  const reachable = useMemo(
    () => (moving && mayAct && playerTurn && table && combat ? reachableTiles(table, playerTurn, combat.movementLeft) : undefined),
    [moving, mayAct, playerTurn, table, combat],
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
  if (!isMember) return <TableError error="You're not in this game." gameId={id} />;
  if (!table || snapshot.status === "closed") return <Waiting snapshot={snapshot} gameId={id} />;

  const send = (action: TableAction) =>
    client?.act(action).then(
      () => setError(""),
      (e: Error) => setError(e.message),
    );
  const aim = combat?.aim;
  const aimedPage = aim && combat && (combat.pages[aim.pageId] ?? table.tokens[aim.tokenId]?.pages?.find((p) => p.id === aim.pageId));
  const aiming = !!aim && mayAct && aim.tokenId === playerTurn?.id;
  const mass = !!aimedPage && isMassAttack(aimedPage.type);
  const { targetable } = aimTargets(table);
  const recent = table.log.slice(-8);
  const peek = peekId ? table.tokens[peekId] : undefined;

  return (
    <main className="board">
      <header className="board-header">
        <h2>{table.map.name}</h2>
        <ConnectionBadge status={snapshot.status} />
        {combat && (
          <span className="muted">
            Round {combat.round} · {PHASE_LABELS[combat.phase]}
          </span>
        )}
        {!combat && <span className="muted small">{carrying ? "Tap a tile to move there." : "Tap your token, then a tile, to move."}</span>}
      </header>
      <div className={combat ? "board-layout" : ""}>
        <div className="board-map">
          <Grid
            state={table}
            activeId={active?.id}
            selectedId={moving ? playerTurn?.id : carrying}
            reachable={reachable}
            fx={fx}
            onTokenClick={(t) => {
              if (aiming && targetable.has(t.id)) {
                send(mass ? { type: "aimTarget", tokenId: t.id } : { type: "slot", targets: [t.id] });
                return;
              }
              if (mayAct && playerTurn && t.id === playerTurn.id) return setMoving((m) => !m);
              if (!combat && (isGm || t.ownerId === user?.id)) return setCarrying((c) => (c === t.id ? null : t.id));
              setPeekId((p) => (p === t.id ? null : t.id));
            }}
            onCellClick={(x, y) => {
              if (!combat && carrying) {
                send({ type: "move", tokenId: carrying, x, y });
                return setCarrying(null);
              }
              if (!reachable?.has(`${x},${y}`)) return setMoving(false);
              send({ type: "turnMove", x, y })?.then(() => setMoving(false));
            }}
          />
          {peek && (
            <TokenPopup
              key={peek.id}
              token={peek}
              // Players see their party's gear; a GM character's deck stays the GM's secret.
              gear={peek.side === "player" ? tokenGear(peek, peek.ownerId ? characters?.[peek.ownerId] : undefined) : undefined}
              onClose={() => setPeekId(null)}
            />
          )}
        </div>
        {combat && (
          <aside className="board-side">
            <div className="board-turn">
              {active && <strong>{active.name}'s turn</strong>}
              {aim && aimedPage ? (
                <>
                  <span>
                    {table.tokens[aim.tokenId]?.name} is using <strong>{aimedPage.name}</strong>.{" "}
                    {aiming ? (mass ? "Tap lit tokens to pick targets." : "Tap a lit token to target it.") : ""}
                  </span>
                  {aiming && mass && (
                    <button className="big-button" disabled={aim.targets.length === 0} onClick={() => send({ type: "slot" })}>
                      Use on {aim.targets.length} target{aim.targets.length === 1 ? "" : "s"}
                    </button>
                  )}
                  {aiming && <button onClick={() => send({ type: "clearAim" })}>Cancel</button>}
                </>
              ) : playerTurn ? (
                <span className="muted">
                  {mayAct
                    ? `${moving ? "Tap a lit tile to move there." : "Tap your glowing token to move."} Pick Pages on your phone.`
                    : "Pick Pages and move from your phone."}{" "}
                  {combat.movementLeft} Movement left.
                </span>
              ) : (
                active && <span className="muted">The GM is taking this turn.</span>
              )}
              {mayAct && !aim && (
                <button className="big-button" onClick={() => send({ type: "endTurn" })}>
                  End {playerTurn!.name}'s turn
                </button>
              )}
              {error && <span className="error">{error}</span>}
            </div>
            <TurnOrder table={table} />
            <ol className="combat-log">
              {recent.map((line, i) => (
                <li key={`${table.log.length}-${i}`} className={line.startsWith(" ") ? "detail" : ""}>
                  {line.trim()}
                </li>
              ))}
            </ol>
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
