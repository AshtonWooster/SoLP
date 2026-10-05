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
  /** What this die does besides its Power, e.g. "On Hit: Inflict 1 Fragile next Scene". */
  effect?: string;
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
  /** Optional artwork (an uploaded image's URL). */
  image?: string;
}

export interface Equipment {
  id: string;
  name: string;
  /** The Equipment's own Rank (9 to 1), which sets its max Passive Cost. Missing: the character's Rank. */
  rank?: number;
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
  /** Stagger damage multipliers per Damage Type, applied like resistances. */
  staggerResistances: ResistanceSet;
}

/** An enemy the GM designed, which can be placed on the map any number of times (shared/types.ts). */
export interface EnemyTemplate {
  name: string;
  color: string;
  maxHp: number;
  maxStagger: number;
  maxLight: number;
  maxSanity: number;
  justice: number;
  resistances: ResistanceSet;
  staggerResistances: ResistanceSet;
  /** Every Page the enemy has. */
  pages: Page[];
  /** Copies of each Page in its Combat Deck. No size limit. */
  deck: DeckEntry[];
  notes: string;
  portrait?: string;
  updatedAt: number;
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

/**
 * Something in a character's Inventory (Act 7). Each takes one Slot; Stacking Items hold
 * several of the same thing in one Slot, up to maxStack.
 */
export interface InventoryItem {
  id: string;
  /** The GM's library item this was added from; its details come from the library while it exists. */
  templateId?: string;
  name: string;
  description: string;
  /** Card art (4:3). */
  image?: string;
  /**
   * item: a Material, Ammo or story piece. tool: brings a Page into the Auxiliary Deck.
   * trinket: only active while in the Trinket Slot.
   */
  kind: "item" | "tool" | "trinket";
  stacking: boolean;
  count: number;
  maxStack: number;
  /** The Tool's Page. */
  page?: Page;
  /** Set by the GM: the item can be used (Tools are always usable through the Auxiliary Deck). */
  usable?: boolean;
  /** Set by the GM: the item runs out after maxUses uses. */
  consumable?: boolean;
  maxUses?: number;
  /** Uses left before it's used up (one item of a stack). */
  uses?: number;
}

/**
 * An item in the GM's library (games/{id}/items/{itemId}). Every item is shown as a card:
 * a Usable item ("tool") is a Page with dice that goes in the Auxiliary Deck; other Items and
 * Trinkets just have a description.
 */
export type ItemTemplate = Omit<InventoryItem, "id" | "templateId" | "count" | "uses"> & { updatedAt?: number };

export interface Inventory {
  /** Starts at 9 (Act 7); the GM can change it. */
  slotCount: number;
  items: InventoryItem[];
  /** The one active Trinket, if any. */
  trinket: InventoryItem | null;
}

/** Copies of one Equipment Page in the Combat Deck. */
export interface DeckEntry {
  pageId: string;
  copies: number;
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
  inventory: Inventory;
  /** The Combat Deck (Act 6). The Auxiliary Deck is built from the inventory's Tools. */
  deck: DeckEntry[];
  /** E.G.O. Pages (Act 3): unique Pages from character progression, made with the GM. */
  ego: Page[];
  /** Portrait image URL. */
  portrait?: string;
  updatedAt: number;
}
