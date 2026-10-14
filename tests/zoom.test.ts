// Zooming and panning the battle map (src/components/zoom.ts). Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { clampView, HOME, isHome, mapPoint, MAX_ZOOM, MIN_ZOOM, panBy, stageStyle, viewTransform, wheelFactor, ZOOM_STEP, zoomAt, type View } from "../src/components/zoom.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("the map starts showing all of it, untransformed", () => {
  assert.ok(isHome(HOME));
  assert.equal(viewTransform(HOME), "translate(0%, 0%) scale(1)");
});

test("zooming keeps the spot under the cursor where it is, so clicks land on the same tile", () => {
  let v: View = HOME;
  // A 10×8 map; the cursor is over tile (7, 2).
  const at = { x: 0.75, y: 0.3 };
  const before = mapPoint(v, at);
  for (const f of [1.3, 1.7, 0.8, 2]) {
    v = zoomAt(v, f, at);
    const after = mapPoint(v, at);
    near(after.x, before.x);
    near(after.y, before.y);
    assert.equal(Math.floor(after.x * 10), 7);
    assert.equal(Math.floor(after.y * 8), 2);
  }
});

test("a point on the map lines up with where the transform draws it", () => {
  const v = zoomAt(zoomAt(HOME, 2.5, { x: 0.2, y: 0.9 }), 1.2, { x: 0.6, y: 0.4 });
  // translate(x, y) scale(s) from the top left draws map point p at x + p * s.
  const p = { x: 0.4, y: 0.55 };
  const shown = { x: v.x + p.x * v.scale, y: v.y + p.y * v.scale };
  const back = mapPoint(v, shown);
  near(back.x, p.x);
  near(back.y, p.y);
});

test("zoom stays between the whole map and the max", () => {
  assert.equal(zoomAt(HOME, 0.5).scale, MIN_ZOOM);
  assert.equal(zoomAt(HOME, 100).scale, MAX_ZOOM);
  let v = HOME;
  for (let i = 0; i < 50; i++) v = zoomAt(v, ZOOM_STEP);
  assert.equal(v.scale, MAX_ZOOM);
  for (let i = 0; i < 50; i++) v = zoomAt(v, 1 / ZOOM_STEP);
  assert.deepEqual(v, HOME);
});

test("the zoom buttons zoom around the middle of the map", () => {
  const v = zoomAt(HOME, ZOOM_STEP);
  near(v.scale, 1.25);
  near(v.x, -0.125);
  near(v.y, -0.125);
});

test("panning moves the map but never past its edges", () => {
  const v = zoomAt(HOME, 2, { x: 0.5, y: 0.5 });
  near(v.x, -0.5);
  near(panBy(v, { x: 0.2, y: 0 }).x, -0.3);
  assert.equal(panBy(v, { x: 5, y: 5 }).x, 0);
  assert.equal(panBy(v, { x: 5, y: 5 }).y, 0);
  assert.equal(panBy(v, { x: -5, y: -5 }).x, -1);
  assert.equal(panBy(v, { x: -5, y: -5 }).y, -1);
  // At the whole map there's nowhere to pan to.
  assert.deepEqual(panBy(HOME, { x: 0.3, y: -0.3 }), HOME);
});

test("zooming out near an edge pulls the map back so it fills the box", () => {
  const v = panBy(zoomAt(HOME, 4), { x: -10, y: -10 });
  const out = zoomAt(v, 0.5, { x: 0, y: 0 });
  assert.deepEqual(out, clampView(out));
  assert.ok(out.x >= 1 - out.scale && out.y >= 1 - out.scale);
});

test("scrolling up zooms in, down zooms out, whatever units the wheel reports", () => {
  assert.ok(wheelFactor(-100) > 1);
  assert.ok(wheelFactor(100) < 1);
  near(wheelFactor(100) * wheelFactor(-100), 1);
  assert.ok(wheelFactor(-3, 1) > 1);
  // One huge flick doesn't jump straight to the max.
  assert.ok(wheelFactor(-100000) < 2);
});

test("the transform matches the view", () => {
  assert.equal(viewTransform({ scale: 2, x: -0.5, y: -0.25 }), "translate(-50%, -25%) scale(2)");
});

test("the map hands its zoom to what's on it, so dice, token borders and pins can keep their size", () => {
  assert.deepEqual(stageStyle(HOME), { "--map-zoom": "1" });
  const v = zoomAt(HOME, 2, { x: 0.5, y: 0.5 });
  assert.deepEqual(stageStyle(v), { "--map-zoom": "2", transform: viewTransform(v) });
  assert.equal(stageStyle(zoomAt(HOME, 100))["--map-zoom"], String(MAX_ZOOM));
});

test("dice animations, pins and token borders and names shrink back by the zoom", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const rule = (sel: string) => css.match(new RegExp(`(^|\\n)${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`))?.[2] ?? "";
  assert.match(rule(".map-stage"), /--unzoom: calc\(1 \/ var\(--map-zoom, 1\)\)/);
  // The clash, Speed and story roll dice all float in .fx-float above the token.
  assert.match(rule(".fx-float"), /scale: var\(--unzoom, 1\)/);
  assert.match(rule(".map-pin"), /scale: var\(--unzoom, 1\)/);
  assert.match(rule(".token"), /border: calc\(3px \* var\(--unzoom, 1\)\)/);
  assert.match(rule(".token-name"), /font-size: calc\(.* \* var\(--unzoom, 1\)\)/);
  assert.match(rule(".token-status"), /font-size: calc\(.* \* var\(--unzoom, 1\)\)/);
  assert.match(rule(".token.selected"), /outline: calc\(3px \* var\(--unzoom, 1\)\)/);
});
