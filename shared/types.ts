// Types shared by the web app and the Cloud Functions.
//
// Firestore layout:
//   users/{uid}                     UserDoc            owner read/write
//   inviteCodes/{code}              { gameId }         functions only
//   games/{gameId}                  GameDoc            members read; functions write
//   games/{gameId}/table/state      TableState         members read; functions write
//   games/{gameId}/gm/meta          GmMeta             GM read; functions write
//   games/{gameId}/gm/notes         GmNotes            GM read/write
//   games/{gameId}/presence/{uid}   Presence           members read; owner write

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

export interface Presence {
  lastSeen: number;
}

/** A member counts as online if their table screen checked in this recently. */
export const PRESENCE_TIMEOUT_MS = 60_000;
export const PRESENCE_INTERVAL_MS = 25_000;

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
}

/** Everything on the table that every member may see. GM-only data lives under games/{id}/gm. */
export interface TableState {
  map: { name: string; width: number; height: number };
  tokens: Record<string, Token>;
  log: string[];
}

/** Partial resource edits the GM can apply to any token. */
export type ResourcePatch = Partial<Resources>;

/** Every change to the table goes through the tableAction function, which checks who may do it. */
export type TableAction =
  /** A player sits down at the table: creates their token if they don't have one. */
  | { type: "takeSeat" }
  /** Players may move only their own token; the GM may move any token. */
  | { type: "move"; tokenId: string; x: number; y: number }
  /** Move one tile relative to where the token is now, so quick taps on a phone all count. */
  | { type: "step"; tokenId: string; dx: number; dy: number }
  // GM override actions
  | { type: "addToken"; name: string; side: Side; x: number; y: number }
  | { type: "removeToken"; tokenId: string }
  | { type: "setResources"; tokenId: string; patch: ResourcePatch };
