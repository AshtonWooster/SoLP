import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type { ClientToServer, GameRole, GameState, Resources, ServerToClient, Side, Token, User, View } from "../shared/types.ts";
import { userFromCookieHeader } from "./auth.ts";
import { db } from "./db.ts";
import { roleIn } from "./games.ts";

interface SocketData {
  user: User;
  gameId?: string;
  role?: GameRole;
}

type GameServer = Server<ClientToServer, ServerToClient, {}, SocketData>;
type GameSocket = Socket<ClientToServer, ServerToClient, {}, SocketData>;

interface LiveGame {
  state: GameState;
  /** Open connections per user, to show who is online. */
  connections: Map<string, number>;
  saveTimer?: NodeJS.Timeout;
}

const live = new Map<string, Promise<LiveGame>>();

const PLAYER_COLORS = ["#4fb3bf", "#e0b04f", "#9b7ede", "#6cc070", "#e07a9b", "#5c8fe0"];

function defaultResources(): Resources {
  // Placeholder values until rank/stat tables are filled in the rules.
  return { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
}

function makeToken(name: string, side: Side, x: number, y: number, color: string): Token {
  return { id: randomUUID(), name, side, x, y, color, resources: defaultResources() };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function newState(gameId: string): GameState {
  const state: GameState = {
    gameId,
    map: { name: "Training Floor", width: 16, height: 10 },
    tokens: {},
    online: [],
    log: ["Table created."],
  };
  const enemy = makeToken("Sweeper", "enemy", 12, 4, "#d9534f");
  state.tokens[enemy.id] = enemy;
  return state;
}

/** Loads a game's table from the database the first time anyone opens it. */
function getLive(gameId: string): Promise<LiveGame> {
  let entry = live.get(gameId);
  if (!entry) {
    entry = (async () => {
      const rows = await db.query<{ state: GameState | null }>(`SELECT state FROM games WHERE id = $1`, [gameId]);
      const state = rows[0]?.state ?? newState(gameId);
      state.gameId = gameId;
      state.online = [];
      return { state, connections: new Map() };
    })();
    entry.catch(() => live.delete(gameId));
    live.set(gameId, entry);
  }
  return entry;
}

async function save(game: LiveGame) {
  clearTimeout(game.saveTimer);
  game.saveTimer = undefined;
  const { online: _transient, ...persisted } = game.state;
  try {
    await db.query(`UPDATE games SET state = $2 WHERE id = $1`, [game.state.gameId, JSON.stringify(persisted)]);
  } catch (err) {
    console.error("Failed to save game", game.state.gameId, err);
  }
}

/** Saves shortly after the last change so rapid edits become one write. */
function scheduleSave(game: LiveGame) {
  clearTimeout(game.saveTimer);
  game.saveTimer = setTimeout(() => save(game), 1000);
}

/** Writes any unsaved tables, e.g. before the server shuts down for a redeploy. */
export async function flushAll() {
  const games = await Promise.allSettled(live.values());
  await Promise.all(
    games.flatMap((g) => (g.status === "fulfilled" && g.value.saveTimer ? [save(g.value)] : [])),
  );
}

/** What the board and players may see: everything except GM-only fields. */
function publicView(state: GameState): GameState {
  const tokens: Record<string, Token> = {};
  for (const [id, t] of Object.entries(state.tokens)) {
    const { gmNotes: _hidden, ...rest } = t;
    tokens[id] = rest;
  }
  return { ...state, tokens };
}

function log(game: LiveGame, line: string) {
  game.state.log.push(line);
  if (game.state.log.length > 100) game.state.log.shift();
}

export function attachLive(io: GameServer) {
  const broadcast = (game: LiveGame, { save = true } = {}) => {
    const id = game.state.gameId;
    game.state.online = [...game.connections.keys()];
    io.to(`${id}:gm`).emit("state", game.state);
    io.to(`${id}:public`).emit("state", publicView(game.state));
    if (save) scheduleSave(game);
  };

  // Every live connection must belong to a logged-in user.
  io.use(async (socket, next) => {
    try {
      const user = await userFromCookieHeader(socket.request.headers.cookie);
      if (!user) return next(new Error("Please log in."));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on("connection", (socket: GameSocket) => {
    const user = socket.data.user;
    const current = async () => (socket.data.gameId ? getLive(socket.data.gameId) : undefined);
    const gmGame = async () => (socket.data.role === "gm" ? current() : undefined);

    socket.on("joinGame", async ({ gameId, view }, ack) => {
      try {
        if (socket.data.gameId) return ack({ ok: false, error: "Already at a table." });
        const role = typeof gameId === "string" && /^[0-9a-f-]{36}$/i.test(gameId) ? await roleIn(gameId, user.id) : null;
        if (!role) return ack({ ok: false, error: "You're not in this game." });
        if ((view === "gm" || view === "board") && role !== "gm") {
          return ack({ ok: false, error: "Only the GM can open this screen." });
        }
        const game = await getLive(gameId);
        socket.data.gameId = gameId;
        socket.data.role = role;
        socket.join(view === "gm" ? `${gameId}:gm` : `${gameId}:public`);
        game.connections.set(user.id, (game.connections.get(user.id) ?? 0) + 1);

        let changed = false;
        if (view === "play" && !Object.values(game.state.tokens).some((t) => t.ownerId === user.id)) {
          const n = Object.values(game.state.tokens).filter((t) => t.side === "player").length;
          const token = makeToken(user.displayName, "player", 2, clamp(2 + n, 0, game.state.map.height - 1), PLAYER_COLORS[n % PLAYER_COLORS.length]);
          token.ownerId = user.id;
          game.state.tokens[token.id] = token;
          log(game, `${user.displayName} took a seat.`);
          changed = true;
        }
        ack({ ok: true });
        broadcast(game, { save: changed });
      } catch (err) {
        console.error(err);
        ack({ ok: false, error: "Couldn't open the table." });
      }
    });

    socket.on("moveToken", async ({ tokenId, x, y }, ack) => {
      const game = await current();
      const token = game?.state.tokens[tokenId];
      if (!game || !token) return ack({ ok: false, error: "Token not found." });
      if (socket.data.role !== "gm" && token.ownerId !== user.id) {
        return ack({ ok: false, error: "You can't move that token." });
      }
      token.x = clamp(Math.round(x), 0, game.state.map.width - 1);
      token.y = clamp(Math.round(y), 0, game.state.map.height - 1);
      ack({ ok: true });
      broadcast(game);
    });

    socket.on("gmAddToken", async ({ name, side, x, y }, ack) => {
      const game = await gmGame();
      if (!game) return ack({ ok: false, error: "GM only." });
      const s: Side = side === "player" ? "player" : "enemy";
      const { width, height } = game.state.map;
      const token = makeToken(
        String(name).trim().slice(0, 24) || "Enemy",
        s,
        clamp(Math.round(Number(x) || 0), 0, width - 1),
        clamp(Math.round(Number(y) || 0), 0, height - 1),
        s === "enemy" ? "#d9534f" : "#4fb3bf",
      );
      game.state.tokens[token.id] = token;
      log(game, `GM added ${token.name}.`);
      ack({ ok: true });
      broadcast(game);
    });

    socket.on("gmRemoveToken", async ({ tokenId }, ack) => {
      const game = await gmGame();
      const token = game?.state.tokens[tokenId];
      if (!game || !token) return ack({ ok: false, error: "GM only." });
      delete game.state.tokens[tokenId];
      log(game, `GM removed ${token.name}.`);
      ack({ ok: true });
      broadcast(game);
    });

    socket.on("gmSetResources", async ({ tokenId, patch }, ack) => {
      const game = await gmGame();
      const token = game?.state.tokens[tokenId];
      if (!game || !token) return ack({ ok: false, error: "GM only." });
      for (const [key, value] of Object.entries(patch ?? {})) {
        if (key in token.resources && typeof value === "number" && Number.isFinite(value)) {
          token.resources[key as keyof Resources] = Math.round(value);
        }
      }
      log(game, `GM override: ${token.name} ${Object.entries(patch ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      ack({ ok: true });
      broadcast(game);
    });

    socket.on("gmSetNotes", async ({ tokenId, notes }, ack) => {
      const game = await gmGame();
      const token = game?.state.tokens[tokenId];
      if (!game || !token) return ack({ ok: false, error: "GM only." });
      token.gmNotes = String(notes).slice(0, 2000);
      ack({ ok: true });
      broadcast(game);
    });

    socket.on("disconnect", async () => {
      const game = await current().catch(() => undefined);
      if (!game) return;
      const n = (game.connections.get(user.id) ?? 1) - 1;
      if (n > 0) game.connections.set(user.id, n);
      else game.connections.delete(user.id);
      broadcast(game, { save: false });
    });
  });
}
