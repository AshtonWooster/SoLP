// Status effects as icons: the character preview, the player's effects bar and Cycle Characters.
// Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { blankEffect, cleanEffect, copyEffect, effectLibrary, PRESET_EFFECTS } from "../shared/effects.ts";
import { cleanIcon, effectDetailLines, effectInitials, effectLabel, nameHue, statusIconInfo } from "../shared/statusIcons.ts";

const ICON = "https://firebasestorage.googleapis.com/v0/b/demo/o/games%2Fg%2Fassets%2Feffect-icons%2Fa.png?alt=media";
const library = effectLibrary({
  custom: { ...blankEffect("status"), name: "Dark Flame", icon: ICON },
  plain: { ...blankEffect("status"), name: "Haste" },
  variant: { ...copyEffect(PRESET_EFFECTS["preset:burn"], "Burn (variant)") },
});

test("built-in statuses get their drawn glyph", () => {
  for (const id of ["burn", "rupture", "poise", "bleed", "strength", "feeble", "endurance"]) {
    assert.equal(statusIconInfo({ name: PRESET_EFFECTS[`preset:${id}`].name, defId: `preset:${id}` }, library).glyph, id);
  }
});

test("a variant still named like a built-in keeps its glyph", () => {
  assert.equal(statusIconInfo({ name: "Burn (variant)", defId: "variant" }, library).glyph, "burn");
  // A hand-tracked note named Bleed looks like Bleed too.
  assert.equal(statusIconInfo({ name: "bleed" }, library).glyph, "bleed");
});

test("an effect's own picture wins over the glyph and initials", () => {
  const info = statusIconInfo({ name: "Dark Flame", defId: "custom" }, library);
  assert.equal(info.image, ICON);
  assert.equal(info.glyph, undefined);
});

test("effects with no picture or glyph fall back to their initials on a color from the name", () => {
  const info = statusIconInfo({ name: "Haste", defId: "plain" }, library);
  assert.equal(info.image, undefined);
  assert.equal(info.glyph, undefined);
  assert.equal(info.initials, "H");
  assert.equal(info.hue, nameHue("Haste"));
  assert.equal(statusIconInfo({ name: "" }, library).name, "Effect");
});

test("the library's current name is shown over the copy on the token", () => {
  assert.equal(statusIconInfo({ name: "Old name", defId: "plain" }, library).name, "Haste");
});

test("initials take the first letters of the first two words", () => {
  assert.equal(effectInitials("Burn"), "B");
  assert.equal(effectInitials("dark flame of ruin"), "DF");
  assert.equal(effectInitials("  "), "?");
  assert.equal(effectInitials("- Smoke"), "S");
});

test("the same name always gets the same hue, within 0-359", () => {
  assert.equal(nameHue("Smoke"), nameHue(" smoke "));
  for (const n of ["a", "Burn", "Charge", "Ζωή"]) assert.ok(nameHue(n) >= 0 && nameHue(n) < 360);
});

test("only https links are kept as icons", () => {
  assert.equal(cleanIcon(ICON), ICON);
  assert.equal(cleanIcon("javascript:alert(1)"), undefined);
  assert.equal(cleanIcon("http://example.com/a.png"), undefined);
  assert.equal(cleanIcon("https://example.com/a b.png"), undefined);
  assert.equal(cleanIcon(42), undefined);
  assert.equal(cleanIcon("https://x/" + "a".repeat(2000)), undefined);
});

test("saving an effect keeps a status effect's icon and drops it from other kinds", () => {
  assert.equal(cleanEffect({ ...blankEffect("status"), name: "S", icon: ICON }).icon, ICON);
  assert.equal(cleanEffect({ ...blankEffect("status"), name: "S", icon: "data:image/png;base64,xx" }).icon, undefined);
  assert.equal(cleanEffect({ ...blankEffect("passive"), name: "P", icon: ICON }).icon, undefined);
  // Effects saved before icons existed come back the same.
  assert.equal("icon" in cleanEffect({ ...blankEffect("status"), name: "S" }), false);
});

test("details and labels say the stacks, duration and stacks still to come", () => {
  assert.deepEqual(effectDetailLines({ duration: "until end of next turn", pending: 2 }), ["until end of next turn", "+2 next round"]);
  assert.deepEqual(effectDetailLines({}), []);
  assert.equal(effectLabel({ name: "Burn", count: 3, pending: 2 }), "Burn, 3 stacks, +2 next round");
  assert.equal(effectLabel({ name: "", count: 1 }), "Effect, 1 stack");
});
