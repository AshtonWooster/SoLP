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

test("nobody can change games or invite codes directly, not even the GM", async () => {
  for (const uid of ["gm", "p1"]) {
    const db = as(uid);
    await assertFails(updateDoc(doc(db, "games", GAME), { name: "hacked" }));
    await assertFails(updateDoc(doc(db, "games", GAME), { memberIds: ["gm", "p1", "friend"] }));
    await assertFails(deleteDoc(doc(db, "games", GAME)));
    await assertFails(setDoc(doc(db, "games", "newgame"), { gmId: uid, memberIds: [uid] }));
    await assertFails(getDoc(doc(db, "inviteCodes", "ABC123")));
  }
});

test("only the GM's hosting tab can save the table", async () => {
  const table = { map: { name: "m", width: 4, height: 4 }, tokens: {}, log: ["saved"] };
  await assertSucceeds(setDoc(doc(as("gm"), "games", GAME, "table", "state"), table));
  await assertFails(setDoc(doc(as("p1"), "games", GAME, "table", "state"), table));
  await assertFails(setDoc(doc(as("stranger"), "games", GAME, "table", "state"), table));
  await assertFails(setDoc(doc(as("gm"), "games", GAME, "table", "state"), { ...table, extra: 1 }));
  // Autosave while combat is running.
  const combat = { round: 1, order: [], turn: 0, movementLeft: 3 };
  await assertSucceeds(setDoc(doc(as("gm"), "games", GAME, "table", "state"), { ...table, combat }));
  // The GM's other maps are saved with the table.
  const maps = { b: { id: "b", name: "Backstreets", width: 8, height: 6, tokens: {}, positions: {} } };
  await assertSucceeds(setDoc(doc(as("gm"), "games", GAME, "table", "state"), { ...table, maps }));
  await assertFails(setDoc(doc(as("gm"), "games", GAME, "table", "other"), table));
});

test("session: only the GM announces hosting; members can see it", async () => {
  const session = { sessionId: "s1", hostUid: "gm", startedAt: 1 };
  await assertSucceeds(setDoc(doc(as("gm"), "games", GAME, "session", "host"), session));
  await assertFails(setDoc(doc(as("p1"), "games", GAME, "session", "host"), { ...session, hostUid: "p1" }));
  await assertSucceeds(getDoc(doc(as("p1"), "games", GAME, "session", "host")));
  await assertFails(getDoc(doc(as("stranger"), "games", GAME, "session", "host")));
  await assertSucceeds(deleteDoc(doc(as("gm"), "games", GAME, "session", "host")));
});

test("signals: members ask to connect as themselves; only the GM answers", async () => {
  const offer = { uid: "p1", sessionId: "s1", offer: "sdp", createdAt: 1 };
  const ref = (uid: string) => doc(as(uid), "games", GAME, "signals", "sig1");
  await assertFails(setDoc(doc(as("p1"), "games", GAME, "signals", "x"), { ...offer, uid: "gm" }));
  await assertFails(setDoc(doc(as("stranger"), "games", GAME, "signals", "x"), { ...offer, uid: "stranger" }));
  await assertFails(setDoc(doc(as("p1"), "games", GAME, "signals", "x"), { ...offer, answer: "forged" }));
  await assertSucceeds(setDoc(ref("p1"), offer));
  await assertSucceeds(getDoc(ref("p1")));
  await assertSucceeds(getDocs(query(collection(as("gm"), "games", GAME, "signals"), where("sessionId", "==", "s1"))));
  await assertFails(updateDoc(ref("p1"), { answer: "self-answered" }));
  await assertFails(updateDoc(ref("gm"), { offer: "changed" }));
  await assertSucceeds(updateDoc(ref("gm"), { answer: "sdp-answer" }));
  await assertSucceeds(deleteDoc(ref("p1")));
});

test("characters: players edit their own, the GM edits any and sets Rank", async () => {
  const sheet = { ownerId: "p1", name: "Roland", rank: 9 };
  const ref = (who: string, owner = "p1") => doc(as(who), "games", GAME, "characters", owner);
  await assertFails(setDoc(ref("p1"), { ...sheet, rank: 1 }));
  await assertFails(setDoc(ref("p1", "gm"), { ...sheet, ownerId: "gm" }));
  await assertFails(setDoc(ref("stranger", "stranger"), { ...sheet, ownerId: "stranger" }));
  await assertSucceeds(setDoc(ref("p1"), sheet));
  await assertSucceeds(updateDoc(ref("p1"), { name: "Roland the Black Silence" }));
  await assertFails(updateDoc(ref("p1"), { rank: 8 }));
  await assertFails(updateDoc(ref("p1"), { ownerId: "gm" }));
  await assertSucceeds(updateDoc(ref("gm"), { rank: 8 }));
  await assertSucceeds(getDoc(ref("gm")));
  await assertFails(getDoc(ref("stranger")));
  await assertSucceeds(deleteDoc(ref("p1")));
});

test("decks lock for players during combat; the GM can still edit them", async () => {
  const sheet = { ownerId: "p1", name: "Roland", rank: 9, deck: [{ pageId: "a", copies: 12 }], inventory: { items: [] } };
  const ref = (who: string) => doc(as(who), "games", GAME, "characters", "p1");
  const table = (combat: unknown) =>
    env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), "games", GAME, "table", "state"), { map: {}, tokens: {}, log: [], ...(combat ? { combat } : {}) }),
    );
  await assertSucceeds(setDoc(ref("p1"), sheet));
  await table({ round: 1, order: [], turn: 0, movementLeft: 3 });
  await assertFails(updateDoc(ref("p1"), { deck: [{ pageId: "b", copies: 12 }] }));
  await assertSucceeds(updateDoc(ref("p1"), { name: "Roland (in combat)" }));
  await assertSucceeds(updateDoc(ref("p1"), { "inventory.items": [{ id: "x" }] }));
  await assertSucceeds(updateDoc(ref("gm"), { deck: [{ pageId: "c", copies: 12 }] }));
  await table(null);
  await assertSucceeds(updateDoc(ref("p1"), { deck: [{ pageId: "b", copies: 12 }] }));
});

test("enemy templates are GM-only", async () => {
  const ref = (who: string) => doc(as(who), "games", GAME, "enemies", "thug");
  await assertSucceeds(setDoc(ref("gm"), { name: "Thug", maxHp: 12 }));
  await assertSucceeds(getDoc(ref("gm")));
  await assertSucceeds(getDocs(collection(as("gm"), "games", GAME, "enemies")));
  await assertFails(getDoc(ref("p1")));
  await assertFails(getDocs(collection(as("p1"), "games", GAME, "enemies")));
  await assertFails(setDoc(ref("p1"), { name: "Weak Thug", maxHp: 1 }));
  await assertSucceeds(deleteDoc(ref("gm")));
});

test("item library: members browse it, only the GM creates and edits items", async () => {
  const ref = (who: string) => doc(as(who), "games", GAME, "items", "potion");
  await assertSucceeds(setDoc(ref("gm"), { name: "Potion", kind: "item", stacking: true, maxStack: 3 }));
  await assertSucceeds(getDocs(collection(as("p1"), "games", GAME, "items")));
  await assertSucceeds(getDoc(ref("p1")));
  await assertFails(setDoc(doc(as("p1"), "games", GAME, "items", "homebrew"), { name: "Infinite Ahn" }));
  await assertFails(setDoc(ref("p1"), { name: "Potion", maxStack: 99 }));
  await assertFails(deleteDoc(ref("p1")));
  await assertFails(getDocs(collection(as("stranger"), "games", GAME, "items")));
  await assertSucceeds(deleteDoc(ref("gm")));
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

test("storage: players (and the GM) upload a player's portrait and Page art; other players can view but not overwrite", async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const path = `games/${GAME}/users/p1/portrait.png`;
  await assertSucceeds(uploadBytes(ref(env.authenticatedContext("p1").storage(), path), png, { contentType: "image/png" }));
  await assertSucceeds(uploadBytes(ref(env.authenticatedContext("gm").storage(), path), png, { contentType: "image/png" }));
  await assertFails(uploadBytes(ref(env.authenticatedContext("p1").storage(), `games/${GAME}/users/gm/portrait.png`), png, { contentType: "image/png" }));
  await assertFails(uploadBytes(ref(env.authenticatedContext("p1").storage(), `games/${GAME}/users/p1/x.js`), png, { contentType: "text/javascript" }));
  await assertSucceeds(getBytes(ref(env.authenticatedContext("gm").storage(), path)));
  await assertFails(getBytes(ref(env.authenticatedContext("stranger").storage(), path)));
});
