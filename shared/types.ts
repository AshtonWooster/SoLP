// Types shared by the game server and every screen (board, GM, player).

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
  /** Player who controls this token, if any. */
  ownerId?: string;
  /** GM-only notes. Stripped before state is sent to the board or players. */
  gmNotes?: string;
}

export interface Player {
  id: string;
  name: string;
  connected: boolean;
}

export interface GameState {
  code: string;
  map: { name: string; width: number; height: number };
  tokens: Record<string, Token>;
  players: Record<string, Player>;
  log: string[];
}

export type Role = "gm" | "board" | "player";

/** Partial resource edits the GM can apply to any token. */
export type ResourcePatch = Partial<Resources>;

// Messages sent from a screen to the server. Each one gets an Ack back.
export interface ClientToServer {
  createRoom: (ack: (res: Ack<{ code: string; gmKey: string }>) => void) => void;
  joinGm: (p: { code: string; gmKey: string }, ack: (res: Ack) => void) => void;
  joinBoard: (p: { code: string }, ack: (res: Ack) => void) => void;
  joinPlayer: (
    p: { code: string; name: string; playerId?: string },
    ack: (res: Ack<{ playerId: string }>) => void,
  ) => void;
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
