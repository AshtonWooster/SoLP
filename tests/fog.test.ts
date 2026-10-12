// Fog of war: the GM hides and reveals parts of each map. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, type Actor } from "../shared/engine.ts";
import { fogAreas, fogMask, fogOfWarOn, isFogged, MAX_FOG_RECTS } from "../shared/fog.ts";
import { playerView, visibleMap } from "../shared/maps.ts";
import type { GameDoc, MapItem, TableState, Token } from "../shared/types.ts";

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
    map: { id: "lib", name: "Library", width: 10, height: 6 },
    tokens: {
      roland: token("roland", "player", 1, 1, { ownerId: "p1" }),
      rat: token("rat", "enemy", 7, 3),
      guard: token("guard", "ally", 8, 4),
    },
    log: [],
  };
}

const act = (t: TableState, a: Parameters<typeof applyAction>[1], who: Actor = gm) => applyAction(t, a, who);
const fogged = (t: TableState, x: number, y: number) => isFogged(t.map, fogMask(t.map), x, y);
const game = (settings?: GameDoc["settings"]): GameDoc => ({ name: "G", gmId: "gm", memberIds: ["gm", "p1"], members: {}, createdAt: 1, settings });

test("fog of war is off unless the GM turns it on in Game settings", () => {
  assert.equal(fogOfWarOn(undefined), false);
  assert.equal(fogOfWarOn(game()), false);
  assert.equal(fogOfWarOn(game({ fogOfWar: false })), false);
  assert.equal(fogOfWarOn(game({ fogOfWar: true })), true);
});

test("maps start fully revealed, so existing games look the same", () => {
  const t = table();
  assert.equal(fogMask(t.map), undefined);
  assert.deepEqual(Object.keys(playerView(t, { fog: true }).tokens).sort(), ["guard", "rat", "roland"]);
});

test("the GM draws boxes that hide, then reveal, parts of the map; later boxes win", () => {
  const t = table();
  assert.equal(act(t, { type: "drawFog", mapId: "lib", x: 5, y: 2, w: 4, h: 3 }), true);
  assert.equal(fogged(t, 5, 2), true);
  assert.equal(fogged(t, 8, 4), true);
  assert.equal(fogged(t, 4, 2), false);
  assert.equal(fogged(t, 9, 2), false);

  assert.equal(act(t, { type: "drawFog", mapId: "lib", x: 7, y: 3, w: 1, h: 1, reveal: true }), true);
  assert.equal(fogged(t, 7, 3), false, "revealed");
  assert.equal(fogged(t, 6, 3), true, "the rest stays hidden");

  // Hiding the same area again is no change.
  assert.equal(act(t, { type: "drawFog", mapId: "lib", x: 5, y: 2, w: 2, h: 1 }), false);
});

test("a box is cut to the map, and one off the map is refused", () => {
  const t = table();
  act(t, { type: "drawFog", mapId: "lib", x: 8, y: 4, w: 10, h: 10 });
  assert.deepEqual(t.map.fog?.rects, [{ x: 8, y: 4, w: 2, h: 2 }]);
  assert.throws(() => act(t, { type: "drawFog", mapId: "lib", x: 20, y: 20, w: 2, h: 2 }), /on the map/);
  assert.throws(() => act(t, { type: "drawFog", mapId: "lib", x: 1, y: 1, w: 0, h: 2 }), /Draw a box/);
});

test("Hide all and Reveal all cover or clear the whole map, and reveals can be drawn over Hide all", () => {
  const t = table();
  assert.equal(act(t, { type: "fogAll", mapId: "lib", hidden: true }), true);
  assert.deepEqual(t.map.fog, { covered: true });
  assert.equal(act(t, { type: "fogAll", mapId: "lib", hidden: true }), false, "already hidden");
  act(t, { type: "drawFog", mapId: "lib", x: 0, y: 0, w: 3, h: 3, reveal: true });
  assert.equal(fogged(t, 1, 1), false);
  assert.equal(fogged(t, 5, 5), true);

  assert.equal(act(t, { type: "fogAll", mapId: "lib", hidden: false }), true);
  assert.equal(t.map.fog, undefined, "nothing left to store");
  assert.equal(act(t, { type: "fogAll", mapId: "lib", hidden: false }), false);
});

test("revealing everything by hand, or hiding everything, stores the simplest fog", () => {
  const t = table();
  act(t, { type: "drawFog", mapId: "lib", x: 2, y: 2, w: 2, h: 2 });
  act(t, { type: "drawFog", mapId: "lib", x: 0, y: 0, w: 10, h: 6, reveal: true });
  assert.equal(t.map.fog, undefined);
  act(t, { type: "drawFog", mapId: "lib", x: 0, y: 0, w: 10, h: 6 });
  assert.deepEqual(t.map.fog, { covered: true });
});

test("boxes a later box covers are dropped, and lots of boxes are redrawn as few", () => {
  const t = table();
  act(t, { type: "drawFog", mapId: "lib", x: 2, y: 2, w: 1, h: 1 });
  act(t, { type: "drawFog", mapId: "lib", x: 1, y: 1, w: 3, h: 3, reveal: true });
  assert.deepEqual(t.map.fog, undefined, "the reveal covered the only hidden box");

  const big: TableState = { ...table(), map: { id: "big", name: "Big", width: 60, height: 60 } };
  for (let i = 0; i <= MAX_FOG_RECTS + 5; i++) {
    act(big, { type: "drawFog", mapId: "big", x: i % 60, y: Math.floor(i / 60), w: 1, h: 1 });
  }
  assert.ok((big.map.fog?.rects?.length ?? 0) <= MAX_FOG_RECTS);
  assert.equal(fogged(big, 59, 0), true);
  assert.equal(fogged(big, 5, 3), true);
  assert.equal(fogged(big, 59, 5), false);
});

test("fogAreas merges hidden tiles into boxes for drawing", () => {
  const t = table();
  act(t, { type: "drawFog", mapId: "lib", x: 0, y: 0, w: 4, h: 2 });
  act(t, { type: "drawFog", mapId: "lib", x: 6, y: 0, w: 2, h: 2 });
  assert.deepEqual(fogAreas(t.map), [
    { x: 0, y: 0, w: 4, h: 2 },
    { x: 6, y: 0, w: 2, h: 2 },
  ]);
});

test("players don't get tokens under the fog, but always get their own characters", () => {
  const t = table();
  act(t, { type: "fogAll", mapId: "lib", hidden: true });
  act(t, { type: "drawFog", mapId: "lib", x: 8, y: 4, w: 1, h: 1, reveal: true });
  const view = playerView(t, { fog: true });
  assert.deepEqual(Object.keys(view.tokens).sort(), ["guard", "roland"], "the rat is under the fog; Roland is a player");
  assert.deepEqual(view.map.fog, t.map.fog, "the fog comes along so screens can cover it");
  // The GM's own table keeps everything.
  assert.equal(Object.keys(t.tokens).length, 3);
});

test("with fog of war off in Game settings, players see everything and get no fog", () => {
  const t = table();
  act(t, { type: "fogAll", mapId: "lib", hidden: true });
  const view = playerView(t);
  assert.deepEqual(Object.keys(view.tokens).sort(), ["guard", "rat", "roland"]);
  assert.equal(view.map.fog, undefined);
  assert.ok(t.map.fog, "the GM's fog is kept for when it's turned back on");
});

test("anyone in the turn order stays in view, so combat still makes sense", () => {
  const t = table();
  act(t, { type: "startCombat", tokenIds: ["roland", "rat"] });
  act(t, { type: "fogAll", mapId: "lib", hidden: true });
  const view = playerView(t, { fog: true });
  assert.deepEqual(Object.keys(view.tokens).sort(), ["rat", "roland"]);
});

test("pins and assets under the fog aren't sent; an asset partly in the open still is", () => {
  const t = table();
  const items: MapItem[] = [
    { id: "pin-dark", kind: "pin", x: 7.5, y: 3.5, name: "Trap" },
    { id: "pin-open", kind: "pin", x: 1.5, y: 1.5, name: "Door" },
    { id: "chest", kind: "image", x: 6, y: 2, w: 2, h: 2, url: "https://example.com/chest.png" },
    { id: "rug", kind: "image", x: 4, y: 2, w: 2, h: 1, url: "https://example.com/rug.png" },
  ];
  t.map.items = items;
  act(t, { type: "drawFog", mapId: "lib", x: 5, y: 2, w: 5, h: 4 });
  const ids = (visibleMap(t.map, { fog: true }).items ?? []).map((i) => i.id);
  assert.deepEqual(ids, ["pin-open", "rug"], "the rug sits half in the open");
  assert.deepEqual((visibleMap(t.map).items ?? []).map((i) => i.id), ["pin-dark", "pin-open", "chest", "rug"], "fog off: all of them");
});

test("only the GM can draw fog or hide and reveal the map", () => {
  const t = table();
  assert.throws(() => act(t, { type: "drawFog", mapId: "lib", x: 0, y: 0, w: 2, h: 2, reveal: true }, p1), /GM only/);
  assert.throws(() => act(t, { type: "fogAll", mapId: "lib", hidden: false }, p1), /GM only/);
});

test("each map keeps its own fog: switching maps, copying and resizing", () => {
  const t = table();
  act(t, { type: "drawFog", mapId: "lib", x: 0, y: 0, w: 10, h: 3 });
  act(t, { type: "createMap", id: "back", name: "Backstreets", width: 8, height: 6 });
  assert.equal(t.maps!.back.fog, undefined, "a new map starts revealed");
  // The GM gets the next map ready: Hide all before the players arrive.
  act(t, { type: "fogAll", mapId: "back", hidden: true });

  act(t, { type: "switchMap", mapId: "back" });
  assert.deepEqual(t.map.fog, { covered: true });
  assert.ok(t.maps!.lib.fog?.rects?.length, "the Library keeps its fog while it waits");
  act(t, { type: "switchMap", mapId: "lib" });
  assert.equal(fogged(t, 3, 2), true);
  assert.equal(fogged(t, 3, 3), false);

  act(t, { type: "createMap", id: "copy", name: "", width: 10, height: 6, copyFrom: "lib" });
  assert.deepEqual(t.maps!.copy.fog, t.map.fog, "a copy takes the fog too");

  act(t, { type: "updateMap", mapId: "lib", width: 4, height: 4 });
  assert.deepEqual(t.map.fog?.rects, [{ x: 0, y: 0, w: 4, h: 3 }], "cut to the smaller map");
});
