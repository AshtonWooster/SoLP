// Account settings: themes and display names. Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanDisplayName, DEFAULT_THEME, displayNameError, MAX_NAME, THEME_INFO, THEMES, themeOf } from "../shared/account.ts";

test("accounts that never picked a theme keep the original Classic look", () => {
  assert.equal(DEFAULT_THEME, "classic");
  assert.equal(themeOf(undefined), "classic");
  assert.equal(themeOf(null), "classic");
});

test("both Library of Ruina themes can be picked; anything else falls back to Classic", () => {
  assert.deepEqual([...THEMES], ["classic", "library", "reception"]);
  assert.equal(themeOf("library"), "library");
  assert.equal(themeOf("reception"), "reception");
  assert.equal(themeOf("neon"), "classic");
  assert.equal(themeOf(3), "classic");
  for (const t of THEMES) assert.ok(THEME_INFO[t].name && THEME_INFO[t].description);
});

test("display names are trimmed, single-spaced and capped like signup", () => {
  assert.equal(cleanDisplayName("  Roland   the  Black "), "Roland the Black");
  assert.equal(cleanDisplayName("x".repeat(40)).length, MAX_NAME);
});

test("display names must be present and at most 32 characters", () => {
  assert.equal(displayNameError("Angela"), "");
  assert.equal(displayNameError("   "), "Enter a display name.");
  assert.equal(displayNameError("x".repeat(33)), "Keep it to 32 characters.");
  assert.equal(displayNameError(` ${"x".repeat(32)} `), "");
});
