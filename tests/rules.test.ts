// Security rules tests. Run with `npm run test:rules` (starts the emulators for you).
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
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

test("nobody can rename games, add members or read invite codes directly, not even the GM", async () => {
  for (const uid of ["gm", "p1"]) {
    const db = as(uid);
    await assertFails(updateDoc(doc(db, "games", GAME), { name: "hacked" }));
    await assertFails(updateDoc(doc(db, "games", GAME), { memberIds: ["gm", "p1", "friend"] }));
    await assertFails(deleteDoc(doc(db, "games", GAME)));
    await assertFails(setDoc(doc(db, "games", "newgame"), { gmId: uid, memberIds: [uid] }));
    await assertFails(getDoc(doc(db, "inviteCodes", "ABC123")));
  }
});

test("game settings: only the GM changes them and kicks players; the GM can't be removed or add anyone", async () => {
  const game = (who: string) => doc(as(who), "games", GAME);
  await assertFails(updateDoc(game("p1"), { "settings.playerEdit.stats": false }));
  await assertSucceeds(updateDoc(game("gm"), { "settings.playerEdit.stats": false }));
  await assertFails(updateDoc(game("p1"), { "settings.clearEffectsAfterCombat": true }));
  await assertSucceeds(updateDoc(game("gm"), { "settings.clearEffectsAfterCombat": true }));
  await assertFails(updateDoc(game("p1"), { memberIds: ["p1"], members: { p1: { displayName: "P1", role: "player" } } }));
  await assertFails(updateDoc(game("gm"), { memberIds: ["p1"] }));
  await assertFails(updateDoc(game("gm"), { "members.friend": { displayName: "F", role: "player" } }));
  await assertFails(updateDoc(game("gm"), { "members.gm.role": "player" }));
  await assertFails(updateDoc(game("gm"), { gmId: "p1" }));
  await assertSucceeds(updateDoc(game("gm"), { memberIds: ["gm"], members: { gm: { displayName: "GM", role: "gm" } } }));
  // Kicked: the player can't read the game or its table any more.
  await assertFails(getDoc(doc(as("p1"), "games", GAME)));
  await assertFails(getDoc(doc(as("p1"), "games", GAME, "table", "state")));
});

test("account settings: you set your own display name and theme, within limits", async () => {
  const me = doc(as("p1"), "users", "p1");
  await assertSucceeds(setDoc(me, { displayName: "P1", email: "p1@x.test" }));
  await assertSucceeds(updateDoc(me, { theme: "library" }));
  await assertSucceeds(updateDoc(me, { theme: "reception", displayName: "Renamed" }));
  await assertSucceeds(updateDoc(me, { theme: "classic" }));
  await assertFails(updateDoc(me, { theme: "neon" }));
  await assertFails(updateDoc(me, { displayName: "" }));
  await assertFails(updateDoc(me, { displayName: "x".repeat(33) }));
  await assertFails(updateDoc(me, { admin: true }));
  await assertFails(setDoc(doc(as("p2"), "users", "p1"), { displayName: "Hijack", email: "p1@x.test", theme: "library" }));
  await assertFails(getDoc(doc(as("gm"), "users", "p1")));
});

test("a member renames only themselves in a game, and can't change roles or anyone else", async () => {
  const game = (who: string) => doc(as(who), "games", GAME);
  await assertSucceeds(updateDoc(game("p1"), { "members.p1.displayName": "New name" }));
  await assertSucceeds(updateDoc(game("gm"), { "members.gm.displayName": "Arbiter" }));
  await assertFails(updateDoc(game("p1"), { "members.gm.displayName": "Pwned" }));
  await assertFails(updateDoc(game("p1"), { "members.p1.role": "gm" }));
  await assertFails(updateDoc(game("p1"), { "members.p1.displayName": "" }));
  await assertFails(updateDoc(game("p1"), { "members.p1.displayName": "x".repeat(33) }));
  await assertFails(updateDoc(game("p1"), { "members.p1": { displayName: "P1", role: "player", extra: 1 } }));
  await assertFails(updateDoc(game("p1"), { "members.p1.displayName": "Ok", name: "hacked" }));
  await assertFails(updateDoc(game("stranger"), { "members.stranger.displayName": "Hi" }));
});

test("on sheet parts needing approval, players only propose changes; the GM applies them", async () => {
  const sheet = { ownerId: "p1", name: "Roland", rank: 9, primary: { justice: 0 }, secondary: {}, inventory: { items: [] }, ahn: 0, augment: { name: "" }, proficiencies: [], weapons: [], armor: null, deck: [], ego: [] };
  const ref = (who: string) => doc(as(who), "games", GAME, "characters", "p1");
  await assertSucceeds(setDoc(ref("p1"), sheet));
  await env.withSecurityRulesDisabled((ctx) =>
    updateDoc(doc(ctx.firestore(), "games", GAME), { settings: { playerEdit: { stats: false, inventory: false, augment: false, equipment: false } } }),
  );
  await assertFails(updateDoc(ref("p1"), { "primary.justice": 3 }));
  await assertFails(updateDoc(ref("p1"), { ahn: 500 }));
  await assertFails(updateDoc(ref("p1"), { "inventory.items": [{ id: "x" }] }));
  await assertFails(updateDoc(ref("p1"), { "augment.name": "Gloves" }));
  await assertFails(updateDoc(ref("p1"), { weapons: [{ id: "w" }] }));
  await assertFails(updateDoc(ref("p1"), { deck: [{ pageId: "a", copies: 1 }] }));
  // The player's changes wait in pendingEdits; a full save that leaves those parts as they are still works.
  await assertSucceeds(updateDoc(ref("p1"), { "pendingEdits.stats": { primary: { justice: 3 } }, "pendingEdits.inventory": { ahn: 500 } }));
  await assertSucceeds(setDoc(ref("p1"), { ...sheet, name: "Roland again", pendingEdits: { stats: { primary: { justice: 3 } } } }));
  await assertSucceeds(updateDoc(ref("p1"), { name: "Roland the Black Silence" }));
  // The GM approves: the change takes effect and the proposal goes.
  await assertSucceeds(updateDoc(ref("gm"), { "primary.justice": 3, pendingEdits: deleteField() }));
  // On (the default), players change those parts directly.
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "games", GAME), { "settings.playerEdit.stats": true }));
  await assertSucceeds(updateDoc(ref("p1"), { "primary.justice": 4 }));
  await assertFails(updateDoc(ref("p1"), { ahn: 1 }));
});

test("a player's new sheet starts blank in the parts the GM approves, so deleting it can't skip approval", async () => {
  const ref = (who: string) => doc(as(who), "games", GAME, "characters", "p1");
  const blank = {
    ownerId: "p1", name: "Roland", rank: 9,
    primary: { fortitude: 0, prudence: 0, justice: 0, temperance: 0 }, secondary: { speed: 0 },
    proficiencies: [], augment: { name: "", description: "", passives: [] }, weapons: [], armor: null,
    ahn: 0, inventory: { slotCount: 9, items: [], trinket: null }, deck: [], ego: [],
  };
  const lock = (playerEdit: Record<string, boolean>) =>
    env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "games", GAME), { settings: { playerEdit } }));
  // Default (all parts free): a new sheet can start with anything, as before.
  await assertSucceeds(setDoc(ref("p1"), { ...blank, primary: { justice: 5 }, ahn: 900, deck: [{ pageId: "a", copies: 12 }] }));
  await assertSucceeds(deleteDoc(ref("p1")));
  await lock({ stats: false, inventory: false, augment: false, equipment: false });
  await assertFails(setDoc(ref("p1"), { ...blank, primary: { ...blank.primary, justice: 5 } }));
  await assertFails(setDoc(ref("p1"), { ...blank, secondary: { speed: 3 } }));
  await assertFails(setDoc(ref("p1"), { ...blank, ahn: 900 }));
  await assertFails(setDoc(ref("p1"), { ...blank, inventory: { slotCount: 40, items: [], trinket: null } }));
  await assertFails(setDoc(ref("p1"), { ...blank, inventory: { slotCount: 9, items: [{ id: "x" }], trinket: null } }));
  await assertFails(setDoc(ref("p1"), { ...blank, augment: { name: "Gloves", description: "", passives: [] } }));
  await assertFails(setDoc(ref("p1"), { ...blank, proficiencies: [{ id: "p" }] }));
  await assertFails(setDoc(ref("p1"), { ...blank, weapons: [{ id: "w" }] }));
  await assertFails(setDoc(ref("p1"), { ...blank, armor: { id: "a" } }));
  await assertFails(setDoc(ref("p1"), { ...blank, deck: [{ pageId: "a", copies: 12 }] }));
  await assertFails(setDoc(ref("p1"), { ...blank, ego: [{ id: "e" }] }));
  // A blank sheet (or one leaving those parts out) is fine, and the free parts can be filled in.
  await assertSucceeds(setDoc(ref("p1"), { ...blank, name: "Roland", details: { age: "30" } }));
  await assertSucceeds(deleteDoc(ref("p1")));
  await assertSucceeds(setDoc(ref("p1"), { ownerId: "p1", name: "Roland", rank: 9 }));
  await assertSucceeds(deleteDoc(ref("p1")));
  // Only the locked parts must start blank.
  await lock({ stats: false });
  await assertFails(setDoc(ref("p1"), { ...blank, primary: { ...blank.primary, justice: 5 } }));
  await assertSucceeds(setDoc(ref("p1"), { ...blank, ahn: 900, weapons: [{ id: "w" }] }));
});

test("a sheet made during combat starts with an empty Combat Deck", async () => {
  const ref = (who: string) => doc(as(who), "games", GAME, "characters", "p1");
  const sheet = { ownerId: "p1", name: "Roland", rank: 9 };
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "games", GAME, "table", "state"), { map: {}, tokens: {}, log: [], combat: { round: 1, order: [], turn: 0, movementLeft: 3 } }),
  );
  await assertFails(setDoc(ref("p1"), { ...sheet, deck: [{ pageId: "a", copies: 12 }] }));
  await assertSucceeds(setDoc(ref("p1"), { ...sheet, deck: [] }));
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

test("item library: members browse it; only the GM edits items that aren't theirs", async () => {
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

test("players' items need the GM's approval unless the GM lets players make items; they change only their own", async () => {
  const items = (who: string) => collection(as(who), "games", GAME, "items");
  const item = (who: string, id: string) => doc(as(who), "games", GAME, "items", id);
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "games", GAME, "items", "gmItem"), { name: "Ore", kind: "item" }));
  // Off (the default): a player's new or changed item must wait for approval.
  await assertFails(setDoc(item("p1", "mine"), { name: "Salve", kind: "tool", createdBy: "p1" }));
  await assertSucceeds(setDoc(item("p1", "mine"), { name: "Salve", kind: "tool", createdBy: "p1", pending: true }));
  await assertFails(updateDoc(item("p1", "mine"), { pending: false }));
  await assertSucceeds(updateDoc(item("p1", "mine"), { name: "Better Salve" }));
  await assertSucceeds(updateDoc(item("gm", "mine"), { pending: deleteField() }));
  // Approved: the player can't change it without approval again, or delete it.
  await assertFails(updateDoc(item("p1", "mine"), { name: "Infinite Salve" }));
  await assertFails(deleteDoc(item("p1", "mine")));
  await assertSucceeds(updateDoc(item("p1", "mine"), { name: "Strong Salve", pending: true }));
  await assertSucceeds(updateDoc(item("gm", "mine"), { pending: deleteField() }));
  await assertFails(updateDoc(item("p1", "gmItem"), { name: "Gold", pending: true }));
  await assertFails(setDoc(item("p1", "fake"), { name: "Fake", kind: "item", createdBy: "gm", pending: true }));
  await assertFails(setDoc(item("stranger", "s"), { name: "S", kind: "item", createdBy: "stranger", pending: true }));
  // On: players' items go straight into use.
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "games", GAME), { "settings.playersCreateItems": true }));
  await assertSucceeds(setDoc(item("p1", "free"), { name: "Bandage", kind: "tool", createdBy: "p1" }));
  await assertSucceeds(updateDoc(item("p1", "mine"), { name: "Better Salve" }));
  await assertFails(setDoc(item("p1", "none"), { name: "None", kind: "item" }));
  await assertFails(updateDoc(item("p1", "mine"), { createdBy: "gm" }));
  await assertFails(updateDoc(item("p1", "gmItem"), { name: "Gold" }));
  await assertFails(deleteDoc(item("p1", "gmItem")));
  await assertSucceeds(updateDoc(item("gm", "mine"), { name: "GM's tweak" }));
  await assertSucceeds(getDocs(items("p1")));
  await assertSucceeds(deleteDoc(item("p1", "free")));
});

test("effect library: members read it; players' effects need the GM's approval unless the GM lets players make effects", async () => {
  const fx = (who: string, id: string) => doc(as(who), "games", GAME, "effects", id);
  const burn = { name: "Burn", kind: "status", decay: "halfAtTurnEnd", rules: [] };
  const rule = { id: "r", when: "turnStart", checks: [], actions: [{ do: "heal", amount: { kind: "number", value: 1 }, who: "me" }] };
  await assertSucceeds(setDoc(fx("gm", "burn"), burn));
  await assertSucceeds(getDocs(collection(as("p1"), "games", GAME, "effects")));
  await assertFails(getDocs(collection(as("stranger"), "games", GAME, "effects")));
  // Off (the default): players make any effect, automated too, but can't approve it.
  await assertSucceeds(setDoc(fx("p1", "mine"), { ...burn, name: "Frostbite", rules: [rule], createdBy: "p1", approved: false }));
  await assertSucceeds(setDoc(fx("p1", "die"), { name: "Bleed on hit", kind: "die", decay: "none", rules: [rule], createdBy: "p1" }));
  await assertFails(setDoc(fx("p1", "sneaky"), { ...burn, createdBy: "p1", approved: true }));
  await assertFails(setDoc(fx("p1", "fake"), { ...burn, createdBy: "gm" }));
  await assertFails(updateDoc(fx("p1", "mine"), { approved: true }));
  await assertFails(updateDoc(fx("p1", "burn"), { name: "Weak Burn" }));
  await assertFails(deleteDoc(fx("p1", "burn")));
  await assertSucceeds(updateDoc(fx("gm", "mine"), { approved: true }));
  // Any change by the player sends it back for approval, and they can't delete an approved one.
  await assertFails(updateDoc(fx("p1", "mine"), { name: "Deep Frostbite" }));
  await assertFails(deleteDoc(fx("p1", "mine")));
  await assertSucceeds(updateDoc(fx("p1", "mine"), { name: "Deep Frostbite", approved: false }));
  await assertSucceeds(deleteDoc(fx("p1", "mine")));
  // On: players' effects work right away.
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "games", GAME), { "settings.playersCreateEffects": true }));
  await assertSucceeds(setDoc(fx("p1", "free"), { ...burn, name: "Chill", rules: [rule], createdBy: "p1", approved: true }));
  await assertSucceeds(updateDoc(fx("p1", "free"), { name: "Deep Chill", approved: true }));
  await assertFails(updateDoc(fx("p1", "burn"), { name: "Weak Burn", approved: true }));
  await assertFails(setDoc(fx("p1", "fake2"), { ...burn, createdBy: "gm", approved: true }));
  await assertSucceeds(deleteDoc(fx("p1", "free")));
  await assertFails(setDoc(fx("stranger", "s"), { ...burn, createdBy: "stranger" }));
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
