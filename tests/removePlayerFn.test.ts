// The GM removing a player (the removePlayer Cloud Function's work), run against the emulators.
// Run with `npm run test:rules`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";
import { removePlayerAsGm } from "../functions/src/removePlayer.ts";

// firebase-admin lives with the functions.
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage") as typeof import("firebase-admin/storage");

let db: import("firebase-admin/firestore").Firestore;
let bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  const app = initializeApp({ projectId: "demo-solp", storageBucket: "demo-solp.appspot.com" }, "removePlayerTest");
  db = getFirestore(app);
  bucket = getStorage(app).bucket();
});

const png = (path: string) => bucket.file(path).save(Buffer.from("png"), { contentType: "image/png" });

beforeEach(async () => {
  await db.recursiveDelete(db.collection("games"));
  await bucket.deleteFiles({ prefix: "games/" });
  const game = db.doc("games/g");
  await game.set({
    name: "Backstreets",
    gmId: "gm",
    memberIds: ["gm", "p1", "p2"],
    members: { gm: { displayName: "GM", role: "gm" }, p1: { displayName: "Ann", role: "player" }, p2: { displayName: "Bo", role: "player" } },
    createdAt: 1,
  });
  await game.collection("characters").doc("p1").set({ ownerId: "p1", rank: 9 });
  await game.collection("characters").doc("p2").set({ ownerId: "p2", rank: 9 });
  await game.collection("items").doc("approved").set({ name: "Knife", createdBy: "p1" });
  await game.collection("items").doc("pending").set({ name: "Shiv", createdBy: "p1", pending: true });
  await game.collection("items").doc("bos").set({ name: "Bat", createdBy: "p2" });
  await game.collection("items").doc("gms").set({ name: "Sword" });
  await game.collection("effects").doc("approved").set({ name: "Burn", createdBy: "p1", approved: true });
  await game.collection("effects").doc("draft").set({ name: "Bleed", createdBy: "p1", approved: false });
  await game.collection("signals").doc("s1").set({ uid: "p1", sessionId: "x", offer: "sdp", createdAt: 1 });
  await game.collection("signals").doc("s2").set({ uid: "p2", sessionId: "x", offer: "sdp", createdAt: 1 });
  await png("games/g/users/p1/portrait/a.png");
  await png("games/g/users/p1/art/b.png");
  await png("games/g/users/p2/portrait/c.png");
  await png("games/g/assets/maps/m.png");
});

const exists = async (path: string) => (await db.doc(path).get()).exists;
const files = async (prefix: string) => (await bucket.getFiles({ prefix }))[0].length;

test("removing a player deletes their place, sheet, items, effects and images", async () => {
  await removePlayerAsGm(db, bucket, "gm", "g", "p1");
  const game = (await db.doc("games/g").get()).data()!;
  assert.deepEqual(game.memberIds, ["gm", "p2"]);
  assert.deepEqual(Object.keys(game.members).sort(), ["gm", "p2"]);
  for (const path of ["characters/p1", "items/approved", "items/pending", "effects/approved", "effects/draft", "signals/s1"]) {
    assert.equal(await exists(`games/g/${path}`), false, path);
  }
  assert.equal(await files("games/g/users/p1/"), 0);
});

test("everyone else's things stay", async () => {
  await removePlayerAsGm(db, bucket, "gm", "g", "p1");
  for (const path of ["characters/p2", "items/bos", "items/gms", "signals/s2"]) assert.ok(await exists(`games/g/${path}`), path);
  assert.equal(await files("games/g/users/p2/"), 1);
  assert.equal(await files("games/g/assets/"), 1);
});

test("only the GM removes players, and never themselves", async () => {
  await assert.rejects(removePlayerAsGm(db, bucket, "p2", "g", "p1"), { code: "permission-denied" });
  await assert.rejects(removePlayerAsGm(db, bucket, "gm", "g", "gm"), { code: "invalid-argument" });
  await assert.rejects(removePlayerAsGm(db, bucket, "gm", "nope", "p1"), { code: "not-found" });
  await assert.rejects(removePlayerAsGm(db, bucket, "gm", "g/../x", "p1"), { code: "invalid-argument" });
  assert.ok(await exists("games/g/characters/p1"));
  assert.equal(await files("games/g/users/p1/"), 2);
});
