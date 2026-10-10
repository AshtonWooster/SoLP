// Only the rare, trust-sensitive steps run here: creating a game, joining one, and the GM changing its invite code.
// Live play never calls a function; the GM's browser hosts the table (see src/net).
import { randomInt } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { newTable } from "../../shared/engine.ts";
import { afterWrongCode, type JoinAttempts, mayTryCode, minutesUntilRetry } from "../../shared/invites.ts";
import type { GameDoc, GameRole, GmMeta, UserDoc } from "../../shared/types.ts";

initializeApp();
const db = getFirestore();

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1, easy to read aloud

function requireUid(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please log in.");
  return req.auth.uid;
}

async function displayNameOf(req: CallableRequest): Promise<string> {
  const snap = await db.doc(`users/${req.auth!.uid}`).get();
  const doc = snap.data() as UserDoc | undefined;
  return doc?.displayName || req.auth!.token.name || req.auth!.token.email || "Player";
}

function newInviteCode(): string {
  return Array.from({ length: 6 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
}

/** An invite code no other game uses, read inside the transaction that claims it. */
async function unusedInviteCode(tx: Transaction): Promise<string> {
  let code = newInviteCode();
  for (let i = 0; (await tx.get(db.doc(`inviteCodes/${code}`))).exists; i++) {
    if (i > 5) throw new HttpsError("internal", "Couldn't create an invite code. Try again.");
    code = newInviteCode();
  }
  return code;
}

export const createGame = onCall(async (req) => {
  const uid = requireUid(req);
  const name = String(req.data?.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpsError("invalid-argument", "Give your game a name.");
  const displayName = await displayNameOf(req);
  const gameRef = db.collection("games").doc();

  await db.runTransaction(async (tx) => {
    const code = await unusedInviteCode(tx);
    const game: GameDoc = {
      name,
      gmId: uid,
      memberIds: [uid],
      members: { [uid]: { displayName, role: "gm" } },
      createdAt: Date.now(),
    };
    tx.set(gameRef, game);
    tx.set(gameRef.collection("gm").doc("meta"), { inviteCode: code } satisfies GmMeta);
    tx.set(gameRef.collection("gm").doc("notes"), { tokens: {} });
    tx.set(gameRef.collection("table").doc("state"), newTable());
    tx.set(db.doc(`inviteCodes/${code}`), { gameId: gameRef.id });
  });
  return { id: gameRef.id };
});

/** Joining is permanent: the game stays on the player's front page from then on. */
export const joinGame = onCall(async (req) => {
  const uid = requireUid(req);
  const code = String(req.data?.code ?? "").trim().toUpperCase();
  // Too many wrong codes and the account waits, so codes can't be guessed (shared/invites.ts).
  const attemptsRef = db.doc(`joinAttempts/${uid}`);
  const attempts = (await attemptsRef.get()).data() as JoinAttempts | undefined;
  if (!mayTryCode(attempts, Date.now())) {
    throw new HttpsError("resource-exhausted", `Too many wrong invite codes. Try again in ${minutesUntilRetry(attempts!, Date.now())} minutes.`);
  }
  const invite = /^[A-Z0-9]{6}$/.test(code) ? await db.doc(`inviteCodes/${code}`).get() : undefined;
  const gameId = invite?.data()?.gameId as string | undefined;
  if (!gameId) {
    await db.runTransaction(async (tx) => {
      const a = (await tx.get(attemptsRef)).data() as JoinAttempts | undefined;
      tx.set(attemptsRef, afterWrongCode(a, Date.now()));
    });
    throw new HttpsError("not-found", "No game with that invite code.");
  }
  const displayName = await displayNameOf(req);

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`games/${gameId}`);
    const game = (await tx.get(ref)).data() as GameDoc | undefined;
    if (!game) throw new HttpsError("not-found", "No game with that invite code.");
    if (game.memberIds.includes(uid)) return; // already in (GM or player)
    tx.update(ref, {
      memberIds: [...game.memberIds, uid],
      [`members.${uid}`]: { displayName, role: "player" satisfies GameRole },
    });
  });
  return { id: gameId };
});

/** The GM swaps the game's invite code for a new one; the old code stops working. */
export const newGameInviteCode = onCall(async (req) => {
  const uid = requireUid(req);
  const gameId = String(req.data?.gameId ?? "");
  if (!gameId || gameId.includes("/")) throw new HttpsError("invalid-argument", "No such game.");
  const gameRef = db.doc(`games/${gameId}`);
  const metaRef = gameRef.collection("gm").doc("meta");

  const code = await db.runTransaction(async (tx) => {
    const game = (await tx.get(gameRef)).data() as GameDoc | undefined;
    if (!game || game.gmId !== uid) throw new HttpsError("permission-denied", "Only the GM can change the invite code.");
    const old = ((await tx.get(metaRef)).data() as GmMeta | undefined)?.inviteCode;
    const code = await unusedInviteCode(tx);
    if (old) tx.delete(db.doc(`inviteCodes/${old}`));
    tx.set(db.doc(`inviteCodes/${code}`), { gameId });
    tx.set(metaRef, { inviteCode: code } satisfies GmMeta);
    return code;
  });
  return { code };
});
