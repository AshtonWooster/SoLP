// A player leaves a game for good, with what's theirs in it: their place in the game, their
// character sheet, the items and effects they made, their connection handshakes and the images they
// uploaded. Used when the GM removes a player (everything goes) and when a player deletes their
// account (items and effects the GM approved stay with the game).
// Kept apart from index.ts so tests can run it against the emulators.
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { GameDoc } from "../../shared/types.ts";
import type { GameFiles } from "./deleteGame.ts";

/** The GM removes a player from their game, with all of that player's data in it. */
export async function removePlayerAsGm(db: Firestore, files: GameFiles | undefined, gmUid: string, gameId: string, playerUid: string): Promise<void> {
  if (!gameId || gameId.includes("/") || !playerUid || playerUid.includes("/")) throw new HttpsError("invalid-argument", "No such player.");
  const game = (await db.doc(`games/${gameId}`).get()).data() as GameDoc | undefined;
  if (!game) throw new HttpsError("not-found", "No such game.");
  if (game.gmId !== gmUid) throw new HttpsError("permission-denied", "Only the GM can remove players.");
  if (playerUid === game.gmId) throw new HttpsError("invalid-argument", "The GM can't be removed.");
  await removePlayerData(db, files, gameId, playerUid, { keepApproved: false });
}

/**
 * Removes a player and what they made from a game they don't GM. Safe to run again if it stopped partway.
 * `keepApproved`: items and effects the GM approved stay with the game (when a player deletes their account).
 */
export async function removePlayerData(db: Firestore, files: GameFiles | undefined, gameId: string, uid: string, opts: { keepApproved: boolean }): Promise<void> {
  const gameRef = db.doc(`games/${gameId}`);
  // Their place goes first: the security rules then turn them away, so nothing new of theirs arrives.
  await db.runTransaction(async (tx) => {
    const game = (await tx.get(gameRef)).data() as GameDoc | undefined;
    if (!game) return;
    const members = { ...game.members };
    delete members[uid];
    tx.update(gameRef, { memberIds: game.memberIds.filter((m) => m !== uid), members });
  });
  await db.recursiveDelete(gameRef.collection("characters").doc(uid));

  const [items, effects, signals] = await Promise.all([
    gameRef.collection("items").where("createdBy", "==", uid).get(),
    gameRef.collection("effects").where("createdBy", "==", uid).get(),
    gameRef.collection("signals").where("uid", "==", uid).get(),
  ]);
  const writer = db.bulkWriter();
  const mine = [
    ...items.docs.filter((d) => !opts.keepApproved || d.get("pending") === true),
    ...effects.docs.filter((d) => !opts.keepApproved || d.get("approved") !== true),
    ...signals.docs,
  ];
  for (const d of mine) void writer.delete(d.ref);
  await writer.close();

  await files?.deleteFiles({ prefix: `games/${gameId}/users/${uid}/` }).catch((err) => console.error(`Couldn't delete images of ${uid} in game ${gameId}`, err));
}
