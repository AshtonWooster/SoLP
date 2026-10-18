// Popups the GM sends to players: text, images and Story Roll prompts. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, type Actor, type EngineContext } from "../shared/engine.ts";
import { ANY_STAT, finishedPopups, MAX_POPUPS, popupsFor, popupWaitingOn, upPopups } from "../shared/popups.ts";
import { tableForGm, tableForPlayers } from "../shared/secrets.ts";
import type { TableState, Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const ann: Actor = { uid: "ann", role: "player", displayName: "Ann" };
const bo: Actor = { uid: "bo", role: "player", displayName: "Bo" };
const resources = { hp: 10, maxHp: 10, stagger: 5, maxStagger: 5, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
const token = (id: string, ownerId: string, x: number): Token => ({ id, name: id, side: "player", x, y: 0, color: "#fff", resources, ownerId });
const ctx: EngineContext = { loadout: (id) => ({ pages: {}, deck: [], aux: [], stats: id === "annie" ? { insight: 3, justice: 1 } : { insight: 0 } }) };

function table(): TableState {
  return { map: { name: "m", width: 8, height: 4 }, tokens: { annie: token("annie", "ann", 0), bob: token("bob", "bo", 1) }, log: [] };
}

test("only the GM sends popups, and one needs text, an image or a Story Roll", () => {
  const t = table();
  assert.throws(() => applyAction(t, { type: "sendPopup", text: "Hi" }, ann), /GM only/);
  assert.throws(() => applyAction(t, { type: "sendPopup", title: " ", text: "  " }, gm), /Add some text/);
  assert.throws(() => applyAction(t, { type: "sendPopup", roll: { stat: "charm" } }, gm), /Pick a Stat/);
  assert.ok(applyAction(t, { type: "sendPopup", id: "a", text: "The door creaks." }, gm));
  assert.ok(applyAction(t, { type: "sendPopup", id: "b", image: "https://example.com/map.png" }, gm));
  assert.ok(applyAction(t, { type: "sendPopup", id: "c", roll: { stat: "Insight" } }, gm));
  assert.deepEqual(t.popups?.map((p) => p.id), ["a", "b", "c"]);
  assert.deepEqual(t.popups?.[2].roll, { stat: "insight" });
});

test("a popup can mix a title, text, an image and a Story Roll", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", title: "A letter", text: "It reads…", image: "https://example.com/letter.png", roll: { stat: ANY_STAT } }, gm);
  assert.deepEqual(popupsFor(t, "ann"), [{ id: "p", title: "A letter", text: "It reads…", image: "https://example.com/letter.png", roll: { stat: "any" } }]);
});

test("images must be web links", () => {
  const t = table();
  assert.throws(() => applyAction(t, { type: "sendPopup", image: "javascript:alert(1)" }, gm), /Add some text/);
});

test("a popup to every player reaches everyone; one to picked players reaches only them", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "all", text: "Everyone" }, gm);
  applyAction(t, { type: "sendPopup", id: "secret", text: "Only Bo", to: ["bo"] }, gm);
  assert.deepEqual(popupsFor(t, "ann").map((p) => p.id), ["all"]);
  assert.deepEqual(popupsFor(t, "bo").map((p) => p.id), ["all", "secret"]);
  // A player who joins later still gets the popup to everyone.
  assert.deepEqual(popupsFor(t, "cy").map((p) => p.id), ["all"]);
  // What a phone gets says nothing about who else it went to.
  assert.equal("to" in popupsFor(t, "bo")[1], false);
});

test("popups stay out of the shared table and the log; the GM's screen sees them all", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "secret", title: "Bo's vision", to: ["bo"] }, gm);
  assert.equal(tableForPlayers(t).popups, undefined);
  assert.equal(tableForGm(t).popups?.length, 1);
  assert.deepEqual(t.log, []);
});

test("closing a popup hides it for that player only, and only recipients can close it", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", text: "Hi", to: ["ann"] }, gm);
  assert.throws(() => applyAction(t, { type: "closePopup", popupId: "p" }, bo), /isn't for you/);
  assert.throws(() => applyAction(t, { type: "closePopup", popupId: "p" }, gm), /Take a popup down/);
  assert.ok(applyAction(t, { type: "closePopup", popupId: "p" }, ann));
  assert.equal(applyAction(t, { type: "closePopup", popupId: "p" }, ann), false);
  assert.deepEqual(popupsFor(t, "ann"), []);
  assert.deepEqual(t.popups?.[0].closedBy, ["ann"]);
});

test("a popup's Story Roll goes in the log, is kept for the GM, and is rolled once", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", text: "Spot anything?", roll: { stat: "insight" } }, gm);
  applyAction(t, { type: "popupRoll", popupId: "p" }, ann, ctx);
  const m = t.log.at(-1)!.match(/^annie makes a Insight Story Roll: (\d+)\+3 = (\d+) \((success|failure|between a failure and a success)\)\.$/);
  assert.ok(m, t.log.at(-1));
  assert.equal(t.popups![0].rolls?.ann, Number(m[2]));
  assert.equal(popupsFor(t, "ann")[0].rolled, Number(m[2]));
  assert.equal(popupsFor(t, "bo")[0].rolled, undefined);
  assert.throws(() => applyAction(t, { type: "popupRoll", popupId: "p" }, ann, ctx), /already rolled/);
  // A Stat the player picks is ignored when the GM named one.
  applyAction(t, { type: "popupRoll", popupId: "p", stat: "justice" }, bo, ctx);
  assert.match(t.log.at(-1)!, /^bob makes a Insight Story Roll/);
});

test("a popup that lets players pick the Stat needs a real one", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", roll: { stat: ANY_STAT } }, gm);
  assert.throws(() => applyAction(t, { type: "popupRoll", popupId: "p" }, ann, ctx), /Pick a Stat/);
  assert.throws(() => applyAction(t, { type: "popupRoll", popupId: "p", stat: "charm" }, ann, ctx), /Pick a Stat/);
  applyAction(t, { type: "popupRoll", popupId: "p", stat: "justice" }, ann, ctx);
  assert.match(t.log.at(-1)!, /^annie makes a Justice Story Roll: \d+\+1 = \d+ \((success|failure|between a failure and a success)\)\.$/);
});

test("only the players a popup is for can roll for it, and it must ask for a roll", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", roll: { stat: "insight" }, to: ["ann"] }, gm);
  applyAction(t, { type: "sendPopup", id: "q", text: "Just reading" }, gm);
  assert.throws(() => applyAction(t, { type: "popupRoll", popupId: "p" }, bo, ctx), /isn't for you/);
  assert.throws(() => applyAction(t, { type: "popupRoll", popupId: "q" }, ann, ctx), /doesn't ask for a roll/);
  assert.throws(() => applyAction(t, { type: "popupRoll", popupId: "p" }, gm, ctx), /Players roll/);
  delete t.tokens.annie;
  assert.throws(() => applyAction(t, { type: "popupRoll", popupId: "p" }, ann, ctx), /token on the table/);
});

test("the GM takes a popup down from every screen, and keeps its results until they clear it", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", text: "Spot anything?", roll: { stat: "insight" } }, gm);
  applyAction(t, { type: "popupRoll", popupId: "p" }, ann, ctx);
  assert.throws(() => applyAction(t, { type: "removePopup", popupId: "p" }, ann), /GM only/);
  assert.ok(applyAction(t, { type: "removePopup", popupId: "p" }, gm));
  assert.deepEqual(popupsFor(t, "ann"), []);
  assert.deepEqual(popupsFor(t, "bo"), []);
  assert.deepEqual(upPopups(t), []);
  assert.equal(finishedPopups(t)[0].takenDown, true);
  assert.equal(typeof finishedPopups(t)[0].rolls?.ann, "number");
  assert.equal(applyAction(t, { type: "removePopup", popupId: "p" }, gm), false);
  assert.throws(() => applyAction(t, { type: "closePopup", popupId: "p" }, ann), /taken down/);
  assert.throws(() => applyAction(t, { type: "popupRoll", popupId: "p" }, bo, ctx), /taken down/);
  // Clearing the record is the GM's.
  assert.throws(() => applyAction(t, { type: "clearPopups", popupId: "p" }, ann), /GM only/);
  assert.ok(applyAction(t, { type: "clearPopups", popupId: "p" }, gm));
  assert.equal(t.popups, undefined);
});

/** The game's players, as the host lists them, so a popup to everyone knows who it waits on. */
const withPlayers = (players: string[]): EngineContext => ({ ...ctx, sheets: { players: () => players, sheet: () => undefined, item: () => undefined, save: () => {} } });

test("a popup takes itself down once every player it's for has closed it", () => {
  const t = table();
  const c = withPlayers(["ann", "bo"]);
  applyAction(t, { type: "sendPopup", id: "p", text: "The door creaks." }, gm, c);
  applyAction(t, { type: "closePopup", popupId: "p" }, ann, c);
  assert.equal(upPopups(t).length, 1, "still open for Bo");
  assert.deepEqual(popupWaitingOn(t.popups![0], ["ann", "bo"]), ["bo"]);
  applyAction(t, { type: "closePopup", popupId: "p" }, bo, c);
  assert.deepEqual(upPopups(t), []);
  const done = finishedPopups(t)[0];
  assert.equal(done.id, "p");
  assert.equal(done.takenDown, undefined);
  assert.equal(typeof done.doneAt, "number");
  assert.deepEqual(done.closedBy, ["ann", "bo"]);
  assert.deepEqual(t.log, [], "nothing in the shared log");
});

test("a popup to picked players comes down when they've closed it, whoever else is in the game", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", text: "Only Ann", to: ["ann"] }, gm);
  // No player list needed: the popup names who it's for.
  applyAction(t, { type: "closePopup", popupId: "p" }, ann, ctx);
  assert.deepEqual(upPopups(t), []);
});

test("a player who left the game isn't waited on", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", text: "Hi", to: ["ann", "gone"] }, gm);
  applyAction(t, { type: "closePopup", popupId: "p" }, ann, withPlayers(["ann", "bo"]));
  assert.deepEqual(upPopups(t), []);
});

test("a popup to every player stays up when the game's players can't be listed", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", text: "Hi" }, gm);
  applyAction(t, { type: "closePopup", popupId: "p" }, ann, ctx);
  applyAction(t, { type: "closePopup", popupId: "p" }, bo, ctx);
  assert.equal(upPopups(t).length, 1);
  assert.equal(popupWaitingOn(t.popups![0], undefined), undefined);
});

test("rolling alone doesn't take a popup down: the player still sees their result until they close it", () => {
  const t = table();
  const c = withPlayers(["ann"]);
  applyAction(t, { type: "sendPopup", id: "p", roll: { stat: "insight" } }, gm, c);
  applyAction(t, { type: "popupRoll", popupId: "p" }, ann, c);
  assert.equal(typeof popupsFor(t, "ann")[0].rolled, "number");
  applyAction(t, { type: "closePopup", popupId: "p" }, ann, c);
  assert.deepEqual(upPopups(t), []);
  assert.equal(typeof finishedPopups(t)[0].rolls?.ann, "number");
});

test("clearing with no popup named clears every finished one and leaves the ones still up", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "a", text: "A", to: ["ann"] }, gm);
  applyAction(t, { type: "sendPopup", id: "b", text: "B" }, gm);
  applyAction(t, { type: "sendPopup", id: "c", text: "C" }, gm);
  applyAction(t, { type: "closePopup", popupId: "a" }, ann, ctx);
  applyAction(t, { type: "removePopup", popupId: "b" }, gm);
  assert.deepEqual(finishedPopups(t).map((p) => p.id), ["b", "a"]);
  assert.ok(applyAction(t, { type: "clearPopups" }, gm));
  assert.deepEqual(t.popups?.map((p) => p.id), ["c"]);
  assert.equal(applyAction(t, { type: "clearPopups" }, gm), false);
  // Clearing doesn't take down one that's still up.
  assert.equal(applyAction(t, { type: "clearPopups", popupId: "c" }, gm), false);
});

test("finished popups make room first when the GM sends too many", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "old", text: "Old, still up" }, gm);
  applyAction(t, { type: "sendPopup", id: "done", text: "Done" }, gm);
  applyAction(t, { type: "removePopup", popupId: "done" }, gm);
  for (let i = 0; i < MAX_POPUPS - 1; i++) applyAction(t, { type: "sendPopup", id: `p${i}`, text: `#${i}` }, gm);
  assert.equal(t.popups?.length, MAX_POPUPS);
  assert.equal(t.popups?.[0].id, "old");
  assert.ok(!t.popups?.some((p) => p.id === "done"));
});

test("finished popups stay off players' screens and out of the shared table", () => {
  const t = table();
  applyAction(t, { type: "sendPopup", id: "p", text: "Hi", to: ["ann"] }, gm);
  applyAction(t, { type: "closePopup", popupId: "p" }, ann, ctx);
  assert.equal(tableForPlayers(t).popups, undefined);
  assert.equal(tableForGm(t).popups?.[0].doneAt !== undefined, true);
  // A player who joins later doesn't get a finished popup to everyone either.
  applyAction(t, { type: "sendPopup", id: "q", text: "All" }, gm);
  applyAction(t, { type: "removePopup", popupId: "q" }, gm);
  assert.deepEqual(popupsFor(t, "cy"), []);
});

test("old popups drop off once there are too many", () => {
  const t = table();
  for (let i = 0; i < MAX_POPUPS + 5; i++) applyAction(t, { type: "sendPopup", id: `p${i}`, text: `#${i}` }, gm);
  assert.equal(t.popups?.length, MAX_POPUPS);
  assert.equal(t.popups?.[0].id, "p5");
});

test("tables from before popups have none for anyone", () => {
  assert.deepEqual(popupsFor(table(), "ann"), []);
});
