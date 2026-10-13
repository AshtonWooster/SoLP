// Shrinking uploaded images to the size they're shown at. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { IMAGE_PRESETS, MAX_ZOOM, canResize, clampCrop, coverScale, croppedSize, defaultCrop, extensionFor, fitImageSize, frameAspect, keepResized } from "../src/imageSize.ts";

test("a portrait photo shrinks so its shorter side still fills the 512px box", () => {
  assert.deepEqual(fitImageSize(4000, 3000, IMAGE_PRESETS.portrait), { width: 683, height: 512 });
  assert.deepEqual(fitImageSize(3000, 4000, IMAGE_PRESETS.portrait), { width: 512, height: 683 });
  assert.deepEqual(fitImageSize(2048, 2048, IMAGE_PRESETS.portrait), { width: 512, height: 512 });
});

test("a 100px icon is stored at 2x its shown size, so a 100x100 box keeps 200x200", () => {
  assert.deepEqual(fitImageSize(1024, 1024, { width: 200, height: 200, fit: "cover" }), { width: 200, height: 200 });
});

test("images are never scaled up", () => {
  assert.deepEqual(fitImageSize(64, 64, IMAGE_PRESETS.portrait), { width: 64, height: 64 });
  assert.deepEqual(fitImageSize(1000, 800, IMAGE_PRESETS.mapBackground), { width: 1000, height: 800 });
  assert.deepEqual(fitImageSize(300, 200, IMAGE_PRESETS.art), { width: 300, height: 200 });
});

test("page art fills its 4:3 frame at 800x600", () => {
  assert.deepEqual(fitImageSize(1600, 1200, IMAGE_PRESETS.art), { width: 800, height: 600 });
  assert.deepEqual(fitImageSize(1920, 1080, IMAGE_PRESETS.art), { width: 1067, height: 600 });
});

test("a panorama portrait is capped at twice the box's longer side", () => {
  assert.deepEqual(fitImageSize(10000, 1000, IMAGE_PRESETS.portrait), { width: 1024, height: 102 });
});

test("map backgrounds and map images keep their whole picture within a generous cap", () => {
  assert.deepEqual(fitImageSize(8192, 6144, IMAGE_PRESETS.mapBackground), { width: 4096, height: 3072 });
  assert.deepEqual(fitImageSize(3000, 6000, IMAGE_PRESETS.mapImage), { width: 1024, height: 2048 });
  assert.ok(IMAGE_PRESETS.mapBackground.width >= 4096, "backgrounds stay sharp when zoomed");
});

test("empty or broken sizes don't divide by zero", () => {
  assert.deepEqual(fitImageSize(0, 0, IMAGE_PRESETS.portrait), { width: 0, height: 0 });
  assert.deepEqual(fitImageSize(NaN, 10, IMAGE_PRESETS.portrait), { width: 0, height: 0 });
});

test("GIFs are left alone so they keep animating; other raster types are resized", () => {
  assert.equal(canResize("image/gif"), false);
  for (const t of ["image/png", "image/jpeg", "image/webp", "image/avif", "image/bmp"]) assert.equal(canResize(t), true);
  assert.equal(canResize("image/svg+xml"), false);
});

test("the resized file is used when it's smaller in size or bytes, otherwise the original", () => {
  const orig = { width: 512, height: 512, bytes: 100_000 };
  assert.equal(keepResized({ width: 4000, height: 3000, bytes: 4_000_000 }, { width: 683, height: 512, bytes: 60_000 }), true);
  assert.equal(keepResized(orig, { width: 512, height: 512, bytes: 40_000 }), true);
  assert.equal(keepResized(orig, { width: 512, height: 512, bytes: 95_000 }), false);
  assert.equal(keepResized(orig, { width: 512, height: 512, bytes: 0 }), false);
});

test("stored files get an extension matching their type", () => {
  assert.equal(extensionFor("image/webp"), "webp");
  assert.equal(extensionFor("image/jpeg"), "jpg");
  assert.equal(extensionFor("image/gif"), "gif");
});

test("a game's image is stored no bigger than its 1600×600 banner needs", () => {
  assert.deepEqual(fitImageSize(4000, 1500, IMAGE_PRESETS.gameCover), { width: 1600, height: 600 });
  assert.deepEqual(fitImageSize(4000, 3000, IMAGE_PRESETS.gameCover), { width: 1600, height: 1200 });
  // A small image is never stretched up.
  assert.deepEqual(fitImageSize(800, 300, IMAGE_PRESETS.gameCover), { width: 800, height: 300 });
});

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} ≈ ${b}`);

test("the framing box takes the shape the image is shown in", () => {
  assert.equal(frameAspect("portrait", 4000, 3000, 0), 1);
  assert.equal(frameAspect("photo", 4000, 3000, 0), 3 / 4);
  assert.equal(frameAspect("art", 100, 900, 0), 4 / 3);
  // A game's image is an 8:3 banner, whatever shape the photo is.
  assert.equal(frameAspect("gameCover", 3000, 4000, 0), 8 / 3);
  // Maps keep their own shape, turned with the image.
  assert.equal(frameAspect("mapBackground", 4000, 3000, 0), 4 / 3);
  assert.equal(frameAspect("mapBackground", 4000, 3000, 90), 3 / 4);
  assert.equal(frameAspect("mapImage", 4000, 3000, 270 + 10), 3 / 4);
});

test("at zoom 1 the image just covers the frame, turned or not", () => {
  near(coverScale(4000, 3000, 0, 1, 1), 1 / 3000);
  near(coverScale(4000, 3000, 90, 1, 1), 1 / 3000);
  // Tilted 45°, a square frame needs √2 times more picture.
  near(coverScale(1000, 1000, 45, 1, 1), Math.SQRT2 / 1000);
});

test("framing can't move the picture off the frame or zoom out past filling it", () => {
  const c = clampCrop({ rotation: 0, zoom: 1, cx: 0, cy: 0 }, 4000, 3000, 1);
  assert.deepEqual(c, { rotation: 0, zoom: 1, cx: 1500, cy: 1500 });
  const right = clampCrop({ rotation: 0, zoom: 1, cx: 99999, cy: 1500 }, 4000, 3000, 1);
  assert.equal(right.cx, 2500);
  assert.equal(clampCrop({ rotation: 0, zoom: 0.2, cx: 2000, cy: 1500 }, 4000, 3000, 1).zoom, 1);
  assert.equal(clampCrop({ rotation: 0, zoom: 99, cx: 2000, cy: 1500 }, 4000, 3000, 1).zoom, MAX_ZOOM);
  // Zoomed in 2×, the frame shows 1500px of picture, so its center can go to 750px from an edge.
  const zoomed = clampCrop({ rotation: 0, zoom: 2, cx: 0, cy: 0 }, 4000, 3000, 1);
  assert.equal(zoomed.cx, 750);
  assert.equal(zoomed.cy, 750);
});

test("a turned picture's center is clamped along its own axes", () => {
  // Turned a quarter, a 4:3 frame over a 4000×3000 photo in portrait orientation: 3000 wide on screen.
  const c = clampCrop({ rotation: 90, zoom: 1, cx: 0, cy: 0 }, 4000, 3000, 1);
  assert.equal(c.cy, 1500);
  assert.equal(c.cx, 1500);
  // Tilted, the centered default stays valid.
  const t = clampCrop({ rotation: 20, ...{ zoom: 1, cx: 500, cy: 500 } }, 1000, 1000, 1);
  near(t.cx, 500);
  near(t.cy, 500);
});

test("the default framing matches the old crop: centered, filling the frame", () => {
  assert.deepEqual(defaultCrop(4000, 3000), { rotation: 0, zoom: 1, cx: 2000, cy: 1500 });
  assert.deepEqual(croppedSize(4032, 3024, defaultCrop(4032, 3024), 1, "portrait"), { width: 512, height: 512 });
  assert.deepEqual(croppedSize(4032, 3024, defaultCrop(4032, 3024), 3 / 4, "photo"), { width: 432, height: 576 });
  assert.deepEqual(croppedSize(6000, 4500, defaultCrop(6000, 4500), 4 / 3, "mapBackground"), { width: 4096, height: 3072 });
});

test("zooming into a small picture stores only the pixels it has, never scaled up", () => {
  // A 600px square portrait zoomed 3×: the frame covers 200 source pixels.
  assert.deepEqual(croppedSize(600, 600, { rotation: 0, zoom: 3, cx: 300, cy: 300 }, 1, "portrait"), { width: 200, height: 200 });
  // A map cropped 2× keeps its shape and half its width.
  assert.deepEqual(croppedSize(2000, 1000, { rotation: 0, zoom: 2, cx: 1000, cy: 500 }, 2, "mapBackground"), { width: 1000, height: 500 });
});
