// Someone deletes their account for good: the games they GM (with everything in them), their
// character, images and unapproved items and effects in every other game, their place in those
// games, their account settings, and finally their login. Kept apart from index.ts so tests can
// run it against the emulators.
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { deleteEmailMatches, signedInRecently } from "../../shared/deleteAccount.ts";
import type { GameDoc } from "../../shared/types.ts";
import { removeGame, type GameFiles } from "./deleteGame.ts";

/** Just the part of Firebase Authentication this needs. */
export interface AccountLogins {
  deleteUser(uid: string): Promise<unknown>;
}

/** Who is asking, from their ID token. */
export interface Requester {
  uid: string;
  email?: string;
  authTime?: number;
}

export async function deleteAccountData(
  db: Firestore,
  files: GameFiles | undefined,
  logins: AccountLogins,
  who: Requester,
  typedEmail: string,
  nowMs = Date.now(),
): Promise<{ deletedGames: number }> {
  const { uid } = who;
  if (!who.email || !deleteEmailMatches(typedEmail, who.email)) {
    throw new HttpsError("invalid-argument", "That isn't your account's email, so nothing was deleted.");
  }
  if (!signedInRecently(who.authTime, nowMs)) {
    throw new HttpsError("unauthenticated", "Enter your password again to delete your account.");
  }

  // Every game this account is in; the GM is always a member too.
  const games = await db.collection("games").where("memberIds", "array-contains", uid).get();
  let deletedGames = 0;
  for (const snap of games.docs) {
    const game = snap.data() as GameDoc;
    if (game.gmId === uid) {
      await removeGame(db, files, snap.id);
      deletedGames++;
    } else {
      await leaveGame(db, files, snap.id, uid);
    }
  }

  await db.doc(`users/${uid}`).delete();
  await db.doc(`joinAttempts/${uid}`).delete();
  // The login goes last, so if anything above fails they can log in and try again.
  await logins.deleteUser(uid).catch((err: { code?: string }) => {
    if (err?.code !== "auth/user-not-found") throw err;
  });
  return { deletedGames };
}

/** Removes a player and what's theirs from someone else's game. Approved items and effects stay with the game. */
async function leaveGame(db: Firestore, files: GameFiles | undefined, gameId: string, uid: string): Promise<void> {
  const gameRef = db.doc(`games/${gameId}`);
  await db.runTransaction(async (tx) => {
    const game = (await tx.get(gameRef)).data() as GameDoc | undefined;
    if (!game) return;
    const members = { ...game.members };
    delete members[uid];
    tx.update(gameRef, { memberIds: game.memberIds.filter((m) => m !== uid), members });
  });
  await db.recursiveDelete(gameRef.collection("characters").doc(uid));

  const batch = db.batch();
  const [items, effects, signals] = await Promise.all([
    gameRef.collection("items").where("createdBy", "==", uid).get(),
    gameRef.collection("effects").where("createdBy", "==", uid).get(),
    gameRef.collection("signals").where("uid", "==", uid).get(),
  ]);
  items.docs.filter((d) => d.get("pending") === true).forEach((d) => batch.delete(d.ref));
  effects.docs.filter((d) => d.get("approved") !== true).forEach((d) => batch.delete(d.ref));
  signals.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  await files?.deleteFiles({ prefix: `games/${gameId}/users/${uid}/` }).catch((err) => console.error(`Couldn't delete images of ${uid} in game ${gameId}`, err));
}
