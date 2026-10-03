import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { PRESENCE_INTERVAL_MS, PRESENCE_TIMEOUT_MS, type Presence } from "../shared/types.ts";
import { db } from "./firebase.ts";

/** While a table screen is open, check in regularly so the GM can see who's at the table. */
export function useHeartbeat(gameId: string, uid: string | undefined) {
  useEffect(() => {
    if (!uid) return;
    const beat = () =>
      setDoc(doc(db, "games", gameId, "presence", uid), { lastSeen: Date.now() } satisfies Presence).catch(() => {});
    beat();
    const timer = setInterval(beat, PRESENCE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [gameId, uid]);
}

/** User ids whose table screen checked in recently. */
export function useOnline(gameId: string): Set<string> {
  const [presence, setPresence] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(
    () =>
      onSnapshot(
        collection(db, "games", gameId, "presence"),
        (snap) => setPresence(Object.fromEntries(snap.docs.map((d) => [d.id, (d.data() as Presence).lastSeen]))),
        () => {},
      ),
    [gameId],
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  return new Set(Object.entries(presence).filter(([, t]) => now - t < PRESENCE_TIMEOUT_MS).map(([id]) => id));
}
