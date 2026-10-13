// The weekly image cleanup, run against the emulators. Run with `npm run test:rules`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, test } from "node:test";
import { SWEEP_STATE, sweepImages } from "../functions/src/sweepImages.ts";

// firebase-admin lives with the functions.
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage") as typeof import("firebase-admin/storage");

let db: import("firebase-admin/firestore").Firestore;
let bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
const BUCKET = "demo-solp.appspot.com";
const url = (path: string) => `http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=t`;
const WEEK_LATER = Date.now() + 8 * 24 * 60 * 60 * 1000;

before(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  const app = initializeApp({ projectId: "demo-solp", storageBucket: BUCKET }, "sweepImagesTest");
  db = getFirestore(app);
  bucket = getStorage(app).bucket();
});

const put = (path: string) => bucket.file(path).save(Buffer.from("png"), { contentType: "image/png" });
const files = async () => (await bucket.getFiles({ prefix: "games/" }))[0].map((f) => f.name).sort();

beforeEach(async () => {
  await db.recursiveDelete(db.collection("games"));
  await db.doc(SWEEP_STATE).delete();
  await bucket.deleteFiles({ prefix: "games/" });
  await db.doc("games/g1").set({ name: "One", image: url("games/g1/assets/cover/c.jpg"), gmId: "gm", memberIds: ["gm"], members: {} });
  await db.doc("games/g1/table/state").set({ map: { background: url("games/g1/assets/maps/bg.png"), items: [] }, tokens: {}, log: [] });
  await db.doc("games/g1/characters/p1").set({ portrait: url("games/g1/users/p1/portrait/me.png") });
  await db.doc("games/g1/mapAssets/a").set({ url: url("games/g1/assets/maps/removed.png"), name: "Old", addedAt: 1, removed: true });
  // Another game copied an enemy whose art lives in g1's folder.
  await db.doc("games/g2").set({ name: "Two", gmId: "gm", memberIds: ["gm"], members: {} });
  await db.doc("games/g2/enemies/n1").set({ name: "Thug", portrait: url("games/g1/assets/enemies/thug.png") });
  for (const p of ["cover/c.jpg", "maps/bg.png", "maps/removed.png", "maps/replaced.png", "enemies/thug.png"]) await put(`games/g1/assets/${p}`);
  await put("games/g1/users/p1/portrait/me.png");
  await put("games/g1/users/p1/portrait/old.png");
});

const UNUSED = ["games/g1/assets/maps/removed.png", "games/g1/assets/maps/replaced.png", "games/g1/users/p1/portrait/old.png"];

test("the first run only logs unused images; the next run deletes them", async () => {
  const before = await files();
  const first = await sweepImages(db, bucket, { now: WEEK_LATER });
  assert.deepEqual(first.flagged.sort(), UNUSED);
  assert.deepEqual(first.deleted, []);
  assert.deepEqual(await files(), before);

  const second = await sweepImages(db, bucket, { now: WEEK_LATER + 7 * 86_400_000 });
  assert.deepEqual(second.deleted.sort(), UNUSED);
  assert.deepEqual(second.flagged, []);
  // Images still in use stay, including one another game copied.
  assert.deepEqual(await files(), [
    "games/g1/assets/cover/c.jpg",
    "games/g1/assets/enemies/thug.png",
    "games/g1/assets/maps/bg.png",
    "games/g1/users/p1/portrait/me.png",
  ]);
});

test("an image put back to use during the week isn't deleted", async () => {
  await sweepImages(db, bucket, { now: WEEK_LATER });
  await db.doc("games/g1/characters/p1").set({ portrait: url("games/g1/users/p1/portrait/old.png") });
  const second = await sweepImages(db, bucket, { now: WEEK_LATER + 7 * 86_400_000 });
  assert.deepEqual(second.deleted.sort(), ["games/g1/assets/maps/removed.png", "games/g1/assets/maps/replaced.png"]);
  assert.ok((await files()).includes("games/g1/users/p1/portrait/old.png"));
});

test("images uploaded this week are left alone", async () => {
  await sweepImages(db, bucket);
  const r = await sweepImages(db, bucket);
  assert.deepEqual(r.flagged, []);
  assert.deepEqual(r.deleted, []);
  assert.equal((await files()).length, 7);
});
