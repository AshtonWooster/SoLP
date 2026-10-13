// Folders in the map editor's list of maps. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyAction, type Actor } from "../shared/engine.ts";
import { groupMaps, MAX_FOLDERS } from "../shared/mapFolders.ts";
import { playerView } from "../shared/maps.ts";
import { tableForGm, tableForPlayers } from "../shared/secrets.ts";
import type { TableState } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };
const act = (t: TableState, a: Parameters<typeof applyAction>[1], who: Actor = gm) => applyAction(t, a, who);

/** The players on the Library, with the Backstreets and the Smoke War waiting. */
function table(): TableState {
  const t: TableState = { map: { id: "library", name: "Library", width: 16, height: 10 }, tokens: {}, log: [] };
  act(t, { type: "createMap", id: "back", name: "Backstreets", width: 8, height: 8 });
  act(t, { type: "createMap", id: "smoke", name: "Smoke War", width: 8, height: 8 });
  t.log = [];
  return t;
}

test("a game made before folders lists every map at the top level, as before", () => {
  const t = table();
  const { folders, loose } = groupMaps([t.map, ...Object.values(t.maps!)], t.mapFolders);
  assert.deepEqual(folders, []);
  assert.deepEqual(loose.map((m) => m.name), ["Library", "Backstreets", "Smoke War"]);
});

test("the GM makes a folder, renames it, and drags maps in and back out", () => {
  const t = table();
  act(t, { type: "createMapFolder", id: "district", name: "" });
  assert.deepEqual(t.mapFolders, { district: { name: "New folder" } }, "a blank name gets a default");
  act(t, { type: "renameMapFolder", folderId: "district", name: "  District 23  " });
  assert.equal(t.mapFolders!.district.name, "District 23");
  act(t, { type: "renameMapFolder", folderId: "district", name: "   " });
  assert.equal(t.mapFolders!.district.name, "District 23", "a blank rename keeps the old name");

  assert.equal(act(t, { type: "setMapFolder", mapId: "back", folderId: "district" }), true);
  assert.equal(act(t, { type: "setMapFolder", mapId: "back", folderId: "district" }), false, "already there: nothing changes");
  act(t, { type: "setMapFolder", mapId: "library", folderId: "district" });
  assert.equal(t.maps!.back.folder, "district");
  assert.equal(t.map.folder, "district", "the players' map can be filed too");

  const g = groupMaps([t.map, ...Object.values(t.maps!)], t.mapFolders);
  assert.deepEqual(g.folders.map((f) => [f.name, f.maps.map((m) => m.name)]), [["District 23", ["Library", "Backstreets"]]]);
  assert.deepEqual(g.loose.map((m) => m.name), ["Smoke War"]);

  act(t, { type: "setMapFolder", mapId: "back", folderId: null });
  assert.equal(t.maps!.back.folder, undefined, "dragged back to the top level");
  assert.deepEqual(t.log, [], "filing maps says nothing in the log players read");
});

test("deleting a folder moves its maps back to the top level and never deletes a map", () => {
  const t = table();
  act(t, { type: "createMapFolder", id: "a", name: "A" });
  act(t, { type: "createMapFolder", id: "b", name: "B" });
  act(t, { type: "setMapFolder", mapId: "back", folderId: "a" });
  act(t, { type: "setMapFolder", mapId: "library", folderId: "a" });
  act(t, { type: "setMapFolder", mapId: "smoke", folderId: "b" });
  act(t, { type: "deleteMapFolder", folderId: "a" });
  assert.deepEqual(Object.keys(t.maps!).sort(), ["back", "smoke"]);
  assert.equal(t.map.name, "Library");
  assert.equal(t.maps!.back.folder, undefined);
  assert.equal(t.map.folder, undefined);
  assert.equal(t.maps!.smoke.folder, "b", "other folders keep their maps");
  act(t, { type: "deleteMapFolder", folderId: "b" });
  assert.equal(t.mapFolders, undefined, "the last folder leaves nothing behind");
  assert.throws(() => act(t, { type: "deleteMapFolder", folderId: "b" }), /Folder not found/);
});

test("a map keeps its folder when the players move to it and away, and a duplicate lands beside it", () => {
  const t = table();
  act(t, { type: "createMapFolder", id: "a", name: "A" });
  act(t, { type: "setMapFolder", mapId: "back", folderId: "a" });
  act(t, { type: "switchMap", mapId: "back" });
  assert.equal(t.map.folder, "a");
  act(t, { type: "switchMap", mapId: "library" });
  assert.equal(t.maps!.back.folder, "a");
  act(t, { type: "createMap", id: "copy", name: "", width: 8, height: 8, copyFrom: "back" });
  assert.equal(t.maps!.copy.folder, "a");
  act(t, { type: "createMap", id: "fresh", name: "Fresh", width: 8, height: 8 });
  assert.equal(t.maps!.fresh.folder, undefined, "a new map starts at the top level");
});

test("folders are sorted by name; a map whose folder is gone shows at the top level", () => {
  const maps = [{ name: "1", folder: "z" }, { name: "2", folder: "gone" }, { name: "3" }, { name: "4", folder: "y" }];
  const g = groupMaps(maps, { z: { name: "Zeta" }, y: { name: "alpha" }, e: { name: "Empty" } });
  assert.deepEqual(g.folders.map((f) => [f.name, f.maps.map((m) => m.name)]), [["alpha", ["4"]], ["Empty", []], ["Zeta", ["1"]]]);
  assert.deepEqual(g.loose.map((m) => m.name), ["2", "3"]);
});

test("only the GM organizes folders, and bad ids are refused", () => {
  const t = table();
  assert.throws(() => act(t, { type: "createMapFolder", name: "Mine" }, p1));
  act(t, { type: "createMapFolder", id: "a", name: "A" });
  assert.throws(() => act(t, { type: "renameMapFolder", folderId: "a", name: "B" }, p1));
  assert.throws(() => act(t, { type: "setMapFolder", mapId: "back", folderId: "a" }, p1));
  assert.throws(() => act(t, { type: "deleteMapFolder", folderId: "a" }, p1));
  assert.throws(() => act(t, { type: "setMapFolder", mapId: "nope", folderId: "a" }), /Map not found/);
  assert.throws(() => act(t, { type: "setMapFolder", mapId: "back", folderId: "nope" }), /Folder not found/);
  // A taken or malformed id gets a fresh one instead.
  act(t, { type: "createMapFolder", id: "a", name: "Again" });
  act(t, { type: "createMapFolder", id: "bad id!", name: "Odd" });
  assert.equal(Object.keys(t.mapFolders!).length, 3);
  assert.equal(t.mapFolders!.a.name, "A");
  assert.equal(t.mapFolders!["bad id!"], undefined);
});

test("a game holds at most the folder limit", () => {
  const t = table();
  for (let i = 0; i < MAX_FOLDERS; i++) act(t, { type: "createMapFolder", name: `F${i}` });
  assert.throws(() => act(t, { type: "createMapFolder", name: "One more" }), /up to/);
});

test("players and the board never get the folders, not even the one their map is in", () => {
  const t = table();
  act(t, { type: "createMapFolder", id: "a", name: "Secret plans" });
  act(t, { type: "setMapFolder", mapId: "library", folderId: "a" });
  const seen = tableForPlayers(playerView(t));
  assert.equal(seen.mapFolders, undefined);
  assert.equal(seen.map.folder, undefined);
  assert.doesNotMatch(JSON.stringify(seen), /Secret plans/);
  assert.equal(tableForGm(t).mapFolders!.a.name, "Secret plans", "the GM's screens keep them");
});

test("the saved table may hold the folders", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /hasOnly\(\["map", "maps", "mapFolders", "tokens", "log", "combat", "popups"\]\)/);
});
