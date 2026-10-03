import { useEffect, useRef, useState } from "react";
import type { GameDoc, User, View } from "../../shared/types.ts";
import { Client, type ClientSnapshot } from "./client.ts";
import { Host, type HostSnapshot } from "./host.ts";

/** Hosts the game's live table in this tab while the GM screen is open. */
export function useHost(gameId: string, user: User | null | undefined, game: GameDoc | undefined) {
  const [snapshot, setSnapshot] = useState<HostSnapshot>({ status: "starting", notes: {}, online: [] });
  const hostRef = useRef<Host | null>(null);
  const isGm = !!user && !!game && game.gmId === user.id;

  useEffect(() => {
    if (!isGm || !user || !game) return;
    const host = new Host(gameId, { uid: user.id, role: "gm", displayName: user.displayName }, game);
    hostRef.current = host;
    const unsub = host.subscribe(setSnapshot);
    host.start();
    // Save before the tab goes away (closing, reloading, or a phone switching apps).
    const onHide = () => void host.flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      unsub();
      host.stop();
      hostRef.current = null;
    };
    // Only restart hosting for a different game or user; member changes go through setGame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, user?.id, isGm]);

  useEffect(() => {
    if (game) hostRef.current?.setGame(game);
  }, [game]);

  return { snapshot, host: hostRef.current };
}

/** Connects this board or phone to the GM's hosted table. */
export function useClient(gameId: string, uid: string | undefined, view: View) {
  const [snapshot, setSnapshot] = useState<ClientSnapshot>({ status: "connecting", online: [] });
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    if (!uid) return;
    const client = new Client(gameId, uid, view);
    clientRef.current = client;
    const unsub = client.subscribe(setSnapshot);
    client.start();
    return () => {
      unsub();
      client.stop();
      clientRef.current = null;
    };
  }, [gameId, uid, view]);

  return { snapshot, client: clientRef.current };
}
