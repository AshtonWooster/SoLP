// The cookie / device-storage choice each visitor makes in the banner.
// SoLP only stores what it needs to run (login, theme, a map-editor preference), which needs no
// consent. The one optional extra is loading theme fonts from Google Fonts, which sends the
// visitor's IP address to Google, so that waits for a yes.

/** Bump this when the banner asks about something new, so everyone is asked again. */
export const CONSENT_VERSION = 1;
export const CONSENT_KEY = "solp-consent";

export interface Consent {
  version: number;
  /** Load theme fonts from Google Fonts. Off means themes use the device's own fonts. */
  fonts: boolean;
  /** When the choice was made (ms since epoch). */
  decidedAt: number;
}

/** Reads a saved choice. Missing, unreadable or from an older banner → null, which shows the banner. */
export function parseConsent(raw: string | null | undefined): Consent | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<Consent>;
    if (c?.version !== CONSENT_VERSION || typeof c.fonts !== "boolean" || typeof c.decidedAt !== "number") return null;
    return { version: c.version, fonts: c.fonts, decidedAt: c.decidedAt };
  } catch {
    return null;
  }
}

export function makeConsent(fonts: boolean, now: number): Consent {
  return { version: CONSENT_VERSION, fonts, decidedAt: now };
}

/** Optional extras stay off until the visitor says yes. */
export function fontsAllowed(c: Consent | null): boolean {
  return c?.fonts === true;
}
