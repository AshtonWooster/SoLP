// Numbers and checks from the ruleset (github.com/AshtonWooster/LoR_PMTTRPG, Rules.md).
//
// Values marked PLACEHOLDER below stand in for numbers the ruleset doesn't give yet; replace them
// here when it does and the whole app follows.
import { newId } from "./id.ts";
import type {
  Armor,
  Character,
  DeckEntry,
  Dice,
  DiceKind,
  NpcOverrides,
  NpcSide,
  NpcTemplate,
  ResistanceSet,
  Equipment,
  Inventory,
  InventoryItem,
  ItemTemplate,
  Page,
  PageType,
  Passive,
  PrimaryStat,
  Weapon,
  WeaponCategory,
  WeaponProperty,
  WeaponStyle,
} from "./character.ts";
import { cleanSecrets } from "./secrets.ts";
import type { PanicType, Resources, SpawnData, TokenGearInfo } from "./types.ts";
import { computeMaxResources, type StatFormulas } from "./formulas.ts";

/** Act 5, Step 1: "For most campaigns, it is encouraged to start at Rank 9." */
export const STARTING_RANK = 9;
/** Fixer Grades run from 9 (newest) to 1. */
export const RANKS = [9, 8, 7, 6, 5, 4, 3, 2, 1];

export const PRIMARY_STATS: { key: PrimaryStat; label: string; effect: string }[] = [
  { key: "fortitude", label: "Fortitude", effect: "Raises max Health" },
  { key: "prudence", label: "Prudence", effect: "Raises max Sanity" },
  { key: "justice", label: "Justice", effect: "Added to Speed rolls; raises Movement Points" },
  { key: "temperance", label: "Temperance", effect: "Raises max Stagger Resist" },
];

/** Act 2 lists Insight plus two unnamed placeholders. Rename them here when the ruleset does. */
export const SECONDARY_STATS: { key: string; label: string; effect: string }[] = [
  { key: "insight", label: "Insight", effect: "Added to Perception Story Rolls" },
  { key: "other", label: "Other", effect: "Not yet defined in the ruleset" },
  { key: "placeholder", label: "Placeholder", effect: "Not yet defined in the ruleset" },
];

export interface RankTable {
  primaryPoints: number;
  secondaryPoints: number;
  /** Max total Passive Cost on the Augment. */
  augmentMaxCost: number;
  /** Max total Passive Cost on each piece of Equipment. */
  equipmentMaxCost: number;
}

/**
 * Act 5's tables: "Character Stats by Rank" (4 Primary and 6 Secondary at Rank 9, then +2 and +3
 * each Rank Up), the Augment's "Max Costs Table" (4, then +2) and Equipment's (2, then +1).
 */
export function rankTable(rank: number): RankTable {
  const step = Math.max(0, STARTING_RANK - rank);
  return {
    primaryPoints: 4 + step * 2,
    secondaryPoints: 6 + step * 3,
    augmentMaxCost: 4 + step * 2,
    equipmentMaxCost: 2 + step,
  };
}

/** Act 5, "Proficiency Counts by Rank": 4 at Rank 9, then 2 more at each Rank Up (6 at Rank 8, ... 20 at Rank 1). */
export function proficiencyCount(rank: number): number {
  return 4 + Math.max(0, STARTING_RANK - rank) * 2;
}

/**
 * Act 2: Fortitude raises max Health, Prudence max Sanity, Temperance max Stagger Resist. How much
 * is up to the game's stat formulas (shared/formulas.ts), which the GM edits in game settings.
 */
export function maxResources(c: Pick<Character, "rank" | "primary">, formulas: StatFormulas): Pick<Resources, "maxHp" | "maxStagger" | "maxSanity" | "maxLight"> {
  return computeMaxResources(c, formulas);
}

// ---- Combat (Act 8) ----

/** Combat Start: every character rolls 1d6 + Justice for Speed. */
export const SPEED_DIE = 6;

/** Act 8, Movement: "Movement Points (`3 + (Justice/2 Rounded Down)`)". */
export const BASE_MOVEMENT = 3;

export function movementPoints(justice: number): number {
  return BASE_MOVEMENT + Math.floor(Math.max(0, justice) / 2);
}

/** Upkeep: "characters restore, by default, 1 Light." */
/** A Staggered character recovers (full Stagger Resist) at the Upkeep that makes this many while Staggered. */
export const STAGGER_UPKEEPS = 2;
/** While Staggered, every Resistance (damage and Stagger) is this. */
export const STAGGERED_RESISTANCE = 2;
export const UPKEEP_LIGHT = 1;

/** Panic types: the die rolled on Panicking, and the Upkeeps spent Panicking before recovering. */
export const PANIC_DIE = 4;
export const PANIC_UPKEEPS = 3;
/** Panic recovery: an ally's Prudence Story Roll of at least this brings a Panicking character out of Panic. */
export const PANIC_RECOVERY_ROLL = 12;
/** What each Panic type (the d4 rolled) does, for the log and the token popup. */
export const PANIC_TYPES: Record<PanicType, { label: string; effect: string }> = {
  1: { label: "Despair", effect: "every die rolls its Min" },
  2: { label: "Paralysis", effect: "no drawing Pages" },
  3: { label: "Darkness", effect: "no gaining Light" },
  4: { label: "Confusion", effect: "no Auxiliary Pages" },
};

/** Knocked Out (Game setting "Knocked Out rules"): an ally's Temperance Story Roll of at least this revives them. */
export const KO_RECOVERY_ROLL = 12;
/** Knocked Out rules: this many Upkeeps without a revive and the character is Dead. */
export const KO_UPKEEPS = 3;

/** Health a revived character comes back with: "(Max Health/4) Rounded Down" (at least 1). */
export function reviveHealth(maxHp: number): number {
  return Math.max(1, Math.floor(maxHp / 4));
}

/** Sanity recovered on a revive (by both characters) and at End of Combat: `3 + Prudence`. */
export function recoverySanity(prudence: number): number {
  return 3 + prudence;
}

/** Act 7, Resting: Health and Sanity recovered for each hour of rest. */
export function restPerHour(c: { rank: number; fortitude: number; prudence: number }): { hp: number; sanity: number } {
  const r = 10 - c.rank;
  return { hp: 6 + r * 2 + c.fortitude * 2, sanity: r * 2 + c.prudence };
}
/** The longest rest the GM can give in one go, in hours. */
export const MAX_REST_HOURS = 24;

/** You asked for players to start combat with 3 Pages in hand. */
export const STARTING_HAND = 3;
/** Upkeep: "characters first draw a Page from their Combat Deck." */
export const UPKEEP_DRAW = 1;
/** PLACEHOLDER: the ruleset doesn't say how many Speed Dice (Page slots) a character has. */
export const SPEED_DICE = 1;

/** PLACEHOLDER: "Weapon Range" isn't defined yet. Tiles, measured like movement. */
export const WEAPON_RANGE: Record<PageType, number> = {
  melee: 1,
  ranged: 6,
  massSummation: 3,
  massIndividual: 3,
  instant: 6,
};

/** The longest Weapon Range a weapon can be given, in tiles. */
export const MAX_WEAPON_RANGE = 50;

/** How far a Page reaches: its Weapon's range when it came with one, otherwise the default for its type. */
export const pageRange = (page: Pick<Page, "type" | "range">): number => page.range ?? WEAPON_RANGE[page.type];

// ---- Creating a Weapon (Act 4; Game setting "Weapon properties") ----

export const WEAPON_PROPERTIES: Record<WeaponProperty, { label: string; category: WeaponCategory; hands: 1 | 2; range: number; note: string }> = {
  small: { label: "Small", category: "melee", hands: 1, range: 1, note: "One handed. A new die on a Page costs 2 Page Points instead of 3." },
  medium: { label: "Medium", category: "melee", hands: 2, range: 1, note: "Two handed. 1 extra Weapon Point per Weapon Rank from 9, plus one." },
  heavy: { label: "Heavy", category: "melee", hands: 2, range: 1, note: "Two handed. (10 − Weapon Rank)/3 rounded up extra Page Points per Light Cost." },
  lowCaliber: { label: "Low Caliber", category: "ranged", hands: 1, range: 6, note: "One handed, 6 Range. Cheaper dice on a Page." },
  highCaliber: { label: "High Caliber", category: "ranged", hands: 2, range: 10, note: "Two handed, 10 Range. Higher Light scaling per Page." },
};

export const WEAPON_STYLES: Record<WeaponStyle, { label: string; note: string }> = {
  offensive: { label: "Offensive", note: "When it starts a Clash, it can resolve the Clash right away." },
  defensive: { label: "Defensive", note: "Can Clash with any attack aimed at an ally within its range." },
};

/** A Weapon with a property picked: its category, hands and range follow the property (Melee range 1). */
export function withWeaponProperty(w: Weapon, property: WeaponProperty): Weapon {
  const p = WEAPON_PROPERTIES[property];
  return { ...w, property, category: p.category, hands: p.hands, meleeRange: WEAPON_RANGE.melee, ...(p.category === "ranged" ? { rangedRange: p.range } : {}) };
}

/** A Weapon's range for Melee or Ranged Pages: what the player set, or the default. */
export function weaponRange(w: Pick<Weapon, "meleeRange" | "rangedRange">, type: "melee" | "ranged"): number {
  const set = type === "melee" ? w.meleeRange : w.rangedRange;
  return typeof set === "number" && Number.isFinite(set) ? Math.max(0, Math.min(MAX_WEAPON_RANGE, Math.round(set))) : WEAPON_RANGE[type];
}

/**
 * The Pages with each one's Weapon Range written on it, for combat: a Melee Page reaches its
 * Weapon's Melee range and a Ranged Page its Ranged range (and carries the Melee range too, for
 * when it's fired without Ammo). Pages on Weapons with no range set, on
 * Armor, or of other types are left as they are (the defaults).
 */
export function withWeaponRanges(c: Pick<Character, "weapons">, pages: Page[], opts: { weaponProperties?: boolean } = {}): Page[] {
  const ranges = new Map<string, Partial<Pick<Page, "range" | "meleeRange" | "weaponStyle">>>();
  for (const w of c.weapons ?? []) {
    for (const p of w.pages) {
      // With "Weapon properties" on, every Page of an Offensive or Defensive Weapon carries its type.
      const style = opts.weaponProperties && (w.style === "offensive" || w.style === "defensive") ? { weaponStyle: w.style } : {};
      if (p.type !== "melee" && p.type !== "ranged") {
        if (style.weaponStyle) ranges.set(p.id, style);
        continue;
      }
      const r: Partial<Pick<Page, "range" | "meleeRange" | "weaponStyle">> = { ...style };
      if ((p.type === "melee" ? w.meleeRange : w.rangedRange) !== undefined) r.range = weaponRange(w, p.type);
      // A Ranged Page fired without Ammo becomes a Melee Page, reaching the Weapon's Melee range.
      if (p.type === "ranged" && w.meleeRange !== undefined) r.meleeRange = weaponRange(w, "melee");
      if (Object.keys(r).length) ranges.set(p.id, r);
    }
  }
  return pages.map((p) => (ranges.has(p.id) ? { ...p, ...ranges.get(p.id)! } : p));
}

/**
 * A Ranged Page fired without Ammo (Game setting "Ranged Pages use Ammo"): used as a Melee Page,
 * reaching its Weapon's Melee range, with every die rolled at disadvantage.
 */
export function asMeleeWithoutAmmo(page: Page): Page {
  const { meleeRange, ...rest } = page;
  return { ...rest, type: "melee", range: meleeRange ?? WEAPON_RANGE.melee, noAmmo: true };
}

/** Partial Cover: Ranged Pages get Final Power - 2 against the character (never below 1 from it). */
export const PARTIAL_COVER = 2;

export const isMassAttack = (type: PageType) => type === "massSummation" || type === "massIndividual";
export const isOffensive = (kind: DiceKind) => kind === "slash" || kind === "pierce" || kind === "blunt";

/** Act 7, Story Rolls: "By default, a Story Roll is `1d20 + Appropriate Stat`." */
export const STORY_DIE = 20;
/** "By default a failure is defined as rolling 9 or below and a success is 12 or higher." */
export const STORY_FAIL_AT_MOST = 9;
export const STORY_SUCCESS_AT_LEAST = 12;

/** How a Story Roll total reads by default: a success, a failure, or in between (the GM decides). */
export function storyOutcome(total: number): "success" | "failure" | "mixed" {
  return total >= STORY_SUCCESS_AT_LEAST ? "success" : total <= STORY_FAIL_AT_MOST ? "failure" : "mixed";
}

/** "Characters can move tiles in any direction", so a diagonal step costs 1 like any other. */
export function moveCost(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
}

// ---- Inventory and decks (Acts 6 and 7) ----

/** "A character's Inventory consists of a starting maximum of 9 Slots." */
export const INVENTORY_SLOTS = 9;
/** "Combat Decks, by default, consist of 12 pages." */
export const DECK_SIZE = 12;

export function blankItem(kind: InventoryItem["kind"]): InventoryItem {
  return {
    id: newId(),
    name: "",
    description: "",
    kind,
    stacking: false,
    count: 1,
    maxStack: 1,
    ...(kind === "tool" ? { page: { ...blankPage("basic"), type: "instant" as const } } : {}),
  };
}

/** A Page the Combat Deck can use, with the Equipment it comes from. */
export interface DeckSource {
  page: Page;
  from: string;
}

/** Combat Pages from current Equipment: every equipped Weapon and the Armor. */
export function equipmentPages(c: Character): DeckSource[] {
  const gear: Equipment[] = [...c.weapons, ...(c.armor ? [c.armor] : [])];
  return gear.flatMap((e) => e.pages.map((page) => ({ page, from: e.name.trim() || "Unnamed equipment" })));
}

/** Basic Pages can be copied any number of times; Special Pages are unique. */
export function maxCopies(page: Page): number {
  return page.kind === "special" ? 1 : DECK_SIZE;
}

export function deckSize(deck: DeckEntry[]): number {
  return deck.reduce((a, e) => a + e.copies, 0);
}

/** Drops entries for Pages no longer on the character's Equipment, and trims over-copied Special Pages. */
export function cleanDeck(c: Character): DeckEntry[] {
  const pages = new Map(equipmentPages(c).map((s) => [s.page.id, s.page]));
  return c.deck
    .filter((e) => pages.has(e.pageId) && e.copies > 0)
    .map((e) => ({ ...e, copies: Math.min(e.copies, maxCopies(pages.get(e.pageId)!)) }));
}

// ---- The GM's item library ----

export const ITEM_KINDS: { value: InventoryItem["kind"]; label: string; hint: string }[] = [
  { value: "tool", label: "Usable", hint: "A Page with dice, used from the Auxiliary Deck" },
  { value: "item", label: "Item", hint: "Material, Ammo or story piece" },
  { value: "trinket", label: "Trinket", hint: "Only active in the Trinket Slot" },
];

export function blankTemplate(kind: InventoryItem["kind"] = "item"): ItemTemplate {
  const { id: _id, count: _count, ...rest } = blankItem(kind);
  return { ...rest, name: "", updatedAt: Date.now() };
}

/** Keeps only known, well-typed fields of an imported or edited library item. */
export function cleanTemplate(raw: unknown): ItemTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === "tool" || r.kind === "trinket" ? r.kind : "item";
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
  const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
  const t: ItemTemplate = {
    name: str(r.name, 120),
    description: str(r.description),
    kind,
    stacking: !!r.stacking,
    maxStack: Math.max(1, num(r.maxStack, 1)),
    updatedAt: Date.now(),
  };
  if (r.stacking !== true) t.maxStack = 1;
  const image = str(r.image, 2000);
  if (/^https?:\/\//.test(image)) t.image = image;
  if (kind === "tool") {
    const p = (r.page ?? {}) as Partial<Page>;
    t.page = {
      ...blankPage("basic"),
      type: "instant",
      ...p,
      id: typeof p.id === "string" && p.id ? p.id : newId(),
      name: t.name,
      dice: Array.isArray(p.dice) ? p.dice.slice(0, 12).map((d) => ({ ...blankDice(), ...d, id: typeof d?.id === "string" ? d.id : newId() })) : [],
      effect: str(p.effect),
    };
    if (t.image) t.page.image = t.image;
    else delete t.page.image;
  }
  if (typeof r.createdBy === "string" && r.createdBy) t.createdBy = r.createdBy;
  if (t.createdBy && r.pending === true) t.pending = true;
  if (r.usable === true) t.usable = true;
  if (kind === "item" && r.ammo === true) t.ammo = true;
  if (r.consumable === true) {
    t.consumable = true;
    t.maxUses = Math.max(1, num(r.maxUses, 1));
  }
  return t;
}

/**
 * An inventory item with its details taken from the GM's library, so the GM's edits reach every
 * inventory. The player's own count and uses are kept (clamped to the library's limits).
 */
export function linkItem(item: InventoryItem, library: Record<string, ItemTemplate> | undefined): InventoryItem {
  const t = item.templateId ? library?.[item.templateId] : undefined;
  // A player's change waiting for the GM's approval doesn't reach inventories yet.
  if (!t || t.pending === true) return item;
  const { updatedAt: _u, ...details } = t;
  const maxStack = t.stacking ? Math.max(1, t.maxStack) : 1;
  const linked: InventoryItem = { ...details, id: item.id, templateId: item.templateId, count: Math.min(Math.max(1, item.count), maxStack) };
  if (t.consumable) linked.uses = Math.min(item.uses ?? t.maxUses ?? 1, t.maxUses ?? 1);
  if (t.page) linked.page = { ...t.page, name: t.name, ...(t.image ? { image: t.image } : {}) };
  return linked;
}

/** The character with every inventory item brought up to date from the GM's library. */
export function linkInventory(c: Character, library: Record<string, ItemTemplate> | undefined): Character {
  if (!library) return c;
  const inv = c.inventory;
  return { ...c, inventory: { ...inv, items: inv.items.map((i) => linkItem(i, library)), trinket: inv.trinket ? linkItem(inv.trinket, library) : null } };
}

/**
 * Add one of a library item to an inventory: onto an existing stack of it with room, otherwise
 * into a free Slot. Returns the new item list, or why it can't be added.
 */
export function addFromLibrary(inv: Inventory, templateId: string, t: ItemTemplate): { items: InventoryItem[] } | { error: string } {
  if (t.stacking) {
    const stack = inv.items.find((i) => i.templateId === templateId && i.count < Math.max(1, t.maxStack));
    if (stack) return { items: inv.items.map((i) => (i === stack ? { ...i, count: i.count + 1 } : i)) };
  }
  if (inv.items.length >= inv.slotCount) return { error: `All ${inv.slotCount} Slots are full.` };
  const { updatedAt: _u, ...details } = t;
  const item: InventoryItem = { ...details, id: newId(), templateId, count: 1 };
  if (t.consumable) item.uses = t.maxUses ?? 1;
  return { items: [...inv.items, item] };
}

/** The Auxiliary Deck: each Tool in the Inventory brings its Page (one copy per item in a stack). */
export function auxiliaryDeck(c: Character): { item: InventoryItem; page: Page; copies: number }[] {
  return c.inventory.items
    .filter((i) => i.kind === "tool" && i.page)
    .map((i) => ({ item: i, page: i.page!, copies: i.stacking ? i.count : 1 }));
}

export function deckChecks(c: Character): Check[] {
  const pages = new Map(equipmentPages(c).map((s) => [s.page.id, s.page]));
  const size = deckSize(c.deck);
  const missing = c.deck.filter((e) => !pages.has(e.pageId)).length;
  const overSpecial = c.deck.filter((e) => pages.get(e.pageId)?.kind === "special" && e.copies > 1);
  return [
    { step: "Decks", ok: size === DECK_SIZE, text: `Combat Deck: ${size} of ${DECK_SIZE} Pages` },
    ...(missing ? [{ step: "Decks", ok: false, text: `${missing} Page${missing === 1 ? "" : "s"} in the deck no longer on your Equipment` }] : []),
    ...overSpecial.map((e) => ({ step: "Decks", ok: false, text: `${pages.get(e.pageId)!.name || "A Special Page"} is unique: 1 copy only` })),
  ];
}

export function inventoryChecks(c: Character): Check[] {
  const inv = c.inventory;
  return [
    { step: "Inventory", ok: inv.items.length <= inv.slotCount, text: `Inventory: ${inv.items.length} of ${inv.slotCount} Slots used` },
    ...inv.items
      .filter((i) => i.stacking && i.count > i.maxStack)
      .map((i) => ({ step: "Inventory", ok: false, text: `${i.name || "A stack"} holds ${i.count}; max is ${i.maxStack}` })),
    ...(inv.trinket && inv.trinket.kind !== "trinket"
      ? [{ step: "Inventory", ok: false, text: "Only a Trinket can go in the Trinket Slot" }]
      : []),
  ];
}

/** Tools are used through the Auxiliary Deck; other items only once the GM marks them usable. */
export const isUsable = (i: InventoryItem) => i.kind === "tool" || !!i.usable;

/**
 * Uses an item once. A consumable item counts down its uses; when the last is spent, one item
 * of the stack is used up (or the item is gone). Returns the updated item, or null if none are left.
 */
export function useItem(item: InventoryItem): InventoryItem | null {
  if (!item.consumable) return item;
  const max = Math.max(1, item.maxUses ?? 1);
  const left = (item.uses ?? max) - 1;
  if (left > 0) return { ...item, uses: left };
  if (item.stacking && item.count > 1) return { ...item, count: item.count - 1, uses: max };
  return null;
}

/** Ammo a Ranged Page can fire: an Item the GM marked as Ammo, with at least one left. */
export const isAmmo = (i: InventoryItem) => i.kind === "item" && !!i.ammo && i.count > 0;

/** One of the item with this id is spent: a stack loses one, and the last one leaves the Slot. */
export function spendOne(items: InventoryItem[], itemId: string): InventoryItem[] {
  return items.flatMap((i) => (i.id !== itemId ? [i] : i.count > 1 ? [{ ...i, count: i.count - 1 }] : []));
}

/** Applies useItem to the item with this id in an inventory list. */
export function useItemIn(items: InventoryItem[], itemId: string): InventoryItem[] {
  return items.flatMap((i) => (i.id === itemId ? [useItem(i)].filter((x): x is InventoryItem => !!x) : [i]));
}

// ---- Enemies ----

/** An enemy's Combat Deck: the copies the GM set, or one of each Page if none were set. No size limit. */
export function enemyDeck(pages: Page[], deck: DeckEntry[] | undefined): string[] {
  const ids = new Set(pages.map((p) => p.id));
  const entries = deck?.length ? deck.filter((e) => ids.has(e.pageId)) : pages.map((p) => ({ pageId: p.id, copies: 1 }));
  return entries.flatMap((e) => Array(Math.max(0, e.copies)).fill(e.pageId));
}

// ---- Characters the GM makes (enemies, allies, anyone else) ----

const ONES: ResistanceSet = { slash: 1, pierce: 1, blunt: 1 };
export const NPC_SIDES: { value: NpcSide; label: string; color: string }[] = [
  { value: "enemy", label: "Enemy", color: "#d9534f" },
  { value: "ally", label: "Ally", color: "#4fb3bf" },
  { value: "neutral", label: "Neutral", color: "#a3968a" },
];

export function blankNpc(): NpcTemplate {
  const attack = { ...blankPage("basic"), name: "Attack" };
  return {
    ...blankCharacter("", ""),
    side: "enemy",
    color: "#d9534f",
    notes: "",
    pages: [attack],
    deck: [{ pageId: attack.id, copies: 6 }],
    overrides: {},
  };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const resistanceSet = (v: unknown): ResistanceSet | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  return { slash: Math.max(0, num(r.slash) ?? 1), pierce: Math.max(0, num(r.pierce) ?? 1), blunt: Math.max(0, num(r.blunt) ?? 1) };
};
const isOnes = (r?: ResistanceSet) => !r || (r.slash === 1 && r.pierce === 1 && r.blunt === 1);

/**
 * A stored or imported GM character with every field filled in. Templates saved before characters
 * had Ranks and Stats (plain Health, Justice and resistances) keep those numbers as overrides.
 */
export function normalizeNpc(raw: unknown): NpcTemplate {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const blank = blankNpc();
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const arr = <T,>(v: unknown, d: T[]): T[] => (Array.isArray(v) ? (v as T[]) : d);
  const t: NpcTemplate = {
    ...blank,
    ...(r as Partial<NpcTemplate>),
    ownerId: "",
    name: str(r.name).slice(0, 120),
    side: NPC_SIDES.some((s) => s.value === r.side) ? (r.side as NpcSide) : "enemy",
    color: /^#[0-9a-f]{6}$/i.test(str(r.color)) ? str(r.color) : blank.color,
    notes: str(r.notes),
    pages: arr(r.pages, blank.pages),
    deck: arr(r.deck, blank.deck),
    weapons: arr(r.weapons, []),
    armor: r.armor && typeof r.armor === "object" ? (r.armor as NpcTemplate["armor"]) : null,
    proficiencies: arr(r.proficiencies, []),
    ego: arr(r.ego, []),
    rank: RANKS.includes(num(r.rank) ?? -1) ? (r.rank as number) : STARTING_RANK,
    primary: { ...blank.primary, ...(r.primary && typeof r.primary === "object" ? (r.primary as NpcTemplate["primary"]) : {}) },
    secondary: { ...blank.secondary, ...(r.secondary && typeof r.secondary === "object" ? (r.secondary as NpcTemplate["secondary"]) : {}) },
    augment: { ...blank.augment, ...(r.augment && typeof r.augment === "object" ? (r.augment as NpcTemplate["augment"]) : {}) },
    details: { ...blank.details, ...(r.details && typeof r.details === "object" ? (r.details as NpcTemplate["details"]) : {}) },
    inventory: { ...blank.inventory, ...(r.inventory && typeof r.inventory === "object" ? (r.inventory as NpcTemplate["inventory"]) : {}) },
    ahn: Math.max(0, Math.round(num(r.ahn) ?? 0)),
    overrides: {},
    updatedAt: num(r.updatedAt) ?? Date.now(),
  };
  if (typeof r.portrait === "string" && r.portrait) t.portrait = r.portrait;
  else delete t.portrait;
  const o = (r.overrides && typeof r.overrides === "object" ? r.overrides : {}) as Record<string, unknown>;
  for (const k of ["maxHp", "maxStagger", "maxSanity", "maxLight"] as const) {
    const v = num(o[k]);
    if (v !== undefined) t.overrides[k] = Math.max(1, Math.round(v));
  }
  for (const k of ["resistances", "staggerResistances"] as const) {
    const v = resistanceSet(o[k]);
    if (v) t.overrides[k] = v;
  }
  if (num(r.rank) === undefined) {
    // An enemy template from before Ranks and Stats: keep its numbers as they were.
    for (const k of ["maxHp", "maxStagger", "maxSanity", "maxLight"] as const) {
      const v = num(r[k]);
      if (v !== undefined) t.overrides[k] = Math.max(1, Math.round(v));
    }
    t.primary.justice = Math.round(num(r.justice) ?? 0);
    for (const k of ["resistances", "staggerResistances"] as const) {
      const v = resistanceSet(r[k]);
      if (v && !isOnes(v)) t.overrides[k] = v;
    }
  }
  for (const k of ["maxHp", "maxStagger", "maxSanity", "maxLight", "justice", "resistances", "staggerResistances"]) delete (t as unknown as Record<string, unknown>)[k];
  return t;
}

/** Every Page a GM character can put in its deck: those on its Equipment, then its own. */
export function npcPages(t: NpcTemplate): DeckSource[] {
  return [...equipmentPages(t), ...t.pages.map((page) => ({ page, from: "" }))];
}

/** Resources and resistances: from Rank, Stats and Armor, unless the GM overrode them. */
export type NpcNumbers = Required<NpcOverrides>;
export function npcStats(t: NpcTemplate, formulas: StatFormulas): NpcNumbers & { calculated: NpcNumbers } {
  const base = maxResources(t, formulas);
  const calculated = { ...base, resistances: t.armor?.resistances ?? ONES, staggerResistances: t.armor?.staggerResistances ?? ONES };
  const o = t.overrides;
  return {
    calculated,
    maxHp: o.maxHp ?? base.maxHp,
    maxStagger: o.maxStagger ?? base.maxStagger,
    maxSanity: o.maxSanity ?? base.maxSanity,
    maxLight: o.maxLight ?? base.maxLight,
    resistances: o.resistances ?? calculated.resistances,
    staggerResistances: o.staggerResistances ?? calculated.staggerResistances,
  };
}

/** What a placed copy starts with. */
export function npcSpawnData(t: NpcTemplate, formulas: StatFormulas): SpawnData {
  const s = npcStats(t, formulas);
  const data: SpawnData = {
    name: t.name,
    color: t.color,
    side: t.side,
    maxHp: s.maxHp,
    maxStagger: s.maxStagger,
    maxLight: s.maxLight,
    maxSanity: s.maxSanity,
    justice: t.primary.justice,
    resistances: s.resistances,
    staggerResistances: s.staggerResistances,
    pages: withWeaponRanges(t, npcPages(t).map((x) => x.page)),
    deck: t.deck,
  };
  if (t.portrait) data.portrait = t.portrait;
  const passiveEffects = linkedEffects(t);
  if (passiveEffects.length) data.passiveEffects = passiveEffects;
  const secret = cleanSecrets(t.secret);
  if (Object.keys(secret).length) data.secret = secret;
  // Only the GM can read the template, so the token keeps the names players may be shown.
  data.gear = gearNames(t);
  return data;
}

/** The names of a character's Weapons, Armor and Augment (with its Passives), as the token popup lists them. */
export function gearNames(c: Pick<Character, "weapons" | "armor" | "augment">): TokenGearInfo {
  const gear: TokenGearInfo = {
    weapons: (c.weapons ?? []).map((w) => ({ id: w.id, name: w.name.trim() || "Unnamed weapon", hands: w.hands })),
  };
  if (c.armor) gear.armor = { name: c.armor.name.trim() || "Unnamed armor" };
  const aug = c.augment;
  if (aug && (aug.name.trim() || aug.passives.length)) {
    gear.augment = { name: aug.name.trim() || "Unnamed augment", passives: aug.passives.map((p) => p.name.trim() || "Unnamed passive") };
  }
  return gear;
}

/** Library ids of the automated effects a character's Passives (Augment, Weapons, Armor) and Proficiencies link to. */
export function linkedEffects(c: Pick<Character, "augment" | "weapons" | "armor" | "proficiencies">): string[] {
  const passives = [...(c.augment?.passives ?? []), ...(c.weapons ?? []).flatMap((w) => w.passives ?? []), ...(c.armor?.passives ?? [])];
  return [...passives, ...(c.proficiencies ?? [])].map((p) => p.effectId).filter((id): id is string => !!id);
}

// ---- Copying Pages and Equipment between characters ----

/** A copy of a Page with fresh ids, so it can sit next to the original. */
export function clonePage(p: Page): Page {
  return { ...structuredClone(p), id: newId(), dice: p.dice.map((d) => ({ ...d, id: newId() })) };
}

/** A copy of a Weapon, Armor or Augment's Passives and Pages with fresh ids. */
export function cloneEquipment<T extends Equipment>(e: T): T {
  return { ...structuredClone(e), id: newId(), passives: e.passives.map((p) => ({ ...p, id: newId() })), pages: e.pages.map(clonePage) };
}

export function cloneAugment(a: Character["augment"]): Character["augment"] {
  return { ...structuredClone(a), passives: a.passives.map((p) => ({ ...p, id: newId() })) };
}

// ---- Blank pieces for the editor ----

export function blankCharacter(ownerId: string, name: string): Character {
  return {
    ownerId,
    name,
    rank: STARTING_RANK,
    primary: { fortitude: 0, prudence: 0, justice: 0, temperance: 0 },
    secondary: Object.fromEntries(SECONDARY_STATS.map((s) => [s.key, 0])),
    proficiencies: [],
    augment: { name: "", description: "", passives: [] },
    weapons: [],
    armor: null,
    details: {
      age: "",
      height: "",
      occupation: "",
      birthplace: "",
      residence: "",
      appearance: "",
      personality: "",
      relationships: "",
    },
    ahn: 0,
    inventory: { slotCount: INVENTORY_SLOTS, items: [], trinket: null },
    deck: [],
    ego: [],
    updatedAt: Date.now(),
  };
}

export const blankPassive = (): Passive => ({ id: newId(), name: "", cost: 1, description: "" });
export const blankDice = (): Dice => ({ id: newId(), kind: "slash", counter: false, sides: 4, basePower: 2 });
export const blankPage = (kind: Page["kind"]): Page => ({
  id: newId(),
  name: "",
  kind,
  cost: kind === "basic" ? 1 : 2,
  type: "melee",
  dice: [blankDice()],
  effect: "",
});
function blankEquipment(): Equipment {
  // Step 5: one Basic Page and one Special Page for each piece of Equipment.
  return { id: newId(), name: "", description: "", passives: [], pages: [blankPage("basic"), blankPage("special")] };
}
export const blankWeapon = (): Weapon => ({ ...blankEquipment(), hands: 1 });
export const blankArmor = (): Armor => ({
  ...blankEquipment(),
  resistances: { slash: 1, pierce: 1, blunt: 1 },
  staggerResistances: { slash: 1, pierce: 1, blunt: 1 },
});

// ---- Checks ----

export interface Check {
  step: string;
  ok: boolean;
  text: string;
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** Passive costs on one Augment or piece of Equipment against its max (Act 7, "Passives"). */
function passiveChecks(step: string, label: string, passives: Passive[], max: number): Check[] {
  const positive = sum(passives.filter((p) => p.cost > 0).map((p) => p.cost));
  const negative = -sum(passives.filter((p) => p.cost < 0).map((p) => p.cost));
  const net = positive - negative;
  const checks: Check[] = [{ step, ok: net <= max, text: `${label}: Passive Cost ${net} of ${max}` }];
  if (negative > 0) {
    checks.push({ step, ok: negative <= max, text: `${label}: Negative Passives ${negative} of ${max} allowed` });
  }
  return checks;
}

/** Max Passive Cost on a piece of Equipment, from its own Rank (or the character's, if it has none). */
export function equipmentMaxCost(e: Equipment, characterRank: number): number {
  return rankTable(e.rank ?? characterRank).equipmentMaxCost;
}

/** Game setting "Weapon properties": a Weapon picks its property and type, and a Melee Weapon carries no Ranged Pages. */
export function weaponPropertyChecks(w: Weapon, label: string): Check[] {
  const name = w.name.trim() || label;
  const melee = w.property ? WEAPON_PROPERTIES[w.property].category === "melee" : false;
  return [
    { step: "Equipment", ok: !!w.property && !!w.style, text: `${name}: Melee or Ranged property and Offensive or Defensive type chosen` },
    ...(melee && w.pages.some((p) => p.type === "ranged") ? [{ step: "Equipment", ok: false, text: `${name} is a Melee Weapon: it can't have Ranged Pages` }] : []),
  ];
}

function equipmentChecks(step: string, label: string, e: Equipment, rank: number): Check[] {
  const name = e.name.trim() || label;
  const pagesOk = e.pages.some((p) => p.kind === "basic") && e.pages.some((p) => p.kind === "special");
  return [
    { step, ok: !!e.name.trim(), text: `${label} has a name` },
    ...passiveChecks(step, name, e.passives, equipmentMaxCost(e, rank)),
    { step, ok: pagesOk, text: `${name} has a Basic Page and a Special Page` },
    {
      step,
      ok: e.pages.every((p) => p.name.trim() && p.dice.length > 0),
      text: `${name}: every Page has a name and at least one Dice`,
    },
  ];
}

/** Everything Act 5 asks for, as a checklist. A character is ready when every check passes. */
export function characterChecks(c: Character, opts: { weaponProperties?: boolean } = {}): Check[] {
  const t = rankTable(c.rank);
  const primarySpent = sum(Object.values(c.primary));
  const secondarySpent = sum(Object.values(c.secondary));
  const hands = sum(c.weapons.map((w) => w.hands));
  return [
    { step: "Stats", ok: primarySpent === t.primaryPoints, text: `Primary Stat Points: ${primarySpent} of ${t.primaryPoints} spent` },
    { step: "Stats", ok: secondarySpent === t.secondaryPoints, text: `Secondary Stat Points: ${secondarySpent} of ${t.secondaryPoints} spent` },
    {
      step: "Proficiencies",
      ok: c.proficiencies.length === proficiencyCount(c.rank) && c.proficiencies.every((p) => p.name.trim()),
      text: `Proficiencies: ${c.proficiencies.length} of ${proficiencyCount(c.rank)} chosen`,
    },
    { step: "Augment", ok: !!c.augment.name.trim(), text: "Augment has a name" },
    ...passiveChecks("Augment", "Augment", c.augment.passives, t.augmentMaxCost),
    { step: "Equipment", ok: c.weapons.length > 0, text: "At least one Weapon" },
    { step: "Equipment", ok: hands <= 2, text: `Weapons use ${hands} of 2 hands` },
    { step: "Equipment", ok: !!c.armor, text: "One Armor" },
    ...c.weapons.flatMap((w, i) => [...equipmentChecks("Equipment", `Weapon ${i + 1}`, w, c.rank), ...(opts.weaponProperties ? weaponPropertyChecks(w, `Weapon ${i + 1}`) : [])]),
    ...(c.armor ? equipmentChecks("Equipment", "Armor", c.armor, c.rank) : []),
    { step: "Finishing Touches", ok: !!c.name.trim(), text: "Character has a name" },
    ...inventoryChecks(c),
    ...deckChecks(c),
  ];
}

