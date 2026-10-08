// Numbers and checks from the ruleset (github.com/AshtonWooster/LoR_PMTTRPG, Rules.md).
//
// The ruleset doesn't have its tables yet ("Stats table", "Max Costs table", and
// Effects_Passives_Proficiencies.md are empty). Every value marked PLACEHOLDER below stands in
// for one of those; replace it here when the table is written and the whole app follows.
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
} from "./character.ts";
import type { Resources, SpawnData } from "./types.ts";

/** Act 5, Step 1: "For most campaigns, it is encouraged to start at Rank 9." */
export const STARTING_RANK = 9;
/** Fixer Grades run from 9 (newest) to 1. */
export const RANKS = [9, 8, 7, 6, 5, 4, 3, 2, 1];

export const PRIMARY_STATS: { key: PrimaryStat; label: string; effect: string }[] = [
  { key: "fortitude", label: "Fortitude", effect: "Raises max Health" },
  { key: "prudence", label: "Prudence", effect: "Raises max Sanity" },
  { key: "justice", label: "Justice", effect: "Added to Speed rolls" },
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
  baseHp: number;
  baseStagger: number;
  baseSanity: number;
  baseLight: number;
  /** Max total Passive Cost on the Augment. */
  augmentMaxCost: number;
  /** Max total Passive Cost on each piece of Equipment. */
  equipmentMaxCost: number;
}

/** PLACEHOLDER for the "Stats table" and "Max Costs table": grows as rank improves (9 → 1). */
export function rankTable(rank: number): RankTable {
  const step = Math.max(0, STARTING_RANK - rank);
  return {
    primaryPoints: 4 + step * 2,
    secondaryPoints: 3 + step,
    baseHp: 30 + step * 6,
    baseStagger: 20 + step * 4,
    baseSanity: 15,
    baseLight: 3,
    augmentMaxCost: 3 + step,
    equipmentMaxCost: 3 + step,
  };
}

/** Proficiencies: 2 at Rank 9, then 2 more at each Rank Up (4 at Rank 8, 6 at Rank 7, ...). */
export function proficiencyCount(rank: number): number {
  return 2 + Math.max(0, STARTING_RANK - rank) * 2;
}

/** Act 2: Fortitude raises max Health, Prudence max Sanity, Temperance max Stagger Resist. */
export function maxResources(c: Pick<Character, "rank" | "primary">): Pick<Resources, "maxHp" | "maxStagger" | "maxSanity" | "maxLight"> {
  const t = rankTable(c.rank);
  return {
    maxHp: t.baseHp + c.primary.fortitude,
    maxStagger: t.baseStagger + c.primary.temperance,
    maxSanity: t.baseSanity + c.primary.prudence,
    maxLight: t.baseLight,
  };
}

// ---- Combat (Act 8) ----

/** Combat Start: every character rolls 1d6 + Justice for Speed. */
export const SPEED_DIE = 6;

/**
 * PLACEHOLDER: "Every turn a character gets a number of Movement Points, increased by their
 * Justice and Passives." The base number isn't in the ruleset yet.
 */
export const BASE_MOVEMENT = 3;

export function movementPoints(justice: number): number {
  return BASE_MOVEMENT + Math.max(0, justice);
}

/** Upkeep: "characters restore, by default, 1 Light." */
/** A Staggered character recovers (full Stagger Resist) at the Upkeep that makes this many while Staggered. */
export const STAGGER_UPKEEPS = 2;
/** While Staggered, every Resistance (damage and Stagger) is this. */
export const STAGGERED_RESISTANCE = 2;
export const UPKEEP_LIGHT = 1;

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

/** PLACEHOLDER: Dash converts Light into Movement Points; the exchange rate isn't in the ruleset yet. */
export const DASH_LIGHT_COST = 1;
export const DASH_MOVEMENT = 2;

export const isMassAttack = (type: PageType) => type === "massSummation" || type === "massIndividual";
export const isOffensive = (kind: DiceKind) => kind === "slash" || kind === "pierce" || kind === "blunt";

/**
 * PLACEHOLDER: Story Rolls (Act 7) "roll a specific stat", but the ruleset doesn't name the die.
 * A Story Roll here is 1d20 + the stat.
 */
export const STORY_DIE = 20;

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
export function npcStats(t: NpcTemplate): NpcNumbers & { calculated: NpcNumbers } {
  const base = maxResources(t);
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
export function npcSpawnData(t: NpcTemplate): SpawnData {
  const s = npcStats(t);
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
    pages: npcPages(t).map((x) => x.page),
    deck: t.deck,
  };
  if (t.portrait) data.portrait = t.portrait;
  const passiveEffects = linkedEffects(t);
  if (passiveEffects.length) data.passiveEffects = passiveEffects;
  return data;
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
export function characterChecks(c: Character): Check[] {
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
    ...c.weapons.flatMap((w, i) => equipmentChecks("Equipment", `Weapon ${i + 1}`, w, c.rank)),
    ...(c.armor ? equipmentChecks("Equipment", "Armor", c.armor, c.rank) : []),
    { step: "Finishing Touches", ok: !!c.name.trim(), text: "Character has a name" },
    ...inventoryChecks(c),
    ...deckChecks(c),
  ];
}
