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
//   games/{gameId}/enemies/{id}     NpcTemplate        GM only (shared/character.ts)

import type { DeckEntry, Dice, NpcSide, Page, ResistanceSet } from "./character.ts";

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
  /** Set by the GM on the game settings page. */
  settings?: GameSettings;
}

/**
 * Parts of their character sheet players may edit freely. Each is on unless the GM turns it off;
 * then a player's changes to it wait for the GM's approval (shared/permissions.ts).
 */
export type PlayerEditKey = "stats" | "inventory" | "augment" | "equipment";

export interface GameSettings {
  playerEdit?: Partial<Record<PlayerEditKey, boolean>>;
  /**
   * Players' new and changed items in the item library go straight into use. Off unless the GM turns
   * it on: then each waits for the GM's approval.
   */
  playersCreateItems?: boolean;
  /**
   * Players' new and changed automated effects in the effect library work at the table right away.
   * Off unless the GM turns it on: then each does nothing until the GM approves it.
   */
  playersCreateEffects?: boolean;
}

export function playersCanCreateItems(game: GameDoc | undefined): boolean {
  return game?.settings?.playersCreateItems === true;
}

export function playersCanCreateEffects(game: GameDoc | undefined): boolean {
  return game?.settings?.playersCreateEffects === true;
}

export const PLAYER_EDIT_OPTIONS: { key: PlayerEditKey; label: string; hint: string; fields: string[] }[] = [
  { key: "stats", label: "Stats", hint: "Primary and Secondary Stats", fields: ["primary", "secondary"] },
  { key: "inventory", label: "Inventory & Ahn", hint: "Items, the Trinket Slot and Ahn", fields: ["inventory", "ahn"] },
  { key: "augment", label: "Augment & Proficiencies", hint: "The Augment, its Passives and Proficiencies", fields: ["augment", "proficiencies"] },
  { key: "equipment", label: "Weapons, Armor & Decks", hint: "Weapons, Armor, their Pages, the Combat Deck and E.G.O. Pages", fields: ["weapons", "armor", "deck", "ego"] },
];

/** Whether players in this game may edit a part of their sheet without the GM's approval (the GM always can). */
export function playerCanEdit(game: GameDoc | undefined, key: PlayerEditKey): boolean {
  return game?.settings?.playerEdit?.[key] !== false;
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

export type Side = "player" | NpcSide;

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
  /** Effects on the character: set by the GM, or given by automated effects. */
  effects?: Effect[];
  /** An enemy's automated Passives (library effect ids); players' come from their character sheet. */
  passiveEffects?: string[];
  status?: TokenStatus;
  /** Only the GM sees it (map editor). Joining combat reveals it. */
  hidden?: boolean;
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
  /** The automated effect from the library this is (count is its stacks). Missing: a note the GM tracks by hand. */
  defId?: string;
}

export interface TokenStatus {
  /** Health reached 0. */
  knockedOut?: boolean;
  /** Stagger Resist reached 0. Can't act; all Resistances are 2x until they recover. */
  staggered?: boolean;
  /** Upkeeps the character has passed while Staggered; they recover at STAGGER_UPKEEPS. */
  staggerUpkeeps?: number;
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
  /** Both characters' resources and statuses right after this step, so screens can apply the damage when the animation gets here. */
  after?: FxState;
}

/** Resources and statuses of the characters in a resolution, by token id. */
export type FxState = Record<string, { resources: Resources; status?: TokenStatus }>;

/** A Page resolving against a character: a Clash between two Pages, or a One-Sided Attack (b only answers with Counter Dice). */
export interface ClashFx {
  id: number;
  /** Token ids: a is the side whose Page resolved first. */
  a: string;
  b: string;
  pageA: string;
  pageB?: string;
  rounds: FxRound[];
  /** Both characters as they were before the first die. */
  before?: FxState;
}

/** Everything on the table that every member may see. GM-only data lives under games/{id}/gm. */
/** A battle map: its name, size in tiles and optional background image. */
export interface MapInfo {
  /** Missing on tables saved before there were several maps. */
  id?: string;
  name: string;
  width: number;
  height: number;
  /** Image URL stretched over the whole grid: the map's bottom layer. */
  background?: string;
  /** The background is only shown to the GM. */
  backgroundHidden?: boolean;
  /** Don't draw tile lines over the map. */
  hideGrid?: boolean;
  /**
   * The middle layer (images and other assets) and the pins and notes drawn above the tokens, in
   * drawing order: later ones are on top.
   */
  items?: MapItem[];
}

/** An image on a map's asset layer, or a pin with a note. Positions and sizes are in tiles. */
export interface MapItem {
  id: string;
  kind: "image" | "pin";
  /** Top-left corner for images, the point for pins. Fractions when not snapped to the grid. */
  x: number;
  y: number;
  /** Images only. */
  w?: number;
  h?: number;
  /** Degrees clockwise (images). */
  rotation?: number;
  /** The image (images). */
  url?: string;
  /** The image's name, or the pin's label. */
  name?: string;
  /** A pin's note. */
  note?: string;
  /** A pin's color. */
  color?: string;
  /** Only the GM sees it. */
  hidden?: boolean;
  /** Can't be dragged in the editor. */
  locked?: boolean;
}

/** A map that isn't on the table right now: its enemies wait here, and where each player stood. */
export interface SavedMap extends MapInfo {
  id: string;
  /** Tokens that stay with this map (enemies, NPCs), with their Health and decks as they were. */
  tokens: Record<string, Token>;
  /** Where the tokens that travel between maps (player characters) last stood here. */
  positions: Record<string, { x: number; y: number }>;
}

export interface TableState {
  map: MapInfo;
  /** The GM's other maps, by id. The current one is `map`, with its tokens in `tokens`. */
  maps?: Record<string, SavedMap>;
  tokens: Record<string, Token>;
  log: string[];
  combat?: CombatState;
}

/** What a placed copy of a GM-made character starts with (worked out by npcSpawnData in shared/ruleset.ts). */
export interface SpawnData {
  name: string;
  color: string;
  side: NpcSide;
  maxHp: number;
  maxStagger: number;
  maxLight: number;
  maxSanity: number;
  justice: number;
  resistances: ResistanceSet;
  staggerResistances: ResistanceSet;
  pages: Page[];
  deck: DeckEntry[];
  portrait?: string;
  /** Library ids of the automated effects its Passives and Proficiencies link to. */
  passiveEffects?: string[];
}

/** Partial resource edits the GM can apply to any token. */
export type ResourcePatch = Partial<Resources>;

/** Every change to the table goes through shared/engine.ts on the host, which checks who may do it. */
export type TableAction =
  /** Players may move only their own token; the GM may move any token. */
  | { type: "move"; tokenId: string; x: number; y: number }
  /** Move one tile relative to where the token is now, so quick taps on a phone all count. */
  | { type: "step"; tokenId: string; dx: number; dy: number }
  // GM override actions
  /** mapId: put it on another map the GM is getting ready instead of the one on the table. */
  | { type: "addToken"; name: string; side: Side; x: number; y: number; mapId?: string; hidden?: boolean }
  | { type: "removeToken"; tokenId: string; mapId?: string }
  | { type: "setResources"; tokenId: string; patch: ResourcePatch }
  | { type: "setNote"; tokenId: string; note: string }
  | { type: "setJustice"; tokenId: string; justice: number }
  | { type: "setResistances"; tokenId: string; resistances: ResistanceSet; staggerResistances?: ResistanceSet }
  /** Replace an enemy token's Pages and deck. */
  | { type: "setEnemyDeck"; tokenId: string; pages: Page[]; deck: DeckEntry[] }
  /** Place a copy of a GM-made character on the map. */
  | { type: "spawnEnemy"; templateId: string; template: SpawnData; x: number; y: number; mapId?: string; hidden?: boolean }
  // Maps (shared/maps.ts). GM only.
  /** copyFrom: start from another map's size, background and assets (not its tokens). */
  | { type: "createMap"; id?: string; name: string; width: number; height: number; background?: string; copyFrom?: string }
  | {
      type: "updateMap";
      mapId: string;
      name?: string;
      width?: number;
      height?: number;
      background?: string | null;
      backgroundHidden?: boolean;
      hideGrid?: boolean;
    }
  // The map editor works on any map: the one on the table, or one the GM is getting ready.
  | { type: "addMapItem"; mapId: string; item: Partial<MapItem> }
  | { type: "updateMapItem"; mapId: string; itemId: string; patch: Partial<MapItem> }
  | { type: "removeMapItem"; mapId: string; itemId: string }
  | { type: "arrangeMapItem"; mapId: string; itemId: string; to: "front" | "back" | "forward" | "backward" }
  /** Replace every item (undo and redo). */
  | { type: "setMapItems"; mapId: string; items: MapItem[] }
  /** Move a token on any map. On a map that isn't on the table, a player's token sets where they arrive. */
  | { type: "placeToken"; mapId: string; tokenId: string; x: number; y: number }
  | { type: "setTokenHidden"; mapId?: string; tokenId: string; hidden: boolean }
  /** Move the players to another map. */
  | { type: "switchMap"; mapId: string }
  | { type: "deleteMap"; mapId: string }
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
