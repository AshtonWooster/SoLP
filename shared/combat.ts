// Combat (Act 8) and Pages (Act 3): turn phases, decks, slotting Pages, and resolving them,
// including Dice Clashes, Counter Dice and Mass Attacks. Runs on the host (the GM's browser).
import type { Dice, Page, ResistanceSet } from "./character.ts";
import { ActionError, clamp, log, type Actor } from "./core.ts";
export type { Actor };
import { newId, rollDie } from "./id.ts";
import {
  DASH_LIGHT_COST,
  enemyDeck,
  DASH_MOVEMENT,
  isMassAttack,
  isOffensive,
  moveCost,
  movementPoints,
  SPEED_DICE,
  SPEED_DIE,
  STARTING_HAND,
  STORY_DIE,
  UPKEEP_DRAW,
  STAGGER_UPKEEPS,
  STAGGERED_RESISTANCE,
  UPKEEP_LIGHT,
  WEAPON_RANGE,
} from "./ruleset.ts";
import type {
  Card,
  ClashFx,
  Combatant,
  CombatState,
  DeckState,
  FxDie,
  FxRound,
  PageSource,
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
  /** Auxiliary Deck: one entry per copy, with the inventory Tool it comes from. */
  aux: { pageId: string; itemId: string }[];
  /** E.G.O. Page ids. */
  ego?: string[];
  /** Stat values by key (primary and secondary), for Story Rolls. */
  stats?: Record<string, number>;
  resistances?: ResistanceSet;
  staggerResistances?: ResistanceSet;
}

export interface EngineContext {
  loadout(tokenId: string): Loadout | undefined;
  /** A Tool's Auxiliary Page was used, so the host can count down the item's uses. */
  onToolUsed?(tokenId: string, itemId: string): void;
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

function rollSpeed(token: Token): Combatant {
  const bonus = token.justice ?? 0;
  const roll = rollDie(SPEED_DIE);
  return { tokenId: token.id, roll, bonus, speed: roll + bonus, dice: SPEED_DICE };
}

export function speedText(t: Token, c: Combatant) {
  return `${t.name} ${c.speed} (${c.roll}${c.bonus >= 0 ? "+" : ""}${c.bonus})`;
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
const distance = (a: Token, b: Token) => moveCost(a, b);
const diceText = (d: Dice) => `${d.counter ? "Counter " : ""}${d.kind[0].toUpperCase()}${d.kind.slice(1)} 1d${d.sides}${d.basePower >= 0 ? "+" : ""}${d.basePower}`;

// ---- Decks (Act 7, "Deck Interactions") ----

/** Enemies carry their own Pages and deck on the token; players' come from their character sheet. */
function enemyLoadout(token: Token): Loadout {
  const pages = token.pages ?? [];
  return { pages: Object.fromEntries(pages.map((p) => [p.id, p])), deck: enemyDeck(pages, token.deck), aux: [] };
}

function setUpDeck(c: CombatState, token: Token, ctx: EngineContext | undefined) {
  const loadout = token.side === "enemy" ? enemyLoadout(token) : ctx?.loadout(token.id);
  if (!loadout) return;
  Object.assign(c.pages, loadout.pages);
  const deck: DeckState = {
    draw: shuffle(loadout.deck.map((pageId) => ({ id: newId(), pageId }))),
    hand: [],
    discard: [],
    aux: loadout.aux.map((a) => ({ id: newId(), pageId: a.pageId, itemId: a.itemId })),
    auxUsed: [],
    ego: (loadout.ego ?? []).map((pageId) => ({ id: newId(), pageId })),
    egoUsed: [],
  };
  c.decks[token.id] = deck;
  for (let i = 0; i < STARTING_HAND; i++) draw(c, token.id);
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

function resistance(t: Token, set: ResistanceSet | undefined, kind: Dice["kind"]): number {
  if (!isOffensive(kind)) return 1;
  if (staggered(t)) return STAGGERED_RESISTANCE;
  return set?.[kind as keyof ResistanceSet] ?? 1;
}

/**
 * Offensive Dice deal (Final Power) × (target's Type Resistance) damage, and the same amount ×
 * their Stagger Resistance as Stagger damage. Both round down.
 */
function dealDamage(table: TableState, target: Token, amount: number, kind: Dice["kind"]) {
  const dmg = Math.max(0, Math.floor(amount * resistance(target, target.resistances, kind)));
  const stagger = Math.max(0, Math.floor(amount * resistance(target, target.staggerResistances, kind)));
  const r = target.resources;
  r.hp = Math.max(0, r.hp - dmg);
  log(table, `  ${target.name} takes ${dmg} ${kind} damage (${r.hp}/${r.maxHp} Health).`);
  staggerDamage(table, target, stagger);
  if (r.hp === 0 && !target.status?.knockedOut) {
    target.status = { ...target.status, knockedOut: true };
    log(table, `  ${target.name} is Knocked Out!`);
    onKnockedOut(table, target);
  }
}

function staggerDamage(table: TableState, target: Token, amount: number) {
  if (amount <= 0) return;
  const r = target.resources;
  r.stagger = Math.max(0, r.stagger - amount);
  log(table, `  ${target.name} takes ${amount} Stagger damage (${r.stagger}/${r.maxStagger}).`);
  if (r.stagger === 0 && !target.status?.staggered) {
    target.status = { ...target.status, staggered: true, staggerUpkeeps: 0 };
    log(table, `  ${target.name} is Staggered! Their Pages are discarded and their Resistances are ${STAGGERED_RESISTANCE}x until they recover.`);
    onStaggered(table, target);
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
    log(table, `  ${t.name} recovers from Stagger (${t.resources.stagger}/${t.resources.maxStagger}); Resistances are back to normal.`);
  } else {
    t.status = { ...t.status, staggerUpkeeps: passed };
    log(table, `  ${t.name} is Staggered and can't act (recovers in ${STAGGER_UPKEEPS - passed} more Upkeep${STAGGER_UPKEEPS - passed === 1 ? "" : "s"}).`);
  }
}

function recoverStagger(table: TableState, t: Token, amount: number) {
  const r = t.resources;
  const before = r.stagger;
  r.stagger = Math.min(r.maxStagger, r.stagger + amount);
  if (r.stagger > 0 && t.status?.staggered) t.status = { ...t.status, staggered: false, staggerUpkeeps: 0 };
  if (r.stagger > before) log(table, `  ${t.name} recovers ${r.stagger - before} Stagger Resist.`);
}

/** Clash Win heals 1 Sanity, Clash Lose costs 1. Sanity runs from -max to +max; the minimum means Panic. */
function changeSanity(t: Token, delta: number) {
  const r = t.resources;
  r.sanity = clamp(r.sanity + delta, -r.maxSanity, r.maxSanity);
  const panic = r.sanity <= -r.maxSanity;
  if (panic !== !!t.status?.panic) t.status = { ...t.status, panic };
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

// ---- Dice Clashes (Act 3, "Dice") ----

interface LiveDie {
  die: Dice;
  owner: Token;
  pageType: Page["type"];
}

const finalPower = (d: Dice) => rollDie(d.sides) + d.basePower;

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
function clashDice(table: TableState, a: LiveDie, b: LiveDie, fa = finalPower(a.die), fb = finalPower(b.die)): ClashOutcome {
  const desc = `${a.owner.name}'s ${diceText(a.die)} (${fa}) vs ${b.owner.name}'s ${diceText(b.die)} (${fb})`;
  if (fa === fb || (a.die.kind === "evade" && b.die.kind === "evade")) {
    log(table, ` ${desc}: Draw, both Negated.`);
    return { winner: "draw", a: "gone", b: "gone", fa, fb };
  }
  const aWins = fa > fb;
  const [w, l, fw, fl] = aWins ? [a, b, fa, fb] : [b, a, fb, fa];
  log(table, ` ${desc}: ${w.owner.name} wins.`);
  changeSanity(w.owner, 1);
  changeSanity(l.owner, -1);
  let wKeep: ClashOutcome["a"] = "gone";

  if (isOffensive(w.die.kind)) {
    if (isOffensive(l.die.kind)) {
      // Melee vs Ranged: the winning melee die deals no damage; it's recycled to the bottom of the page.
      if (w.pageType === "melee" && l.pageType === "ranged") {
        log(table, `  Melee beats Ranged: the die is recycled to the bottom of the Page.`);
        wKeep = "bottom";
      } else dealDamage(table, l.owner, fw, w.die.kind);
    } else if (l.die.kind === "block") {
      // A losing Block reduces the damage (before Type Resistance) by its Final Power.
      dealDamage(table, l.owner, Math.max(0, fw - fl), w.die.kind);
    } else dealDamage(table, l.owner, fw, w.die.kind);
  } else if (w.die.kind === "block") {
    if (isOffensive(l.die.kind)) {
      // A Ranged attacker outside the Melee target's range takes no Stagger damage from a winning Block.
      const rangedSafe = l.pageType === "ranged" && w.pageType === "melee" && distance(l.owner, w.owner) > WEAPON_RANGE.melee;
      if (rangedSafe) log(table, `  ${l.owner.name} is out of melee range: no Stagger damage.`);
      else staggerDamage(table, l.owner, fw - fl);
    } else staggerDamage(table, l.owner, fw);
  } else if (w.die.kind === "evade") {
    recoverStagger(table, w.owner, fw);
    if (isOffensive(l.die.kind)) wKeep = "recycle";
  }
  return aWins ? { winner: "a", a: wKeep, b: "gone", fa, fb } : { winner: "b", a: "gone", b: wKeep, fa, fb };
}

const fxDie = (d: Dice, power: number): FxDie => ({ kind: d.kind, sides: d.sides, basePower: d.basePower, power, ...(d.counter ? { counter: true } : {}) });

/** Remember a resolution for the clash animation; only the latest few are kept. */
function recordFx(c: CombatState, fx: Omit<ClashFx, "id">) {
  if (fx.rounds.length === 0) return;
  c.fxSeq = (c.fxSeq ?? 0) + 1;
  c.fx = [...(c.fx ?? []), { ...fx, id: c.fxSeq }].slice(-8);
}

/** Unused Defensive Dice become Counter Dice on their owner. */
function storeCounter(c: CombatState, owner: Token, die: Dice, pageId: string) {
  (c.counters[owner.id] ??= []).push({ id: newId(), die: { ...die, counter: true }, pageId });
}

// ---- Resolving Pages (Act 8, "Resolve Slotted Pages") ----

/**
 * A One-Sided Attack: each die hits the target top to bottom. The target's Counter Dice answer
 * automatically, in the order they were made; any used are lost when the page finishes.
 */
function oneSided(table: TableState, attacker: Token, target: Token, page: Page, dice: Dice[], powers?: number[], animate = true) {
  const c = table.combat!;
  const used = new Set<string>();
  const rounds: FxRound[] = [];
  dice.forEach((die, i) => {
    if (knockedOut(target) || down(attacker)) return;
    const fp = powers?.[i] ?? finalPower(die);
    // The oldest Counter Die answers; one that won stays first and answers the next die too.
    const counter = (c.counters[target.id] ?? [])[0];
    if (counter) {
      used.add(counter.id);
      const out = clashDice(table, { die, owner: attacker, pageType: page.type }, { die: counter.die, owner: target, pageType: c.pages[counter.pageId]?.type ?? "melee" }, fp);
      rounds.push({ a: fxDie(die, out.fa), b: fxDie(counter.die, out.fb), result: out.winner });
      // "On Clash Win, Counter Dice are Recycled": it answers the next die too. Otherwise it's spent.
      if (out.winner !== "b") c.counters[target.id] = (c.counters[target.id] ?? []).filter((x) => x.id !== counter.id);
      return;
    }
    if (isOffensive(die.kind)) {
      log(table, ` ${attacker.name}'s ${diceText(die)} (${fp}) hits ${target.name}.`);
      rounds.push({ a: fxDie(die, fp), result: "hit" });
      dealDamage(table, target, fp, die.kind);
    } else storeCounter(c, attacker, die, page.id);
  });
  // Counter Dice used against this page are lost at the end of its resolution.
  if (used.size) c.counters[target.id] = (c.counters[target.id] ?? []).filter((x) => !used.has(x.id));
  if (animate) recordFx(c, { a: attacker.id, b: target.id, pageA: page.name, rounds });
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
  const qa = pa.dice.filter((d) => !d.counter).map((die) => ({ die, owner: ta, pageType: pa.type }));
  const qb = pb.dice.filter((d) => !d.counter).map((die) => ({ die, owner: tb, pageType: pb.type }));
  const rounds: FxRound[] = [];

  /** A Ranged Page with no Offensive Dice left, out of the Melee target's range, Negates the target's Offensive Dice. */
  const rangedEscape = () => {
    for (const [mine, theirs, me, them] of [
      [qa, qb, ta, tb],
      [qb, qa, tb, ta],
    ] as const) {
      const myType = mine === qa ? pa.type : pb.type;
      const theirType = mine === qa ? pb.type : pa.type;
      if (myType === "ranged" && theirType === "melee" && !mine.some((d) => isOffensive(d.die.kind)) && distance(me, them) > WEAPON_RANGE.melee) {
        const before = theirs.length;
        const kept = theirs.filter((d) => !isOffensive(d.die.kind));
        theirs.splice(0, theirs.length, ...kept);
        if (kept.length < before) log(table, `  ${me.name} is out of melee range: ${them.name}'s Offensive Dice are Negated.`);
      }
    }
  };

  for (let guard = 0; qa.length && qb.length && guard < 200; guard++) {
    if (down(ta) || down(tb)) break;
    const out = clashDice(table, qa[0], qb[0]);
    rounds.push({ a: fxDie(qa[0].die, out.fa), b: fxDie(qb[0].die, out.fb), result: out.winner });
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
  // Defensive ones become Counter Dice.
  for (const [q, me, them, page] of [
    [qa, ta, tb, pa],
    [qb, tb, ta, pb],
  ] as const) {
    for (const d of q) {
      if (down(me) || knockedOut(them)) break;
      if (isOffensive(d.die.kind)) {
        const fp = finalPower(d.die);
        log(table, ` ${me.name}'s ${diceText(d.die)} (${fp}) hits ${them.name} unopposed.`);
        rounds.push({ [me === ta ? "a" : "b"]: fxDie(d.die, fp), result: "hit" });
        dealDamage(table, them, fp, d.die.kind);
      } else storeCounter(c, me, d.die, page.id);
    }
  }
  recordFx(c, { a: ta.id, b: tb.id, pageA: pa.name, pageB: pb.name, rounds });
}

/** The page on a target's chosen Speed Die, or one clashing with this Mass Attack. */
function defendingPage(c: CombatState, mass: SlottedPage, targetId: string, die: number) {
  return c.slots.find((s) => s.ownerId === targetId && s.id !== mass.id && (s.clashWith === mass.id || s.die === die) && !isMassAttack(c.pages[s.pageId]?.type));
}

function resolveMass(table: TableState, slot: SlottedPage) {
  const c = table.combat!;
  const owner = table.tokens[slot.ownerId];
  const page = c.pages[slot.pageId];
  const dice = page.dice.filter((d) => !d.counter);
  const targets = slot.targets.map((t) => ({ ref: t, token: table.tokens[t.tokenId] })).filter((t) => t.token && !knockedOut(t.token));
  log(table, `${owner.name} unleashes ${page.name} (${page.type === "massSummation" ? "Summation" : "Individual"}) on ${targets.map((t) => t.token.name).join(", ")}.`);
  const powers = dice.map(finalPower);

  if (page.type === "massSummation") {
    const total = powers.reduce((x, y) => x + y, 0);
    const hit: Token[] = [];
    for (const { ref, token } of targets) {
      const defence = defendingPage(c, slot, token.id, ref.die);
      if (!defence) {
        hit.push(token);
        continue;
      }
      const dp = c.pages[defence.pageId];
      const theirs = dp.dice.filter((d) => !d.counter).map(finalPower).reduce((x, y) => x + y, 0);
      log(table, ` Summation: ${owner.name} ${total} vs ${token.name}'s ${dp.name} ${theirs}.`);
      if (theirs < total) {
        log(table, `  ${token.name}'s ${dp.name} is Negated.`);
        removeSlot(c, defence);
        hit.push(token);
      } else if (theirs > total) {
        log(table, `  ${token.name} is unaffected.`);
        delete defence.clashWith;
      } else {
        // A tie: the Mass Attack still lands, but the defender's Page is left alone.
        log(table, `  Tie: ${token.name}'s ${dp.name} is unaffected, but the attack still lands.`);
        delete defence.clashWith;
        hit.push(token);
      }
    }
    for (const t of hit) oneSided(table, owner, t, page, dice, powers);
  } else {
    // Individual: each Mass die meets each target's next die; a lower target die is Negated and the Mass die lands.
    const queues = new Map(
      targets.map(({ ref, token }) => {
        const defence = defendingPage(c, slot, token.id, ref.die);
        return [token.id, { defence, dice: defence ? c.pages[defence.pageId].dice.filter((d) => !d.counter) : [] }];
      }),
    );
    dice.forEach((die, i) => {
      for (const { token } of targets) {
        if (knockedOut(token) || knockedOut(owner)) continue;
        const q = queues.get(token.id)!;
        const theirs = q.dice.shift();
        if (theirs) {
          const tf = finalPower(theirs);
          log(table, ` ${owner.name}'s ${diceText(die)} (${powers[i]}) vs ${token.name}'s ${diceText(theirs)} (${tf}).`);
          if (tf >= powers[i]) continue;
          log(table, `  ${token.name}'s die is Negated.`);
        }
        oneSided(table, owner, token, page, [die], [powers[i]], false);
      }
    });
    for (const q of queues.values()) if (q.defence) removeSlot(c, q.defence);
  }
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
  const partner = slot.clashWith ? c.slots.find((s) => s.id === slot.clashWith) : undefined;
  if (partner) {
    // A clash with a Mass Attack (more than 1 target) waits for the Mass Attack owner's turn.
    if (isMassAttack(c.pages[partner.pageId]?.type) && partner.targets.length > 1) return false;
    clashPages(table, slot, partner);
    removeSlot(c, partner);
    removeSlot(c, slot);
    return true;
  }
  const target = table.tokens[slot.targets[0]?.tokenId];
  if (!target || knockedOut(target)) {
    log(table, `${owner.name}'s ${page.name} has no target left.`);
  } else {
    log(table, `${owner.name} uses ${page.name} on ${target.name}.`);
    oneSided(table, owner, target, page, page.dice.filter((d) => !d.counter));
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
      log(table, `${token.name} is Knocked Out; their turn is skipped.`);
      advance(c);
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
    const drawn = Array.from({ length: UPKEEP_DRAW }, () => draw(c, token.id)).filter(Boolean).length;
    const r = token.resources;
    const light = Math.min(UPKEEP_LIGHT, Math.max(0, r.maxLight - r.light));
    r.light += light;
    if (c.decks[token.id] || light) log(table, `  Upkeep: ${c.decks[token.id] ? `draws ${drawn}` : ""}${c.decks[token.id] && light ? ", " : ""}${light ? `+${light} Light` : ""}.`);
    c.counters[token.id] = [];
    staggerUpkeep(table, token);
    if (staggered(token)) {
      // Staggered: no Combat Actions this turn.
      c.phase = "endstep";
      advance(c);
      continue;
    }

    // Combat Actions: wait for the player.
    c.phase = "actions";
    c.movementLeft = movementPoints(token.justice ?? 0);
    delete c.aim;
    return;
  }
  log(table, "No one in the turn order can act.");
}

function advance(c: CombatState) {
  c.turn += 1;
  if (c.turn >= c.order.length) {
    c.turn = 0;
    c.round += 1;
  }
}

/** Endstep (Effects and Passives later), then the next character's turn. */
export function endTurn(table: TableState) {
  const c = table.combat!;
  c.phase = "endstep";
  delete c.aim;
  advance(c);
  runPhases(table);
}

// ---- Starting, joining and leaving combat ----

export function startCombat(table: TableState, ids: string[], ctx?: EngineContext) {
  const order = sortOrder(table, ids.map((id) => rollSpeed(table.tokens[id])));
  const c: CombatState = { round: 1, order, turn: 0, phase: "resolve", movementLeft: 0, pages: {}, decks: {}, slots: [], counters: {} };
  table.combat = c;
  for (const id of ids) setUpDeck(c, table.tokens[id], ctx);
  log(table, `Combat started. Speed: ${order.map((x) => speedText(table.tokens[x.tokenId], x)).join(", ")}.`);
  runPhases(table);
}

export function addCombatant(table: TableState, token: Token, ctx?: EngineContext) {
  const c = table.combat!;
  const entry = rollSpeed(token);
  const activeId = c.order[c.turn].tokenId;
  c.order = sortOrder(table, [...c.order, entry]);
  c.turn = c.order.findIndex((x) => x.tokenId === activeId);
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
      c.turn = 0;
      c.round += 1;
    }
    runPhases(table);
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
    return owner && owner.side !== token.side && !isMassAttack(c.pages[s.pageId]?.type) && s.targets.some((t) => t.tokenId === token.id);
  });
  return slot ? table.tokens[slot.ownerId] : undefined;
}

/** A Story Roll (Act 7): 1d20 (placeholder) + the chosen Stat. Allowed any time, in or out of combat. */
export function storyRoll(table: TableState, actor: Actor, token: Token, stat: string, ctx?: EngineContext) {
  if (actor.role !== "gm" && token.ownerId !== actor.uid) throw new ActionError("You can only roll for your own character.");
  const stats = token.side === "enemy" ? { justice: token.justice ?? 0 } : (ctx?.loadout(token.id)?.stats ?? {});
  const key = String(stat).toLowerCase();
  const value = Math.round(Number(stats[key] ?? 0));
  const roll = rollDie(STORY_DIE);
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  log(table, `${token.name} makes a ${label} Story Roll: ${roll}${value >= 0 ? "+" : ""}${value} = ${roll + value}.`);
  return roll + value;
}

export function dash(table: TableState, actor: Actor) {
  const token = actingToken(table, actor);
  if (token.resources.light < DASH_LIGHT_COST) throw new ActionError(`Dashing costs ${DASH_LIGHT_COST} Light.`);
  token.resources.light -= DASH_LIGHT_COST;
  table.combat!.movementLeft += DASH_MOVEMENT;
  log(table, `${token.name} Dashes: -${DASH_LIGHT_COST} Light, +${DASH_MOVEMENT} Movement.`);
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

/** Characters a Page can target: within Weapon Range and not Knocked Out. Only Instant Pages can target yourself. */
export function validTargets(table: TableState, user: Token, page: Page): Token[] {
  return Object.values(table.tokens).filter(
    (t) => !knockedOut(t) && (t.id !== user.id || page.type === "instant") && distance(user, t) <= WEAPON_RANGE[page.type],
  );
}

export function aim(table: TableState, actor: Actor, source: PageSource, cardId?: string, die?: number) {
  const token = actingToken(table, actor);
  const src: PageSource = source === "aux" || source === "ego" ? source : "hand";
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
 * Instant Pages resolve right away and never clash.
 */
export function slot(table: TableState, actor: Actor, targetIds?: string[], ctx?: EngineContext) {
  const c = table.combat!;
  const token = actingToken(table, actor);
  const a = c.aim;
  if (!a || a.tokenId !== token.id) throw new ActionError("Pick a Page first.");
  const page = pageForAim(table, token);
  const ids = [...new Set(targetIds?.length ? targetIds : a.targets)];
  const mass = isMassAttack(page.type);
  if (ids.length === 0) throw new ActionError("Pick a target.");
  if (!mass && ids.length > 1) throw new ActionError("This Page takes one target.");
  const allowed = new Set(validTargets(table, token, page).map((t) => t.id));
  for (const id of ids) if (!allowed.has(id)) throw new ActionError(`${table.tokens[id]?.name ?? "That target"} is out of range.`);
  if (token.resources.light < page.cost) throw new ActionError(`${page.name} costs ${page.cost} Light; ${token.name} has ${token.resources.light}.`);

  const card = a.cardId ? pile(c.decks[token.id], a.source)?.find((x) => x.id === a.cardId) : undefined;
  const free = freeDie(c, token, a.die);
  if (page.type !== "instant" && free === undefined) {
    throw new ActionError(a.die !== undefined ? `Speed Die ${a.die + 1} isn't free.` : "No free Speed Die to slot it on.");
  }

  // Pay, and take the card out of the hand (or Auxiliary Deck).
  token.resources.light -= page.cost;
  const deck = c.decks[token.id];
  if (deck && card) {
    if (a.source === "aux") {
      deck.aux = deck.aux.filter((x) => x.id !== card.id);
      if (card.itemId) ctx?.onToolUsed?.(token.id, card.itemId);
    } else if (a.source === "ego") deck.ego = (deck.ego ?? []).filter((x) => x.id !== card.id);
    else deck.hand = deck.hand.filter((x) => x.id !== card.id);
  }
  delete c.aim;
  const entry: SlottedPage = {
    id: newId(),
    ownerId: token.id,
    die: free ?? 0,
    pageId: page.id,
    card,
    fromAux: a.source === "aux",
    fromEgo: a.source === "ego",
    targets: ids.map((tokenId) => ({ tokenId, die: 0 })),
  };
  const names = ids.map((id) => table.tokens[id].name).join(", ");

  if (page.type === "instant") {
    log(table, `${token.name} uses ${page.name} (Instant) on ${names}.`);
    c.slots.push(entry);
    resolveSlot(table, entry);
    return;
  }

  // Counter Dice on the Page wait on the character until the end of their next Upkeep.
  for (const d of page.dice.filter((x) => x.counter)) storeCounter(c, token, d, page.id);
  c.slots.push(entry);

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
          return;
        }
      }
      log(table, `${token.name} slots ${page.name} against ${names}: Clash with ${otherPage!.name}!`);
      return;
    }
  }
  log(table, `${token.name} slots ${page.name} against ${names} (${page.cost} Light).`);
}
