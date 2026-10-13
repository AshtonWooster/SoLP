// Someone deletes their account for good: the games they GM (with everything in them), their
// character, images and unapproved items and effects in every other game, their place in those
// games, their account settings, and finally their login. Kept apart from index.ts so tests can
// run it against the emulators.
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { deleteEmailMatches, signedInRecently } from "../../shared/deleteAccount.ts";
import type { GameDoc } from "../../shared/types.ts";
import { removeGame, type GameFiles } from "./deleteGame.ts";
import { removePlayerData } from "./removePlayer.ts";

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
      await removePlayerData(db, files, snap.id, uid, { keepApproved: true });
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
