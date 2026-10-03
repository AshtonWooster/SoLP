import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import type { GameDoc, GmMeta, TableState } from "../../shared/types.ts";
import { useAuth, useDoc } from "../api.ts";
import { Grid } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { TableError } from "../components/TableError.tsx";

/** The shared table display, run by the GM on a big screen. View-only. */
export function Board() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const game = useDoc<GameDoc>(`games/${id}`);
  const isGm = !!user && game.data?.gmId === user.id;
  const table = useDoc<TableState>(isGm ? `games/${id}/table/state` : null);
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
  if (table.error) return <TableError error={table.error} gameId={id} />;

  return (
    <main className="board">
      <header className="board-header">
        <h2>{table.data?.map.name ?? "Loading…"}</h2>
        <ConnectionBadge offline={table.offline} />
      </header>
      {table.data && <Grid state={table.data} />}
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
