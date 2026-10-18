// Combat (Act 8) and Pages (Act 3): turn phases, decks, slotting Pages, and resolving them,
// including Dice Clashes, Counter Dice and Mass Attacks. Runs on the host (the GM's browser).
import type { Dice, InventoryItem, Page, ResistanceSet } from "./character.ts";
import type { SheetAccess } from "./rewards.ts";
import { ActionError, clamp, log, occupied, type Actor } from "./core.ts";
import { secret } from "./secrets.ts";
export type { Actor };
import {
  arriveAtRoundStart,
  decayAtEnd,
  isLive,
  noResult,
  PRESET_EFFECTS,
  runTrigger,
  withPct,
  type DamageSource,
  type EffectDef,
  type EffectOps,
  type TriggerOptions,
  type TriggerResult,
  type When,
} from "./effects.ts";
import { newId, rollDie } from "./id.ts";
import {
  enemyDeck,
  isMassAttack,
  isOffensive,
  linkItem,
  moveCost,
  movementPoints,
  SPEED_DICE,
  SPEED_DIE,
  STARTING_HAND,
  STORY_DIE,
  storyOutcome,
  UPKEEP_DRAW,
  STAGGER_UPKEEPS,
  STAGGERED_RESISTANCE,
  UPKEEP_LIGHT,
  isAmmo,
  PARTIAL_COVER,
  pageRange,
  spendOne,
  asMeleeWithoutAmmo,
  PANIC_DIE,
  PANIC_TYPES,
  PANIC_UPKEEPS,
  PANIC_RECOVERY_ROLL,
  KO_RECOVERY_ROLL,
  KO_UPKEEPS,
  reviveHealth,
  recoverySanity,
  restPerHour,
  MAX_REST_HOURS,
} from "./ruleset.ts";
import type {
  Card,
  ClashFx,
  Cover,
  Combatant,
  CombatState,
  DeckState,
  FxDie,
  FxMassSide,
  FxRound,
  FxState,
  PageSource,
  PanicType,
  Side,
  SlottedPage,
  TableState,
  Token,
} from "./types.ts";

// ---- What the host knows about each character's Pages ----

/** A player's Pages, from their character sheet. The host supplies these; enemies use token.pages. */
export interface Loadout {
  /** Every Page the character might use, by id. */
  pages: Record<string, Page>;
  /** Combat Deck page ids, one entry per copy. */
  deck: string[];
  /** Auxiliary Deck: one entry per copy, with the inventory Tool it comes from (none for a Proficiency's Page). */
  aux: { pageId: string; itemId?: string }[];
  /** E.G.O. Page ids. */
  ego?: string[];
  /** Stat values by key (primary and secondary), for Story Rolls and effects. */
  stats?: Record<string, number>;
  /** The character's Rank (9 to 1), for Resting. */
  rank?: number;
  /** Library ids of the automated effects the character's Passives and Proficiencies link to. */
  passiveEffects?: string[];
  resistances?: ResistanceSet;
  staggerResistances?: ResistanceSet;
}

export interface EngineContext {
  loadout(tokenId: string): Loadout | undefined;
  /** A Tool's Auxiliary Page was used, so the host can count down the item's uses. */
  onToolUsed?(tokenId: string, itemId: string): void;
  /** An automated effect from the game's library (the built-in ones are always there). */
  effectDef?(id: string): EffectDef | undefined;
  /** The Game setting "Effects wear off when combat ends" (shared/types.ts). */
  clearEffectsAfterCombat?(): boolean;
  /** The Game setting "Ranged Pages use Ammo" (shared/types.ts). */
  rangedAmmo?(): boolean;
  /** The Game setting "Knocked Out rules" (shared/types.ts), read when combat starts. */
  knockOutRules?(): boolean;
  /** The Game setting "Recover when combat ends" (shared/types.ts). */
  endOfCombatRecovery?(): boolean;
  /** Whether players may make Story Rolls on their own (Game settings). Missing: they may. */
  playersStoryRoll?(): boolean;
  /** Players' Ahn and inventories, for popups that hand out or take away items and Ahn (shared/rewards.ts). */
  sheets?: SheetAccess;
}

/**
 * The context of the action being applied. applyAction sets it for the length of one action, so
 * effects deep inside a clash can read the effect library and players' Passives.
 */
let engineCtx: EngineContext | undefined;

export function withContext<T>(ctx: EngineContext | undefined, fn: () => T): T {
  const before = engineCtx;
  engineCtx = ctx;
  try {
    return fn();
  } finally {
    engineCtx = before;
  }
}

// ---- Small helpers ----

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rollDie(i + 1) - 1;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function activeToken(table: TableState): Token | undefined {
  const c = table.combat;
  return c ? table.tokens[c.order[c.turn]?.tokenId] : undefined;
}

/** Whose turn the GM is playing: the active combatant, when it's one of the GM's characters. */
export function gmTurnToken(table: TableState): Token | undefined {
  const t = activeToken(table);
  return t && t.side !== "player" ? t : undefined;
}

/** Speed: 1d6 + Justice, plus anything the character's effects add ("When I roll Speed"). */
export function rollSpeed(table: TableState, token: Token, dice = SPEED_DICE): Combatant {
  const fx = trigger(table, "speed", token);
  const roll = rollWith(table, token, SPEED_DIE + fx.max, fx);
  const bonus = (token.justice ?? 0) + fx.power;
  // Effects can add Speed Dice (Speed, Speed II) or take one away.
  const total = Math.max(0, Math.min(10, dice + fx.dice));
  return { tokenId: token.id, roll, bonus, speed: roll + bonus, dice: total, ...(total !== dice ? { baseDice: dice } : {}) };
}

/** Notes who just rolled Speed, so every screen plays the roll. */
export function markSpeedRoll(c: CombatState, tokenIds: string[]) {
  c.speedRoll = { id: newId(), tokenIds };
}

export function speedText(t: Token, c: Combatant) {
  return `${t.name} ${c.speed}${secret(t, "justice", ` (${c.roll}${c.bonus >= 0 ? "+" : ""}${c.bonus})`)}`;
}

/** Enemies oppose the party (players and allies); neutral characters oppose everyone. */
export function opposed(a: Side, b: Side): boolean {
  const team = (s: Side) => (s === "player" || s === "ally" ? "party" : s);
  return a !== b && (team(a) !== team(b) || a === "neutral" || b === "neutral");
}

/** Highest Speed first. On a tie players go before enemies; other ties keep their order (the GM can swap them). */
export function sortOrder(table: TableState, order: Combatant[]): Combatant[] {
  const sideRank = (c: Combatant) => (table.tokens[c.tokenId]?.side === "player" ? 0 : 1);
  return [...order].sort((a, b) => b.speed - a.speed || sideRank(a) - sideRank(b));
}

const knockedOut = (t: Token | undefined) => !t || !!t.status?.knockedOut;
const staggered = (t: Token | undefined) => !!t?.status?.staggered;
/** Out of the fight for now: Knocked Out, or Staggered (can't act or use dice). */
const down = (t: Token | undefined) => knockedOut(t) || staggered(t);
/** Knocked Out rules (Game setting, fixed for the combat): they apply to players' characters only. */
const koRules = (table: TableState, t: Token | undefined) => !!table.combat?.knockOutRules && t?.side === "player";
/** A Knocked Out player character who isn't Dead yet, under the Knocked Out rules: Pages can still target them, and allies can revive them. */
export function revivable(table: TableState, t: Token | undefined): boolean {
  return !!t && koRules(table, t) && !!t.status?.knockedOut && !t.status.dead;
}
/** A Stat from the character's sheet (players), or Justice from the token. */
const statOf = (t: Token, key: string) => engineCtx?.loadout(t.id)?.stats?.[key] ?? (key === "justice" ? (t.justice ?? 0) : 0);
const distance = (a: Token, b: Token) => moveCost(a, b);
const diceText = (d: Dice) => `${d.counter ? "Counter " : ""}${d.kind[0].toUpperCase()}${d.kind.slice(1)} 1d${d.sides}${d.basePower >= 0 ? "+" : ""}${d.basePower}`;

// ---- Decks (Act 7, "Deck Interactions") ----

/** Enemies carry their own Pages and deck on the token; players' come from their character sheet. */
function enemyLoadout(token: Token): Loadout {
  const pages = token.pages ?? [];
  return { pages: Object.fromEntries(pages.map((p) => [p.id, p])), deck: enemyDeck(pages, token.deck), aux: [] };
}

function setUpDeck(c: CombatState, token: Token, ctx: EngineContext | undefined) {
  const loadout = token.side !== "player" ? enemyLoadout(token) : ctx?.loadout(token.id);
  if (!loadout) return;
  Object.assign(c.pages, loadout.pages);
  const deck: DeckState = {
    draw: shuffle(loadout.deck.map((pageId) => ({ id: newId(), pageId }))),
    hand: [],
    discard: [],
    aux: loadout.aux.map((a) => ({ id: newId(), pageId: a.pageId, ...(a.itemId ? { itemId: a.itemId } : {}) })),
    auxUsed: [],
    ego: (loadout.ego ?? []).map((pageId) => ({ id: newId(), pageId })),
    egoUsed: [],
  };
  c.decks[token.id] = deck;
  if (panicType(token) !== 2) for (let i = 0; i < STARTING_HAND; i++) draw(c, token.id);
  if (loadout.resistances) token.resistances = loadout.resistances;
  if (loadout.staggerResistances) token.staggerResistances = loadout.staggerResistances;
}

/** Take the top Page of the Combat Deck into the hand. An empty deck reshuffles the discard pile. */
function draw(c: CombatState, tokenId: string): Card | undefined {
  const deck = c.decks[tokenId];
  if (!deck) return;
  if (deck.draw.length === 0) {
    if (deck.discard.length === 0) return;
    deck.draw = shuffle(deck.discard);
    deck.discard = [];
  }
  const card = deck.draw.pop()!;
  deck.hand.push(card);
  return card;
}

/** A used Page goes to the top of the discard pile (or, for Auxiliary Pages, out until combat ends). */
function discard(c: CombatState, slot: SlottedPage) {
  const deck = c.decks[slot.ownerId];
  if (!deck || !slot.card) return;
  if (slot.fromAux) deck.auxUsed.push(slot.card);
  else if (slot.fromEgo) (deck.egoUsed ??= []).push(slot.card);
  else deck.discard.push(slot.card);
}

/** The pile a source's cards live in during combat. */
function pile(deck: DeckState | undefined, source: PageSource): Card[] | undefined {
  if (!deck) return undefined;
  return source === "aux" ? deck.aux : source === "ego" ? (deck.ego ?? []) : deck.hand;
}

const SOURCE_NAMES: Record<PageSource, string> = { hand: "the hand", aux: "the Auxiliary Deck", ego: "your E.G.O. Pages" };

// ---- Resources and statuses ----

function resistance(t: Token, set: ResistanceSet | undefined, kind: Dice["kind"], stagger: boolean): number {
  if (!isOffensive(kind)) return 1;
  if (staggered(t)) return STAGGERED_RESISTANCE;
  // Changed for a while by an automated effect (the newest change wins).
  const mod = [...(t.resistMods ?? [])].reverse().find((m) => m.kind === kind && m.stagger === stagger);
  if (mod) return mod.value;
  return set?.[kind as keyof ResistanceSet] ?? 1;
}

/**
 * Offensive Dice deal (Final Power) × (target's Type Resistance) damage, and the same amount ×
 * their Stagger Resistance as Stagger damage. Both round up.
 */
function dealDamage(table: TableState, target: Token, amount: number, kind: Dice["kind"], attacker?: Token, die?: Dice, play: PagePlay = {}) {
  const page = { page: play.page, nth: play.nth, oneSided: play.oneSided };
  // Effects of the one hitting (e.g. Poise) can add damage before Resistances.
  const hit = attacker && die ? trigger(table, "hit", attacker, { other: target, die, ...page }) : noResult();
  amount = withPct(Math.max(0, amount + hit.damage), hit.pct);
  // Effects of the one being hit ([Type] Protection, [Type] Fragile), also before Resistances.
  if (attacker && die) {
    const fx = trigger(table, "takingHit", target, { other: attacker, die, dieIsMine: false, event: { amount, source: "attack" }, ...page });
    amount = withPct(Math.max(0, amount + fx.damage - fx.reduce), fx.pct);
  }
  const source: DamageSource<Token> = { attack: true, by: attacker };
  // Health-only and Stagger-only changes from the one hitting ("Slash damage +1", "Stagger damage +1") come after Resistances.
  const health = withPct(Math.max(0, Math.ceil(amount * resistance(target, target.resistances, kind, false)) + hit.health), hit.healthPct);
  const dmg = incoming(table, target, health, "health", source, die);
  const stagger = withPct(Math.max(0, Math.ceil(amount * resistance(target, target.staggerResistances, kind, true)) + hit.stagger), hit.staggerPct);
  const r = target.resources;
  r.hp = Math.max(0, r.hp - dmg);
  log(table, `  ${target.name} takes ${secret(target, "hp", `${dmg} `)}${kind} damage${secret(target, "hp", ` (${r.hp}/${r.maxHp} Health)`)}.`);
  staggerDamage(table, target, stagger, source, die);
  checkKnockedOut(table, target, attacker);
  // Effects of the one hit (e.g. Rupture).
  if (attacker && die) trigger(table, "wasHit", target, { other: attacker, die, dieIsMine: false, ...page });
}

/** The Page a die comes from and how it lands, for effects that ask about "the Page". */
interface PagePlay {
  page?: Page;
  nth?: number;
  oneSided?: boolean;
  /** A Ranged Page against a target in Partial Cover: Final Power - 2. */
  cover?: boolean;
}

/**
 * Health or Stagger damage about to land: the target's "When I'm about to take damage" rules can
 * raise it, lower it or block it (Protection, Fragile, Resistance to Burn, Temporary Health).
 */
function incoming(table: TableState, target: Token, amount: number, type: "health" | "stagger", source: DamageSource<Token>, die?: Dice): number {
  if (amount <= 0) return 0;
  const by = source.by && source.by !== target ? source.by : undefined;
  const fx = trigger(table, "takingDamage", target, { other: by, die, dieIsMine: false, event: { amount, type, source: source.attack ? "attack" : source.effectId } });
  return withPct(Math.max(0, amount + fx.damage - fx.reduce), fx.pct);
}

function checkKnockedOut(table: TableState, target: Token, by?: Token) {
  if (target.resources.hp === 0 && !target.status?.knockedOut) {
    target.status = { ...target.status, knockedOut: true };
    log(table, `  ${target.name} is Knocked Out!`);
    if (koRules(table, target)) {
      target.status = { ...target.status, koUpkeeps: 0 };
      log(table, `  An ally can revive ${target.name} with a Temperance Story Roll of ${KO_RECOVERY_ROLL} or more; after ${KO_UPKEEPS} Upkeeps they're Dead.`);
    }
    onKnockedOut(table, target);
    if (by && by !== target) trigger(table, "knockOut", by, { other: target });
    // Everyone else still fighting hears about it (Hook, Remembrance, Corpse Cleanup).
    for (const t of fighters(table)) if (t !== target) trigger(table, "someoneDown", t, { other: target });
  }
}

/** Stagger damage; with a source, the target's effects get a say first ("When I'm about to take damage"). */
function staggerDamage(table: TableState, target: Token, amount: number, source?: DamageSource<Token>, die?: Dice) {
  if (source) amount = incoming(table, target, amount, "stagger", source, die);
  if (amount <= 0) return;
  const r = target.resources;
  r.stagger = Math.max(0, r.stagger - amount);
  log(table, `  ${target.name} takes ${secret(target, "stagger", `${amount} `)}Stagger damage${secret(target, "stagger", ` (${r.stagger}/${r.maxStagger})`)}.`);
  if (r.stagger === 0 && !target.status?.staggered) {
    target.status = { ...target.status, staggered: true, staggerUpkeeps: 0 };
    log(table, `  ${target.name} is Staggered! Their Pages are discarded and their Resistances are ${STAGGERED_RESISTANCE}x until they recover.`);
    onStaggered(table, target);
    trigger(table, "staggered", target, { other: source?.by && source.by !== target ? source.by : undefined });
  }
}

/** A Staggered character can't use dice: their slotted Pages go to the discard pile and their Counter Dice are lost. */
function onStaggered(table: TableState, t: Token) {
  const c = table.combat;
  if (!c) return;
  for (const s of c.slots.filter((x) => x.ownerId === t.id)) removeSlot(c, s);
  c.counters[t.id] = [];
}

/** At the character's Upkeep: count it, and recover once they've passed enough while Staggered. */
function staggerUpkeep(table: TableState, t: Token) {
  if (!staggered(t)) return;
  const passed = (t.status?.staggerUpkeeps ?? 0) + 1;
  if (passed >= STAGGER_UPKEEPS) {
    t.status = { ...t.status, staggered: false, staggerUpkeeps: 0 };
    t.resources.stagger = t.resources.maxStagger;
    log(table, `  ${t.name} recovers from Stagger${secret(t, "stagger", ` (${t.resources.stagger}/${t.resources.maxStagger})`)}; Resistances are back to normal.`);
    trigger(table, "recovered", t);
  } else {
    t.status = { ...t.status, staggerUpkeeps: passed };
    log(table, `  ${t.name} is Staggered and can't act (recovers in ${STAGGER_UPKEEPS - passed} more Upkeep${STAGGER_UPKEEPS - passed === 1 ? "" : "s"}).`);
  }
}

function recoverStagger(table: TableState, t: Token, amount: number) {
  const r = t.resources;
  const before = r.stagger;
  r.stagger = Math.min(r.maxStagger, r.stagger + amount);
  const wasStaggered = !!t.status?.staggered;
  if (r.stagger > 0 && wasStaggered) {
    // Recovering from Stagger always brings Stagger Resist back to full, however little was recovered.
    t.status = { ...t.status, staggered: false, staggerUpkeeps: 0 };
    r.stagger = r.maxStagger;
    log(table, `  ${t.name} recovers from Stagger${secret(t, "stagger", ` (${r.stagger}/${r.maxStagger})`)}; Resistances are back to normal.`);
    trigger(table, "recovered", t);
  } else if (r.stagger > before) log(table, secret(t, "stagger", `  ${t.name} recovers ${r.stagger - before} Stagger Resist.`));
}

/** Clash Win heals 1 Sanity, Clash Lose costs 1. Sanity runs from -max to +max; the minimum means Panic. */
function changeSanity(table: TableState, t: Token, delta: number) {
  const r = t.resources;
  // Panicking: Sanity stays at its minimum until they recover.
  if (panicType(t)) {
    r.sanity = -r.maxSanity;
    return;
  }
  r.sanity = clamp(r.sanity + delta, -r.maxSanity, r.maxSanity);
  const panic = r.sanity <= -r.maxSanity;
  if (panic === !!t.status?.panic) return;
  if (!panic) return clearPanic(t);
  t.status = { ...t.status, panic };
  rollPanicType(table, t);
  trigger(table, "panic", t);
}

// ---- Panic types ----

/** How the character is Panicking; undefined when they aren't. */
export function panicType(t: Token | undefined): PanicType | undefined {
  return t?.status?.panic ? t.status.panicType : undefined;
}

/** On Panicking, a d4 says how. Sanity is held at its minimum until they recover. */
function rollPanicType(table: TableState, t: Token) {
  const type = rollDie(PANIC_DIE) as PanicType;
  t.status = { ...t.status, panic: true, panicType: type, panicUpkeeps: 0 };
  t.resources.sanity = -t.resources.maxSanity;
  const { label, effect } = PANIC_TYPES[type];
  log(table, `  ${t.name} Panics! d${PANIC_DIE}: ${type}, ${label}: ${effect} for ${PANIC_UPKEEPS} Upkeeps.`);
}

function clearPanic(t: Token) {
  const status = { ...t.status, panic: false };
  delete status.panicType;
  delete status.panicUpkeeps;
  delete status.panicRecoveryFails;
  t.status = status;
}

/** At the character's Upkeep: count it, and recover (Sanity back to 0) after enough while Panicking. */
function panicUpkeep(table: TableState, t: Token) {
  const type = panicType(t);
  if (!type) return;
  const passed = (t.status?.panicUpkeeps ?? 0) + 1;
  if (passed >= PANIC_UPKEEPS) recoverFromPanic(table, t);
  else {
    t.status = { ...t.status, panicUpkeeps: passed };
    const left = PANIC_UPKEEPS - passed;
    log(table, `  ${t.name} is Panicking: ${PANIC_TYPES[type].effect} (recovers in ${left} more Upkeep${left === 1 ? "" : "s"}).`);
  }
}

/** Out of Panic, with Sanity back at 0. */
function recoverFromPanic(table: TableState, t: Token) {
  clearPanic(t);
  t.resources.sanity = 0;
  log(table, `  ${t.name} recovers from Panic${secret(t, "sanity", " (Sanity 0)")}.`);
}

/** Allies a character can help out of Panic: Panicking, on their side, and not themselves. */
export function canRecoverFromPanic(helper: Token | undefined, t: Token | undefined): boolean {
  return !!helper && !!t && helper.id !== t.id && !!t.status?.panic && !opposed(helper.side, t.side) && helper.side !== "neutral";
}

/**
 * Panic recovery: on their turn, during Combat Actions, a character helps a Panicking ally with a
 * Prudence Story Roll; at PANIC_RECOVERY_ROLL or more the ally recovers right away. Once a turn.
 * Each failed attempt on the ally adds +1 to the next one, whoever makes it, until they recover.
 */
export function panicRecovery(table: TableState, actor: Actor, tokenId: string, ctx?: EngineContext) {
  const c = table.combat!;
  const helper = actingToken(table, actor);
  const ally = table.tokens[tokenId];
  if (!ally) throw new ActionError("Token not found.");
  if (!ally.status?.panic) throw new ActionError(`${ally.name} isn't Panicking.`);
  if (!canRecoverFromPanic(helper, ally)) throw new ActionError(`${helper.name} can only help an ally out of Panic.`);
  if (c.panicRecoveryUsed) throw new ActionError(`${helper.name} already tried Panic recovery this turn.`);
  c.panicRecoveryUsed = true;
  const fails = ally.status.panicRecoveryFails ?? 0;
  log(table, `${helper.name} tries to bring ${ally.name} out of Panic${fails ? ` (+${fails} from ${fails} failed attempt${fails === 1 ? "" : "s"})` : ""}.`);
  const total = storyRoll(table, actor, helper, "prudence", ctx, fails);
  if (total >= PANIC_RECOVERY_ROLL) return recoverFromPanic(table, ally);
  ally.status = { ...ally.status, panicRecoveryFails: fails + 1 };
  log(table, `  Not enough (needs ${PANIC_RECOVERY_ROLL}): ${ally.name} is still Panicking. The next attempt gets +${fails + 1}.`);
}

/**
 * The GM set a character's Sanity by hand: at its minimum they Panic (rolling a Panic type, but no
 * "When I Panic" effects); above it, they're out of Panic.
 */
export function panicByOverride(table: TableState, t: Token) {
  if (t.resources.sanity > -t.resources.maxSanity) return clearPanic(t);
  if (t.status?.panic) return;
  t.status = { ...t.status, panic: true };
  rollPanicType(table, t);
}

// ---- Knocked Out rules (Game setting "Knocked Out rules") ----

/** One step closer to Death: an Upkeep passed while Knocked Out, or a Page with an Offensive Die resolved against them. */
function koTick(table: TableState, t: Token, why: string) {
  const passed = (t.status?.koUpkeeps ?? 0) + 1;
  if (passed >= KO_UPKEEPS) {
    t.status = { ...t.status, koUpkeeps: passed, dead: true };
    log(table, `  ${t.name} is Dead.`);
    return;
  }
  t.status = { ...t.status, koUpkeeps: passed };
  const left = KO_UPKEEPS - passed;
  log(table, `  ${why}: ${t.name} is Dead in ${left} more Upkeep${left === 1 ? "" : "s"} unless revived.`);
}

/** Back up from a Knock Out: a quarter of their Health, 3 + Prudence Sanity and full Stagger Resist. */
function revive(table: TableState, t: Token) {
  const status = { ...t.status, knockedOut: false, staggered: false, staggerUpkeeps: 0 };
  delete status.koUpkeeps;
  delete status.koRecoveryFails;
  delete status.dead;
  t.status = status;
  const r = t.resources;
  r.hp = Math.max(r.hp, reviveHealth(r.maxHp));
  r.stagger = r.maxStagger;
  log(table, `  ${t.name} is back up (${r.hp}/${r.maxHp} Health, full Stagger Resist).`);
  gainRecoverySanity(table, t);
}

/** 3 + Prudence Sanity, as a revive and the end of combat give. */
function gainRecoverySanity(table: TableState, t: Token) {
  const n = recoverySanity(statOf(t, "prudence"));
  const r = t.resources;
  const before = r.sanity;
  changeSanity(table, t, n);
  if (r.sanity !== before) log(table, secret(t, "sanity", `  ${t.name} recovers ${r.sanity - before} Sanity (${r.sanity}).`));
}

/** Allies a character can revive: Knocked Out (not Dead) players' characters on their side, not themselves. */
export function canRevive(table: TableState, helper: Token | undefined, t: Token | undefined): boolean {
  return !!helper && !!t && helper.id !== t.id && revivable(table, t) && !opposed(helper.side, t.side) && helper.side !== "neutral";
}

/**
 * Knocked Out rules: on their turn, during Combat Actions, a character revives a Knocked Out ally
 * with a Temperance Story Roll of KO_RECOVERY_ROLL or more. Both recover 3 + Prudence Sanity. Once a
 * turn; each failed attempt on the ally adds +1 to the next one, whoever makes it.
 */
export function koRecovery(table: TableState, actor: Actor, tokenId: string, ctx?: EngineContext) {
  const c = table.combat!;
  const helper = actingToken(table, actor);
  const ally = table.tokens[tokenId];
  if (!ally) throw new ActionError("Token not found.");
  if (!c.knockOutRules) throw new ActionError("The Knocked Out rules are off in this game.");
  if (!ally.status?.knockedOut) throw new ActionError(`${ally.name} isn't Knocked Out.`);
  if (ally.status.dead) throw new ActionError(`${ally.name} is Dead.`);
  if (!canRevive(table, helper, ally)) throw new ActionError(`${helper.name} can only revive an ally.`);
  if (c.koRecoveryUsed) throw new ActionError(`${helper.name} already tried to revive someone this turn.`);
  c.koRecoveryUsed = true;
  const fails = ally.status.koRecoveryFails ?? 0;
  log(table, `${helper.name} tries to revive ${ally.name}${fails ? ` (+${fails} from ${fails} failed attempt${fails === 1 ? "" : "s"})` : ""}.`);
  const total = storyRoll(table, actor, helper, "temperance", ctx, fails);
  if (total >= KO_RECOVERY_ROLL) {
    revive(table, ally);
    gainRecoverySanity(table, helper);
    return;
  }
  ally.status = { ...ally.status, koRecoveryFails: fails + 1 };
  log(table, `  Not enough (needs ${KO_RECOVERY_ROLL}): ${ally.name} is still Knocked Out. The next attempt gets +${fails + 1}.`);
}

/**
 * A Page resolving against a Knocked Out character (Knocked Out rules): it does nothing to them, but
 * its dice still go top to bottom (Defensive Dice become Counter Dice), and a Page with an Offensive
 * Die brings their Death an Upkeep closer.
 */
function resolveOnDown(table: TableState, attacker: Token, target: Token, page: Page, dice: Dice[]) {
  const c = table.combat!;
  log(table, `${attacker.name} uses ${page.name} on ${target.name}, who is Knocked Out: it does nothing to them.`);
  for (const d of dice) if (!isOffensive(d.kind)) storeCounter(c, attacker, d, page.id);
  if (dice.some((d) => isOffensive(d.kind)) && !target.status?.dead) koTick(table, target, `${page.name} lands`);
}

/** A Knocked Out character's slotted Pages go to the discard pile; Pages clashing with them stop clashing. */
function onKnockedOut(table: TableState, t: Token) {
  const c = table.combat;
  if (!c) return;
  for (const s of c.slots.filter((x) => x.ownerId === t.id)) removeSlot(c, s);
  c.counters[t.id] = [];
}

function removeSlot(c: CombatState, slot: SlottedPage) {
  // Already gone (e.g. its owner was Knocked Out or Staggered mid-clash): don't discard it twice.
  if (!c.slots.some((s) => s.id === slot.id)) return;
  c.slots = c.slots.filter((s) => s.id !== slot.id);
  for (const s of c.slots) if (s.clashWith === slot.id) delete s.clashWith;
  discard(c, slot);
}

// ---- Automated effects (shared/effects.ts) ----

/** What the effect rules may do to the table, with the same logging and Knock Out rules as dice. */
function effectOps(table: TableState): EffectOps<Token> {
  return {
    def: (id) => {
      const d = engineCtx?.effectDef?.(id) ?? PRESET_EFFECTS[id];
      return isLive(d) ? d : undefined;
    },
    passives: (t) => (t.side === "player" ? (engineCtx?.loadout(t.id)?.passiveEffects ?? []) : (t.passiveEffects ?? [])),
    stat: (t, key) => engineCtx?.loadout(t.id)?.stats?.[key] ?? (key === "justice" ? (t.justice ?? 0) : 0),
    healthPercent: (t) => (t.resources.maxHp ? (100 * t.resources.hp) / t.resources.maxHp : 0),
    sanityOf: (t) => t.resources.sanity,
    state: (t, s) => (s === "panic" ? !!t.status?.panic : staggered(t)),
    round: () => table.combat?.round ?? 0,
    near: (t, range, enemies) =>
      Object.values(table.tokens).filter((x) => x.id !== t.id && !knockedOut(x) && distance(t, x) <= range && opposed(t.side, x.side) === enemies),
    count: (t, enemies, isDown, range) =>
      Object.values(table.tokens).filter(
        (x) => x.id !== t.id && !x.hidden && knockedOut(x) === isDown && opposed(t.side, x.side) === enemies && (range === undefined || distance(t, x) <= range),
      ).length,
    out: knockedOut,
    damage: (t, n, source) => {
      n = incoming(table, t, n, "health", source);
      if (n <= 0) return;
      const r = t.resources;
      r.hp = Math.max(0, r.hp - n);
      log(table, `  ${t.name} takes ${secret(t, "hp", `${n} `)}damage${secret(t, "hp", ` (${r.hp}/${r.maxHp} Health)`)}.`);
      checkKnockedOut(table, t, source.by);
    },
    staggerDamage: (t, n, source) => staggerDamage(table, t, n, source),
    heal: (t, n) => {
      const r = t.resources;
      const before = r.hp;
      r.hp = Math.min(r.maxHp, r.hp + n);
      if (r.hp > before) {
        log(table, `  ${t.name} recovers${secret(t, "hp", ` ${r.hp - before}`)} Health${secret(t, "hp", ` (${r.hp}/${r.maxHp})`)}.`);
        trigger(table, "healed", t, { event: { amount: r.hp - before } });
      }
    },
    recoverStagger: (t, n) => recoverStagger(table, t, n),
    light: (t, n) => {
      const r = t.resources;
      if (n > 0 && panicType(t) === 3) return log(table, `  ${t.name} is Panicking and can't gain Light.`);
      const before = r.light;
      r.light = clamp(r.light + n, 0, r.maxLight);
      if (r.light !== before) log(table, secret(t, "light", `  ${t.name} ${r.light > before ? "gains" : "loses"} ${Math.abs(r.light - before)} Light.`));
    },
    sanity: (t, n) => {
      if (!n) return;
      if (panicType(t)) return log(table, secret(t, "sanity", `  ${t.name}'s Sanity stays at ${-t.resources.maxSanity} while Panicking.`));
      log(table, secret(t, "sanity", `  ${t.name} ${n > 0 ? "gains" : "loses"} ${Math.abs(n)} Sanity (${clamp(t.resources.sanity + n, -t.resources.maxSanity, t.resources.maxSanity)}).`));
      changeSanity(table, t, n);
    },
    draw: (t, n) => {
      const c = table.combat;
      if (!c?.decks[t.id]) return;
      if (panicType(t) === 2) return log(table, `  ${t.name} is Panicking and can't draw.`);
      const drawn = Array.from({ length: Math.min(n, 10) }, () => draw(c, t.id)).filter(Boolean).length;
      if (drawn) log(table, `  ${t.name} draws ${drawn}.`);
    },
    movement: (t, n) => {
      const c = table.combat;
      if (!c || !n || activeToken(table)?.id !== t.id) return;
      const before = c.movementLeft;
      c.movementLeft = Math.max(0, c.movementLeft + n);
      if (c.movementLeft !== before) log(table, `  ${t.name} ${n > 0 ? "gains" : "loses"} ${Math.abs(c.movementLeft - before)} Movement (${c.movementLeft}).`);
    },
    push: (from, t, n) => {
      // One tile at a time, straight away from (or toward) the pusher, until something is in the way.
      const sx = Math.sign(t.x - from.x) * Math.sign(n);
      const sy = Math.sign(t.y - from.y) * Math.sign(n);
      if (!sx && !sy) return;
      let moved = 0;
      for (let i = 0; i < Math.min(Math.abs(n), 20); i++) {
        const x = t.x + sx;
        const y = t.y + sy;
        if (x < 0 || y < 0 || x >= table.map.width || y >= table.map.height || occupied(table, x, y, t.id)) break;
        t.x = x;
        t.y = y;
        moved++;
      }
      if (moved) log(table, `  ${t.name} is ${n > 0 ? "pushed" : "pulled"} ${moved} ${moved === 1 ? "tile" : "tiles"}.`);
    },
    log: (line) => log(table, line),
    proc: (t, defId) => table.combat && recordProc(table.combat, t.id, defId),
    speed: (t) => table.combat?.order.find((x) => x.tokenId === t.id)?.speed ?? 0,
    resource: (t, key) => t.resources[key],
    hand: (t) => table.combat?.decks[t.id]?.hand.length ?? 0,
    used: (t) => table.combat?.used?.[t.id] ?? 0,
    discard: (t, n) => {
      const deck = table.combat?.decks[t.id];
      if (!deck) return 0;
      let gone = 0;
      for (; gone < Math.min(n, 10) && deck.hand.length; gone++) {
        const [card] = deck.hand.splice(rollDie(deck.hand.length) - 1, 1);
        deck.discard.push(card);
        log(table, `  ${t.name} discards ${secret(t, "deck", table.combat!.pages[card.pageId]?.name ?? "a Page")}.`);
      }
      return gone;
    },
    addPage: (t, names, n) => {
      const c = table.combat;
      const deck = c?.decks[t.id];
      if (!c || !deck) return;
      const own = t.side === "player" ? Object.values(engineCtx?.loadout(t.id)?.pages ?? {}) : (t.pages ?? []);
      const wanted = names.map((x) => x.toLowerCase());
      const matches = own.filter((p) => wanted.includes(p.name.trim().toLowerCase()));
      if (!matches.length) return log(table, `  ${t.name} has no Page named ${names.join(" or ")} to add.`);
      for (let i = 0; i < Math.min(n, 10); i++) {
        const page = matches[rollDie(matches.length) - 1];
        c.pages[page.id] ??= page;
        deck.hand.push({ id: newId(), pageId: page.id });
        log(table, `  ${t.name} adds ${secret(t, "deck", page.name)} to their hand.`);
      }
    },
    costDown: (t, n) => {
      const c = table.combat;
      const deck = c?.decks[t.id];
      const cards = (deck?.hand ?? []).filter((x) => (c!.pages[x.pageId]?.cost ?? 0) >= 1);
      if (!c || !cards.length) return;
      const card = cards[rollDie(cards.length) - 1];
      card.discount = { n: (card.discount?.round === c.round ? card.discount.n : 0) + n, round: c.round };
      log(table, `  ${t.name}'s ${secret(t, "deck", c.pages[card.pageId]?.name ?? "Page")} costs ${n} less this round.`);
    },
    counterDie: (t, die) => {
      const c = table.combat;
      if (!c) return;
      storeCounter(c, t, die, "");
      log(table, `  ${t.name} gains a Counter ${diceText(die)}.`);
    },
    resist: (t, kind, isStagger) => resistance(t, isStagger ? t.staggerResistances : t.resistances, kind, isStagger),
    setResist: (t, kind, value, which, until) => {
      const round = until === "combat" ? undefined : (table.combat?.round ?? 0) + (until === "nextRound" ? 1 : 0);
      const sides = which === "both" ? [false, true] : [which === "stagger"];
      for (const stagger of sides) {
        t.resistMods = [...(t.resistMods ?? []).filter((m) => !(m.kind === kind && m.stagger === stagger)), { kind, stagger, value, ...(round !== undefined ? { round } : {}) }];
      }
      log(table, secret(t, "resistances", `  ${t.name}'s ${which === "stagger" ? "Stagger " : ""}Resistance${which === "both" ? "s" : ""} to ${kind} ${which === "both" ? "are" : "is"} now ${value}x${until === "round" ? " this round" : ""}.`));
    },
    enemies: (a, b) => opposed(a.side, b.side),
    speedDice: (t, n) => {
      const entry = table.combat?.order.find((x) => x.tokenId === t.id);
      if (!entry || !n) return;
      const dice = Math.max(0, Math.min(10, entry.dice + n));
      entry.baseDice = Math.max(0, (entry.baseDice ?? entry.dice) + (dice - entry.dice));
      entry.dice = dice;
      log(table, `  ${t.name} now has ${dice} Speed ${dice === 1 ? "Die" : "Dice"}.`);
    },
  };
}

/** Runs a moment's rules for a character. "They", the die and its owner come in `opts`. */
function trigger(table: TableState, when: When, holder: Token, opts: TriggerOptions<Token> = {}) {
  return runTrigger(effectOps(table), when, holder, opts);
}

type RollFx = Pick<TriggerResult, "advantage" | "min" | "rollMax" | "rerollMin">;

/**
 * A die roll from 1 (plus any raised Min) to its size. Advantage rolls one die more than its count
 * and keeps the highest; Disadvantage the same, keeping the lowest (they cancel each other out
 * first). Effects can also make it roll its Max, or roll again once on its Min.
 */
function rollWith(table: TableState, owner: Token, sides: number, fx: RollFx): number {
  const max = Math.max(1, sides);
  const min = Math.max(1, Math.min(max, 1 + fx.min));
  if (panicType(owner) === 1) {
    log(table, `  ${owner.name} is Panicking: the die rolls its Min (${min}).`);
    return min;
  }
  if (fx.rollMax) {
    log(table, `  ${owner.name}'s die rolls its Max (${max}).`);
    return max;
  }
  const once = () => {
    const one = () => min + rollDie(max - min + 1) - 1;
    if (!fx.advantage) return one();
    const rolls = Array.from({ length: Math.min(10, Math.abs(fx.advantage)) + 1 }, one);
    const kept = fx.advantage > 0 ? Math.max(...rolls) : Math.min(...rolls);
    log(table, `  ${owner.name} rolls with ${fx.advantage > 0 ? "advantage" : "disadvantage"}: ${rolls.slice(0, -1).join(", ")} and ${rolls[rolls.length - 1]}, keeps ${kept}.`);
    return kept;
  };
  const roll = once();
  if (!fx.rerollMin || roll !== min || min === max) return roll;
  const again = once();
  log(table, `  ${owner.name} rolled the Min (${roll}) and rolls again: ${again}.`);
  return again;
}

// ---- Dice Clashes (Act 3, "Dice") ----

interface LiveDie {
  die: Dice;
  owner: Token;
  pageType: Page["type"];
  /** The Page it's on, for effects that ask about it. */
  play?: PagePlay;
}

/**
 * Final Power = roll + Base Power, plus anything the roller's effects add (e.g. Strength) and the
 * opponent's take away (Enemy Power Down). Effects can also change the die's Max or give advantage.
 */
function rollPower(table: TableState, d: Dice, owner: Token, other?: Token, play: PagePlay = {}): number {
  const page = { page: play.page, nth: play.nth };
  const mine = trigger(table, "roll", owner, { other, die: d, ...page });
  const theirs = other ? trigger(table, "theyRoll", other, { other: owner, die: d, dieIsMine: false, ...page }) : undefined;
  const fx: RollFx = {
    // A Ranged Page fired without Ammo rolls every die with disadvantage.
    advantage: mine.advantage + (theirs?.advantage ?? 0) - (play.page?.noAmmo ? 1 : 0),
    min: mine.min + (theirs?.min ?? 0),
    rollMax: mine.rollMax || !!theirs?.rollMax,
    rerollMin: mine.rerollMin || !!theirs?.rerollMin,
  };
  const power = rollWith(table, owner, d.sides + mine.max + (theirs?.max ?? 0), fx) + d.basePower;
  const bonus = mine.power + (theirs?.power ?? 0);
  const final = bonus ? Math.max(0, power + bonus) : power;
  return play.cover ? partialCover(table, final) : final;
}

/** Partial Cover takes 2 off a Ranged Page's Final Power, but never takes it below 1. */
function partialCover(table: TableState, power: number): number {
  const after = Math.max(Math.min(power, 1), power - PARTIAL_COVER);
  if (after !== power) log(table, `  Partial Cover: ${power} → ${after}.`);
  return after;
}

/** How far a Melee Page reaches, for the Ranged Page rules ("outside of the target's Weapon Range"). */
const meleeReach = (page: Page | undefined) => pageRange(page ?? { type: "melee" });

interface ClashOutcome {
  winner: "a" | "b" | "draw";
  /** The Final Powers rolled. */
  fa: number;
  fb: number;
  /** What happens to each die afterwards: gone, reused as the current die, or moved to the bottom of its page. */
  a: "gone" | "recycle" | "bottom";
  b: "gone" | "recycle" | "bottom";
}

/**
 * Two Dice clash: higher Final Power wins, equal is a Draw (both Negated), Evade vs Evade is
 * always a Draw. Applies damage, Stagger and Sanity as the ruleset describes.
 */
function clashDice(
  table: TableState,
  a: LiveDie,
  b: LiveDie,
  fa = rollPower(table, a.die, a.owner, b.owner, a.play),
  fb = rollPower(table, b.die, b.owner, a.owner, b.play),
): ClashOutcome {
  const desc = `${a.owner.name}'s ${diceText(a.die)} (${fa}) vs ${b.owner.name}'s ${diceText(b.die)} (${fb})`;
  if (fa === fb || (a.die.kind === "evade" && b.die.kind === "evade")) {
    log(table, ` ${desc}: Draw, both Negated.`);
    return { winner: "draw", a: "gone", b: "gone", fa, fb };
  }
  const aWins = fa > fb;
  const [w, l, fw, fl] = aWins ? [a, b, fa, fb] : [b, a, fb, fa];
  log(table, ` ${desc}: ${w.owner.name} wins.`);
  const wPlay: PagePlay = { ...w.play, oneSided: false };
  changeSanity(table, w.owner, 1);
  changeSanity(table, l.owner, -1);
  let wKeep: ClashOutcome["a"] = "gone";

  if (isOffensive(w.die.kind)) {
    if (isOffensive(l.die.kind)) {
      // Melee vs Ranged: the winning melee die deals no damage; it's recycled to the bottom of the page.
      if (w.pageType === "melee" && l.pageType === "ranged") {
        log(table, `  Melee beats Ranged: the die is recycled to the bottom of the Page.`);
        wKeep = "bottom";
      } else dealDamage(table, l.owner, fw, w.die.kind, w.owner, w.die, wPlay);
    } else if (l.die.kind === "block") {
      // A losing Block reduces the damage (before Type Resistance) by its Final Power.
      dealDamage(table, l.owner, Math.max(0, fw - fl), w.die.kind, w.owner, w.die, wPlay);
    } else dealDamage(table, l.owner, fw, w.die.kind, w.owner, w.die, wPlay);
  } else if (w.die.kind === "block") {
    if (isOffensive(l.die.kind)) {
      // A Ranged attacker outside the Melee target's range takes no Stagger damage from a winning Block.
      const rangedSafe = l.pageType === "ranged" && w.pageType === "melee" && distance(l.owner, w.owner) > meleeReach(w.play?.page);
      if (rangedSafe) log(table, `  ${l.owner.name} is out of melee range: no Stagger damage.`);
      else staggerDamage(table, l.owner, fw - fl, { attack: true, by: w.owner }, w.die);
    } else staggerDamage(table, l.owner, fw, { attack: true, by: w.owner }, w.die);
  } else if (w.die.kind === "evade") {
    recoverStagger(table, w.owner, fw);
    if (isOffensive(l.die.kind)) wKeep = "recycle";
  }
  trigger(table, "clashWin", w.owner, { other: l.owner, die: w.die, page: w.play?.page, nth: w.play?.nth });
  trigger(table, "clashLose", l.owner, { other: w.owner, die: l.die, page: l.play?.page, nth: l.play?.nth });
  return aWins ? { winner: "a", a: wKeep, b: "gone", fa, fb } : { winner: "b", a: "gone", b: wKeep, fa, fb };
}

const fxDie = (d: Dice, power: number): FxDie => ({ kind: d.kind, sides: d.sides, basePower: d.basePower, power, ...(d.counter ? { counter: true } : {}) });

/** Resources and statuses of these tokens right now, for the animation to show at the right moment. */
const fxState = (...tokens: Token[]): FxState =>
  Object.fromEntries(tokens.map((t) => [t.id, { resources: { ...t.resources }, ...(t.status ? { status: { ...t.status } } : {}) }]));

/** Status Effects going off kept for screens to catch up on: enough for one busy clash. */
export const MAX_PROCS = 16;

/** Remember a resolution for the clash animation; only the latest few are kept. */
function recordFx(c: CombatState, fx: Omit<ClashFx, "id">) {
  if (fx.rounds.length === 0) return;
  c.fxSeq = (c.fxSeq ?? 0) + 1;
  c.fx = [...(c.fx ?? []), { ...fx, id: c.fxSeq }].slice(-8);
}

/** Remember a status Effect going off, for its VFX; only the latest few are kept. */
export function recordProc(c: CombatState, tokenId: string, defId: string) {
  c.procSeq = (c.procSeq ?? 0) + 1;
  c.procs = [...(c.procs ?? []), { id: c.procSeq, tokenId, defId }].slice(-MAX_PROCS);
}

/** Unused Defensive Dice become Counter Dice on their owner. */
function storeCounter(c: CombatState, owner: Token, die: Dice, pageId: string) {
  (c.counters[owner.id] ??= []).push({ id: newId(), die: { ...die, counter: true }, pageId });
}

// ---- Resolving Pages (Act 8, "Resolve Slotted Pages") ----

/**
 * One die of a One-Sided Attack, already rolled: their oldest Counter Die answers it, if they have one;
 * otherwise an Offensive die hits and a Defensive one becomes the attacker's Counter Die (nothing to show).
 * A Counter Die that wins stays first and answers the next die too; one that loses or Draws is spent.
 * Counter Dice used against a Page are added to `used`, to be lost when the Page finishes.
 */
function oneSidedDie(table: TableState, attacker: Token, target: Token, page: Page, die: Dice, fp: number, play: PagePlay, used: Set<string>): Omit<FxRound, "after"> | undefined {
  const c = table.combat!;
  const counter = (c.counters[target.id] ?? [])[0];
  if (counter) {
    used.add(counter.id);
    const counterPage = c.pages[counter.pageId];
    const out = clashDice(
      table,
      { die, owner: attacker, pageType: page.type, play },
      { die: counter.die, owner: target, pageType: counterPage?.type ?? "melee", play: { page: counterPage } },
      fp,
    );
    // "On Clash Win, Counter Dice are Recycled": it answers the next die too. Otherwise it's spent.
    if (out.winner !== "b") c.counters[target.id] = (c.counters[target.id] ?? []).filter((x) => x.id !== counter.id);
    return { a: fxDie(die, out.fa), b: fxDie(counter.die, out.fb), result: out.winner };
  }
  if (!isOffensive(die.kind)) {
    storeCounter(c, attacker, die, page.id);
    return undefined;
  }
  log(table, ` ${attacker.name}'s ${diceText(die)} (${fp}) hits ${target.name}.`);
  dealDamage(table, target, fp, die.kind, attacker, die, { ...play, oneSided: true });
  return { a: fxDie(die, fp), result: "hit" };
}

/** Counter Dice used against a Page are lost at the end of its resolution. */
function spendCounters(c: CombatState, target: Token, used: Set<string>) {
  if (used.size) c.counters[target.id] = (c.counters[target.id] ?? []).filter((x) => !used.has(x.id));
}

/**
 * A One-Sided Attack: each die hits the target top to bottom. The target's Counter Dice answer
 * automatically, in the order they were made; any used are lost when the page finishes.
 */
function oneSided(table: TableState, attacker: Token, target: Token, page: Page, dice: Dice[], nth?: number, cover?: boolean) {
  const c = table.combat!;
  const used = new Set<string>();
  const rounds: FxRound[] = [];
  const before = fxState(attacker, target);
  for (const die of dice) {
    if (knockedOut(target) || down(attacker)) break;
    const play: PagePlay = { page, nth, ...(cover ? { cover } : {}) };
    const fp = rollPower(table, die, attacker, target, play);
    const round = oneSidedDie(table, attacker, target, page, die, fp, play, used);
    if (round) rounds.push({ ...round, after: fxState(attacker, target) });
  }
  spendCounters(c, target, used);
  recordFx(c, { a: attacker.id, b: target.id, pageA: page.name, rounds, before });
}

/** Two Pages clash: their dice clash top to bottom until one side runs out. */
function clashPages(table: TableState, a: SlottedPage, b: SlottedPage) {
  const c = table.combat!;
  const owner = (s: SlottedPage) => table.tokens[s.ownerId];
  const pa = c.pages[a.pageId];
  const pb = c.pages[b.pageId];
  const ta = owner(a);
  const tb = owner(b);
  log(table, `Clash: ${ta.name}'s ${pa.name} vs ${tb.name}'s ${pb.name}.`);
  // A Ranged Page whose target the GM marked in Partial Cover rolls 2 lower.
  const playOf = (s: SlottedPage, p: Page): PagePlay => ({ page: p, nth: s.nth, ...(p.type === "ranged" && s.cover === "partial" ? { cover: true } : {}) });
  const qa: LiveDie[] = pa.dice.filter((d) => !d.counter).map((die) => ({ die, owner: ta, pageType: pa.type, play: playOf(a, pa) }));
  const qb: LiveDie[] = pb.dice.filter((d) => !d.counter).map((die) => ({ die, owner: tb, pageType: pb.type, play: playOf(b, pb) }));
  const rounds: FxRound[] = [];
  const before = fxState(ta, tb);

  /** A Ranged Page with only Defensive Dice left, out of the Melee target's range, turns the target's Offensive Dice into Counter Dice. */
  const rangedEscape = () => {
    for (const [mine, theirs, me, them] of [
      [qa, qb, ta, tb],
      [qb, qa, tb, ta],
    ] as const) {
      const myType = mine === qa ? pa.type : pb.type;
      const theirPage = mine === qa ? pb : pa;
      // Only while the Ranged Page still has dice: once it's spent, the Melee Page's leftovers become Counter Dice below.
      if (myType === "ranged" && theirPage.type === "melee" && mine.length && !mine.some((d) => isOffensive(d.die.kind)) && distance(me, them) > meleeReach(theirPage)) {
        const converted = theirs.filter((d) => isOffensive(d.die.kind));
        if (!converted.length) continue;
        theirs.splice(0, theirs.length, ...theirs.filter((d) => !isOffensive(d.die.kind)));
        for (const d of converted) storeCounter(c, them, d.die, theirPage.id);
        log(table, `  ${me.name} is out of melee range: ${them.name}'s Offensive Dice become Counter Dice.`);
      }
    }
  };

  for (let guard = 0; qa.length && qb.length && guard < 200; guard++) {
    if (down(ta) || down(tb)) break;
    const out = clashDice(table, qa[0], qb[0]);
    rounds.push({ a: fxDie(qa[0].die, out.fa), b: fxDie(qb[0].die, out.fb), result: out.winner, after: fxState(ta, tb) });
    for (const [q, fate] of [
      [qa, out.a],
      [qb, out.b],
    ] as const) {
      if (fate === "gone") q.shift();
      else if (fate === "bottom") q.push(q.shift()!);
    }
    rangedEscape();
  }
  // Leftover dice: Offensive ones hit One-Sided (Counter Dice don't answer inside a clash);
  // Defensive ones become Counter Dice. A Melee Page's leftovers against a Ranged Page outside its
  // Weapon Range can't reach: they all become Counter Dice.
  for (const [q, me, them, page, other] of [
    [qa, ta, tb, pa, pb],
    [qb, tb, ta, pb, pa],
  ] as const) {
    if (q.length && page.type === "melee" && other.type === "ranged" && !down(me) && distance(me, them) > meleeReach(page)) {
      log(table, `  ${them.name} is out of ${me.name}'s range: ${me.name}'s ${q.length === 1 ? "last die becomes a Counter Die" : `${q.length} remaining dice become Counter Dice`}.`);
      for (const d of q) storeCounter(c, me, d.die, page.id);
      continue;
    }
    for (const d of q) {
      if (down(me) || knockedOut(them)) break;
      if (isOffensive(d.die.kind)) {
        const fp = rollPower(table, d.die, me, them, d.play);
        log(table, ` ${me.name}'s ${diceText(d.die)} (${fp}) hits ${them.name} unopposed.`);
        dealDamage(table, them, fp, d.die.kind, me, d.die, { ...d.play, oneSided: true });
        rounds.push({ [me === ta ? "a" : "b"]: fxDie(d.die, fp), result: "hit", after: fxState(ta, tb) });
      } else storeCounter(c, me, d.die, page.id);
    }
  }
  recordFx(c, { a: ta.id, b: tb.id, pageA: pa.name, pageB: pb.name, rounds, before });
}

/** The page on a target's chosen Speed Die, or one clashing with this Mass Attack. */
function defendingPage(c: CombatState, mass: SlottedPage, targetId: string, die: number) {
  return c.slots.find((s) => s.ownerId === targetId && s.id !== mass.id && (s.clashWith === mass.id || s.die === die) && !isMassAttack(c.pages[s.pageId]?.type));
}

/**
 * A Mass Attack. Every die is rolled once, and that Final Power is both its check against each
 * target's Page and the damage it deals. Summation rolls all its dice together and sums them against
 * each target's Page summed; the dice then land one by one with the same numbers. Individual rolls
 * each die in turn and meets each target's next die with it. Every target plays at once in one animation.
 * Counter Dice aren't rolled against a Mass Attack; the targets keep them for later.
 */
function resolveMass(table: TableState, slot: SlottedPage) {
  const c = table.combat!;
  const owner = table.tokens[slot.ownerId];
  const page = c.pages[slot.pageId];
  const dice = page.dice.filter((d) => !d.counter);
  const targets = slot.targets.map((t) => ({ ref: t, token: table.tokens[t.tokenId] })).filter((t) => t.token && !knockedOut(t.token));
  const downed = slot.targets.map((x) => table.tokens[x.tokenId]).filter((t): t is Token => revivable(table, t));
  log(table, `${owner.name} unleashes ${page.name} (${page.type === "massSummation" ? "Summation" : "Individual"}) on ${[...targets.map((t) => t.token), ...downed].map((t) => t.name).join(", ")}.`);
  // Knocked Out targets (under the Knocked Out rules) take nothing, but an Offensive Die brings their Death closer.
  if (dice.some((d) => isOffensive(d.kind))) for (const t of downed) koTick(table, t, `${page.name} lands on ${t.name}, who is Knocked Out`);
  const play: PagePlay = { page, nth: slot.nth };
  const tokens = [owner, ...targets.map((t) => t.token)];
  const before = fxState(...tokens);
  const rounds: FxRound[] = [];
  const pages: Record<string, string> = {};
  /** The attacker's side of a step: lands if it hit anyone, otherwise it lost. */
  const push = (round: Omit<FxRound, "result" | "after">) => {
    const sides = Object.values(round.vs ?? {});
    if (!sides.length) return;
    const landed = sides.some((v) => v.result === "a" || v.result === "hit");
    const result = landed ? "hit" : sides.every((v) => v.result === "draw") ? "draw" : "b";
    rounds.push({ ...round, result, after: fxState(...tokens) });
  };
  /**
   * One die, already rolled, landing on these targets at once. Counter Dice don't answer a Mass
   * Attack. An Offensive die hits each of them; a Defensive one has no one to clash with and becomes
   * one Counter Die on the attacker, not one per target.
   */
  const land = (die: Dice, fp: number, on: Token[], vs: Record<string, FxMassSide>) => {
    const live = on.filter((t) => !knockedOut(t));
    if (!live.length || down(owner)) return;
    if (!isOffensive(die.kind)) return storeCounter(c, owner, die, page.id);
    for (const t of live) {
      if (down(owner)) break;
      log(table, ` ${owner.name}'s ${diceText(die)} (${fp}) hits ${t.name}.`);
      dealDamage(table, t, fp, die.kind, owner, die, { ...play, oneSided: true });
      vs[t.id] = { result: "hit" };
    }
  };

  if (page.type === "massSummation") {
    // All the dice at once: the sum is the check, and each die then lands with its own number.
    const powers = dice.map((d) => rollPower(table, d, owner, undefined, play));
    const total = powers.reduce((x, y) => x + y, 0);
    const check: Record<string, FxMassSide> = {};
    const hit: Token[] = [];
    for (const { ref, token } of targets) {
      const defence = defendingPage(c, slot, token.id, ref.die);
      if (!defence) {
        hit.push(token);
        check[token.id] = { result: "hit" };
        continue;
      }
      const dp = c.pages[defence.pageId];
      pages[token.id] = dp.name;
      const theirDice = dp.dice.filter((d) => !d.counter);
      const theirPowers = theirDice.map((d) => rollPower(table, d, token, owner, { page: dp, nth: defence.nth }));
      const theirs = theirPowers.reduce((x, y) => x + y, 0);
      const fx = theirDice.map((d, i) => fxDie(d, theirPowers[i]));
      log(table, ` Summation: ${owner.name} ${total} vs ${token.name}'s ${dp.name} ${theirs}.`);
      if (theirs < total) {
        log(table, `  ${token.name}'s ${dp.name} is Negated.`);
        removeSlot(c, defence);
        hit.push(token);
        check[token.id] = { dice: fx, result: "a" };
      } else {
        // Equal to or higher: the target isn't affected by the Mass Attack.
        log(table, `  ${theirs === total ? "Tie: " : ""}${token.name} is unaffected.`);
        delete defence.clashWith;
        check[token.id] = { dice: fx, result: theirs === total ? "draw" : "b" };
      }
    }
    push({ aDice: dice.map((d, i) => fxDie(d, powers[i])), vs: check });
    dice.forEach((die, i) => {
      if (down(owner)) return;
      const vs: Record<string, FxMassSide> = {};
      land(die, powers[i], hit, vs);
      push({ a: fxDie(die, powers[i]), vs });
    });
  } else {
    // Individual: each die is rolled in turn and meets each target's next die with that one number;
    // a lower target die is Negated and the Mass die lands, otherwise it doesn't land on them.
    const queues = new Map(
      targets.map(({ ref, token }) => {
        const defence = defendingPage(c, slot, token.id, ref.die);
        if (defence) pages[token.id] = c.pages[defence.pageId].name;
        return [token.id, { defence, dice: defence ? c.pages[defence.pageId].dice.filter((d) => !d.counter) : [] }];
      }),
    );
    for (const die of dice) {
      if (down(owner)) break;
      const fp = rollPower(table, die, owner, undefined, play);
      const vs: Record<string, FxMassSide> = {};
      const unopposed: Token[] = [];
      for (const { token } of targets) {
        if (knockedOut(token)) continue;
        const q = queues.get(token.id)!;
        const theirs = q.dice.shift();
        if (!theirs) {
          unopposed.push(token);
          continue;
        }
        const tf = rollPower(table, theirs, token, owner, { page: q.defence ? c.pages[q.defence.pageId] : undefined, nth: q.defence?.nth });
        log(table, ` ${owner.name}'s ${diceText(die)} (${fp}) vs ${token.name}'s ${diceText(theirs)} (${tf}).`);
        if (tf >= fp) {
          vs[token.id] = { die: fxDie(theirs, tf), result: tf === fp ? "draw" : "b" };
          continue;
        }
        log(table, `  ${token.name}'s die is Negated.`);
        vs[token.id] = { die: fxDie(theirs, tf), result: "a" };
        if (isOffensive(die.kind)) {
          log(table, ` ${owner.name}'s ${diceText(die)} (${fp}) hits ${token.name}.`);
          dealDamage(table, token, fp, die.kind, owner, die, { ...play, oneSided: true });
        }
      }
      // Unopposed, it lands One-Sided (Counter Dice don't answer a Mass Attack).
      land(die, fp, unopposed, vs);
      push({ a: fxDie(die, fp), vs });
    }
    for (const q of queues.values()) if (q.defence) removeSlot(c, q.defence);
  }
  if (targets.length) recordFx(c, { a: owner.id, b: targets[0].token.id, pageA: page.name, targets: targets.map((t) => t.token.id), pages, rounds, before });
}

/** Resolve one slotted Page: clashing, Mass, or One-Sided. Returns false if it has to wait. */
function resolveSlot(table: TableState, slot: SlottedPage): boolean {
  const c = table.combat!;
  const page = c.pages[slot.pageId];
  const owner = table.tokens[slot.ownerId];
  if (!page || down(owner)) {
    removeSlot(c, slot);
    return true;
  }
  if (isMassAttack(page.type)) {
    resolveMass(table, slot);
    removeSlot(c, slot);
    return true;
  }
  // A Page that clashed with a Mass Attack waits for the Mass Attack owner's turn, where the Mass
  // Attack's one roll is checked against it. A Page slotted before a Mass Attack was aimed at its
  // Speed Die still resolves on its owner's turn as usual.
  const mass = c.slots.find((s) => s.id === slot.clashWith && isMassAttack(c.pages[s.pageId]?.type));
  if (mass) return false;
  // A Ranged Page still waiting on its owner's choice against a target in Full Cover can't fire: it holds.
  if (slot.cover === "full") {
    holdFire(table, slot);
    return true;
  }
  let partner = slot.clashWith ? c.slots.find((s) => s.id === slot.clashWith) : undefined;
  if (partner?.cover === "full") {
    holdFire(table, partner);
    partner = undefined;
  }
  if (partner) {
    clashPages(table, slot, partner);
    removeSlot(c, partner);
    removeSlot(c, slot);
    return true;
  }
  const target = table.tokens[slot.targets[0]?.tokenId];
  if (revivable(table, target)) resolveOnDown(table, owner, target!, page, page.dice.filter((d) => !d.counter));
  else if (!target || knockedOut(target)) {
    log(table, `${owner.name}'s ${page.name} has no target left.`);
  } else {
    log(table, `${owner.name} uses ${page.name} on ${target.name}.`);
    oneSided(table, owner, target, page, page.dice.filter((d) => !d.counter), slot.nth, page.type === "ranged" && slot.cover === "partial");
  }
  removeSlot(c, slot);
  return true;
}

// ---- Turn phases (Act 8, "On Your Turn") ----

/**
 * Runs the active character's turn forward until it needs input: Resolve Slotted Pages, then
 * Upkeep, then Combat Actions (which waits for the player). Knocked Out characters are skipped.
 * New phase effects (e.g. Passives at Upkeep) slot in here.
 */
function runPhases(table: TableState) {
  const c = table.combat!;
  // Each character can be skipped at most twice in a row (Staggered for two Upkeeps).
  for (let skips = 0; skips <= c.order.length * STAGGER_UPKEEPS; skips++) {
    const token = activeToken(table);
    if (!token) return;
    if (knockedOut(token)) {
      if (token.status?.dead) log(table, `${token.name} is Dead; their turn is skipped.`);
      else {
        log(table, `${token.name} is Knocked Out; their turn is skipped.`);
        if (koRules(table, token)) koTick(table, token, "Upkeep");
      }
      nextTurn(table);
      if (!table.combat) return;
      continue;
    }
    // Resolve Slotted Pages
    c.phase = "resolve";
    log(table, `Round ${c.round}: ${token.name}'s turn.`);
    for (const slot of c.slots.filter((s) => s.ownerId === token.id).sort((a, b) => a.die - b.die)) {
      if (c.slots.includes(slot)) resolveSlot(table, slot);
    }
    if (!table.combat) return;
    if (knockedOut(token)) continue;

    // Upkeep: draw, restore Light, then (later) Effects and Passives. Counter Dice expire at its end.
    c.phase = "upkeep";
    // Panicking can stop the draw or the Light.
    const noDraw = panicType(token) === 2;
    const drawn = noDraw ? 0 : Array.from({ length: UPKEEP_DRAW }, () => draw(c, token.id)).filter(Boolean).length;
    const r = token.resources;
    const light = panicType(token) === 3 ? 0 : Math.min(UPKEEP_LIGHT, Math.max(0, r.maxLight - r.light));
    r.light += light;
    if (c.decks[token.id] || light) log(table, `  Upkeep: ${c.decks[token.id] ? (noDraw ? "no draw" : `draws ${drawn}`) : ""}${secret(token, "light", `${c.decks[token.id] && light ? ", " : ""}${light ? `+${light} Light` : ""}`)}.`);
    c.counters[token.id] = [];
    staggerUpkeep(table, token);
    panicUpkeep(table, token);
    if (staggered(token)) {
      // Staggered: no Combat Actions this turn, but their effects still tick at Endstep.
      c.phase = "endstep";
      endstep(table, token);
      if (!table.combat) return;
      nextTurn(table);
      continue;
    }
    // Movement first, so effects at the start of the turn can add to it (Haste) or take it away (Bind).
    c.movementLeft = movementPoints(token.justice ?? 0);
    trigger(table, "turnStart", token);
    if (knockedOut(token)) continue;

    // Combat Actions: wait for the player.
    c.phase = "actions";
    delete c.aim;
    delete c.panicRecoveryUsed;
    delete c.koRecoveryUsed;
    return;
  }
  log(table, "No one in the turn order can act.");
}

/** The next character's turn; after the last one, the round ends and the next begins. */
function nextTurn(table: TableState) {
  const c = table.combat!;
  c.turn += 1;
  if (c.turn < c.order.length) return;
  c.turn = 0;
  endRound(table);
  c.round += 1;
  startRound(table);
}

/** Who's fighting this round, in turn order. */
const fighters = (table: TableState) => (table.combat?.order ?? []).map((x) => table.tokens[x.tokenId]).filter((t): t is Token => !!t && !knockedOut(t));

/** End of the round: "At the end of the round" rules, then stacks that wear off at round's end. */
function endRound(table: TableState) {
  const ops = effectOps(table);
  const round = table.combat?.round;
  for (const t of fighters(table)) trigger(table, "roundEnd", t);
  for (const t of fighters(table)) decayAtEnd(ops, t, "round");
  // Resistances changed "until the end of the round" go back.
  for (const t of Object.values(table.tokens)) {
    if (!t.resistMods) continue;
    t.resistMods = t.resistMods.filter((m) => m.round === undefined || m.round !== round);
    if (!t.resistMods.length) delete t.resistMods;
  }
}

/** Start of a round: stacks given "next round" arrive, then "At the start of the round" rules. */
function startRound(table: TableState) {
  const ops = effectOps(table);
  const c = table.combat;
  if (c) {
    delete c.used;
    // "Costs less this round" wears off.
    for (const deck of Object.values(c.decks)) for (const card of deck.hand) if (card.discount && card.discount.round !== c.round) delete card.discount;
  }
  for (const t of fighters(table)) arriveAtRoundStart(ops, t);
  for (const t of fighters(table)) trigger(table, "roundStart", t);
}

/** Endstep (Effects and Passives), then the next character's turn. */
export function endTurn(table: TableState) {
  const c = table.combat!;
  c.phase = "endstep";
  delete c.aim;
  const token = activeToken(table);
  if (token) endstep(table, token);
  if (!table.combat) return;
  nextTurn(table);
  if (table.combat) runPhases(table);
}

/** Effects that run at the end of the character's turn, then stacks that wear off. */
function endstep(table: TableState, token: Token) {
  if (knockedOut(token)) return;
  trigger(table, "turnEnd", token);
  decayAtEnd(effectOps(table), token, "turn");
}

// ---- Starting, joining and leaving combat ----

/** Light back to full, unless Panic (Darkness) stops them gaining any. */
function fullLight(t: Token | undefined) {
  if (t && panicType(t) !== 3) t.resources.light = Math.max(t.resources.light, t.resources.maxLight);
}

export function startCombat(table: TableState, ids: string[], ctx?: EngineContext) {
  // "Once a combat" rules can fire again.
  for (const id of ids) {
    const t = table.tokens[id];
    delete t.effectUses;
    delete t.resistMods;
  }
  const c: CombatState = { round: 1, order: [], turn: 0, phase: "resolve", movementLeft: 0, pages: {}, decks: {}, slots: [], counters: {} };
  table.combat = c;
  if (ctx?.knockOutRules?.()) c.knockOutRules = true;
  // Combat Start: "Each character fully recovers their Light and draws 3 Pages" (the draw is in setUpDeck).
  for (const id of ids) fullLight(table.tokens[id]);
  c.order = sortOrder(table, ids.map((id) => rollSpeed(table, table.tokens[id])));
  markSpeedRoll(c, ids);
  for (const id of ids) setUpDeck(c, table.tokens[id], ctx);
  log(table, `Combat started. Speed: ${c.order.map((x) => speedText(table.tokens[x.tokenId], x)).join(", ")}.`);
  for (const x of c.order) trigger(table, "combatStart", table.tokens[x.tokenId]);
  startRound(table);
  if (table.combat) runPhases(table);
}

/**
 * The GM ends the Combat Encounter: "When combat ends" rules run, then (when the Game setting
 * says so) every automated status Effect comes off. Effects the GM tracks by hand stay. With the
 * Game setting "Recover when combat ends", everyone who fought recovers too (endOfCombat).
 */
export function finishCombat(table: TableState, ctx?: EngineContext) {
  const c = table.combat;
  if (!c) return;
  const tokens = c.order.map((x) => table.tokens[x.tokenId]).filter((t): t is Token => !!t);
  for (const t of tokens) if (!knockedOut(t)) trigger(table, "combatEnd", t);
  if (ctx?.endOfCombatRecovery?.()) for (const t of tokens) endOfCombat(table, t);
  delete table.combat;
  for (const t of tokens) {
    delete t.effectUses;
    delete t.resistMods;
    if (!ctx?.clearEffectsAfterCombat?.() || !t.effects?.some((e) => e.defId)) continue;
    t.effects = t.effects.filter((e) => !e.defId);
    log(table, `  ${t.name}'s automated Effects wear off.`);
  }
}

/**
 * Act 8, End of Combat: full Light and Stagger Resist, out of Panic (Sanity 0), Stagger and Knock Out
 * (with a quarter of their Health, as a revive gives), then 3 + Prudence Sanity. The Dead stay Dead.
 */
function endOfCombat(table: TableState, t: Token) {
  if (t.status?.dead) return;
  const r = t.resources;
  if (t.status?.panic) {
    clearPanic(t);
    r.sanity = 0;
  }
  if (t.status?.knockedOut) {
    r.hp = Math.max(r.hp, reviveHealth(r.maxHp));
  }
  const status = { ...t.status, knockedOut: false, staggered: false, staggerUpkeeps: 0 };
  delete status.koUpkeeps;
  delete status.koRecoveryFails;
  t.status = status;
  r.light = r.maxLight;
  r.stagger = r.maxStagger;
  r.sanity = clamp(r.sanity + recoverySanity(statOf(t, "prudence")), -r.maxSanity, r.maxSanity);
  log(table, `  ${t.name} recovers: full Light and Stagger Resist${secret(t, "sanity", `, Sanity ${r.sanity}/${r.maxSanity}`)}.`);
}

/**
 * Act 7, Resting (the GM, out of combat): each hour restores 6 + (10 − Rank)×2 + Fortitude×2
 * Health and (10 − Rank)×2 + Prudence Sanity to the players' characters (or the ones picked). A
 * character brought above 0 Health is no longer Knocked Out; above their minimum Sanity, out of
 * Panic. The Dead don't recover.
 */
export function rest(table: TableState, hours: number, tokenIds: string[] | undefined, ctx?: EngineContext) {
  if (table.combat) throw new ActionError("Characters can't rest during combat.");
  const h = Math.round(Number(hours));
  if (!Number.isFinite(h) || h < 1 || h > MAX_REST_HOURS) throw new ActionError(`Rest for 1 to ${MAX_REST_HOURS} hours.`);
  const picked = tokenIds?.length ? tokenIds.map((id) => table.tokens[id]).filter((t): t is Token => !!t) : Object.values(table.tokens).filter((t) => t.side === "player");
  if (!picked.length) throw new ActionError("No one to rest.");
  log(table, `The party rests for ${h} hour${h === 1 ? "" : "s"}.`);
  for (const t of picked) {
    const l = ctx?.loadout(t.id);
    if (t.status?.dead) {
      log(table, `  ${t.name} is Dead and doesn't recover.`);
      continue;
    }
    if (!l || l.rank === undefined) {
      log(table, `  ${t.name} has no character sheet to rest with.`);
      continue;
    }
    const per = restPerHour({ rank: l.rank, fortitude: l.stats?.fortitude ?? 0, prudence: l.stats?.prudence ?? 0 });
    const r = t.resources;
    const hp = r.hp;
    const sanity = r.sanity;
    r.hp = Math.min(r.maxHp, r.hp + Math.max(0, per.hp) * h);
    r.sanity = Math.min(r.maxSanity, r.sanity + Math.max(0, per.sanity) * h);
    if (r.hp > 0 && t.status?.knockedOut) {
      const status = { ...t.status, knockedOut: false };
      delete status.koUpkeeps;
      delete status.koRecoveryFails;
      t.status = status;
    }
    if (t.status?.panic && r.sanity > -r.maxSanity) clearPanic(t);
    log(table, `  ${t.name} recovers ${r.hp - hp} Health (${r.hp}/${r.maxHp}) and ${r.sanity - sanity} Sanity (${r.sanity}/${r.maxSanity}).`);
  }
}

export function addCombatant(table: TableState, token: Token, ctx?: EngineContext) {
  const c = table.combat!;
  fullLight(token);
  const entry = rollSpeed(table, token);
  const activeId = c.order[c.turn].tokenId;
  c.order = sortOrder(table, [...c.order, entry]);
  c.turn = c.order.findIndex((x) => x.tokenId === activeId);
  markSpeedRoll(c, [token.id]);
  setUpDeck(c, token, ctx);
  log(table, `${speedText(token, entry)} joined the turn order.`);
}

/** Takes a character out of the order, keeping the turn on the right person. */
export function dropCombatant(table: TableState, tokenId: string) {
  const c = table.combat;
  if (!c) return;
  const i = c.order.findIndex((x) => x.tokenId === tokenId);
  if (i < 0) return;
  c.order.splice(i, 1);
  for (const s of c.slots.filter((x) => x.ownerId === tokenId)) removeSlot(c, s);
  for (const s of c.slots) s.targets = s.targets.filter((t) => t.tokenId !== tokenId);
  delete c.decks[tokenId];
  delete c.counters[tokenId];
  if (c.order.length === 0) {
    delete table.combat;
    log(table, "Combat ended: no one left in the turn order.");
    return;
  }
  if (i < c.turn) c.turn -= 1;
  else if (i === c.turn) {
    if (c.turn >= c.order.length) {
      c.turn = c.order.length - 1;
      nextTurn(table);
    }
    if (table.combat) runPhases(table);
  }
}

// ---- Combat Actions ----

/** Who may act right now: the GM, or the player whose turn it is, during Combat Actions. */
export function actingToken(table: TableState, actor: Actor): Token {
  const c = table.combat;
  const active = activeToken(table);
  if (!c || !active) throw new ActionError("Combat hasn't started.");
  if (actor.role !== "gm" && active.ownerId !== actor.uid) throw new ActionError("It isn't your turn.");
  if (c.phase !== "actions") throw new ActionError("Wait for Combat Actions.");
  return active;
}

/** "Characters cannot spend any Movement Points while they are the target of an enemy attack, unless the attack is a Mass Attack." */
export function pinnedBy(table: TableState, token: Token): Token | undefined {
  const c = table.combat;
  if (!c) return;
  const slot = c.slots.find((s) => {
    const owner = table.tokens[s.ownerId];
    return owner && opposed(owner.side, token.side) && !isMassAttack(c.pages[s.pageId]?.type) && s.targets.some((t) => t.tokenId === token.id);
  });
  return slot ? table.tokens[slot.ownerId] : undefined;
}

const STORY_OUTCOME_TEXT = { success: "success", failure: "failure", mixed: "between a failure and a success" } as const;

/**
 * A Story Roll (Act 7): 1d20 + the chosen Stat. Allowed any time, in or out of combat. The log says
 * how it reads by default: 9 or below fails, 12 or higher succeeds.
 */
/** `extra` is added to the Stat (e.g. Panic recovery's bonus from failed attempts). */
export function storyRoll(table: TableState, actor: Actor, token: Token, stat: string, ctx?: EngineContext, extra = 0) {
  if (actor.role !== "gm" && token.ownerId !== actor.uid) throw new ActionError("You can only roll for your own character.");
  const stats = token.side !== "player" ? { justice: token.justice ?? 0 } : (ctx?.loadout(token.id)?.stats ?? {});
  const key = String(stat).toLowerCase();
  const value = Math.round(Number(stats[key] ?? 0)) + extra;
  const roll = panicType(token) === 1 ? 1 : rollDie(STORY_DIE);
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  const outcome = STORY_OUTCOME_TEXT[storyOutcome(roll + value)];
  log(table, `${token.name} makes a ${label} Story Roll: ${roll}${secret(token, "justice", `${value >= 0 ? "+" : ""}${value} = ${roll + value}`)}${secret(token, "justice", ` (${outcome})`)}.`);
  table.storyRoll = { id: newId(), tokenId: token.id, stat: key, roll, bonus: value };
  return roll + value;
}

/** The card being used from the hand, Auxiliary Deck or E.G.O. Pages. */
function pageFor(table: TableState, token: Token, source: PageSource, cardId?: string): { page: Page; card: Card } {
  const c = table.combat!;
  const card = pile(c.decks[token.id], source)?.find((x) => x.id === cardId);
  if (!card) throw new ActionError(`That Page isn't in ${SOURCE_NAMES[source]}.`);
  return { page: c.pages[card.pageId], card };
}

/** A Speed Die the character has and that holds no Page yet. */
function freeDie(c: CombatState, token: Token, die: number | undefined): number | undefined {
  const count = c.order.find((x) => x.tokenId === token.id)?.dice ?? 0;
  const free = (i: number) => i >= 0 && i < count && !c.slots.some((s) => s.ownerId === token.id && s.die === i);
  if (die !== undefined) return free(die) ? die : undefined;
  return Array.from({ length: count }, (_, i) => i).find(free);
}

/**
 * Characters a Page can target: within Weapon Range and not Knocked Out (under the Knocked Out rules,
 * a Knocked Out player character who isn't Dead can be targeted). Only Instant Pages can target
 * yourself. A Page from a Defensive Weapon can also target, from any distance, an enemy whose
 * Page is aimed at an ally within its range, to Clash with that Page (guardDice).
 */
export function validTargets(table: TableState, user: Token, page: Page): Token[] {
  return Object.values(table.tokens).filter(
    (t) =>
      (!knockedOut(t) || revivable(table, t)) &&
      (t.id !== user.id || page.type === "instant") &&
      (distance(user, t) <= pageRange(page) || guardDice(table, user, page, t.id).length > 0),
  );
}

/**
 * Game setting "Weapon properties": the Speed Dice of `targetId` holding a Page that a Defensive
 * Weapon's Page can Clash with: one aimed at an ally of `user` within the Page's range.
 */
export function guardDice(table: TableState, user: Token, page: Page, targetId: string): number[] {
  const c = table.combat;
  const them = table.tokens[targetId];
  if (!c || !them || page.weaponStyle !== "defensive" || isMassAttack(page.type) || page.type === "instant" || !opposed(user.side, them.side)) return [];
  return c.slots
    .filter((s) => {
      const p = c.pages[s.pageId];
      if (s.ownerId !== targetId || s.clashWith || !p || p.type === "instant" || isMassAttack(p.type)) return false;
      return s.targets.some((ref) => {
        const ally = table.tokens[ref.tokenId];
        return !!ally && ally.id !== user.id && !knockedOut(ally) && !opposed(user.side, ally.side) && distance(user, ally) <= pageRange(page);
      });
    })
    .map((s) => s.die);
}

export function aim(table: TableState, actor: Actor, source: PageSource, cardId?: string, die?: number) {
  const token = actingToken(table, actor);
  const src: PageSource = source === "aux" || source === "ego" ? source : "hand";
  if (src === "aux" && panicType(token) === 4) throw new ActionError(`${token.name} is Panicking and can't use Auxiliary Pages.`);
  const { page, card } = pageFor(table, token, src, cardId);
  if (die !== undefined && page.type !== "instant" && freeDie(table.combat!, token, die) === undefined) {
    throw new ActionError(`Speed Die ${die + 1} isn't free.`);
  }
  table.combat!.aim = { tokenId: token.id, pageId: page.id, source: src, cardId: card.id, targets: [], ...(die !== undefined ? { die } : {}) };
}

export function aimTarget(table: TableState, actor: Actor, tokenId: string) {
  const token = actingToken(table, actor);
  const a = table.combat!.aim;
  if (!a || a.tokenId !== token.id) throw new ActionError("Pick a Page first.");
  const page = pageForAim(table, token);
  if (!isMassAttack(page.type)) throw new ActionError("Only Mass Attacks take several targets.");
  if (a.targets.includes(tokenId)) a.targets = a.targets.filter((x) => x !== tokenId);
  else {
    if (!validTargets(table, token, page).some((t) => t.id === tokenId)) throw new ActionError("Out of range.");
    a.targets.push(tokenId);
  }
}

function pageForAim(table: TableState, token: Token): Page {
  const a = table.combat!.aim!;
  return pageFor(table, token, a.source, a.cardId).page;
}

/**
 * Use a Combat Page (or Auxiliary/enemy Page): pay its Light and slot it on a free Speed Die
 * against the target(s). Slotting against a Speed Die that already holds a Page starts a Clash.
 * Instant Pages resolve right away and never clash. A single-target Page can aim at any of the
 * target's Speed Dice (`targetDie`), or go in `unopposed`: a One-Sided attack that starts no Clash.
 */
export function slot(table: TableState, actor: Actor, targetIds?: string[], ctx?: EngineContext, opts: { targetDie?: number; unopposed?: boolean; ammo?: string; resolveNow?: boolean } = {}) {
  const c = table.combat!;
  const token = actingToken(table, actor);
  const a = c.aim;
  if (!a || a.tokenId !== token.id) throw new ActionError("Pick a Page first.");
  if (a.source === "aux" && panicType(token) === 4) throw new ActionError(`${token.name} is Panicking and can't use Auxiliary Pages.`);
  const aimedPage = pageForAim(table, token);
  // With "Ranged Pages use Ammo" on, a player's Ranged Page spends Ammo from their inventory; with
  // none, it's used as a Melee Page and every die rolls with disadvantage.
  const usesAmmo = aimedPage.type === "ranged" && token.side === "player" && !!ctx?.rangedAmmo?.();
  const ammo = usesAmmo ? findAmmo(token, opts.ammo, ctx!) : undefined;
  const page = usesAmmo && !ammo ? withoutAmmo(c, aimedPage) : aimedPage;
  const ids = [...new Set(targetIds?.length ? targetIds : a.targets)];
  const mass = isMassAttack(page.type);
  if (ids.length === 0) throw new ActionError("Pick a target.");
  if (!mass && ids.length > 1) throw new ActionError("This Page takes one target.");
  const allowed = new Set(validTargets(table, token, page).map((t) => t.id));
  for (const id of ids) if (!allowed.has(id)) throw new ActionError(`${table.tokens[id]?.name ?? "That target"} is out of range.`);
  const aimed = a.cardId ? pile(c.decks[token.id], a.source)?.find((x) => x.id === a.cardId) : undefined;
  const cost = Math.max(0, page.cost - (aimed?.discount?.round === c.round ? aimed.discount.n : 0));
  if (token.resources.light < cost) throw new ActionError(`${page.name} costs ${cost} Light; ${token.name} has ${token.resources.light}.`);
  const targetDie = !mass && opts.targetDie !== undefined ? opts.targetDie : 0;
  if (targetDie > 0) {
    const theirs = c.order.find((x) => x.tokenId === ids[0])?.dice ?? 0;
    if (targetDie >= theirs) throw new ActionError(`${table.tokens[ids[0]]?.name ?? "The target"} has no Speed Die ${targetDie + 1}.`);
  }
  // A Defensive Weapon's Page aimed past its range can only Clash with a Page aimed at an ally within it.
  const far = !mass && distance(token, table.tokens[ids[0]]) > pageRange(page);
  if (far && (opts.unopposed || !guardDice(table, token, page, ids[0]).includes(targetDie))) {
    throw new ActionError(`${table.tokens[ids[0]].name} is out of range; ${page.name} can only Clash with their Page aimed at an ally within range.`);
  }
  if (opts.resolveNow) {
    if (page.weaponStyle !== "offensive") throw new ActionError("Only a Page from an Offensive Weapon can resolve a Clash right away.");
    const theirs = mass || opts.unopposed ? undefined : c.slots.find((s) => s.ownerId === ids[0] && s.die === targetDie && !s.clashWith && c.pages[s.pageId]?.type !== "instant");
    if (!theirs || isMassAttack(c.pages[theirs.pageId]!.type)) throw new ActionError("Only a Clash with a Page that isn't a Mass Attack can be resolved right away.");
  }

  const card = aimed;
  const free = freeDie(c, token, a.die);
  if (page.type !== "instant" && free === undefined) {
    throw new ActionError(a.die !== undefined ? `Speed Die ${a.die + 1} isn't free.` : "No free Speed Die to slot it on.");
  }

  // Pay, and take the card out of the hand (or Auxiliary Deck).
  token.resources.light -= cost;
  if (card?.discount) delete card.discount;
  const deck = c.decks[token.id];
  if (deck && card) {
    if (a.source === "aux") {
      deck.aux = deck.aux.filter((x) => x.id !== card.id);
      if (card.itemId) ctx?.onToolUsed?.(token.id, card.itemId);
    } else if (a.source === "ego") deck.ego = (deck.ego ?? []).filter((x) => x.id !== card.id);
    else deck.hand = deck.hand.filter((x) => x.id !== card.id);
  }
  if (ammo) ctx!.sheets!.save(ammo.uid, { items: spendOne(ammo.items, ammo.item.id) });
  delete c.aim;
  // Count it, for "the first Page I use this round" and "if I haven't used a Page".
  const nth = ((c.used ??= {})[token.id] ?? 0) + 1;
  c.used[token.id] = nth;
  // "On Use": the character's effects, then each of the Page's dice's Dice effects.
  const usedOn = table.tokens[ids[0]];
  trigger(table, "use", token, { other: usedOn, page, nth });
  for (const d of page.dice) trigger(table, "use", token, { other: usedOn, die: d, only: "die", page, nth });
  const entry: SlottedPage = {
    id: newId(),
    ownerId: token.id,
    die: free ?? 0,
    pageId: page.id,
    card,
    fromAux: a.source === "aux",
    fromEgo: a.source === "ego",
    targets: ids.map((tokenId) => ({ tokenId, die: targetDie })),
    nth,
    ...(ammo ? { ammo: ammo.item.name || "Ammo" } : {}),
  };
  const names = ids.map((id) => table.tokens[id].name).join(", ");
  if (ammo) log(table, `${token.name} loads ${ammo.item.name || "Ammo"}${ammo.item.count > 1 ? ` (${ammo.item.count - 1} left)` : " (the last one)"}.`);
  if (page.noAmmo) log(table, `${token.name} has no Ammo: ${page.name} is used as a Melee Page, every die rolled with disadvantage.`);

  if (page.type === "instant") {
    log(table, `${token.name} uses ${page.name} (Instant) on ${names}.`);
    c.slots.push(entry);
    resolveSlot(table, entry);
    return;
  }

  // Counter Dice on the Page wait on the character until the end of their next Upkeep.
  for (const d of page.dice.filter((x) => x.counter)) storeCounter(c, token, d, page.id);
  c.slots.push(entry);

  if (!mass && opts.unopposed) {
    log(table, `${token.name} slots ${page.name} against ${names}, unopposed (${cost} Light).`);
    return;
  }
  if (!mass) {
    const ref = entry.targets[0];
    const other = c.slots.find((s) => s.ownerId === ref.tokenId && s.die === ref.die && !s.clashWith && c.pages[s.pageId]?.type !== "instant");
    const otherPage = other && c.pages[other.pageId];
    // A Mass Attack only clashes with Pages from characters it's aimed at.
    const clashes = other && (!isMassAttack(otherPage!.type) || other.targets.some((t) => t.tokenId === token.id));
    if (other && clashes) {
      entry.clashWith = other.id;
      if (!isMassAttack(otherPage!.type)) {
        other.clashWith = entry.id;
        // Redirect: the Page on that die now faces whoever clashed with it.
        const was = other.targets[0]?.tokenId;
        other.targets = [{ tokenId: token.id, die: entry.die }];
        if (was && was !== token.id) {
          log(table, `${token.name} redirects ${names}'s ${otherPage!.name} (aimed at ${table.tokens[was]?.name ?? "someone"}) with ${page.name}: Clash!`);
          if (opts.resolveNow) {
            log(table, `${token.name}'s Offensive Weapon resolves the Clash right away.`);
            resolveSlot(table, entry);
          }
          return;
        }
      }
      log(table, `${token.name} slots ${page.name} against ${names}: Clash with ${otherPage!.name}!`);
      if (opts.resolveNow) {
        log(table, `${token.name}'s Offensive Weapon resolves the Clash right away.`);
        resolveSlot(table, entry);
      }
      return;
    }
  }
  log(table, `${token.name} slots ${page.name} against ${names} (${cost} Light).`);
}

// ---- Ranged Pages: Ammo and Cover (ruleset, "Cover") ----

/** The Ammo a player fires with: the stack they picked, or their first. Undefined if they have none. */
function findAmmo(token: Token, itemId: string | undefined, ctx: EngineContext) {
  const sheets = ctx.sheets;
  const uid = token.ownerId;
  const sheet = uid ? sheets?.sheet(uid) : undefined;
  if (!sheets || !uid || !sheet) throw new ActionError("Players' sheets aren't loaded yet.");
  // The GM marks Ammo in the item library, so each item is read with the library's details.
  const linked = (i: InventoryItem) => (i.templateId ? linkItem(i, { [i.templateId]: sheets.item(i.templateId)! }) : i);
  const ammo = sheet.inventory.items.filter((i) => isAmmo(linked(i)));
  if (!ammo.length) return undefined;
  const item = itemId ? ammo.find((i) => i.id === itemId) : ammo[0];
  if (!item) throw new ActionError("That Ammo isn't in the inventory.");
  return { uid, items: sheet.inventory.items, item: linked(item) };
}

/** A Ranged Page fired without Ammo, kept in play under its own id (the card is unchanged). */
function withoutAmmo(c: CombatState, page: Page): Page {
  const id = `${page.id}~noammo`;
  return (c.pages[id] ??= { ...asMeleeWithoutAmmo(page), id });
}

/**
 * The GM marks the target of a slotted Ranged Page as in Partial Cover (its dice get Final Power - 2)
 * or Full Cover (its owner fires right away or holds fire), or clears it.
 */
export function setCover(table: TableState, actor: Actor, slotId: string, cover: Cover | null) {
  if (actor.role !== "gm") throw new ActionError("Only the GM marks Cover.");
  const c = table.combat;
  const s = c?.slots.find((x) => x.id === slotId);
  if (!c || !s) throw new ActionError("That Page is no longer slotted.");
  const page = c.pages[s.pageId];
  if (page?.type !== "ranged") throw new ActionError("Only Ranged Pages are affected by Cover.");
  if ((s.cover ?? null) === cover) return false;
  const owner = table.tokens[s.ownerId];
  const target = table.tokens[s.targets[0]?.tokenId]?.name ?? "The target";
  if (!cover) {
    delete s.cover;
    log(table, `${target} is no longer in Cover from ${owner?.name ?? "someone"}'s ${page.name}.`);
  } else {
    s.cover = cover;
    log(
      table,
      cover === "partial"
        ? `${target} is in Partial Cover: ${owner?.name ?? "the attacker"}'s ${page.name} gets Final Power -${PARTIAL_COVER}.`
        : `${target} is moving into Full Cover: ${owner?.name ?? "the attacker"} can fire ${page.name} now or hold fire.`,
    );
  }
  return true;
}

/**
 * The owner of a Ranged Page whose target is going into Full Cover answers it: fire now (the clash or
 * One-Sided attack resolves right away) or hold fire (the Page is Negated).
 */
export function coverChoice(table: TableState, actor: Actor, slotId: string, fire: boolean) {
  const c = table.combat;
  const s = c?.slots.find((x) => x.id === slotId);
  if (!c || !s) throw new ActionError("That Page is no longer slotted.");
  const owner = table.tokens[s.ownerId];
  if (actor.role !== "gm" && owner?.ownerId !== actor.uid) throw new ActionError("Only the Page's owner decides.");
  if (s.cover !== "full") throw new ActionError("Its target isn't going into Full Cover.");
  if (!fire) return void holdFire(table, s);
  delete s.cover;
  log(table, `${owner?.name ?? "Someone"} fires ${c.pages[s.pageId]?.name ?? "their Page"} before the target reaches cover!`);
  if (!resolveSlot(table, s)) {
    s.cover = "full";
    throw new ActionError("It's facing a Mass Attack and resolves with it; hold fire or wait.");
  }
}

/**
 * A Ranged Page that holds fire is Negated: none of its dice are used, except Defensive Dice, which
 * become Counter Dice (its Counter Dice were stored when it was slotted, and stay).
 */
function holdFire(table: TableState, s: SlottedPage) {
  const c = table.combat!;
  const owner = table.tokens[s.ownerId];
  const page = c.pages[s.pageId];
  const kept = owner && page ? page.dice.filter((d) => !d.counter && !isOffensive(d.kind)) : [];
  for (const d of kept) storeCounter(c, owner, d, page.id);
  log(table, `${owner?.name ?? "Someone"} holds fire: ${page?.name ?? "their Page"} is Negated${kept.length ? `; ${kept.length} Defensive ${kept.length === 1 ? "Die becomes a Counter Die" : "Dice become Counter Dice"}` : ""}.`);
  removeSlot(c, s);
}
