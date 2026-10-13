// The map editor's asset library. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assetId, assetName, assetUses, libraryEntries, type MapAsset, newAsset, removedAsset, searchLibrary } from "../shared/mapAssets.ts";
import type { MapItem } from "../shared/types.ts";

const img = (url: string, extra: Partial<MapItem> = {}): MapItem => ({ id: url, kind: "image", url, x: 0, y: 0, w: 1, h: 1, ...extra });
const pin: MapItem = { id: "p", kind: "pin", x: 1, y: 1, name: "Note" };

test("an image's id is stable and differs between images, so one file is listed once", () => {
  assert.equal(assetId("https://x/a.png"), assetId("https://x/a.png"));
  assert.notEqual(assetId("https://x/a.png"), assetId("https://x/b.png"));
  assert.match(assetId("https://x/a.png"), /^[0-9a-f]{16}$/);
});

test("names come from the file name: no extension, readable, at most 60 characters", () => {
  assert.equal(assetName("old_oak-tree.png"), "old oak tree");
  assert.equal(assetName("Crate.JPEG"), "Crate");
  assert.equal(assetName(".png"), "Image");
  assert.equal(assetName("x".repeat(80) + ".webp").length, 60);
  const a = newAsset("u", "Barrel.png", 123);
  assert.deepEqual(a, { url: "u", name: "Barrel", addedAt: 123 });
});

test("uses count every placement across maps, but not pins", () => {
  const uses = assetUses([{ items: [img("a"), img("a", { id: "a2" }), pin] }, { items: [img("a", { id: "a3" }), img("b")] }, {}]);
  assert.equal(uses.get("a"), 3);
  assert.equal(uses.get("b"), 1);
  assert.equal(uses.size, 2);
});

test("the library lists saved uploads newest first, even ones on no map", () => {
  const saved: Record<string, MapAsset> = {
    [assetId("old")]: { url: "old", name: "Old", addedAt: 1 },
    [assetId("new")]: { url: "new", name: "New", addedAt: 5 },
  };
  const list = libraryEntries(saved, [{ items: [img("old")] }]);
  assert.deepEqual(
    list.map((e) => [e.name, e.uses]),
    [["New", 0], ["Old", 1]],
  );
  assert.equal(list[0].id, assetId("new"));
});

test("images already on a map before the library existed show up, each once", () => {
  const list = libraryEntries(undefined, [{ items: [img("tree", { name: "Tree" }), img("tree", { id: "t2" })] }, { items: [img("rock")] }]);
  assert.deepEqual(list.map((e) => e.name).sort(), ["Image", "Tree"]);
  assert.equal(list.find((e) => e.url === "tree")!.uses, 2);
});

test("removing keeps the marker, so an image still on a map doesn't come back", () => {
  const entry = libraryEntries(undefined, [{ items: [img("tree", { name: "Tree" })] }])[0];
  const removed = removedAsset(entry);
  assert.equal(removed.removed, true);
  assert.equal(removed.url, "tree");
  assert.deepEqual(libraryEntries({ [entry.id]: removed }, [{ items: [img("tree")] }]), []);
});

test("search matches every word of the name, any case", () => {
  const list = libraryEntries(
    { a: newAsset("1", "Old oak tree.png", 3), b: newAsset("2", "Pine tree.png", 2), c: newAsset("3", "Crate.png", 1) },
    [],
  );
  assert.deepEqual(searchLibrary(list, "TREE").map((e) => e.name), ["Old oak tree", "Pine tree"]);
  assert.deepEqual(searchLibrary(list, "oak tree").map((e) => e.name), ["Old oak tree"]);
  assert.equal(searchLibrary(list, "  ").length, 3);
});

test("the map editor shows the library on its left, and uploads from either button are saved to it", () => {
  const src = readFileSync(new URL("../src/components/maps/MapEditor.tsx", import.meta.url), "utf8");
  const body = src.slice(src.indexOf('<div className="me-body">'));
  assert.ok(body.indexOf("<AssetLibrary") < body.indexOf('className="me-canvas-wrap"'), "library comes before the canvas");
  assert.match(src, /saveToLibrary\(gameId, url, file\)/);
  const lib = readFileSync(new URL("../src/components/maps/AssetLibrary.tsx", import.meta.url), "utf8");
  assert.match(lib, /saveToLibrary\(gameId, url, file\.name\)/);
  assert.match(lib, /<ConfirmButton/, "removing takes a second tap");
  assert.match(lib, /"mapImage"/, "uploads go through the framing and resize flow");
});
