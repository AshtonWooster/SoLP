import { io, type Socket } from "socket.io-client";
import { useEffect, useState } from "react";
import type { Ack, ClientToServer, GameState, ServerToClient } from "../shared/types.ts";

export const socket: Socket<ServerToClient, ClientToServer> = io({ autoConnect: true });

/** Latest game state pushed by the server for whatever room this screen joined. */
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

/** Re-runs `join` on every (re)connect so screens recover after a dropped connection. */
export function useJoin(join: (() => void) | null) {
  useEffect(() => {
    if (!join) return;
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
    };
  }, [join]);
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

export function ackError(res: Ack<any>): string | null {
  return res.ok ? null : res.error;
}

export function store<T>(key: string, value?: T): T | null {
  try {
    if (value !== undefined) localStorage.setItem(key, JSON.stringify(value));
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function query(name: string): string {
  return new URLSearchParams(location.search).get(name) ?? "";
}
