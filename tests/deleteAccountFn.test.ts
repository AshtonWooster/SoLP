// The deleteAccount Cloud Function's work, run against the emulators. Run with `npm run test:rules`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";
import { deleteAccountData, type AccountLogins } from "../functions/src/deleteAccount.ts";

// firebase-admin lives with the functions.
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage") as typeof import("firebase-admin/storage");

const NOW = 1_800_000_000_000;
const JUST_NOW = NOW / 1000 - 30;
let db: import("firebase-admin/firestore").Firestore;
let bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
let deletedLogins: string[];
const logins: AccountLogins = { deleteUser: async (uid) => void deletedLogins.push(uid) };

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  const app = initializeApp({ projectId: "demo-solp", storageBucket: "demo-solp.appspot.com" }, "deleteAccountTest");
  db = getFirestore(app);
  bucket = getStorage(app).bucket();
});

const png = (path: string) => bucket.file(path).save(Buffer.from("png"), { contentType: "image/png" });

/** Leaver GMs "theirs" (with p2 in it) and plays in "others" (GM'd by gm, with p2 too). */
beforeEach(async () => {
  deletedLogins = [];
  for (const c of ["games", "inviteCodes", "users", "joinAttempts"]) await db.recursiveDelete(db.collection(c));
  await bucket.deleteFiles({ prefix: "games/" });

  await db.doc("users/leaver").set({ displayName: "Leaver", email: "leaver@x.test" });
  await db.doc("users/p2").set({ displayName: "P2", email: "p2@x.test" });
  await db.doc("joinAttempts/leaver").set({ wrong: 3, since: 1 });

  const theirs = db.doc("games/theirs");
  await theirs.set({ name: "Leaver's Game", gmId: "leaver", memberIds: ["leaver", "p2"], members: { leaver: { displayName: "Leaver", role: "gm" }, p2: { displayName: "P2", role: "player" } }, createdAt: 1 });
  await theirs.collection("gm").doc("meta").set({ inviteCode: "MINE01" });
  await theirs.collection("characters").doc("p2").set({ ownerId: "p2", rank: 9 });
  await db.doc("inviteCodes/MINE01").set({ gameId: "theirs" });
  await png("games/theirs/assets/map.png");

  const others = db.doc("games/others");
  await others.set({ name: "Others' Game", gmId: "gm", memberIds: ["gm", "leaver", "p2"], members: { gm: { displayName: "GM", role: "gm" }, leaver: { displayName: "Leaver", role: "player" }, p2: { displayName: "P2", role: "player" } }, createdAt: 1 });
  await others.collection("gm").doc("meta").set({ inviteCode: "KEEP01" });
  await db.doc("inviteCodes/KEEP01").set({ gameId: "others" });
  await others.collection("characters").doc("leaver").set({ ownerId: "leaver", rank: 9 });
  await others.collection("characters").doc("p2").set({ ownerId: "p2", rank: 9 });
  await others.collection("items").doc("pendingMine").set({ name: "Shiv", createdBy: "leaver", pending: true });
  await others.collection("items").doc("approvedMine").set({ name: "Knife", createdBy: "leaver" });
  await others.collection("items").doc("p2s").set({ name: "Bat", createdBy: "p2", pending: true });
  await others.collection("effects").doc("draftMine").set({ name: "Bleed", createdBy: "leaver", approved: false });
  await others.collection("effects").doc("approvedMine").set({ name: "Burn", createdBy: "leaver", approved: true });
  await others.collection("signals").doc("s1").set({ uid: "leaver", sessionId: "x", offer: "o", createdAt: 1 });
  await others.collection("signals").doc("s2").set({ uid: "p2", sessionId: "x", offer: "o", createdAt: 1 });
  await png("games/others/users/leaver/portrait.png");
  await png("games/others/users/p2/portrait.png");
  await png("games/others/assets/map.png");
});

const exists = async (path: string) => (await db.doc(path).get()).exists;
const files = async (prefix: string) => (await bucket.getFiles({ prefix }))[0].length;
const leaver = { uid: "leaver", email: "leaver@x.test", authTime: JUST_NOW };

test("deleting an account removes the games they GM, their data in other games, their settings and their login", async () => {
  const result = await deleteAccountData(db, bucket, logins, leaver, " Leaver@x.test ", NOW);
  assert.deepEqual(result, { deletedGames: 1 });
  assert.deepEqual(deletedLogins, ["leaver"]);

  // Their own game, for everyone.
  assert.equal(await exists("games/theirs"), false);
  assert.equal((await db.doc("games/theirs").listCollections()).length, 0);
  assert.equal(await exists("inviteCodes/MINE01"), false);
  assert.equal(await files("games/theirs/"), 0);

  // Their place and data in someone else's game.
  const others = (await db.doc("games/others").get()).data()!;
  assert.deepEqual(others.memberIds, ["gm", "p2"]);
  assert.deepEqual(Object.keys(others.members).sort(), ["gm", "p2"]);
  assert.equal(await exists("games/others/characters/leaver"), false);
  assert.equal(await exists("games/others/items/pendingMine"), false);
  assert.equal(await exists("games/others/effects/draftMine"), false);
  assert.equal(await exists("games/others/signals/s1"), false);
  assert.equal(await files("games/others/users/leaver/"), 0);

  // Their settings and abuse counter.
  assert.equal(await exists("users/leaver"), false);
  assert.equal(await exists("joinAttempts/leaver"), false);
});

test("other people's things stay, and so do items and effects the GM already approved", async () => {
  await deleteAccountData(db, bucket, logins, leaver, "leaver@x.test", NOW);
  for (const path of ["users/p2", "games/others", "games/others/characters/p2", "games/others/items/p2s", "games/others/signals/s2", "inviteCodes/KEEP01", "games/others/items/approvedMine", "games/others/effects/approvedMine"]) {
    assert.ok(await exists(path), path);
  }
  assert.equal(await files("games/others/users/p2/"), 1);
  assert.equal(await files("games/others/assets/"), 1);
});

test("the wrong email, or no recent password, deletes nothing", async () => {
  await assert.rejects(deleteAccountData(db, bucket, logins, leaver, "p2@x.test", NOW), { code: "invalid-argument" });
  await assert.rejects(deleteAccountData(db, bucket, logins, leaver, "", NOW), { code: "invalid-argument" });
  await assert.rejects(deleteAccountData(db, bucket, logins, { ...leaver, email: undefined }, "", NOW), { code: "invalid-argument" });
  await assert.rejects(deleteAccountData(db, bucket, logins, { ...leaver, authTime: NOW / 1000 - 3600 }, "leaver@x.test", NOW), { code: "unauthenticated" });
  await assert.rejects(deleteAccountData(db, bucket, logins, { ...leaver, authTime: undefined }, "leaver@x.test", NOW), { code: "unauthenticated" });
  assert.deepEqual(deletedLogins, []);
  assert.ok(await exists("users/leaver"));
  assert.ok(await exists("games/theirs"));
  assert.ok(await exists("games/others/characters/leaver"));
});

test("someone can only delete their own account: another user's email does nothing to it", async () => {
  // p2 is signed in and types the leaver's email: refused, and the leaver's data stays.
  await assert.rejects(deleteAccountData(db, bucket, logins, { uid: "p2", email: "p2@x.test", authTime: JUST_NOW }, "leaver@x.test", NOW), { code: "invalid-argument" });
  assert.ok(await exists("users/leaver"));
  assert.ok(await exists("games/theirs"));
  assert.deepEqual(deletedLogins, []);
});

test("deleting again after a half-finished try finishes the job", async () => {
  await db.doc("users/leaver").delete();
  await db.recursiveDelete(db.doc("games/theirs"));
  const result = await deleteAccountData(db, bucket, logins, leaver, "leaver@x.test", NOW);
  assert.deepEqual(result, { deletedGames: 0 });
  assert.equal(await exists("games/others/characters/leaver"), false);
  assert.deepEqual(deletedLogins, ["leaver"]);
});
