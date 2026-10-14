// Types shared by the web app and the Cloud Functions.
//
// During play the GM's browser hosts the live table and every other screen (board, phones)
// connects straight to it over WebRTC. Firestore is used for accounts, the games list,
// saving the table between sessions, and helping devices find each other.
//
// Firestore layout:
//   users/{uid}                     UserDoc            owner read/write (display name, theme)
//   inviteCodes/{code}              { gameId }         functions only
//   joinAttempts/{uid}              JoinAttempts       functions only (shared/invites.ts)
//   games/{gameId}                  GameDoc            members read; functions write
//   games/{gameId}/table/state      TableState         GM read/write (host autosave)
//   games/{gameId}/table/status     TableStatus        members read; GM write (host autosave)
//   games/{gameId}/gm/meta          GmMeta             GM read; functions write
//   games/{gameId}/gm/notes         GmNotes            GM read/write
//   games/{gameId}/session/host     SessionDoc         members read; GM write
//   games/{gameId}/signals/{id}     SignalDoc          connection handshakes (see src/net)
//   games/{gameId}/characters/{uid} Character          members read; owner or GM write (shared/character.ts)
//   games/{gameId}/enemies/{id}     NpcTemplate        GM only (shared/character.ts)
//   games/{gameId}/vfx/{id}         VfxDef             members read; GM write (shared/vfx.ts)

import type { ThemeId } from "./account.ts";
import type { DeckEntry, Dice, NpcSide, Page, ResistanceSet } from "./character.ts";
import type { Fog } from "./fog.ts";
import type { StatFormulas } from "./formulas.ts";
import type { SheetSecrets } from "./secrets.ts";

// ---- Accounts and games ----

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface UserDoc {
  displayName: string;
  email: string;
  /** The look of the app on this person's devices (shared/account.ts). Missing means Classic. */
  theme?: ThemeId;
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
  /** The game's image (a download URL), set by the GM in Game settings: shown on the game's page and its box on the front page. */
  image?: string;
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
  /**
   * Players' new and changed Proficiencies in the Proficiency tree (shared/proficiencies.ts) wait for
   * the GM's approval, and nobody can pick them until then. Off unless the GM turns it on: then
   * players' Proficiencies join the tree right away, as they always have.
   */
  approveProficiencies?: boolean;
  /**
   * Players may make Story Rolls on their own from their phone. On unless the GM turns it off: then
   * the Story roll button is gone and players roll only when a GM popup asks them to.
   */
  playerStoryRolls?: boolean;
  /**
   * When the GM ends combat, every automated status Effect (Burn, Poise…) comes off the characters
   * who fought. Off unless the GM turns it on: then Effects stay until they wear off or the GM removes them.
   */
  clearEffectsAfterCombat?: boolean;
  /**
   * Status Effects play the VFX the GM built for them in the VFX editor (shared/vfx.ts) on the map.
   * Off unless the GM turns it on: then the map looks as it always did and loads no VFX.
   */
  statusVfx?: boolean;
  /**
   * How Rank and Stats set max Health, Stagger Resist, Sanity and Light (shared/formulas.ts). New
   * games start with the standard formulas; a game from before formulas has none saved and keeps
   * its old numbers until the GM changes them.
   */
  statFormulas?: Partial<StatFormulas>;
  /**
   * When the GM last cleared the table log (ms since 1970), from the Clear log button. Not a toggle:
   * a game that never cleared its log has none (shared/clearLog.ts).
   */
  logClearedAt?: number;
}

export function playersCanCreateItems(game: GameDoc | undefined): boolean {
  return game?.settings?.playersCreateItems === true;
}

export function playersCanCreateEffects(game: GameDoc | undefined): boolean {
  return game?.settings?.playersCreateEffects === true;
}

export function proficienciesNeedApproval(game: GameDoc | undefined): boolean {
  return game?.settings?.approveProficiencies === true;
}

export function playersCanStoryRoll(game: GameDoc | undefined): boolean {
  return game?.settings?.playerStoryRolls !== false;
}

export function effectsClearAfterCombat(game: GameDoc | undefined): boolean {
  return game?.settings?.clearEffectsAfterCombat === true;
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
  /** When Firestore deletes it if nothing else did (a TTL policy in firestore.indexes.json). */
  expireAt?: Date;
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
  /** Automated rules that fire once a round or once a combat: the round each last fired in. */
  effectUses?: Record<string, number>;
  /** Resistances changed by automated effects for a while (cleared when combat ends). */
  resistMods?: ResistMod[];
  status?: TokenStatus;
  /** Only the GM sees it (map editor). Joining combat reveals it. */
  hidden?: boolean;
  /** The GM's characters: parts of the sheet players can't see (shared/secrets.ts). */
  secret?: SheetSecrets;
  /** Set on the copy players get, which leaves out what `secret` hides. */
  concealed?: boolean;
  /** The GM's characters: the gear it was placed with, so players can see it if the GM shows it. */
  gear?: TokenGearInfo;
}

/** A Resistance changed by an automated effect: the multiplier for one damage type, until the round ends or combat ends. */
export interface ResistMod {
  kind: "slash" | "pierce" | "blunt";
  stagger: boolean;
  value: number;
  /** The round it wears off at the end of; missing: when combat ends. */
  round?: number;
}

/** Names of a character's Weapons, Armor and Augment, for the token popup. */
export interface TokenGearInfo {
  weapons: { id: string; name: string; hands: 1 | 2 }[];
  armor?: { name: string };
  augment?: { name: string; passives: string[] };
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
  /** Stacks given "next round": they arrive at the start of the next round. */
  pending?: number;
  /** Who gave the stacks, for automated effects that keep each character's apart (Marks). */
  sourceId?: string;
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
  /** Speed Dice before automated effects added or took any (missing: the same as dice). */
  baseDice?: number;
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
  /** Costs this much less until the end of this round (an automated effect). */
  discount?: { n: number; round: number };
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
  /** Which of its owner's Pages this round it was (1: the first), for "the first Page I use" effects. */
  nth?: number;
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
  /** The latest Speed roll (combat starting, a re-roll, or someone joining), so screens can animate it. */
  speedRoll?: SpeedRoll;
  /** Status Effects that just went off (their rules fired), newest last, so screens can play their VFX (shared/vfx.ts). */
  procs?: EffectProc[];
  /** Id of the newest entry in procs. */
  procSeq?: number;
  /** Pages each character has used this round, by token id. */
  used?: Record<string, number>;
}

/** A status Effect going off on a character: its rules fired. */
export interface EffectProc {
  id: number;
  tokenId: string;
  /** The Effect's library id. */
  defId: string;
}

/** Who just rolled Speed. A new id each roll, so screens play each roll once. */
export interface SpeedRoll {
  id: string;
  tokenIds: string[];
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
  /** A Mass Summation check: all of the attacker's dice, rolled together and summed (`a` is then left out). */
  aDice?: FxDie[];
  /** A Mass Attack: each target's side of this step at once, by token id. Targets left out sit this step out. */
  vs?: Record<string, FxMassSide>;
}

/** One Mass Attack target's side of a step: what they answered with, and how it went. */
export interface FxMassSide {
  /** The die they answered with: a die of their Page, or a Counter Die. */
  die?: FxDie;
  /** A Summation check: every die of the Page they defend with, rolled together and summed. */
  dice?: FxDie[];
  /** "a": the Mass Attack won and lands, "b": the target held, "draw", or "hit": it landed unopposed. */
  result: FxRound["result"];
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
  /** A Mass Attack: every target, which all play at once with `a`. `b` is the first of them. */
  targets?: string[];
  /** A Mass Attack: the Page each target defends with, by token id. */
  pages?: Record<string, string>;
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
  /** Fog of war over this map (shared/fog.ts). Missing: nothing is hidden. */
  fog?: Fog;
  /** The GM's folder this map is sorted into (shared/mapFolders.ts). Missing: the top level. */
  folder?: string;
}

/** A folder in the map editor's list of maps. */
export interface MapFolder {
  name: string;
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

/** What members may read of the saved table: whether combat is running. */
export interface TableStatus {
  combat: boolean;
}

export interface TableState {
  map: MapInfo;
  /** The GM's other maps, by id. The current one is `map`, with its tokens in `tokens`. */
  maps?: Record<string, SavedMap>;
  /** Folders the GM sorts the maps into, by id (shared/mapFolders.ts). */
  mapFolders?: Record<string, MapFolder>;
  tokens: Record<string, Token>;
  log: string[];
  combat?: CombatState;
  /** Popups the GM sent to players: text, an image, a Story Roll prompt (shared/popups.ts). Newest last. Finished ones stay for the GM's record. */
  popups?: GmPopup[];
  /** The latest Story Roll, for screens to play its dice (shared/combat.ts). */
  storyRoll?: StoryRoll;
}

/** A Story Roll: 1d20 (the roll) + a Stat (the bonus). Players' copy leaves out a hidden bonus. */
export interface StoryRoll {
  id: string;
  tokenId: string;
  /** The Stat rolled, as "insight", "justice"… */
  stat: string;
  roll: number;
  bonus?: number;
}

/** A popup the GM sends to every player or to some of them. Any mix of text, an image and a Story Roll prompt. */
export interface GmPopup {
  id: string;
  title?: string;
  text?: string;
  /** An image URL (uploaded to the game's assets). */
  image?: string;
  /** Asks for a Story Roll: the Stat to roll, or "any" to let the player pick. */
  roll?: { stat: string };
  /** Players (user ids) it's for. Missing: every player, including ones who join later. */
  to?: string[];
  sentAt: number;
  /** Players who closed it. */
  closedBy?: string[];
  /** Each player's Story Roll total, by user id. */
  rolls?: Record<string, number>;
  /** An item and/or Ahn it hands out or takes away (shared/rewards.ts). */
  deal?: PopupDeal;
  /** How the deal turned out for each player, by user id. */
  outcomes?: Record<string, DealOutcome>;
  /**
   * When it came down: every player it's for closed it, or the GM took it down (`takenDown`). It's
   * off every phone then; the GM's screen keeps it, with its results, until they clear it.
   */
  doneAt?: number;
  takenDown?: boolean;
}

/**
 * Items and Ahn a GM popup hands out (a reward) or takes away (a cost), and when: right away when
 * it's sent, on a Story Roll of at least `need`, or when the player pays `price` Ahn (rewards only).
 * On a roll a reward is gained on a success; a cost is lost on a failure.
 */
export interface PopupDeal {
  kind: "reward" | "cost";
  /** An item from the GM's item library, with its name as sent (the library item may change later). */
  itemId?: string;
  itemName?: string;
  /** How many of the item. */
  count?: number;
  /** Ahn gained (a reward) or lost (a cost). */
  ahn?: number;
  when: "now" | "roll" | "buy";
  need?: number;
  price?: number;
}

/**
 * gained: got the reward (or bought it). missed: failed the roll for a reward. lost: lost the cost.
 * kept: passed the roll and kept it. full: no free Slot for the item. none: had none of the cost to
 * lose. nosheet: has no character sheet.
 */
export type DealOutcome = "gained" | "missed" | "lost" | "kept" | "full" | "none" | "nosheet";

/** What a player's screen gets of a popup sent to them: nothing about anyone else. */
export interface PlayerPopup {
  id: string;
  title?: string;
  text?: string;
  image?: string;
  roll?: { stat: string };
  /** Their own Story Roll total, once they've rolled. */
  rolled?: number;
  deal?: PopupDeal;
  /** How the deal turned out for them, once it's settled. */
  outcome?: DealOutcome;
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
  /** Parts of its sheet players can't see. */
  secret?: SheetSecrets;
  gear?: TokenGearInfo;
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
  /** Rename one copy of a GM character on the map (players' tokens follow their sheets). */
  | { type: "renameToken"; tokenId: string; name: string }
  /** Which parts of a GM character's sheet players can't see (shared/secrets.ts). */
  | { type: "setSecret"; tokenId: string; secret: SheetSecrets }
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
  /** Fog of war (shared/fog.ts): draw a box of whole tiles that hides, or reveals, that part of a map. */
  | { type: "drawFog"; mapId?: string; x: number; y: number; w: number; h: number; reveal?: boolean }
  /** Hide or reveal the whole map. */
  | { type: "fogAll"; mapId?: string; hidden: boolean }
  /** Move the players to another map. */
  | { type: "switchMap"; mapId: string }
  | { type: "deleteMap"; mapId: string }
  /** Folders for sorting maps (shared/mapFolders.ts). Deleting one moves its maps to the top level. */
  | { type: "createMapFolder"; id?: string; name: string }
  | { type: "renameMapFolder"; folderId: string; name: string }
  | { type: "deleteMapFolder"; folderId: string }
  /** folderId null: back to the top level. */
  | { type: "setMapFolder"; mapId: string; folderId: string | null }
  // Combat (Act 8). The GM runs it; whoever's turn it is can move, use Pages and end their turn.
  | { type: "startCombat"; tokenIds: string[] }
  | { type: "endCombat" }
  | { type: "addCombatant"; tokenId: string }
  | { type: "removeCombatant"; tokenId: string }
  /** Swap a combatant with its neighbour, for breaking Speed ties. */
  /** dir: one place up or down; to: straight to that place in the order (dragging). */
  | { type: "reorderCombatant"; tokenId: string; dir?: -1 | 1; to?: number }
  | { type: "rerollSpeed" }
  | { type: "endTurn" }
  /** Move the active character to a tile, spending Movement Points. Used from the board and phones. */
  | { type: "turnMove"; x: number; y: number }
  /** Roll a Story Roll with one of the character's Stats; the result goes in the log. */
  | { type: "storyRoll"; tokenId: string; stat: string }
  // GM popups (shared/popups.ts).
  /** GM: show players a popup. `to` missing or empty: every player. */
  | { type: "sendPopup"; id?: string; title?: string; text?: string; image?: string; roll?: { stat: string }; to?: string[]; deal?: PopupDeal }
  /** GM: take a popup down from every screen. Its results stay in the GM's finished list. */
  | { type: "removePopup"; popupId: string }
  /** GM: clear a finished popup from their list, or every finished one when `popupId` is missing. */
  | { type: "clearPopups"; popupId?: string }
  /** A player closes a popup sent to them. */
  | { type: "closePopup"; popupId: string }
  /** A player makes the Story Roll a popup asks for. `stat`: their pick, when the popup lets them choose. */
  | { type: "popupRoll"; popupId: string; stat?: string }
  /** A player pays the Ahn a popup asks for its reward. */
  | { type: "popupBuy"; popupId: string }
  /** GM: set a player's Ahn (Game setting "Rewards and costs in popups"). */
  | { type: "setAhn"; uid: string; ahn: number }
  | { type: "setEffects"; tokenId: string; effects: Effect[] }
  /** Pick a Page to use, so the board can show its valid targets. */
  | { type: "aim"; source: PageSource; cardId?: string; pageId?: string; die?: number }
  /** Add or remove a target while aiming a Mass Attack. */
  | { type: "aimTarget"; tokenId: string }
  | { type: "clearAim" }
  /**
   * Pay the Light and slot the aimed Page against the given targets (or the ones picked while aiming).
   * `targetDie` picks which of a single target's Speed Dice to clash with (the first by default);
   * `unopposed` slots it as a One-Sided attack that doesn't clash with the Page on that die.
   */
  | { type: "slot"; targets?: string[]; targetDie?: number; unopposed?: boolean };

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
      /** A player's phone: the GM's popups for them that they haven't closed (shared/popups.ts). */
      popups?: PlayerPopup[];
    }
  | { t: "ack"; id: number; error?: string }
  | { t: "bye"; reason: string };
