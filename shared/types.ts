// Types shared by the web app and the Cloud Functions.
//
// During play the GM's browser hosts the live table and every other screen (board, phones)
// connects straight to it over WebRTC. Firestore is used for accounts, the games list,
// saving the table between sessions, and helping devices find each other.
//
// Firestore layout:
//   users/{uid}                     UserDoc            owner read/write
//   inviteCodes/{code}              { gameId }         functions only
//   games/{gameId}                  GameDoc            members read; functions write
//   games/{gameId}/table/state      TableState         members read; GM write (host autosave)
//   games/{gameId}/gm/meta          GmMeta             GM read; functions write
//   games/{gameId}/gm/notes         GmNotes            GM read/write
//   games/{gameId}/session/host     SessionDoc         members read; GM write
//   games/{gameId}/signals/{id}     SignalDoc          connection handshakes (see src/net)
//   games/{gameId}/characters/{uid} Character          members read; owner or GM write (shared/character.ts)
//   games/{gameId}/enemies/{id}     EnemyTemplate      GM only (shared/character.ts)

import type { DeckEntry, Dice, Page, ResistanceSet } from "./character.ts";

// ---- Accounts and games ----

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface UserDoc {
  displayName: string;
  email: string;
}

/** Every account is the same; your role is per game. Creating a game makes you its GM. */
export type GameRole = "gm" | "player";

export interface GameDoc {
  name: string;
  gmId: string;
  /** Everyone in the game, GM included. Lets the front page query "games I'm in". */
  memberIds: string[];
  members: Record<string, { displayName: string; role: GameRole }>;
  createdAt: number;
}

/** Only the GM can read this, so only the GM can hand out the invite code. */
export interface GmMeta {
  inviteCode: string;
}

export interface GmNotes {
  /** Notes per token id, hidden from the board and players. */
  tokens: Record<string, string>;
}

/** Present while a GM screen is hosting the table. Its id changes every time hosting starts. */
export interface SessionDoc {
  sessionId: string;
  hostUid: string;
  startedAt: number;
}

/** A device asking to join the hosted table, and the host's reply. */
export interface SignalDoc {
  uid: string;
  sessionId: string;
  offer: string;
  answer?: string;
  createdAt: number;
}

// ---- Live table ----

export type Side = "player" | "enemy";

export interface Resources {
  hp: number;
  maxHp: number;
  stagger: number;
  maxStagger: number;
  light: number;
  maxLight: number;
  sanity: number;
  maxSanity: number;
}

export interface Token {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
  color: string;
  resources: Resources;
  /** User who controls this token, if any. */
  ownerId?: string;
  /** Added to Speed rolls and Movement Points. Players' comes from their character; the GM sets enemies'. */
  justice?: number;
  /** Damage multipliers. Players' come from their Armor; the GM sets enemies'. Missing = 1. */
  resistances?: ResistanceSet;
  /** Stagger damage multipliers, the same way. */
  staggerResistances?: ResistanceSet;
  /** An enemy's Pages and Combat Deck (players' come from their character sheet). */
  pages?: Page[];
  deck?: DeckEntry[];
  /** The enemy template this token was copied from. */
  templateId?: string;
  /** Portrait image URL (players' from their character, enemies' from their template). */
  portrait?: string;
  /** Effects on the character (set by the GM for now). */
  effects?: Effect[];
  status?: TokenStatus;
}

/** A temporary ailment, buff or environmental effect (Act 7, "Effects"). */
export interface Effect {
  id: string;
  name: string;
  /** Stacks or count. */
  count: number;
  description: string;
  /** e.g. "until end of next turn". */
  duration?: string;
}

export interface TokenStatus {
  /** Health reached 0. */
  knockedOut?: boolean;
  /** Stagger Resist reached 0. */
  staggered?: boolean;
  /** Sanity reached its minimum. */
  panic?: boolean;
}

/** One character in the turn order. */
export interface Combatant {
  tokenId: string;
  /** The d6 result. Speed = roll + bonus. */
  roll: number;
  bonus: number;
  speed: number;
  /** How many Speed Dice (Page slots) they have. */
  dice: number;
}

/**
 * A turn's phases, in order (Act 8, "On Your Turn"). Phases that need nothing from the player
 * pass automatically; only Combat Actions waits for them.
 */
export type TurnPhase = "resolve" | "upkeep" | "actions" | "endstep";

/** One copy of a Page in a deck, hand or discard pile. */
export interface Card {
  id: string;
  pageId: string;
  /** For Auxiliary Pages: the inventory Tool it comes from. */
  itemId?: string;
}

/** A player's Pages during combat. The draw pile's order is hidden from other players. */
export interface DeckState {
  draw: Card[];
  hand: Card[];
  /** Top of the pile is the end of the list. */
  discard: Card[];
  /** Auxiliary Deck: available from the start of combat. */
  aux: Card[];
  /** Auxiliary Pages already used this combat. */
  auxUsed: Card[];
  /** E.G.O. Pages: available from the start; each is used once per combat. */
  ego?: Card[];
  egoUsed?: Card[];
}

export interface TargetRef {
  tokenId: string;
  /** Which of the target's Speed Dice. */
  die: number;
}

/** A Page slotted on one of a character's Speed Dice, waiting to resolve at the start of their next turn. */
export interface SlottedPage {
  id: string;
  ownerId: string;
  die: number;
  pageId: string;
  /** The card it came from (players), so it can go to the discard pile. */
  card?: Card;
  fromAux?: boolean;
  fromEgo?: boolean;
  targets: TargetRef[];
  /** The page this one is clashing with, if any. */
  clashWith?: string;
}

/** A Counter Die waiting on a character, used automatically against One-Sided attacks. */
export interface CounterDie {
  id: string;
  die: Dice;
  pageId: string;
}

/** The Page a player is picking targets for, so the board can light up valid targets. */
export interface Aim {
  tokenId: string;
  pageId: string;
  source: PageSource;
  cardId?: string;
  /** The Speed Die picked for it, if the player chose one. */
  die?: number;
  /** Picked so far (Mass Attacks pick several). */
  targets: string[];
}

/** Where a Page being used comes from: the hand, the Auxiliary Deck, or E.G.O. Pages. */
export type PageSource = "hand" | "aux" | "ego";

/** Present while combat is running (Act 8). */
export interface CombatState {
  round: number;
  /** Highest Speed first. */
  order: Combatant[];
  /** Index into order of whoever's turn it is. */
  turn: number;
  phase: TurnPhase;
  /** Movement Points the active character has left this turn. */
  movementLeft: number;
  /** Every Page in play, by id, copied from character sheets and enemy page lists. */
  pages: Record<string, Page>;
  /** Everyone's decks in this combat, by token id. */
  decks: Record<string, DeckState>;
  slots: SlottedPage[];
  /** Counter Dice waiting on each character, by token id, in the order they were made. */
  counters: Record<string, CounterDie[]>;
  aim?: Aim;
  /** The latest Page resolutions, die by die, so screens can animate them. Newest last. */
  fx?: ClashFx[];
  /** Id of the newest entry in fx. */
  fxSeq?: number;
}

/** One die as it was rolled, for the clash animation. */
export interface FxDie {
  kind: import("./character.ts").DiceKind;
  sides: number;
  basePower: number;
  counter?: boolean;
  /** Final Power: the roll plus the base. */
  power: number;
}

/** One step of a resolution: two dice clashing, or one die landing unopposed ("hit"). */
export interface FxRound {
  a?: FxDie;
  b?: FxDie;
  result: "a" | "b" | "draw" | "hit";
}

/** A Page resolving against a character: a Clash between two Pages, or a One-Sided Attack (b only answers with Counter Dice). */
export interface ClashFx {
  id: number;
  /** Token ids: a is the side whose Page resolved first. */
  a: string;
  b: string;
  pageA: string;
  pageB?: string;
  rounds: FxRound[];
}

/** Everything on the table that every member may see. GM-only data lives under games/{id}/gm. */
export interface TableState {
  map: { name: string; width: number; height: number };
  tokens: Record<string, Token>;
  log: string[];
  combat?: CombatState;
}

/** What a placed enemy copies from its template. */
export type EnemyTemplateData = Omit<import("./character.ts").EnemyTemplate, "updatedAt" | "notes">;

/** Partial resource edits the GM can apply to any token. */
export type ResourcePatch = Partial<Resources>;

/** Every change to the table goes through shared/engine.ts on the host, which checks who may do it. */
export type TableAction =
  /** Players may move only their own token; the GM may move any token. */
  | { type: "move"; tokenId: string; x: number; y: number }
  /** Move one tile relative to where the token is now, so quick taps on a phone all count. */
  | { type: "step"; tokenId: string; dx: number; dy: number }
  // GM override actions
  | { type: "addToken"; name: string; side: Side; x: number; y: number }
  | { type: "removeToken"; tokenId: string }
  | { type: "setResources"; tokenId: string; patch: ResourcePatch }
  | { type: "setNote"; tokenId: string; note: string }
  | { type: "setJustice"; tokenId: string; justice: number }
  | { type: "setResistances"; tokenId: string; resistances: ResistanceSet; staggerResistances?: ResistanceSet }
  /** Replace an enemy token's Pages and deck. */
  | { type: "setEnemyDeck"; tokenId: string; pages: Page[]; deck: DeckEntry[] }
  /** Place a copy of an enemy template on the map. */
  | { type: "spawnEnemy"; templateId: string; template: EnemyTemplateData; x: number; y: number }
  // Combat (Act 8). The GM runs it; whoever's turn it is can move, use Pages and end their turn.
  | { type: "startCombat"; tokenIds: string[] }
  | { type: "endCombat" }
  | { type: "addCombatant"; tokenId: string }
  | { type: "removeCombatant"; tokenId: string }
  /** Swap a combatant with its neighbour, for breaking Speed ties. */
  | { type: "reorderCombatant"; tokenId: string; dir: -1 | 1 }
  | { type: "rerollSpeed" }
  | { type: "endTurn" }
  /** Move the active character to a tile, spending Movement Points. Used from the board and phones. */
  | { type: "turnMove"; x: number; y: number }
  /** Convert Light into Movement Points. */
  | { type: "dash" }
  /** Roll a Story Roll with one of the character's Stats; the result goes in the log. */
  | { type: "storyRoll"; tokenId: string; stat: string }
  | { type: "setEffects"; tokenId: string; effects: Effect[] }
  /** Pick a Page to use, so the board can show its valid targets. */
  | { type: "aim"; source: PageSource; cardId?: string; pageId?: string; die?: number }
  /** Add or remove a target while aiming a Mass Attack. */
  | { type: "aimTarget"; tokenId: string }
  | { type: "clearAim" }
  /** Pay the Light and slot the aimed Page against the given targets (or the ones picked while aiming). */
  | { type: "slot"; targets?: string[] };

/** Which screen a connecting device is: a player's phone or the shared board. */
export type View = "play" | "board";

// Messages over the WebRTC data channel between a device and the host.
export type PeerMessage =
  | { t: "hello"; view: View }
  | { t: "act"; id: number; action: TableAction };

export type HostMessage =
  | {
      t: "state";
      table: TableState;
      /** User ids connected right now, host included. */
      online: string[];
      /** Only sent to the GM's own devices. */
      notes?: Record<string, string>;
    }
  | { t: "ack"; id: number; error?: string }
  | { t: "bye"; reason: string };
