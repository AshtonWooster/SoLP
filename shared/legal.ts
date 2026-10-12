// The details the legal pages need that only the site's operator can supply.
// Anything still in [square brackets] is a placeholder: the pages highlight it until it's filled in.

export const LEGAL = {
  /** Who runs the site: a person's name or a company. */
  operator: "[OPERATOR NAME]",
  /** Where people send privacy requests and questions. */
  contactEmail: "[CONTACT EMAIL]",
  /** Postal address, if your jurisdiction requires one (e.g. the EU/UK). */
  address: "[POSTAL ADDRESS, OR REMOVE THIS LINE]",
  /** Whose law governs the Terms, e.g. "the State of California, USA". */
  jurisdiction: "[GOVERNING LAW, E.G. COUNTRY OR STATE]",
  /** The date these documents take effect. Update it whenever they change. */
  effectiveDate: "[EFFECTIVE DATE]",
  /** Youngest age allowed to make an account (13 meets COPPA in the US; some EU countries require 16). */
  minimumAge: 13,
};

export const LEGAL_PAGES = [
  { path: "/privacy", title: "Privacy Policy" },
  { path: "/terms", title: "Terms of Service" },
  { path: "/cookies", title: "Cookie Policy" },
] as const;

/** True while a detail still needs filling in. */
export function isPlaceholder(value: string | number): boolean {
  return typeof value === "string" && /^\[.*\]$/.test(value.trim());
}

/** The details still left as placeholders, so a test or a pre-launch check can list them. */
export function missingLegalDetails(details: Record<string, string | number> = LEGAL): string[] {
  return Object.entries(details)
    .filter(([, v]) => isPlaceholder(v))
    .map(([k]) => k);
}
