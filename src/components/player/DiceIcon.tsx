import type { Dice, DiceKind } from "../../../shared/character.ts";

/** Small line icons for each die type, coloured like Library of Ruina: Offensive orange, Block blue, Evade green. */
const PATHS: Record<DiceKind, string> = {
  slash: "M5 17 L13 5 M9 19 L17 7 M13 20 L20 10",
  pierce: "M4 20 L17 7 M12 5 H19 V12 M4 20 L8 19 L5 16 Z",
  blunt: "M7 4 H15 V11 H7 Z M11 11 V20",
  block: "M12 3 L19 6 V11 C19 16 15.5 19.5 12 21 C8.5 19.5 5 16 5 11 V6 Z M12 8 V16 M8.5 11.5 H15.5",
  evade: "M5 15 C8 7 15 6 19 9 M15 5 L19 9 L15 12 M5 19 C9 17 12 17 15 18",
};

export const DIE_NAMES: Record<DiceKind, string> = { slash: "Slash", pierce: "Pierce", blunt: "Blunt", block: "Block", evade: "Evade" };

export const dieClass = (kind: DiceKind) => (kind === "block" ? "block" : kind === "evade" ? "evade" : "offensive");

/** Lowest and highest Final Power the die can roll. */
export const dieRange = (d: Dice) => `${1 + d.basePower}-${d.sides + d.basePower}`;

export function DiceIcon({ dice, size = 26 }: { dice: Dice; size?: number }) {
  return (
    <span className={`dice-icon ${dieClass(dice.kind)}${dice.counter ? " counter" : ""}`} style={{ width: size, height: size }} title={`${dice.counter ? "Counter " : ""}${DIE_NAMES[dice.kind]}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={PATHS[dice.kind]} />
      </svg>
    </span>
  );
}
