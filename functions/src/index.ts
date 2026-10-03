// Only the rare, trust-sensitive steps run here: creating a game and joining one.
// Live play never calls a function; the GM's browser hosts the table (see src/net).
import { randomInt } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { newTable } from "../../shared/engine.ts";
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

export const createGame = onCall(async (req) => {
  const uid = requireUid(req);
  const name = String(req.data?.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpsError("invalid-argument", "Give your game a name.");
  const displayName = await displayNameOf(req);
  const gameRef = db.collection("games").doc();

  await db.runTransaction(async (tx) => {
    // Pick an unused invite code.
    let code = newInviteCode();
    for (let i = 0; (await tx.get(db.doc(`inviteCodes/${code}`))).exists; i++) {
      if (i > 5) throw new HttpsError("internal", "Couldn't create an invite code. Try again.");
      code = newInviteCode();
    }
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
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new HttpsError("not-found", "No game with that invite code.");
  const invite = await db.doc(`inviteCodes/${code}`).get();
  const gameId = invite.data()?.gameId as string | undefined;
  if (!gameId) throw new HttpsError("not-found", "No game with that invite code.");
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
