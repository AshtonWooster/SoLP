// Several maps per game. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAction, type Actor } from "../shared/engine.ts";
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
