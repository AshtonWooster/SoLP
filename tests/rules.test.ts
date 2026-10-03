// Security rules tests. Run with `npm run test:rules` (starts the emulators for you).
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

let env: RulesTestEnvironment;
const GAME = "game1";

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-solp",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed a game the way the Cloud Functions would: gm "gm", player "p1"; "stranger" is not in it.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "games", GAME), {
      name: "Test",
      gmId: "gm",
      memberIds: ["gm", "p1"],
      members: { gm: { displayName: "GM", role: "gm" }, p1: { displayName: "P1", role: "player" } },
      createdAt: 1,
    });
    await setDoc(doc(db, "games", GAME, "table", "state"), { map: { name: "m", width: 4, height: 4 }, tokens: {}, log: [] });
    await setDoc(doc(db, "games", GAME, "gm", "meta"), { inviteCode: "ABC123" });
    await setDoc(doc(db, "games", GAME, "gm", "notes"), { tokens: {} });
    await setDoc(doc(db, "inviteCodes", "ABC123"), { gameId: GAME });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("members can read the game and table; others can't", async () => {
  await assertSucceeds(getDoc(doc(as("gm"), "games", GAME)));
  await assertSucceeds(getDoc(doc(as("p1"), "games", GAME, "table", "state")));
  await assertFails(getDoc(doc(as("stranger"), "games", GAME)));
  await assertFails(getDoc(doc(as("stranger"), "games", GAME, "table", "state")));
  await assertFails(getDoc(doc(anon(), "games", GAME)));
});

test("front page query only works for your own games", async () => {
  await assertSucceeds(getDocs(query(collection(as("p1"), "games"), where("memberIds", "array-contains", "p1"))));
  await assertFails(getDocs(query(collection(as("stranger"), "games"), where("memberIds", "array-contains", "p1"))));
  await assertFails(getDocs(collection(as("p1"), "games")));
});

test("nobody can change games, tables or invite codes directly, not even the GM", async () => {
  for (const uid of ["gm", "p1"]) {
    const db = as(uid);
    await assertFails(updateDoc(doc(db, "games", GAME), { name: "hacked" }));
    await assertFails(updateDoc(doc(db, "games", GAME), { memberIds: ["gm", "p1", "friend"] }));
    await assertFails(setDoc(doc(db, "games", GAME, "table", "state"), { tokens: {} }));
    await assertFails(deleteDoc(doc(db, "games", GAME)));
    await assertFails(setDoc(doc(db, "games", "newgame"), { gmId: uid, memberIds: [uid] }));
    await assertFails(getDoc(doc(db, "inviteCodes", "ABC123")));
  }
});

test("only the GM sees the invite code and GM notes", async () => {
  await assertSucceeds(getDoc(doc(as("gm"), "games", GAME, "gm", "meta")));
  await assertSucceeds(getDoc(doc(as("gm"), "games", GAME, "gm", "notes")));
  await assertFails(getDoc(doc(as("p1"), "games", GAME, "gm", "meta")));
  await assertFails(getDoc(doc(as("p1"), "games", GAME, "gm", "notes")));
  await assertSucceeds(updateDoc(doc(as("gm"), "games", GAME, "gm", "notes"), { "tokens.t1": "weak to fire" }));
  await assertFails(updateDoc(doc(as("p1"), "games", GAME, "gm", "notes"), { "tokens.t1": "x" }));
  await assertFails(updateDoc(doc(as("gm"), "games", GAME, "gm", "meta"), { inviteCode: "ZZZZZZ" }));
});

test("presence: members write only their own check-in", async () => {
  await assertSucceeds(setDoc(doc(as("p1"), "games", GAME, "presence", "p1"), { lastSeen: 1 }));
  await assertFails(setDoc(doc(as("p1"), "games", GAME, "presence", "gm"), { lastSeen: 1 }));
  await assertFails(setDoc(doc(as("p1"), "games", GAME, "presence", "p1"), { lastSeen: 1, extra: true }));
  await assertFails(setDoc(doc(as("stranger"), "games", GAME, "presence", "stranger"), { lastSeen: 1 }));
  await assertSucceeds(getDocs(collection(as("gm"), "games", GAME, "presence")));
});

test("users: you can read and write only your own profile", async () => {
  await assertSucceeds(setDoc(doc(as("p1"), "users", "p1"), { displayName: "P1", email: "p1@x.com" }));
  await assertSucceeds(getDoc(doc(as("p1"), "users", "p1")));
  await assertFails(getDoc(doc(as("gm"), "users", "p1")));
  await assertFails(setDoc(doc(as("gm"), "users", "p1"), { displayName: "Gotcha", email: "x" }));
  await assertFails(setDoc(doc(as("p1"), "users", "p1"), { displayName: "", email: "p1@x.com" }));
  await assertFails(setDoc(doc(as("p1"), "users", "p1"), { displayName: "P1", email: "e", admin: true }));
});

test("storage: GM uploads game images, members view, others can't", async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const path = `games/${GAME}/assets/map.png`;
  await assertSucceeds(uploadBytes(ref(env.authenticatedContext("gm").storage(), path), png, { contentType: "image/png" }));
  await assertFails(uploadBytes(ref(env.authenticatedContext("p1").storage(), path), png, { contentType: "image/png" }));
  await assertFails(
    uploadBytes(ref(env.authenticatedContext("gm").storage(), `games/${GAME}/assets/x.html`), png, { contentType: "text/html" }),
  );
  await assertSucceeds(getBytes(ref(env.authenticatedContext("p1").storage(), path)));
  await assertFails(getBytes(ref(env.authenticatedContext("stranger").storage(), path)));
});
