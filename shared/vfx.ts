// VFX: looks the GM builds in the VFX editor and plays on the map while a status Effect is on a
// character (flames for Burn, a blue glow for Shield…). Each VFX is a small stack of layers drawn
// with CSS around the token, saved as a few numbers and colors, never as images or video.
//
// Firestore: games/{gameId}/vfx/{id}  VfxDef  members read; GM write.
// A VFX lists the status Effects it plays on by library id (built-in ones too), so changing a VFX
// changes it everywhere it plays, and an Effect with no VFX looks exactly as it did before.

import { newId } from "./id.ts";
import type { Effect, GameDoc } from "./types.ts";

export type VfxLayerType = "aura" | "particles" | "tint" | "icon" | "motion";
export type AuraStyle = "glow" | "ripple" | "ring";
export type ParticleShape = "dot" | "spark" | "flame" | "bubble" | "star" | "drop" | "glyph";
export type ParticleFlow = "rise" | "fall" | "orbit" | "burst" | "swirl";
export type TintStyle = "steady" | "pulse" | "flicker";
export type MotionKind = "shake" | "bob" | "sway" | "throb";
export type IconSpot = "top" | "topRight" | "bottomRight" | "center";

/** One piece of a VFX. Which fields matter depends on the type. */
export interface VfxLayer {
  id: string;
  type: VfxLayerType;
  /** "#rrggbb". */
  color: string;
  /** Particles: a second color, mixed in with the first. */
  color2?: string;
  /** 1 is normal; 0.25 to 3. */
  size: number;
  /** 1 is normal; 0.25 (slow) to 3 (fast). */
  speed: number;
  /** 0.1 (faint) to 1 (solid). */
  opacity: number;
  /** Particles: how many at once (at full stacks when the VFX grows with stacks). */
  count?: number;
  aura?: AuraStyle;
  shape?: ParticleShape;
  flow?: ParticleFlow;
  tint?: TintStyle;
  motion?: MotionKind;
  /** Icons, and particles shaped "glyph": a character or emoji. */
  glyph?: string;
  spot?: IconSpot;
}

export interface VfxDef {
  name: string;
  /** Drawn in order: later layers on top. */
  layers: VfxLayer[];
  /** The status Effects (library ids) it plays on. */
  statuses: string[];
  /** "loop": the whole time the Effect is on. "gain": once, each time the Effect is gained or gains stacks. */
  play: "loop" | "gain";
  /** More stacks: more particles and a stronger look, up to FULL_STACKS. */
  scaleWithStacks?: boolean;
  updatedAt?: number;
}

export const MAX_LAYERS = 6;
export const MAX_PARTICLES = 24;
export const MAX_STATUSES = 40;
/** A token plays at most this many VFX at once, so a pile of Effects can't slow the board down. */
export const MAX_VFX_PER_TOKEN = 3;
/** Stacks at which a VFX that grows with stacks looks its strongest. */
export const FULL_STACKS = 10;
/** How long a "When gained" VFX plays, at speed 1. */
export const GAIN_MS = 1600;

export const LAYER_TYPES: { value: VfxLayerType; label: string; hint: string }[] = [
  { value: "aura", label: "Aura", hint: "A glow or ring around the character" },
  { value: "particles", label: "Particles", hint: "Flames, sparks, bubbles or drops" },
  { value: "tint", label: "Tint", hint: "Colors the character" },
  { value: "icon", label: "Icon", hint: "A symbol or emoji on the token" },
  { value: "motion", label: "Motion", hint: "Makes the token shake, bob or throb" },
];
export const AURA_STYLES: { value: AuraStyle; label: string }[] = [
  { value: "glow", label: "Soft glow" },
  { value: "ripple", label: "Ripples" },
  { value: "ring", label: "Spinning ring" },
];
export const PARTICLE_SHAPES: { value: ParticleShape; label: string }[] = [
  { value: "dot", label: "Dots" },
  { value: "spark", label: "Sparks" },
  { value: "flame", label: "Flames" },
  { value: "bubble", label: "Bubbles" },
  { value: "star", label: "Stars" },
  { value: "drop", label: "Drops" },
  { value: "glyph", label: "Symbol" },
];
export const PARTICLE_FLOWS: { value: ParticleFlow; label: string }[] = [
  { value: "rise", label: "Rise" },
  { value: "fall", label: "Fall" },
  { value: "orbit", label: "Circle around" },
  { value: "burst", label: "Burst out" },
  { value: "swirl", label: "Swirl up" },
];
export const TINT_STYLES: { value: TintStyle; label: string }[] = [
  { value: "steady", label: "Steady" },
  { value: "pulse", label: "Pulsing" },
  { value: "flicker", label: "Flickering" },
];
export const MOTIONS: { value: MotionKind; label: string }[] = [
  { value: "shake", label: "Shake" },
  { value: "bob", label: "Bob" },
  { value: "sway", label: "Sway" },
  { value: "throb", label: "Throb" },
];
export const ICON_SPOTS: { value: IconSpot; label: string }[] = [
  { value: "top", label: "Above" },
  { value: "topRight", label: "Top corner" },
  { value: "bottomRight", label: "Bottom corner" },
  { value: "center", label: "Middle" },
];

/** Whether the GM turned on "Status effect VFX" in Game settings. Off: nothing loads or plays at the table. */
export function statusVfxOn(game: GameDoc | undefined): boolean {
  return game?.settings?.statusVfx === true;
}

// ---- Making and cleaning ----

/** A new layer of a type, with a look that works straight away. */
export function newLayer(type: VfxLayerType, color = "#ff8a3d"): VfxLayer {
  const base: VfxLayer = { id: newId(), type, color, size: 1, speed: 1, opacity: 0.8 };
  switch (type) {
    case "aura":
      return { ...base, aura: "glow" };
    case "particles":
      return { ...base, shape: "dot", flow: "rise", count: 8, opacity: 0.9 };
    case "tint":
      return { ...base, tint: "pulse", opacity: 0.35 };
    case "icon":
      return { ...base, glyph: "✦", spot: "topRight", opacity: 1 };
    case "motion":
      return { ...base, motion: "shake" };
  }
}

export function blankVfx(name = "New VFX"): VfxDef {
  return { name, layers: [newLayer("aura")], statuses: [], play: "loop" };
}

const oneOf = <T extends string>(v: unknown, options: { value: T }[], d: T): T => options.find((o) => o.value === v)?.value ?? d;
const num = (v: unknown, min: number, max: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : d;
};
const HEX = /^#[0-9a-f]{6}$/i;
const color = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : d);
/** At most 2 characters as people see them: one emoji (even a joined one) or two letters. */
export function cleanGlyph(v: unknown, d = "✦"): string {
  const s = String(v ?? "").trim();
  if (!s) return d;
  const parts =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(new Intl.Segmenter().segment(s), (x) => x.segment)
      : Array.from(s);
  return parts.slice(0, 2).join("").trim().slice(0, 16) || d;
}

function cleanLayer(raw: unknown): VfxLayer {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<VfxLayer>;
  const type = oneOf(r.type, LAYER_TYPES, "aura");
  const l: VfxLayer = {
    id: String(r.id || newId()).slice(0, 40),
    type,
    color: color(r.color, "#ff8a3d"),
    size: num(r.size, 0.25, 3, 1),
    speed: num(r.speed, 0.25, 3, 1),
    opacity: num(r.opacity, 0.1, 1, 0.8),
  };
  if (type === "aura") l.aura = oneOf(r.aura, AURA_STYLES, "glow");
  if (type === "particles") {
    l.shape = oneOf(r.shape, PARTICLE_SHAPES, "dot");
    l.flow = oneOf(r.flow, PARTICLE_FLOWS, "rise");
    l.count = Math.round(num(r.count, 1, MAX_PARTICLES, 8));
    if (r.color2 && HEX.test(String(r.color2))) l.color2 = color(r.color2, l.color);
    if (l.shape === "glyph") l.glyph = cleanGlyph(r.glyph);
  }
  if (type === "tint") l.tint = oneOf(r.tint, TINT_STYLES, "pulse");
  if (type === "icon") {
    l.glyph = cleanGlyph(r.glyph);
    l.spot = oneOf(r.spot, ICON_SPOTS, "topRight");
  }
  if (type === "motion") l.motion = oneOf(r.motion, MOTIONS, "shake");
  return l;
}

/** A VFX as it may be saved: only known pieces, sensible numbers, and limits on size. */
export function cleanVfx(raw: unknown): VfxDef {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<VfxDef>;
  const layers = (Array.isArray(r.layers) ? r.layers : []).slice(0, MAX_LAYERS).map(cleanLayer);
  // One motion at a time: two would fight over the token.
  const firstMotion = layers.findIndex((l) => l.type === "motion");
  const def: VfxDef = {
    name: String(r.name ?? "").slice(0, 60),
    layers: layers.filter((l, i) => l.type !== "motion" || i === firstMotion),
    statuses: [...new Set((Array.isArray(r.statuses) ? r.statuses : []).map((s) => String(s).slice(0, 80)).filter(Boolean))].slice(0, MAX_STATUSES),
    play: r.play === "gain" ? "gain" : "loop",
  };
  if (r.scaleWithStacks === true) def.scaleWithStacks = true;
  if (r.updatedAt) def.updatedAt = Number(r.updatedAt) || 0;
  return def;
}

/** A copy to change without touching the original: new layer ids, and it plays on nothing yet. */
export function copyVfx(def: VfxDef, name = `${def.name} (copy)`): VfxDef {
  return cleanVfx({ ...def, name: name.slice(0, 60), statuses: [], layers: def.layers.map((l) => ({ ...l, id: newId() })) });
}

/** Turns playing on one status Effect on or off. */
export function linkStatus(def: VfxDef, statusId: string, on: boolean): VfxDef {
  const has = def.statuses.includes(statusId);
  if (on === has) return def;
  if (on && def.statuses.length >= MAX_STATUSES) return def;
  return { ...def, statuses: on ? [...def.statuses, statusId] : def.statuses.filter((s) => s !== statusId) };
}

/** Moves a layer one place up (later, drawn on top) or down. */
export function moveLayer(def: VfxDef, layerId: string, dir: -1 | 1): VfxDef {
  const i = def.layers.findIndex((l) => l.id === layerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= def.layers.length) return def;
  const layers = [...def.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...def, layers };
}

// ---- Starting points ----

const L = (type: VfxLayerType, extra: Partial<VfxLayer>): VfxLayer => ({ ...newLayer(type), ...extra });

/** Ready-made looks to start from in the VFX editor. Picking one copies it into the game's library. */
export const VFX_TEMPLATES: { key: string; name: string; make: () => VfxDef }[] = [
  {
    key: "flames",
    name: "Flames",
    make: () => ({
      name: "Flames",
      play: "loop",
      scaleWithStacks: true,
      statuses: [],
      layers: [
        L("aura", { aura: "glow", color: "#ff6a1a", opacity: 0.6 }),
        L("particles", { shape: "flame", flow: "rise", color: "#ff8a3d", color2: "#ffd23d", count: 14, speed: 1.2, size: 1.5 }),
      ],
    }),
  },
  {
    key: "bleed",
    name: "Bleeding",
    make: () => ({
      name: "Bleeding",
      play: "loop",
      scaleWithStacks: true,
      statuses: [],
      layers: [L("particles", { shape: "drop", flow: "fall", color: "#c1121f", color2: "#7a0b12", count: 6, speed: 0.8 }), L("tint", { tint: "pulse", color: "#c1121f", opacity: 0.25 })],
    }),
  },
  {
    key: "frost",
    name: "Frost",
    make: () => ({
      name: "Frost",
      play: "loop",
      statuses: [],
      layers: [
        L("tint", { tint: "steady", color: "#8fd8ff", opacity: 0.3 }),
        L("particles", { shape: "glyph", glyph: "❄", flow: "fall", color: "#dff4ff", count: 6, speed: 0.6, size: 0.8 }),
      ],
    }),
  },
  {
    key: "poison",
    name: "Poison",
    make: () => ({
      name: "Poison",
      play: "loop",
      scaleWithStacks: true,
      statuses: [],
      layers: [L("particles", { shape: "bubble", flow: "rise", color: "#7bd64a", color2: "#b05cff", count: 8, speed: 0.7 }), L("tint", { tint: "pulse", color: "#5fbf2f", opacity: 0.3 })],
    }),
  },
  {
    key: "shield",
    name: "Shield",
    make: () => ({ name: "Shield", play: "loop", statuses: [], layers: [L("aura", { aura: "ring", color: "#63b8ff", opacity: 0.9, size: 1.1 }), L("aura", { aura: "glow", color: "#63b8ff", opacity: 0.5 })] }),
  },
  {
    key: "charge",
    name: "Charge",
    make: () => ({
      name: "Charge",
      play: "loop",
      scaleWithStacks: true,
      statuses: [],
      layers: [L("particles", { shape: "spark", flow: "orbit", color: "#ffe14d", color2: "#ffffff", count: 6, speed: 1.6 }), L("motion", { motion: "shake", size: 0.5 })],
    }),
  },
  {
    key: "sparkle",
    name: "Blessing",
    make: () => ({ name: "Blessing", play: "loop", statuses: [], layers: [L("particles", { shape: "star", flow: "swirl", color: "#ffe9a8", color2: "#fff7e0", count: 8, speed: 0.8 }), L("aura", { aura: "glow", color: "#ffd86b", opacity: 0.45 })] }),
  },
  {
    key: "hit",
    name: "Impact burst",
    make: () => ({ name: "Impact burst", play: "gain", statuses: [], layers: [L("particles", { shape: "spark", flow: "burst", color: "#ffffff", color2: "#ff5a5a", count: 14, speed: 1.4 }), L("aura", { aura: "ripple", color: "#ff5a5a" })] }),
  },
  {
    key: "dread",
    name: "Dread",
    make: () => ({ name: "Dread", play: "loop", statuses: [], layers: [L("tint", { tint: "flicker", color: "#2b0a3d", opacity: 0.45 }), L("particles", { shape: "dot", flow: "rise", color: "#3a1a4f", color2: "#000000", count: 10, size: 1.6, speed: 0.5, opacity: 0.6 }), L("motion", { motion: "sway", size: 0.6 })] }),
  },
];

// ---- At the table ----

/** The game's VFX by the status Effect they play on: library id → VFX, by name. */
export function vfxByStatus(library: Record<string, VfxDef> | undefined): Map<string, { id: string; def: VfxDef }[]> {
  const out = new Map<string, { id: string; def: VfxDef }[]>();
  for (const [id, raw] of Object.entries(library ?? {}).sort((a, b) => (a[1].name ?? "").localeCompare(b[1].name ?? "") || a[0].localeCompare(b[0]))) {
    const def = cleanVfx(raw);
    if (def.layers.length === 0) continue;
    for (const s of def.statuses) {
      const list = out.get(s) ?? [];
      list.push({ id, def });
      out.set(s, list);
    }
  }
  return out;
}

export interface TokenVfx {
  /** The VFX's id. */
  id: string;
  def: VfxDef;
  /** The most stacks among the Effects it plays for. */
  stacks: number;
}

/** Stacks of each automated Effect on a character, by library id (stacks from several givers add up). */
export function stacksByStatus(effects: Effect[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of effects ?? []) if (e.defId && e.count > 0) out.set(e.defId, (out.get(e.defId) ?? 0) + e.count);
  return out;
}

/**
 * The VFX to play on a character for the Effects on it, each once even when several of its Effects
 * share it, in the order the Effects are listed; at most MAX_VFX_PER_TOKEN.
 */
export function tokenVfx(effects: Effect[] | undefined, byStatus: Map<string, { id: string; def: VfxDef }[]>): TokenVfx[] {
  if (byStatus.size === 0) return [];
  const out = new Map<string, TokenVfx>();
  for (const [statusId, stacks] of stacksByStatus(effects)) {
    for (const v of byStatus.get(statusId) ?? []) {
      const had = out.get(v.id);
      if (had) had.stacks = Math.max(had.stacks, stacks);
      else out.set(v.id, { id: v.id, def: v.def, stacks });
    }
  }
  return [...out.values()].slice(0, MAX_VFX_PER_TOKEN);
}

/** Effects (library ids) that are new on a character or have more stacks than before: "When gained" VFX play for these. */
export function gainedStatuses(before: Effect[] | undefined, after: Effect[] | undefined): string[] {
  const was = stacksByStatus(before);
  return [...stacksByStatus(after)].filter(([id, n]) => n > (was.get(id) ?? 0)).map(([id]) => id);
}

/** How strong a VFX looks at some stacks: 1 unless it grows with stacks, then from 0.4 at 1 stack to 1 at FULL_STACKS. */
export function stackStrength(def: VfxDef, stacks: number): number {
  if (!def.scaleWithStacks) return 1;
  const s = Math.min(FULL_STACKS, Math.max(1, Math.floor(stacks)));
  return Math.round((0.4 + (0.6 * (s - 1)) / (FULL_STACKS - 1)) * 100) / 100;
}

/** How many particles a layer shows at that strength (at least 1). */
export function particleCount(layer: VfxLayer, strength = 1): number {
  return Math.max(1, Math.min(MAX_PARTICLES, Math.round((layer.count ?? 8) * strength)));
}

/** A particle's place in its layer: the same every time it's drawn, so particles don't jump around on re-render. */
export interface ParticleSpot {
  /** Across the token, 0 to 1. */
  x: number;
  /** When it starts, as a share of one loop (0 to 1). */
  delay: number;
  /** Size, about 0.6 to 1.4 times the layer's. */
  scale: number;
  /** Sideways drift, -1 to 1. */
  drift: number;
  /** Direction for bursts and orbits, in degrees. */
  angle: number;
  /** Uses the layer's second color. */
  alt: boolean;
}

/** A small seeded random generator (mulberry32), so a layer's particles are always laid out the same. */
function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h << 13) | (h >>> 19);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where each of a layer's particles goes. Spread evenly, with a little randomness so it looks natural. */
export function particleSpots(layer: VfxLayer, n: number): ParticleSpot[] {
  const rand = seeded(layer.id);
  return Array.from({ length: n }, (_, i) => {
    const r = [rand(), rand(), rand(), rand(), rand()];
    return {
      x: Math.round(((i + 0.2 + r[0] * 0.6) / n) * 1000) / 1000,
      delay: Math.round(((i / n + r[1] * 0.3) % 1) * 1000) / 1000,
      scale: Math.round((0.6 + r[2] * 0.8) * 100) / 100,
      drift: Math.round((r[3] * 2 - 1) * 100) / 100,
      angle: Math.round((360 * i) / n + r[4] * 20),
      alt: !!layer.color2 && i % 2 === 1,
    };
  });
}

/** Seconds one loop of a layer takes at its speed. */
export function loopSeconds(layer: Pick<VfxLayer, "speed" | "type">): number {
  const base = layer.type === "particles" ? 2.4 : layer.type === "motion" ? 0.9 : 2;
  return Math.round((base / Math.max(0.25, layer.speed)) * 100) / 100;
}
