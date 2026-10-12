// The GM deletes a game for good: the game, every sheet, map, item, effect and enemy in it, its
// invite code, and its uploaded images. Kept apart from index.ts so tests can run it against the emulators.
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { deleteNameMatches } from "../../shared/deleteGame.ts";
import type { GameDoc, GmMeta } from "../../shared/types.ts";

/** Just the part of a Cloud Storage bucket this needs. */
export interface GameFiles {
  deleteFiles(query: { prefix: string }): Promise<unknown>;
}

export async function deleteGameAsGm(db: Firestore, files: GameFiles | undefined, uid: string, gameId: string, typedName: string): Promise<void> {
  if (!gameId || gameId.includes("/")) throw new HttpsError("invalid-argument", "No such game.");
  const gameRef = db.doc(`games/${gameId}`);
  const metaRef = gameRef.collection("gm").doc("meta");

  // The game document goes first: without it the security rules turn every member away, so a
  // GM tab still hosting can't save the table back while the rest is being removed.
  await db.runTransaction(async (tx) => {
    const game = (await tx.get(gameRef)).data() as GameDoc | undefined;
    if (!game) throw new HttpsError("not-found", "No such game.");
    if (game.gmId !== uid) throw new HttpsError("permission-denied", "Only the GM can delete this game.");
    if (!deleteNameMatches(typedName, game.name)) throw new HttpsError("invalid-argument", "That isn't the game's name, so nothing was deleted.");
    const code = ((await tx.get(metaRef)).data() as GmMeta | undefined)?.inviteCode;
    if (code) tx.delete(db.doc(`inviteCodes/${code}`));
    tx.delete(gameRef);
  });
  await db.recursiveDelete(gameRef);
  // The game is already gone by now, so a failure here leaves only unreachable images behind.
  await files?.deleteFiles({ prefix: `games/${gameId}/` }).catch((err) => console.error(`Couldn't delete images of game ${gameId}`, err));
}
