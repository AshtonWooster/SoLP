// The GM dragging assets and pins on the table's map. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyAction, type Actor } from "../shared/engine.ts";
import { dragItemTo, movePin, playerView, TABLE_LAYERS } from "../shared/maps.ts";
import type { MapItem, TableState } from "../shared/types.ts";

const gm: Actor = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };
const img = "https://example.com/crate.png";

function table(): TableState {
  return {
    map: {
      id: "library",
      name: "Library",
      width: 16,
      height: 10,
      items: [
        { id: "crate", kind: "image", url: img, x: 2, y: 3, w: 2, h: 1 },
        { id: "door", kind: "pin", x: 4.5, y: 4.5, name: "Door" },
        { id: "statue", kind: "image", url: img, x: 8, y: 1, w: 1, h: 1, locked: true },
      ],
    },
    tokens: {},
    log: [],
  };
}
const item = (t: TableState, id: string) => t.map.items!.find((i) => i.id === id)!;

test("the layers the GM can switch between on the table: tokens first, then assets and pins", () => {
  assert.deepEqual(
    TABLE_LAYERS.map((l) => l.key),
    ["tokens", "assets", "pins"],
  );
});

test("dragging an asset moves it by whole tiles when snapping, freely otherwise; its size stays", () => {
  const crate = item(table(), "crate");
  assert.deepEqual(dragItemTo(crate, "assets", 1.4, 2.6, true), { x: 3, y: 6 });
  assert.deepEqual(dragItemTo(crate, "assets", 1.4, 2.6, false), { x: 3.4, y: 5.6 });
});

test("dragging a pin lands in the middle of a tile when snapping, anywhere otherwise", () => {
  const door = item(table(), "door");
  assert.deepEqual(dragItemTo(door, "pins", 2.2, -1.9, true), { x: 6.5, y: 2.5 });
  assert.deepEqual(dragItemTo(door, "pins", 0.25, 0.25, false), { x: 4.75, y: 4.75 });
  assert.deepEqual(movePin({ x: 0.5, y: 0.5 }, 0.4, 0.4, true), { x: 0.5, y: 0.5 }, "still in the same tile");
});

test("each layer grabs only its own kind, and locked assets don't move", () => {
  const t = table();
  assert.equal(dragItemTo(item(t, "crate"), "pins", 1, 1, true), undefined, "an asset on the pins layer");
  assert.equal(dragItemTo(item(t, "door"), "assets", 1, 1, true), undefined, "a pin on the assets layer");
  assert.equal(dragItemTo(item(t, "crate"), "tokens", 1, 1, true), undefined, "the tokens layer moves no assets");
  assert.equal(dragItemTo(item(t, "statue"), "assets", 1, 1, true), undefined, "locked in the map editor");
});

test("a drag on the table saves the new spot on the players' map, and players see it", () => {
  const t = table();
  const to = dragItemTo(item(t, "crate"), "assets", 3, 1, true)!;
  assert.equal(applyAction(t, { type: "updateMapItem", mapId: "library", itemId: "crate", patch: to }, gm), true);
  assert.deepEqual([item(t, "crate").x, item(t, "crate").y, item(t, "crate").w], [5, 4, 2]);
  const pinTo = dragItemTo(item(t, "door"), "pins", -2, 0, true)!;
  applyAction(t, { type: "updateMapItem", mapId: "library", itemId: "door", patch: pinTo }, gm);
  const seen = playerView(t).map.items!;
  assert.deepEqual(
    seen.filter((i: MapItem) => i.id !== "statue").map((i: MapItem) => [i.id, i.x, i.y]),
    [
      ["crate", 5, 4],
      ["door", 2.5, 4.5],
    ],
  );
});

test("players can't move assets or pins", () => {
  const t = table();
  assert.throws(() => applyAction(t, { type: "updateMapItem", mapId: "library", itemId: "crate", patch: { x: 9 } }, p1), /GM only/);
  assert.throws(() => applyAction(t, { type: "updateMapItem", mapId: "library", itemId: "door", patch: { x: 9 } }, p1), /GM only/);
  assert.equal(item(t, "crate").x, 2);
  assert.equal(item(t, "door").x, 4.5);
});

test("only the GM screen gets the layer switch; the players' board never passes a layer to the map", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(read("../src/screens/Gm.tsx"), /<LayerSwitch/);
  for (const screen of ["../src/screens/Board.tsx", "../src/screens/Play.tsx"]) {
    const src = read(screen);
    assert.doesNotMatch(src, /LayerSwitch|onMoveItem|layer=\{/, screen);
  }
});
