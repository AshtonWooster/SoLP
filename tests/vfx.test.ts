// VFX for status effects (shared/vfx.ts). Run with `npm run test:engine`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiceKind, Page } from "../shared/character.ts";
import { applyAction, type Actor, type EngineContext, type Loadout } from "../shared/engine.ts";
import { MAX_PROCS, recordProc } from "../shared/combat.ts";
import { tableForPlayers } from "../shared/secrets.ts";
import type { Effect, GameDoc, TableState, Token } from "../shared/types.ts";
import {
  blankVfx,
  cleanGlyph,
  cleanVfx,
  copyVfx,
  FULL_STACKS,
  gainedStatuses,
  linkStatus,
  lostStatuses,
  newProcs,
  PLAY_OPTIONS,
  vfxPlaying,
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

test("a VFX plays in one of four ways; anything else saved reads as 'the whole time'", () => {
  assert.deepEqual(PLAY_OPTIONS.map((p) => p.value), ["loop", "gain", "proc", "end"]);
  for (const play of ["gain", "proc", "end"] as const) assert.equal(cleanVfx({ ...vfx("x", []), play }).play, play);
  assert.equal(cleanVfx({ ...vfx("x", []), play: "sometimes" }).play, "loop");
});

test("several VFX on one status effect: looping ones play together, the others only on their moment", () => {
  const byStatus = vfxByStatus({
    flames: vfx("Flames", ["preset:burn"]),
    embers: vfx("Embers", ["preset:burn"]),
    flare: vfx("Flare", ["preset:burn"], { play: "proc" }),
    puff: vfx("Puff", ["preset:burn"], { play: "end" }),
    spark: vfx("Spark", ["preset:burn"], { play: "gain" }),
  });
  assert.deepEqual(tokenVfx([fx("preset:burn", 3)], byStatus).map((v) => v.id).sort(), ["embers", "flames"]);
  assert.deepEqual(vfxPlaying(["preset:burn"], byStatus, "proc").map((v) => v.id), ["flare"]);
  assert.deepEqual(vfxPlaying(["preset:burn"], byStatus, "end").map((v) => v.id), ["puff"]);
  assert.deepEqual(vfxPlaying(["preset:burn"], byStatus, "gain").map((v) => v.id), ["spark"]);
  assert.deepEqual(vfxPlaying(["preset:poise"], byStatus, "proc"), []);
});

test("'When it wears off' plays for Effects that came off, not ones that only lost stacks", () => {
  assert.deepEqual(lostStatuses([fx("preset:burn", 2)], []), ["preset:burn"]);
  assert.deepEqual(lostStatuses([fx("preset:burn", 2)], [fx("preset:burn", 1)]), []);
  assert.deepEqual(lostStatuses([], [fx("preset:burn", 1)]), []);
});

test("screens play only the Effects that went off since they last looked", () => {
  const procs = [
    { id: 1, tokenId: "a", defId: "preset:burn" },
    { id: 2, tokenId: "a", defId: "preset:poise" },
    { id: 3, tokenId: "b", defId: "preset:burn" },
  ];
  const fired = newProcs(procs, 1);
  assert.deepEqual([...fired.get("a")!], ["preset:poise"]);
  assert.deepEqual([...fired.get("b")!], ["preset:burn"]);
  assert.equal(newProcs(procs, 3).size, 0);
  assert.equal(newProcs(undefined, 0).size, 0);
});

// ---- Effects going off in combat ----

const gm: { uid: string; role: "gm"; displayName: string } = { uid: "gm", role: "gm", displayName: "GM" };
const p1: Actor = { uid: "p1", role: "player", displayName: "P1" };
const die = (kind: DiceKind, fp: number) => ({ id: `d${kind}${fp}`, kind, counter: false, sides: 1, basePower: fp - 1 });
const slash: Page = { id: "slash", name: "Slash", kind: "basic", cost: 0, type: "melee", dice: [die("slash", 5)], effect: "" };
const tok = (id: string, side: Token["side"], x: number, extra: Partial<Token> = {}): Token => ({
  id, name: id, side, x, y: 2, color: "#fff",
  resources: { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 5, sanity: 0, maxSanity: 15 },
  ...extra,
});

function combat(roland: Partial<Token>, rat: Partial<Token> = {}) {
  const table: TableState = {
    map: { name: "m", width: 16, height: 10 },
    tokens: { roland: tok("roland", "player", 2, { ownerId: "p1", justice: 100, ...roland }), rat: tok("rat", "enemy", 3, { justice: -100, pages: [slash], ...rat }) },
    log: [],
  };
  const loadout: Loadout = { pages: { slash }, deck: Array(12).fill("slash"), aux: [], stats: { justice: 4 } } as Loadout;
  const ctx: EngineContext = { loadout: (id) => (id === "roland" ? loadout : undefined) };
  applyAction(table, { type: "startCombat", tokenIds: ["roland", "rat"] }, gm, ctx);
  return { table, endTurn: (who: Actor = gm) => applyAction(table, { type: "endTurn" }, who, ctx) };
}

test("a status Effect going off in combat is recorded for its 'When it goes off' VFX", () => {
  const s = combat({ effects: [fx("preset:burn", 5)] });
  assert.equal(s.table.combat!.procs, undefined, "nothing has gone off yet");
  s.endTurn(p1);
  assert.deepEqual(s.table.combat!.procs, [{ id: 1, tokenId: "roland", defId: "preset:burn" }]);
  assert.equal(s.table.combat!.procSeq, 1);
  s.endTurn(); // The Rat's turn: Roland's Burn doesn't go off.
  assert.equal(s.table.combat!.procs!.length, 1);
  s.endTurn(p1);
  assert.deepEqual(s.table.combat!.procs!.map((p) => p.id), [1, 2]);
});

test("only the latest Effects going off are kept", () => {
  const s = combat({});
  const c = s.table.combat!;
  for (let i = 0; i < MAX_PROCS + 4; i++) recordProc(c, "roland", "preset:burn");
  assert.equal(c.procs!.length, MAX_PROCS);
  assert.equal(c.procs!.at(-1)!.id, MAX_PROCS + 4);
  assert.equal(c.procs![0].id, 5);
});

test("players aren't told an Effect went off on a character whose Effects the GM keeps secret", () => {
  const s = combat({}, { effects: [fx("preset:burn", 5)], secret: { effects: true } } as Partial<Token>);
  s.endTurn(p1);
  s.endTurn();
  assert.ok(s.table.combat!.procs!.some((p) => p.tokenId === "rat"), "the GM's screen gets it");
  assert.ok(!tableForPlayers(s.table).combat!.procs!.some((p) => p.tokenId === "rat"));
});
