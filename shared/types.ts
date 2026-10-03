// Types shared by the game server and every screen (board, GM, player).

// ---- Accounts and games ----

export interface User {
  id: string;
  email: string;
  displayName: string;
}

/** Every account is the same; your role is per game. Creating a game makes you its GM. */
export type GameRole = "gm" | "player";

export interface GameSummary {
  id: string;
  name: string;
  role: GameRole;
  gmName: string;
  playerCount: number;
}

export interface GameDetail {
  id: string;
  name: string;
  role: GameRole;
  /** Present only for the GM. */
  inviteCode?: string;
  members: { id: string; displayName: string; role: GameRole }[];
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
  /** GM-only notes. Stripped before state is sent to the board or players. */
  gmNotes?: string;
}

export interface GameState {
  gameId: string;
  map: { name: string; width: number; height: number };
  tokens: Record<string, Token>;
  /** User ids currently connected to the table. */
  online: string[];
  log: string[];
}

/** Which screen a connection is: the GM's controls, the shared board, or a player's phone. */
export type View = "gm" | "board" | "play";

/** Partial resource edits the GM can apply to any token. */
export type ResourcePatch = Partial<Resources>;

// Messages sent from a screen to the server. Each one gets an Ack back.
export interface ClientToServer {
  /** The logged-in user opens a game's table. "gm" and "board" need the GM role. */
  joinGame: (p: { gameId: string; view: View }, ack: (res: Ack) => void) => void;
  /** Players may move only their own token; the GM may move any token. */
  moveToken: (p: { tokenId: string; x: number; y: number }, ack: (res: Ack) => void) => void;
  // GM override actions
  gmAddToken: (p: { name: string; side: Side; x: number; y: number }, ack: (res: Ack) => void) => void;
  gmRemoveToken: (p: { tokenId: string }, ack: (res: Ack) => void) => void;
  gmSetResources: (p: { tokenId: string; patch: ResourcePatch }, ack: (res: Ack) => void) => void;
  gmSetNotes: (p: { tokenId: string; notes: string }, ack: (res: Ack) => void) => void;
}

export interface ServerToClient {
  state: (s: GameState) => void;
}

export type Ack<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
