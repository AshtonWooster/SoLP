// Finding the images a game still uses, for the weekly image cleanup. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectStoragePaths, storagePaths, SWEEP_GRACE_MS, unusedFiles } from "../shared/imageRefs.ts";

const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/solp.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=abc`;

test("download URLs name their file; other links don't", () => {
  assert.deepEqual(storagePaths(url("games/g1/assets/maps/a b.png")), ["games/g1/assets/maps/a b.png"]);
  assert.deepEqual(storagePaths("http://127.0.0.1:9199/v0/b/demo-solp.appspot.com/o/games%2Fg1%2Fx.png?alt=media"), ["games/g1/x.png"]);
  assert.deepEqual(storagePaths("https://example.com/cat.png"), []);
});

test("every URL anywhere in a document counts, however deep", () => {
  const table = {
    map: { background: url("games/g1/assets/maps/bg.png"), items: [{ kind: "image", url: url("games/g1/assets/maps/tree.png") }] },
    tokens: { t1: { portrait: url("games/g2/users/p1/portrait/me.png") } },
    popups: [{ text: "hi", image: url("games/g1/assets/popups/letter.png") }],
    log: ["Ann moved"],
  };
  assert.deepEqual(
    [...collectStoragePaths(table, new Set())].sort(),
    ["games/g1/assets/maps/bg.png", "games/g1/assets/maps/tree.png", "games/g1/assets/popups/letter.png", "games/g2/users/p1/portrait/me.png"],
  );
});

test("only files nothing uses and older than a week are unused", () => {
  const now = 100 * SWEEP_GRACE_MS;
  const old = now - SWEEP_GRACE_MS - 1;
  const files = [
    { name: "used.png", created: old, size: 1 },
    { name: "orphan.png", created: old, size: 2 },
    { name: "just-uploaded.png", created: now - 1000, size: 3 },
  ];
  assert.deepEqual(unusedFiles(files, new Set(["used.png"]), now).map((f) => f.name), ["orphan.png"]);
});
