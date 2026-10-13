import { initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth, signOut } from "firebase/auth";
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

/** In `npm run dev` everything talks to the local Firebase emulators under a demo project. */
const useEmulators = import.meta.env.DEV || import.meta.env.VITE_USE_EMULATORS === "true";

async function loadConfig(): Promise<FirebaseOptions> {
  if (useEmulators) return { projectId: "demo-solp", apiKey: "demo-key", authDomain: "demo-solp.firebaseapp.com", storageBucket: "demo-solp.appspot.com" };
  // Firebase Hosting serves the project's web config here, so no keys live in the repo.
  const res = await fetch("/__/firebase/init.json");
  if (!res.ok) throw new Error("Couldn't load Firebase config. Is the site deployed on Firebase Hosting?");
  return res.json();
}

const app = initializeApp(await loadConfig());
export const auth = getAuth(app);
// Token fields like ownerId are optional; leave them out instead of rejecting the save.
// The cache is kept on the device (shared by its tabs), so a screen opened again within half an
// hour is charged only for documents that changed, not for every item, effect and enemy again.
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const functions = getFunctions(app);
export const storage = getStorage(app);

if (useEmulators) {
  // Use the page's own host so phones on the same Wi-Fi reach the laptop's emulators too.
  const host = location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}

/**
 * Logs out and wipes this device's saved copy of the games, so the next person on a shared
 * device can't read it. Firestore can't be used again after this, so the page reloads at `to`.
 */
export async function logOut(to = "/"): Promise<void> {
  await signOut(auth).catch(() => {});
  await terminate(db).catch(() => {});
  await clearIndexedDbPersistence(db).catch((err) => console.warn("Couldn't clear saved game data", err));
  location.assign(to);
}

export const createGameFn = httpsCallable<{ name: string }, { id: string }>(functions, "createGame");
export const joinGameFn = httpsCallable<{ code: string }, { id: string }>(functions, "joinGame");
export const newInviteCodeFn = httpsCallable<{ gameId: string }, { code: string }>(functions, "newGameInviteCode");
export const removePlayerFn = httpsCallable<{ gameId: string; uid: string }, { ok: boolean }>(functions, "removePlayer");
export const deleteGameFn = httpsCallable<{ gameId: string; name: string }, { ok: boolean }>(functions, "deleteGame");
export const deleteAccountFn = httpsCallable<{ email: string }, { deletedGames: number }>(functions, "deleteAccount");
/** Firebase errors carry codes like "auth/wrong-password"; turn the common ones into plain sentences. */
export function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "Wrong email or password.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Password must be at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/network-request-failed": "Can't reach the server. Check your connection.",
  };
  if (messages[code]) return messages[code];
  // Callable function errors carry the message we wrote on the server.
  if (code.startsWith("functions/")) return (err as Error).message;
  return (err as Error)?.message ?? "Something went wrong.";
}
