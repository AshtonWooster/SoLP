import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import type { GameDetail } from "../../shared/types.ts";
import { api } from "../api.ts";
import { Grid } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";
import { useGameState, useTable } from "../socket.ts";

/** The shared table display. View-only: players act from their phones, the GM from the laptop. */
export function Board() {
  const { id = "" } = useParams();
  const error = useTable(id, "board");
  const state = useGameState();
  const [inviteCode, setInviteCode] = useState("");
  const [qr, setQr] = useState("");

  useEffect(() => {
    api<{ game: GameDetail }>(`/games/${id}`)
      .then((r) => setInviteCode(r.game.inviteCode ?? ""))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!inviteCode) return;
    QRCode.toDataURL(`${location.origin}/join/${inviteCode}`, { margin: 1, width: 240 }).then(setQr);
  }, [inviteCode]);

  if (error) return <TableError error={error} gameId={id} />;

  return (
    <main className="board">
      <header className="board-header">
        <h2>{state?.map.name ?? "Loading…"}</h2>
        <ConnectionBadge />
      </header>
      {state && <Grid state={state} />}
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
