import type { PrimaryStat, ResistanceSet } from "../../shared/character.ts";
import { NumberInput } from "./Fields.tsx";

/** The four virtues' emblems, colored like Library of Ruina: red, white, purple and teal. */
const STAT_ICONS: Record<PrimaryStat, { color: string; body: React.ReactNode }> = {
  // A heart.
  fortitude: {
    color: "#e2434f",
    body: <path d="M12 20.5 C6 16.5 3 13 3 9.2 C3 6.4 5.1 4.5 7.6 4.5 C9.5 4.5 11 5.6 12 7.2 C13 5.6 14.5 4.5 16.4 4.5 C18.9 4.5 21 6.4 21 9.2 C21 13 18 16.5 12 20.5 Z" />,
  },
  // A brain.
  prudence: {
    color: "#f3ede4",
    body: (
      <>
        <path d="M11.3 5.2 C10.4 3.8 8.2 3.7 7.2 5 C5.4 4.9 4.2 6.6 4.8 8.2 C3.3 9.1 3.2 11.3 4.5 12.3 C3.7 13.9 4.8 15.9 6.6 16 C7 17.9 9.3 18.8 11.3 17.6 Z" />
        <path d="M12.7 5.2 C13.6 3.8 15.8 3.7 16.8 5 C18.6 4.9 19.8 6.6 19.2 8.2 C20.7 9.1 20.8 11.3 19.5 12.3 C20.3 13.9 19.2 15.9 17.4 16 C17 17.9 14.7 18.8 12.7 17.6 Z" />
        <path d="M11.3 17.6 V20.5 H12.7 V17.6" />
      </>
    ),
  },
  // A padlock.
  temperance: {
    color: "#a874d6",
    body: (
      <>
        <path d="M7.5 10 V7.5 C7.5 5 9.5 3.3 12 3.3 C14.5 3.3 16.5 5 16.5 7.5 V10 H14.6 V7.6 C14.6 6.1 13.5 5.1 12 5.1 C10.5 5.1 9.4 6.1 9.4 7.6 V10 Z" />
        <path fillRule="evenodd" d="M5.5 10 H18.5 V20.5 H5.5 Z M12 12.6 A1.6 1.6 0 1 0 12 15.8 A1.6 1.6 0 1 0 12 12.6 Z M11.3 15.4 H12.7 V18 H11.3 Z" />
      </>
    ),
  },
  // Scales.
  justice: {
    color: "#3fc6c0",
    body: (
      <>
        <path d="M11.2 4 H12.8 V19 H16 V20.5 H8 V19 H11.2 Z" />
        <path d="M4 7 H20 V8.4 H4 Z" />
        <path d="M6 8.4 L3 14 C3.5 15.6 8.5 15.6 9 14 Z M6 10.6 L4.6 13.4 H7.4 Z" fillRule="evenodd" />
        <path d="M18 8.4 L15 14 C15.5 15.6 20.5 15.6 21 14 Z M18 10.6 L16.6 13.4 H19.4 Z" fillRule="evenodd" />
      </>
    ),
  },
};

export const STAT_COLORS: Record<PrimaryStat, string> = Object.fromEntries(Object.entries(STAT_ICONS).map(([k, v]) => [k, v.color])) as Record<PrimaryStat, string>;

export function StatIcon({ stat, size = 22 }: { stat: PrimaryStat; size?: number }) {
  const icon = STAT_ICONS[stat];
  return (
    <svg className="stat-icon" viewBox="0 0 24 24" width={size} height={size} fill={icon.color} aria-hidden="true">
      {icon.body}
    </svg>
  );
}

/**
 * PLACEHOLDER emblems for the Secondary Stats until the ruleset names them, in muted gold.
 * A Secondary Stat added to the ruleset without its own emblem gets the diamond.
 */
const SECONDARY_ICONS: Record<string, React.ReactNode> = {
  // An eye.
  insight: (
    <path
      fillRule="evenodd"
      d="M12 6 C7 6 3.6 9.4 2 12 C3.6 14.6 7 18 12 18 C17 18 20.4 14.6 22 12 C20.4 9.4 17 6 12 6 Z M12 8.6 A3.4 3.4 0 1 0 12 15.4 A3.4 3.4 0 1 0 12 8.6 Z M12 10.6 A1.4 1.4 0 1 1 12 13.4 A1.4 1.4 0 1 1 12 10.6 Z"
    />
  ),
  // A four-pointed star.
  other: <path d="M12 2.5 L14.2 9.8 L21.5 12 L14.2 14.2 L12 21.5 L9.8 14.2 L2.5 12 L9.8 9.8 Z" />,
  // A hexagon.
  placeholder: <path fillRule="evenodd" d="M12 2.8 L20 7.4 V16.6 L12 21.2 L4 16.6 V7.4 Z M12 6 L7 8.9 V15.1 L12 18 L17 15.1 V8.9 Z" />,
};
const SECONDARY_FALLBACK = <path d="M12 3 L21 12 L12 21 L3 12 Z" />;
export const SECONDARY_COLOR = "#c9a75e";

export function SecondaryStatIcon({ stat, size = 22 }: { stat: string; size?: number }) {
  return (
    <svg className="stat-icon" viewBox="0 0 24 24" width={size} height={size} fill={SECONDARY_COLOR} aria-hidden="true" data-stat={stat}>
      {SECONDARY_ICONS[stat] ?? SECONDARY_FALLBACK}
    </svg>
  );
}

/** Whichever emblem fits: a Primary Stat's virtue, or a Secondary Stat's placeholder. */
export function AnyStatIcon({ stat, size = 22 }: { stat: string; size?: number }) {
  return stat in STAT_ICONS ? <StatIcon stat={stat as PrimaryStat} size={size} /> : <SecondaryStatIcon stat={stat} size={size} />;
}

type DamageType = keyof ResistanceSet;
const GLYPHS: Record<DamageType, string> = {
  // Three claw marks.
  slash: "M8 15.5 L13.5 7 L14.6 7.7 L9.1 16.2 Z M10.6 17 L16 8.6 L17 9.3 L11.6 17.7 Z M6.6 12.6 L10.6 6.5 L11.6 7.2 L7.6 13.3 Z",
  // A spear point.
  pierce: "M16.8 6.6 L15.9 11.2 L14.5 9.8 L8.2 16.1 L7.3 15.2 L13.6 8.9 L12.2 7.5 Z",
  // A peak.
  blunt: "M6.5 16.5 L10.2 9.3 L12.1 12.4 L13.6 10.2 L17.5 16.5 Z",
};

/** Library of Ruina's resistance shield: red for damage, yellow for Stagger. */
export function ResistIcon({ type, stagger, size = 26 }: { type: DamageType; stagger?: boolean; size?: number }) {
  const color = stagger ? "#f2d43a" : "#e5452f";
  return (
    <svg className="resist-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M4 3.5 H20 V12 C20 16.8 16.6 19.6 12 21.5 C7.4 19.6 4 16.8 4 12 Z" fill={color} />
      <path d="M5.8 5.2 H18.2 V12 C18.2 15.8 15.6 18.1 12 19.6 C8.4 18.1 5.8 15.8 5.8 12 Z" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
      <path d={GLYPHS[type]} fill="#2a0c06" />
    </svg>
  );
}

/** Library of Ruina's words for a resistance multiplier. */
export function resistWord(v: number): string {
  if (v <= 0) return "Immune";
  if (v < 0.5) return "Ineffective";
  if (v < 1) return "Endured";
  if (v === 1) return "Normal";
  if (v < 2) return "Weak";
  return "Fatal";
}

const TYPES: DamageType[] = ["slash", "pierce", "blunt"];

/**
 * Damage and Stagger resistances side by side, like Library of Ruina: a shield per damage type
 * with its multiplier next to it. `labelFor` names each input for screen readers and tests.
 */
export function ResistanceGrid({
  resistances,
  staggerResistances,
  onChange,
  labelFor,
}: {
  resistances: ResistanceSet;
  staggerResistances: ResistanceSet;
  onChange?: (field: "resistances" | "staggerResistances", r: ResistanceSet) => void;
  labelFor: (field: "resistances" | "staggerResistances", type: DamageType) => string;
}) {
  return (
    <div className="resist-grid">
      {(["resistances", "staggerResistances"] as const).map((field) => {
        const r = field === "resistances" ? resistances : staggerResistances;
        return (
          <div key={field} className={`resist-col ${field === "resistances" ? "damage" : "stagger"}`} title={field === "resistances" ? "Damage taken is multiplied by these" : "Stagger damage taken is multiplied by these"}>
            {TYPES.map((type) => (
              <label key={type} className="resist-line">
                <ResistIcon type={type} stagger={field === "staggerResistances"} />
                {onChange ? (
                  <NumberInput label={labelFor(field, type)} value={r[type]} step={0.25} min={0} onChange={(v) => onChange(field, { ...r, [type]: Math.max(0, v) })} />
                ) : (
                  <strong>{r[type]}</strong>
                )}
                <span className="resist-word">{resistWord(r[type])}</span>
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export type ResourceKey = "hp" | "stagger" | "light" | "sanity";

/** Health, Stagger Resist, Light and Sanity, each with its emblem and color. */
export const RESOURCES: { key: ResourceKey; max: "maxHp" | "maxStagger" | "maxLight" | "maxSanity"; label: string }[] = [
  { key: "hp", max: "maxHp", label: "Health" },
  { key: "stagger", max: "maxStagger", label: "Stagger Resist" },
  { key: "light", max: "maxLight", label: "Light" },
  { key: "sanity", max: "maxSanity", label: "Sanity" },
];

const RESOURCE_ICONS: Record<ResourceKey, { color: string; body: React.ReactNode }> = {
  // A drop of blood.
  hp: { color: "var(--hp)", body: <path d="M12 2.8 C12 2.8 5 10.4 5 14.6 C5 18.5 8.1 21.2 12 21.2 C15.9 21.2 19 18.5 19 14.6 C19 10.4 12 2.8 12 2.8 Z" /> },
  // A cracked shield.
  stagger: {
    color: "var(--p-stagger)",
    body: <path fillRule="evenodd" d="M4 3.5 H20 V12 C20 16.8 16.6 19.6 12 21.5 C7.4 19.6 4 16.8 4 12 Z M12.6 5 L10 10.5 L13.2 12 L10.6 18.5 L11.4 18.7 L14.8 11.4 L11.8 10 L13.6 5 Z" />,
  },
  // A sun.
  light: {
    color: "var(--p-light)",
    body: (
      <>
        <circle cx="12" cy="12" r="4.6" />
        <path d="M11.2 1.8 H12.8 V5.4 H11.2 Z M11.2 18.6 H12.8 V22.2 H11.2 Z M1.8 11.2 H5.4 V12.8 H1.8 Z M18.6 11.2 H22.2 V12.8 H18.6 Z M4.2 5.3 L5.3 4.2 L7.8 6.7 L6.7 7.8 Z M16.2 17.3 L17.3 16.2 L19.8 18.7 L18.7 19.8 Z M4.2 18.7 L6.7 16.2 L7.8 17.3 L5.3 19.8 Z M16.2 6.7 L18.7 4.2 L19.8 5.3 L17.3 7.8 Z" />
      </>
    ),
  },
  // A crescent moon.
  sanity: { color: "var(--sanity)", body: <path d="M15.5 3 C10.2 3.6 6.3 8 6.3 13.2 C6.3 17.6 9.3 21 13.6 21 C16.6 21 19.2 19.4 20.6 16.9 C13.5 18.4 9.4 10.6 15.5 3 Z" /> },
};

export function ResourceIcon({ res, size = 20 }: { res: ResourceKey; size?: number }) {
  const icon = RESOURCE_ICONS[res];
  return (
    <svg className="res-icon" viewBox="0 0 24 24" width={size} height={size} style={{ fill: icon.color }} aria-hidden="true" data-res={res}>
      {icon.body}
    </svg>
  );
}
