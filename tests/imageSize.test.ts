// Shrinking uploaded images to the size they're shown at. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { IMAGE_PRESETS, canResize, extensionFor, fitImageSize, keepResized } from "../src/imageSize.ts";

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
