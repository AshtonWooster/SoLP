// Several maps per game. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, type Actor } from "../shared/engine.ts";
import { MAP_MIN, moveRect, playerView, resizeRect } from "../shared/maps.ts";
import type { TableState, Token } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };

function token(id: string, side: Token["side"], x: number, y: number, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, side, x, y, color: "#fff",
    resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 },
    ...extra,
  };
}

function table(): TableState {
  return {
    map: { name: "Library", width: 16, height: 10 },
    tokens: {
      roland: token("roland", "player", 5, 5, { ownerId: "p1" }),
      angela: token("angela", "player", 6, 5, { ownerId: "p2" }),
      rat: token("rat", "enemy", 10, 4),
    },
    log: [],
  };
}

const act = (t: TableState, a: Parameters<typeof applyAction>[1], who: Actor = gm) => applyAction(t, a, who);
const pos = (t: TableState, id: string) => [t.tokens[id].x, t.tokens[id].y];

test("the GM creates a map, switches to it and back: players travel and keep their stats, enemies stay, positions are remembered", () => {
  const t = table();
  act(t, { type: "createMap", name: "Backstreets", width: 8, height: 6 });
  const backId = Object.keys(t.maps!)[0];
  assert.equal(t.maps![backId].name, "Backstreets");
  assert.equal(t.map.name, "Library", "creating doesn't switch");
  t.tokens.roland.resources.hp = 12;

  act(t, { type: "switchMap", mapId: backId });
  assert.equal(t.map.name, "Backstreets");
  assert.equal(t.map.width, 8);
  assert.deepEqual(Object.keys(t.tokens).sort(), ["angela", "roland"], "the rat stays in the Library");
  assert.equal(t.tokens.roland.resources.hp, 12, "Health carries over");
  // First visit: lined up near the top-left.
  assert.deepEqual(pos(t, "roland"), [1, 1]);
  assert.deepEqual(pos(t, "angela"), [1, 2]);
  act(t, { type: "move", tokenId: "roland", x: 7, y: 5 });

  const libraryId = t.maps ? Object.keys(t.maps).find((id) => t.maps![id].name === "Library")! : "";
  act(t, { type: "switchMap", mapId: libraryId });
  assert.equal(t.map.name, "Library");
  assert.deepEqual(pos(t, "roland"), [5, 5], "back where he stood in the Library");
  assert.deepEqual(pos(t, "rat"), [10, 4]);
  assert.equal(t.tokens.rat.resources.hp, 30);

  act(t, { type: "switchMap", mapId: backId });
  assert.deepEqual(pos(t, "roland"), [7, 5], "and back where he stood in the Backstreets");
});

test("enemies keep their own Health on their map while the party is elsewhere", () => {
  const t = table();
  const libraryId = (act(t, { type: "createMap", name: "B", width: 10, height: 10 }), t.map.id!);
  const bId = Object.keys(t.maps!)[0];
  act(t, { type: "setResources", tokenId: "rat", patch: { hp: 7 } });
  act(t, { type: "switchMap", mapId: bId });
  assert.equal(t.tokens.rat, undefined);
  assert.equal(t.maps![libraryId].tokens.rat.resources.hp, 7);
  act(t, { type: "switchMap", mapId: libraryId });
  assert.equal(t.tokens.rat.resources.hp, 7);
});

test("renaming, resizing and backgrounds; shrinking pulls tokens onto free tiles", () => {
  const t = table();
  const id = (t.map.id = "library");
  act(t, { type: "updateMap", mapId: id, name: "Archive", width: 6, height: 6, background: "https://example.com/floor.png" });
  assert.equal(t.map.name, "Archive");
  assert.equal(t.map.background, "https://example.com/floor.png");
  const tiles = Object.values(t.tokens).map((x) => `${x.x},${x.y}`);
  assert.equal(new Set(tiles).size, tiles.length, "no shared tiles");
  for (const x of Object.values(t.tokens)) assert.ok(x.x < 6 && x.y < 6, `${x.id} on the map`);
  assert.deepEqual(pos(t, "roland"), [5, 5], "a token that still fits doesn't move");
  act(t, { type: "updateMap", mapId: id, background: null });
  assert.equal(t.map.background, undefined);
  act(t, { type: "updateMap", mapId: id, background: "javascript:alert(1)" });
  assert.equal(t.map.background, undefined, "only http(s) images");
});

test("only the GM manages maps; no switching mid-combat; the current map can't be deleted", () => {
  const t = table();
  assert.throws(() => act(t, { type: "createMap", name: "X", width: 8, height: 8 }, p1), /GM only/);
  act(t, { type: "createMap", name: "X", width: 8, height: 8 });
  const x = Object.keys(t.maps!)[0];
  assert.throws(() => act(t, { type: "switchMap", mapId: x }, p1), /GM only/);
  act(t, { type: "startCombat", tokenIds: ["roland", "rat"] });
  assert.throws(() => act(t, { type: "switchMap", mapId: x }), /End combat/);
  act(t, { type: "endCombat" });
  assert.throws(() => act(t, { type: "deleteMap", mapId: t.map.id! }), /Switch to another map/);
  act(t, { type: "deleteMap", mapId: x });
  assert.deepEqual(t.maps, {});
});

// ---- The map editor ----

const img = "https://example.com/crate.png";

function twoMaps() {
  const t = table();
  t.map.id = "library";
  act(t, { type: "createMap", name: "Backstreets", width: 12, height: 8 });
  const back = Object.keys(t.maps!)[0];
  return { t, back };
}

test("assets: added on any map, dragged, resized and rotated, with numbers cleaned", () => {
  const { t, back } = twoMaps();
  act(t, { type: "addMapItem", mapId: "library", item: { id: "crate", kind: "image", url: img, x: 2.5, y: 3, w: 1.5, h: 1 } });
  assert.deepEqual(t.map.items, [{ id: "crate", kind: "image", url: img, x: 2.5, y: 3, w: 1.5, h: 1 }]);
  act(t, { type: "updateMapItem", mapId: "library", itemId: "crate", patch: { x: 4, rotation: -90, w: 0.01, name: "  Crate " } });
  assert.deepEqual(t.map.items![0], { id: "crate", kind: "image", url: img, x: 4, y: 3, w: 0.25, h: 1, rotation: 270, name: "Crate" });
  assert.equal(act(t, { type: "updateMapItem", mapId: "library", itemId: "crate", patch: { x: 4 } }), false, "no change, no update");

  // A map the players aren't on gets ready the same way.
  act(t, { type: "addMapItem", mapId: back, item: { kind: "image", url: img, x: 1, y: 1 } });
  assert.equal(t.maps![back].items!.length, 1);
  assert.equal(t.maps![back].items![0].w, 2, "default size: 2 tiles");
  assert.equal(t.map.items!.length, 1, "the table's map is untouched");

  assert.throws(() => act(t, { type: "addMapItem", mapId: "library", item: { kind: "image", url: "javascript:alert(1)" } }), /Pick an image/);
  assert.throws(() => act(t, { type: "addMapItem", mapId: "nowhere", item: { kind: "image", url: img } }), /Map not found/);
});

test("assets: drawing order, removing, and undo restoring the whole layer", () => {
  const { t } = twoMaps();
  for (const id of ["a", "b", "c"]) act(t, { type: "addMapItem", mapId: "library", item: { id, kind: "image", url: img } });
  const order = () => t.map.items!.map((i) => i.id).join("");
  const before = structuredClone(t.map.items!);
  act(t, { type: "arrangeMapItem", mapId: "library", itemId: "a", to: "front" });
  assert.equal(order(), "bca");
  act(t, { type: "arrangeMapItem", mapId: "library", itemId: "a", to: "backward" });
  assert.equal(order(), "bac");
  act(t, { type: "arrangeMapItem", mapId: "library", itemId: "c", to: "back" });
  assert.equal(order(), "cba");
  assert.equal(act(t, { type: "arrangeMapItem", mapId: "library", itemId: "c", to: "backward" }), false);
  act(t, { type: "removeMapItem", mapId: "library", itemId: "b" });
  assert.equal(order(), "ca");
  act(t, { type: "setMapItems", mapId: "library", items: before });
  assert.equal(order(), "abc");
});

test("pins and notes keep their label, note and color", () => {
  const { t } = twoMaps();
  act(t, { type: "addMapItem", mapId: "library", item: { id: "trap", kind: "pin", x: 3.5, y: 2.5, name: "Trap", note: "DC 12 to spot", color: "#ff0000", hidden: true } });
  assert.deepEqual(t.map.items![0], { id: "trap", kind: "pin", x: 3.5, y: 2.5, name: "Trap", note: "DC 12 to spot", color: "#ff0000", hidden: true });
  act(t, { type: "updateMapItem", mapId: "library", itemId: "trap", patch: { color: "red; background:url(x)", kind: "image" } });
  assert.equal(t.map.items![0].kind, "pin", "kind doesn't change");
  assert.equal(t.map.items![0].color, undefined, "only #rrggbb colors");
});

test("players never receive what the GM hid: background, assets, pins or tokens", () => {
  const { t } = twoMaps();
  act(t, { type: "updateMap", mapId: "library", background: "https://example.com/floor.png", backgroundHidden: true, hideGrid: true });
  act(t, { type: "addMapItem", mapId: "library", item: { id: "shown", kind: "image", url: img } });
  act(t, { type: "addMapItem", mapId: "library", item: { id: "secret", kind: "image", url: img, hidden: true } });
  act(t, { type: "addMapItem", mapId: "library", item: { id: "gm-note", kind: "pin", note: "Ambush here", hidden: true } });
  act(t, { type: "setTokenHidden", tokenId: "rat", hidden: true });

  const seen = playerView(t);
  assert.equal(seen.map.background, undefined);
  assert.equal(seen.map.hideGrid, true);
  assert.deepEqual(seen.map.items!.map((i) => i.id), ["shown"]);
  assert.deepEqual(Object.keys(seen.tokens).sort(), ["angela", "roland"]);
  assert.ok(!JSON.stringify(seen.map).includes("Ambush"), "hidden notes aren't sent");
  // The GM's own copy still has everything.
  assert.equal(t.map.background, "https://example.com/floor.png");
  assert.equal(t.map.items!.length, 3);
  assert.ok(t.tokens.rat.hidden);

  act(t, { type: "updateMap", mapId: "library", backgroundHidden: false });
  assert.equal(playerView(t).map.background, "https://example.com/floor.png");
  assert.equal(t.map.backgroundHidden, undefined);
});

test("hidden tokens: never players' characters; joining combat reveals them; the turn order can't hide", () => {
  const { t } = twoMaps();
  assert.throws(() => act(t, { type: "setTokenHidden", tokenId: "roland", hidden: true }), /always shown/);
  act(t, { type: "setTokenHidden", tokenId: "rat", hidden: true });
  act(t, { type: "startCombat", tokenIds: ["roland", "rat"] });
  assert.equal(t.tokens.rat.hidden, undefined, "the rat jumps out");
  assert.throws(() => act(t, { type: "setTokenHidden", tokenId: "rat", hidden: true }), /turn order/);
  act(t, { type: "endCombat" });
  act(t, { type: "setTokenHidden", tokenId: "rat", hidden: true });
  act(t, { type: "startCombat", tokenIds: ["roland"] });
  act(t, { type: "addCombatant", tokenId: "rat" });
  assert.equal(t.tokens.rat.hidden, undefined, "added mid-fight, it's revealed too");
});

test("getting another map ready: place hidden enemies, move them, set where the party arrives, with nothing in the log", () => {
  const { t, back } = twoMaps();
  const logBefore = t.log.length;
  act(t, { type: "addToken", name: "Lurker", side: "enemy", x: 6, y: 6, mapId: back, hidden: true });
  const [lurker] = Object.values(t.maps![back].tokens);
  assert.equal(lurker.name, "Lurker");
  assert.equal(lurker.hidden, true);
  assert.equal(Object.values(t.tokens).find((x) => x.name === "Lurker"), undefined, "not on the players' map");
  act(t, { type: "placeToken", mapId: back, tokenId: lurker.id, x: 99, y: 3 });
  assert.deepEqual([lurker.x, lurker.y], [11, 3], "kept on the map");
  act(t, { type: "placeToken", mapId: back, tokenId: "roland", x: 4, y: 4 });
  assert.deepEqual(t.maps![back].positions.roland, { x: 4, y: 4 });
  assert.deepEqual(pos(t, "roland"), [5, 5], "his token on the table doesn't move");
  assert.equal(t.log.length, logBefore, "players' log doesn't give the prep away");

  act(t, { type: "switchMap", mapId: back });
  assert.deepEqual(pos(t, "roland"), [4, 4], "arrives where the GM put him");
  assert.equal(t.tokens[lurker.id].hidden, true, "still hidden once the party arrives");
  assert.equal(playerView(t).tokens[lurker.id], undefined);

  act(t, { type: "removeToken", tokenId: lurker.id });
  assert.equal(t.tokens[lurker.id], undefined);
});

test("the map editor is GM only", () => {
  const { t, back } = twoMaps();
  assert.throws(() => act(t, { type: "addMapItem", mapId: "library", item: { kind: "image", url: img } }, p1), /GM only/);
  assert.throws(() => act(t, { type: "placeToken", mapId: back, tokenId: "roland", x: 1, y: 1 }, p1), /GM only/);
  assert.throws(() => act(t, { type: "setTokenHidden", tokenId: "rat", hidden: true }, p1), /GM only/);
  assert.throws(() => act(t, { type: "addToken", name: "X", side: "enemy", x: 1, y: 1, mapId: back }, p1), /GM only/);
});

test("copying a map takes its look but not its tokens", () => {
  const { t } = twoMaps();
  act(t, { type: "updateMap", mapId: "library", background: "https://example.com/floor.png", hideGrid: true });
  act(t, { type: "addMapItem", mapId: "library", item: { id: "crate", kind: "image", url: img } });
  act(t, { type: "createMap", name: "", width: 0, height: 0, copyFrom: "library" } as never);
  const copy = Object.values(t.maps!).find((m) => m.name === "Library copy")!;
  assert.equal(copy.width, MAP_MIN, "an explicit size still applies");
  assert.equal(copy.background, "https://example.com/floor.png");
  assert.equal(copy.hideGrid, true);
  assert.equal(copy.items!.length, 1);
  assert.notEqual(copy.items![0].id, "crate", "its own asset ids");
  assert.deepEqual(copy.tokens, {});
  act(t, { type: "createMap", id: "same", name: "Same", copyFrom: "library" } as never);
  assert.ok(t.maps!.same, "the editor can name the new map's id");
  act(t, { type: "createMap", id: "library", name: "Clash" } as never);
  assert.equal(Object.values(t.maps!).filter((m) => m.id === "library").length, 0, "but never reuse one");
  const same = Object.values(t.maps!).find((m) => m.name === "Same")!;
  assert.deepEqual([same.width, same.height], [16, 10], "size comes from the source when not given");
});

test("maps saved before the editor keep working and switch like before", () => {
  const t = table(); // no id, items or flags, like an existing game's board
  const seen = playerView(t);
  assert.deepEqual(seen.map, { name: "Library", width: 16, height: 10 });
  act(t, { type: "createMap", name: "B", width: 8, height: 8 });
  const b = Object.keys(t.maps!)[0];
  act(t, { type: "switchMap", mapId: b });
  assert.equal(t.map.name, "B");
  assert.equal(Object.values(t.maps!)[0].name, "Library");
});

test("dragging and resizing: snapped to whole tiles or free, opposite corner fixed, aspect kept with Shift", () => {
  const r = { x: 2, y: 2, w: 2, h: 1 };
  assert.deepEqual(moveRect(r, 1.4, -0.6, true), { x: 3, y: 1, w: 2, h: 1 });
  assert.deepEqual(moveRect(r, 1.437, -0.6, false), { x: 3.44, y: 1.4, w: 2, h: 1 });
  assert.deepEqual(resizeRect(r, "se", 1.3, 0.2, { snap: true }), { x: 2, y: 2, w: 3, h: 1 });
  assert.deepEqual(resizeRect(r, "se", 1.3, 0.2, { snap: false }), { x: 2, y: 2, w: 3.3, h: 1.2 });
  assert.deepEqual(resizeRect(r, "nw", 1, 1, { snap: false }), { x: 3, y: 2.75, w: 1, h: 0.25 }, "the bottom-right corner stays put");
  assert.deepEqual(resizeRect(r, "nw", 5, 5, { snap: true }), { x: 3, y: 2, w: 1, h: 1 }, "never smaller than a tile when snapped");
  assert.deepEqual(resizeRect(r, "se", 2, 0, { snap: false, keepAspect: true }), { x: 2, y: 2, w: 4, h: 2 });
  assert.deepEqual(resizeRect(r, "sw", -2, 0, { snap: false, keepAspect: true }), { x: 0, y: 2, w: 4, h: 2 });
  assert.deepEqual(resizeRect(r, "ne", 0, -1, { snap: false, keepAspect: true }), { x: 2, y: 1, w: 4, h: 2 });
});
