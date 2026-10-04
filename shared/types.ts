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
}

/** Everything on the table that every member may see. GM-only data lives under games/{id}/gm. */
export interface TableState {
  map: { name: string; width: number; height: number };
  tokens: Record<string, Token>;
  log: string[];
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
  | { type: "addToken"; name: string; side: Side; x: number; y: number }
  | { type: "removeToken"; tokenId: string }
  | { type: "setResources"; tokenId: string; patch: ResourcePatch }
  | { type: "setNote"; tokenId: string; note: string };

/** Which screen a connecting device is: a player's phone or the shared board (GM only). */
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
