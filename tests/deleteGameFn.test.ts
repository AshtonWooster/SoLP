// The deleteGame Cloud Function's work, run against the emulators. Run with `npm run test:rules`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";
import { deleteGameAsGm } from "../functions/src/deleteGame.ts";

// firebase-admin lives with the functions.
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage") as typeof import("firebase-admin/storage");

const GAME = "doomed";
const OTHER = "survivor";
let db: import("firebase-admin/firestore").Firestore;
let bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  const app = initializeApp({ projectId: "demo-solp", storageBucket: "demo-solp.appspot.com" }, "deleteGameTest");
  db = getFirestore(app);
  bucket = getStorage(app).bucket();
});

async function seed(gameId: string, code: string) {
  const game = db.doc(`games/${gameId}`);
  await game.set({ name: "Backstreets Run", gmId: "gm", memberIds: ["gm", "p1"], members: {}, createdAt: 1 });
  await game.collection("gm").doc("meta").set({ inviteCode: code });
  await game.collection("gm").doc("notes").set({ tokens: {} });
  await game.collection("table").doc("state").set({ tokens: {}, log: [] });
  await game.collection("characters").doc("p1").set({ ownerId: "p1", rank: 9 });
  await game.collection("items").doc("i1").set({ name: "Knife" });
  await game.collection("effects").doc("e1").set({ name: "Burn" });
  await game.collection("enemies").doc("n1").set({ name: "Thug" });
  await db.doc(`inviteCodes/${code}`).set({ gameId });
  await bucket.file(`games/${gameId}/assets/map.png`).save(Buffer.from("png"), { contentType: "image/png" });
  await bucket.file(`games/${gameId}/users/p1/portrait.png`).save(Buffer.from("png"), { contentType: "image/png" });
}

beforeEach(async () => {
  await db.recursiveDelete(db.collection("games"));
  await db.recursiveDelete(db.collection("inviteCodes"));
  await bucket.deleteFiles({ prefix: "games/" });
  await seed(GAME, "DOOM01");
  await seed(OTHER, "KEEP01");
});

const gameLeft = async (gameId: string) => (await db.doc(`games/${gameId}`).listCollections()).length + ((await db.doc(`games/${gameId}`).get()).exists ? 1 : 0);
const filesLeft = async (gameId: string) => (await bucket.getFiles({ prefix: `games/${gameId}/` }))[0].length;

test("the GM deletes the game with everything in it, its invite code and its images; other games stay", async () => {
  await deleteGameAsGm(db, bucket, "gm", GAME, " Backstreets Run ");
  assert.equal(await gameLeft(GAME), 0);
  assert.equal((await db.doc("inviteCodes/DOOM01").get()).exists, false);
  assert.equal(await filesLeft(GAME), 0);
  assert.ok((await db.doc(`games/${OTHER}/characters/p1`).get()).exists);
  assert.ok((await db.doc("inviteCodes/KEEP01").get()).exists);
  assert.equal(await filesLeft(OTHER), 2);
});

test("players and strangers can't delete a game, even with its name", async () => {
  for (const uid of ["p1", "stranger"]) {
    await assert.rejects(deleteGameAsGm(db, bucket, uid, GAME, "Backstreets Run"), { code: "permission-denied" });
  }
  assert.ok((await db.doc(`games/${GAME}`).get()).exists);
  assert.ok((await db.doc(`games/${GAME}/characters/p1`).get()).exists);
  assert.equal(await filesLeft(GAME), 2);
});

test("the GM must type the game's exact name; otherwise nothing is deleted", async () => {
  for (const name of ["", "backstreets run", "Backstreets"]) {
    await assert.rejects(deleteGameAsGm(db, bucket, "gm", GAME, name), { code: "invalid-argument" });
  }
  assert.ok((await db.doc(`games/${GAME}`).get()).exists);
  assert.ok((await db.doc("inviteCodes/DOOM01").get()).exists);
});

test("a game that doesn't exist or a bad id is refused", async () => {
  await assert.rejects(deleteGameAsGm(db, bucket, "gm", "nope", "Backstreets Run"), { code: "not-found" });
  await assert.rejects(deleteGameAsGm(db, bucket, "gm", `${GAME}/gm`, "Backstreets Run"), { code: "invalid-argument" });
  await assert.rejects(deleteGameAsGm(db, bucket, "gm", "", "Backstreets Run"), { code: "invalid-argument" });
});
