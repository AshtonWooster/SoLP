// How a status effect looks as an icon: the picture the GM gave it, a drawn glyph for the built-in
// statuses, or its initials on a color from its name, so every effect on a character has an icon.
import type { EffectDef } from "./effects.ts";
import type { Effect } from "./types.ts";

/** The drawn glyphs, one per built-in status (shared/effects.ts PRESET_EFFECTS). */
export const STATUS_GLYPHS = ["burn", "rupture", "poise", "bleed", "strength", "feeble", "endurance"] as const;
export type StatusGlyph = (typeof STATUS_GLYPHS)[number];

export interface StatusIconInfo {
  /** The effect's name, or "Effect" for an unnamed note. */
  name: string;
  /** The picture the GM (or the player who made the effect) gave it. */
  image?: string;
  /** A built-in status, or a variant still named like one: its drawn glyph. */
  glyph?: StatusGlyph;
  /** One or two letters, for effects with neither. */
  initials: string;
  /** A hue (0-359) from the name, so the same effect always gets the same color. */
  hue: number;
}

/** Only https download links are kept as icons; anything else is dropped. */
export function cleanIcon(raw: unknown): string | undefined {
  return typeof raw === "string" && /^https:\/\/\S+$/.test(raw) && raw.length <= 2000 ? raw : undefined;
}

/** "Burn" → "B", "Dark Flame" → "DF", "" → "?". */
export function effectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return "?";
  const first = (w: string) => w.match(/[\p{L}\p{N}]/u)![0].toUpperCase();
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[1]);
}

/** A stable hue for a name. */
export function nameHue(name: string): number {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

function glyphFor(defId: string | undefined, name: string): StatusGlyph | undefined {
  const fromId = defId?.startsWith("preset:") ? defId.slice("preset:".length) : undefined;
  if (fromId && (STATUS_GLYPHS as readonly string[]).includes(fromId)) return fromId as StatusGlyph;
  // A variant keeps its look while it keeps the name: "Burn (variant)" is still a flame.
  const byName = name.trim().toLowerCase().replace(/\s*\(.*\)$/, "");
  return (STATUS_GLYPHS as readonly string[]).includes(byName) ? (byName as StatusGlyph) : undefined;
}

/** What to draw for an effect on a character, looked up in the game's library by its defId. */
export function statusIconInfo(effect: Pick<Effect, "name" | "defId">, library: Record<string, EffectDef>): StatusIconInfo {
  const def = effect.defId ? library[effect.defId] : undefined;
  const name = def?.name || effect.name || "Effect";
  const image = cleanIcon(def?.icon);
  return { name, image, glyph: image ? undefined : glyphFor(effect.defId, name), initials: effectInitials(name), hue: nameHue(name) };
}

/** The lines under an effect's name in its details: how long it lasts and stacks still to come. */
export function effectDetailLines(effect: Pick<Effect, "duration" | "pending">): string[] {
  const lines: string[] = [];
  if (effect.duration) lines.push(effect.duration);
  if (effect.pending) lines.push(`+${effect.pending} next round`);
  return lines;
}

/** The icon's accessible name: "Burn, 3 stacks, +2 next round". */
export function effectLabel(effect: Pick<Effect, "name" | "count" | "pending">): string {
  const name = effect.name || "Effect";
  const stacks = `${effect.count} ${effect.count === 1 ? "stack" : "stacks"}`;
  return [name, stacks, effect.pending ? `+${effect.pending} next round` : ""].filter(Boolean).join(", ");
}
