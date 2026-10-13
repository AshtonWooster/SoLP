// VFX for status effects (shared/vfx.ts). Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, GameDoc } from "../shared/types.ts";
import {
  blankVfx,
  cleanGlyph,
  cleanVfx,
  copyVfx,
  FULL_STACKS,
  gainedStatuses,
  linkStatus,
  MAX_LAYERS,
  MAX_PARTICLES,
  MAX_VFX_PER_TOKEN,
  moveLayer,
  newLayer,
  particleCount,
  particleSpots,
  stackStrength,
  statusVfxOn,
  tokenVfx,
  VFX_TEMPLATES,
  vfxByStatus,
  type VfxDef,
} from "../shared/vfx.ts";

const game = (settings?: GameDoc["settings"]): GameDoc => ({ name: "g", gmId: "gm", memberIds: ["gm"], members: {}, createdAt: 1, settings });
const fx = (defId: string, count: number, extra: Partial<Effect> = {}): Effect => ({ id: `${defId}-${count}`, name: defId, count, description: "", defId, ...extra });
const vfx = (name: string, statuses: string[], extra: Partial<VfxDef> = {}): VfxDef => ({ ...blankVfx(name), statuses, ...extra });

test("Status effect VFX is off by default, so existing games look the same", () => {
  assert.equal(statusVfxOn(undefined), false);
  assert.equal(statusVfxOn(game()), false);
  assert.equal(statusVfxOn(game({ emotionLevels: true })), false);
  assert.equal(statusVfxOn(game({ statusVfx: false })), false);
  assert.equal(statusVfxOn(game({ statusVfx: true })), true);
});

test("a status effect with no VFX plays nothing", () => {
  const byStatus = vfxByStatus({ a: vfx("Flames", ["preset:burn"]) });
  assert.deepEqual(tokenVfx([fx("preset:poise", 3)], byStatus), []);
  assert.deepEqual(tokenVfx(undefined, byStatus), []);
  // Notes the GM tracks by hand aren't library effects.
  assert.deepEqual(tokenVfx([{ id: "n", name: "Burn", count: 2, description: "" }], byStatus), []);
  assert.deepEqual(tokenVfx([fx("preset:burn", 3)], new Map()), []);
});

test("a VFX plays on every status effect it's linked to, once per character, with the most stacks", () => {
  const byStatus = vfxByStatus({ fire: vfx("Flames", ["preset:burn", "own:scorch"]) });
  const list = tokenVfx([fx("preset:burn", 2), fx("own:scorch", 5)], byStatus);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "fire");
  assert.equal(list[0].stacks, 5);
});

test("stacks from different givers add up (Marks)", () => {
  const byStatus = vfxByStatus({ mark: vfx("Mark", ["own:mark"]) });
  const list = tokenVfx([fx("own:mark", 2, { sourceId: "a" }), fx("own:mark", 3, { sourceId: "b", id: "x" })], byStatus);
  assert.equal(list[0].stacks, 5);
});

test("a character plays at most a few VFX at once", () => {
  const lib = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`v${i}`, vfx(`V${i}`, [`s${i}`])]));
  const list = tokenVfx(Array.from({ length: 6 }, (_, i) => fx(`s${i}`, 1)), vfxByStatus(lib));
  assert.equal(list.length, MAX_VFX_PER_TOKEN);
});

test("VFX with no layers play nothing", () => {
  const byStatus = vfxByStatus({ empty: vfx("Empty", ["preset:burn"], { layers: [] }) });
  assert.equal(byStatus.size, 0);
});

test("changing a VFX changes it everywhere it plays: status effects link to it by id", () => {
  let lib: Record<string, VfxDef> = { fire: vfx("Flames", ["preset:burn", "own:scorch"]) };
  lib = { fire: { ...lib.fire, layers: [newLayer("tint", "#0000ff")] } };
  const byStatus = vfxByStatus(lib);
  assert.equal(byStatus.get("preset:burn")![0].def.layers[0].type, "tint");
  assert.equal(byStatus.get("own:scorch")![0].def.layers[0].color, "#0000ff");
});

test("linking and unlinking status effects", () => {
  let d = vfx("Flames", []);
  d = linkStatus(d, "preset:burn", true);
  d = linkStatus(d, "preset:burn", true);
  assert.deepEqual(d.statuses, ["preset:burn"]);
  d = linkStatus(d, "own:scorch", true);
  d = linkStatus(d, "preset:burn", false);
  assert.deepEqual(d.statuses, ["own:scorch"]);
});

test("'When gained' VFX play for new Effects and added stacks, not for losing stacks", () => {
  assert.deepEqual(gainedStatuses([], [fx("preset:burn", 1)]), ["preset:burn"]);
  assert.deepEqual(gainedStatuses([fx("preset:burn", 1)], [fx("preset:burn", 3)]), ["preset:burn"]);
  assert.deepEqual(gainedStatuses([fx("preset:burn", 3)], [fx("preset:burn", 1)]), []);
  assert.deepEqual(gainedStatuses([fx("preset:burn", 3)], []), []);
  assert.deepEqual(gainedStatuses(undefined, undefined), []);
});

test("growing with stacks: weaker at 1 stack, full strength at FULL_STACKS, the same beyond", () => {
  const flat = vfx("Flat", []);
  assert.equal(stackStrength(flat, 1), 1);
  assert.equal(stackStrength(flat, 30), 1);
  const grow = { ...flat, scaleWithStacks: true };
  assert.equal(stackStrength(grow, 1), 0.4);
  assert.equal(stackStrength(grow, FULL_STACKS), 1);
  assert.equal(stackStrength(grow, 50), 1);
  assert.ok(stackStrength(grow, 5) > stackStrength(grow, 2));
  const p = { ...newLayer("particles"), count: 10 };
  assert.equal(particleCount(p, 1), 10);
  assert.equal(particleCount(p, 0.4), 4);
  assert.equal(particleCount({ ...p, count: 1 }, 0.4), 1);
});

test("particles are laid out the same every time, inside the token", () => {
  const p = { ...newLayer("particles"), id: "fixed", count: 12, color2: "#ffffff" };
  const a = particleSpots(p, 12);
  assert.deepEqual(a, particleSpots(p, 12));
  for (const s of a) {
    assert.ok(s.x >= 0 && s.x <= 1);
    assert.ok(s.delay >= 0 && s.delay < 1);
    assert.ok(s.scale >= 0.6 && s.scale <= 1.4);
  }
  assert.equal(a.filter((s) => s.alt).length, 6);
  assert.equal(particleSpots({ ...p, color2: undefined }, 4).filter((s) => s.alt).length, 0);
});

test("cleaning keeps a VFX small: known fields, numbers in range, limits on layers", () => {
  const raw = {
    name: "x".repeat(100),
    play: "sometimes",
    video: "data:video/mp4;base64,AAAA",
    statuses: ["a", "a", "", "b"],
    layers: [
      { type: "particles", color: "red", size: 99, speed: -1, opacity: 5, count: 500, shape: "glyph", glyph: "🔥🔥🔥🔥", flow: "sideways", junk: 1 },
      { type: "motion", motion: "shake" },
      { type: "motion", motion: "bob" },
      ...Array(10).fill({ type: "aura" }),
    ],
  };
  const d = cleanVfx(raw);
  assert.equal(d.name.length, 60);
  assert.equal(d.play, "loop");
  assert.ok(!("video" in d));
  assert.deepEqual(d.statuses, ["a", "b"]);
  assert.ok(d.layers.length <= MAX_LAYERS);
  assert.equal(d.layers.filter((l) => l.type === "motion").length, 1);
  const p = d.layers[0];
  assert.equal(p.color, "#ff8a3d");
  assert.equal(p.size, 3);
  assert.equal(p.speed, 0.25);
  assert.equal(p.opacity, 1);
  assert.equal(p.count, MAX_PARTICLES);
  assert.equal(p.flow, "rise");
  assert.equal(p.glyph, "🔥🔥");
  assert.ok(!("junk" in p));
  // Fields for other layer types aren't kept.
  assert.ok(!("motion" in p) && !("aura" in p));
  assert.equal(cleanVfx(null).layers.length, 0);
  assert.ok(JSON.stringify(cleanVfx(VFX_TEMPLATES[0].make())).length < 2000);
});

test("symbols keep a joined emoji whole", () => {
  assert.equal(cleanGlyph("❤️‍🔥 extra"), "❤️‍🔥");
  assert.equal(cleanGlyph(""), "✦");
  assert.equal(cleanGlyph("AB C"), "AB");
});

test("every ready-made look is valid and starts linked to nothing", () => {
  for (const t of VFX_TEMPLATES) {
    const d = t.make();
    assert.deepEqual(cleanVfx(d).layers.length, d.layers.length, t.name);
    assert.deepEqual(d.statuses, []);
    assert.equal(new Set(d.layers.map((l) => l.id)).size, d.layers.length, `${t.name}: layer ids are unique`);
  }
});

test("duplicating makes an unlinked copy with its own layer ids; moving layers changes drawing order", () => {
  const d = cleanVfx({ ...VFX_TEMPLATES[0].make(), statuses: ["preset:burn"] });
  const c = copyVfx(d);
  assert.equal(c.name, "Flames (copy)");
  assert.deepEqual(c.statuses, []);
  assert.ok(c.layers.every((l, i) => l.id !== d.layers[i].id && l.type === d.layers[i].type));
  const moved = moveLayer(d, d.layers[0].id, 1);
  assert.deepEqual(moved.layers.map((l) => l.type), [d.layers[1].type, d.layers[0].type]);
  assert.equal(moveLayer(d, d.layers[0].id, -1), d);
});
