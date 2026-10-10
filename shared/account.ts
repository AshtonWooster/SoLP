// Account settings: each person's display name and the look of the app on their devices.

/** "classic" is the original look, so accounts that never pick a theme see no change. */
export const THEMES = ["classic", "library", "reception"] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = "classic";

export const THEME_INFO: Record<ThemeId, { name: string; description: string }> = {
  classic: { name: "Classic", description: "The original SoLP look." },
  library: { name: "Library Hall", description: "Warm umber and gold leaf, small caps, Pages as parchment." },
  reception: { name: "Reception", description: "Steel black with cut corners and Pages that glow by rarity." },
};

/** Any stored value, made safe: unknown or missing themes fall back to Classic. */
export function themeOf(value: unknown): ThemeId {
  return THEMES.includes(value as ThemeId) ? (value as ThemeId) : DEFAULT_THEME;
}

export const MAX_NAME = 32;

/** Trims and collapses spaces; the same limit the signup form and security rules use. */
export function cleanDisplayName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

/** Why a display name can't be saved, or "" when it can. */
export function displayNameError(name: string): string {
  const clean = cleanDisplayName(name);
  if (!clean) return "Enter a display name.";
  if (name.replace(/\s+/g, " ").trim().length > MAX_NAME) return `Keep it to ${MAX_NAME} characters.`;
  return "";
}
