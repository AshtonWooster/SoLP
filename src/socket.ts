import { io, type Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { ClientToServer, GameState, ServerToClient, View } from "../shared/types.ts";

// Connects only while a table screen is open, after login, so the session cookie goes with it.
export const socket: Socket<ServerToClient, ClientToServer> = io({ autoConnect: false });

/** Latest game state pushed by the server for the table this screen joined. */
export function useGameState(): GameState | null {
  const [state, setState] = useState<GameState | null>(null);
  useEffect(() => {
    socket.on("state", setState);
    return () => {
      socket.off("state", setState);
    };
  }, []);
  return state;
}

/** Connects, opens the game's table as the given view, and rejoins after any dropped connection. */
export function useTable(gameId: string, view: View): string {
  const [error, setError] = useState("");
  useEffect(() => {
    const join = () =>
      socket.emit("joinGame", { gameId, view }, (res) => setError(res.ok ? "" : res.error));
    const onError = (err: Error) => setError(err.message);
    socket.on("connect", join);
    socket.on("connect_error", onError);
    socket.connect();
    return () => {
      socket.off("connect", join);
      socket.off("connect_error", onError);
      socket.disconnect();
    };
  }, [gameId, view]);
  return error;
}

export function useConnected(): boolean {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on("connect", on);
    socket.on("disconnect", off);
    return () => {
      socket.off("connect", on);
      socket.off("disconnect", off);
    };
  }, []);
  return connected;
}
