// A player character, built with the steps in Act 5 of the ruleset ("Creating a Character").
// Stored at games/{gameId}/characters/{uid}: one character per player per game.

export type PrimaryStat = "fortitude" | "prudence" | "justice" | "temperance";

/** A modular, always-active effect on an Augment, Weapon or Armor. Negative cost = Negative Passive. */
export interface Passive {
  id: string;
  name: string;
  cost: number;
  description: string;
}

export type DiceKind = "slash" | "pierce" | "blunt" | "block" | "evade";

/** One Dice on a Page: its type, Roll (die size) and Base Power. Final Power = roll + base power. */
export interface Dice {
  id: string;
  kind: DiceKind;
  /** Counter Dice are stored and used automatically against One-Sided attacks. */
  counter: boolean;
  sides: number;
  basePower: number;
}

export type PageType = "melee" | "ranged" | "massSummation" | "massIndividual" | "instant";

/** A Combat Page that comes with a piece of Equipment. */
export interface Page {
  id: string;
  name: string;
  /** Basic Pages can be copied freely into the Combat Deck; Special Pages are unique. */
  kind: "basic" | "special";
  /** Light paid to use the Page. */
  cost: number;
  type: PageType;
  dice: Dice[];
  effect: string;
}

export interface Equipment {
  id: string;
  name: string;
  description: string;
  passives: Passive[];
  pages: Page[];
}

export interface Weapon extends Equipment {
  /** Characters have two hands by default. */
  hands: 1 | 2;
}

/** Damage multipliers per Damage Type. Higher tier armor has lower values. */
export interface ResistanceSet {
  slash: number;
  pierce: number;
  blunt: number;
}

export interface Armor extends Equipment {
  resistances: ResistanceSet;
}

export interface Proficiency {
  id: string;
  name: string;
  description: string;
}

export interface CharacterDetails {
  age: string;
  height: string;
  occupation: string;
  birthplace: string;
  residence: string;
  appearance: string;
  personality: string;
  relationships: string;
}

export interface Character {
  ownerId: string;
  name: string;
  /** Fixer Grade or equivalent, agreed with the GM. Only the GM can change it after creation. */
  rank: number;
  primary: Record<PrimaryStat, number>;
  /** Keyed by the secondary stat names in shared/ruleset.ts. */
  secondary: Record<string, number>;
  proficiencies: Proficiency[];
  augment: { name: string; description: string; passives: Passive[] };
  weapons: Weapon[];
  armor: Armor | null;
  details: CharacterDetails;
  /** Starting money. */
  ahn: number;
  updatedAt: number;
}
