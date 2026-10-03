import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Grid } from "../components/Grid.tsx";
import { ConnectionBadge } from "../components/Status.tsx";
import { query, socket, useGameState, useJoin } from "../socket.ts";

/** The shared table display. View-only: players act from their phones, the GM from the laptop. */
export function Board() {
  const [code, setCode] = useState(query("room").toUpperCase());
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const state = useGameState();

  const join = useCallback(() => {
    socket.emit("joinBoard", { code }, (res) => setError(res.ok ? "" : res.error));
  }, [code]);
  useJoin(code ? join : null);

  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(`${location.origin}/play?room=${code}`, { margin: 1, width: 240 }).then(setQr);
  }, [code]);

  if (!code || error) {
    return (
      <main className="center">
        <h1>Game Board</h1>
        {error && <p className="error">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            history.replaceState(null, "", `/board?room=${input.toUpperCase()}`);
            setError("");
            setCode(input.toUpperCase());
          }}
        >
          <input placeholder="Room code" value={input} onChange={(e) => setInput(e.target.value)} maxLength={4} autoFocus />
          <button>Show board</button>
        </form>
      </main>
    );
  }

  return (
    <main className="board">
      <header className="board-header">
        <h2>{state?.map.name ?? "Loading…"}</h2>
        <ConnectionBadge />
      </header>
      {state && <Grid state={state} />}
      <aside className="join-card">
        {qr && <img src={qr} alt="Scan to join" />}
        <div>
          <div className="muted">Join at {location.host}/play</div>
          <div className="room-code">{code}</div>
        </div>
      </aside>
    </main>
  );
}
