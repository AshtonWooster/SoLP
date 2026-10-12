import { initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";
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
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
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

export const createGameFn = httpsCallable<{ name: string }, { id: string }>(functions, "createGame");
export const joinGameFn = httpsCallable<{ code: string }, { id: string }>(functions, "joinGame");
export const newInviteCodeFn = httpsCallable<{ gameId: string }, { code: string }>(functions, "newGameInviteCode");
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
