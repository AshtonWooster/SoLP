import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServer,
  GameState,
  Resources,
  ServerToClient,
  Side,
  Token,
} from "../shared/types.ts";

const PORT = Number(process.env.PORT ?? 3001);

interface Room {
  state: GameState;
  gmKey: string;
}

interface SocketData {
  code?: string;
  role?: "gm" | "board" | "player";
  playerId?: string;
}

type GameSocket = Socket<ClientToServer, ServerToClient, {}, SocketData>;

const rooms = new Map<string, Room>();

const app = express();
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient, {}, SocketData>(http, {
  cors: { origin: true },
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// In production the server also hosts the built website, so one deploy covers everything.
const distDir = path.resolve(import.meta.dirname, "../dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // Any other page (/board, /gm, /play) gets the app; the app picks the screen.
  app.use((_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

const PLAYER_COLORS = ["#4fb3bf", "#e0b04f", "#9b7ede", "#6cc070", "#e07a9b", "#5c8fe0"];

function newCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, easy to read aloud
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

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

/** What the board and players may see: everything except GM-only fields. */
function publicView(state: GameState): GameState {
  const tokens: Record<string, Token> = {};
  for (const [id, t] of Object.entries(state.tokens)) {
    const { gmNotes: _hidden, ...rest } = t;
    tokens[id] = rest;
  }
  return { ...state, tokens };
}

function broadcast(room: Room) {
  const code = room.state.code;
  io.to(`${code}:gm`).emit("state", room.state);
  io.to(`${code}:public`).emit("state", publicView(room.state));
}

function log(room: Room, line: string) {
  room.state.log.push(line);
  if (room.state.log.length > 100) room.state.log.shift();
}

io.on("connection", (socket: GameSocket) => {
  const roomOf = () => (socket.data.code ? rooms.get(socket.data.code) : undefined);
  const gmRoom = () => (socket.data.role === "gm" ? roomOf() : undefined);

  socket.on("createRoom", (ack) => {
    const code = newCode();
    const gmKey = randomBytes(12).toString("hex");
    const state: GameState = {
      code,
      map: { name: "Training Floor", width: 16, height: 10 },
      tokens: {},
      players: {},
      log: [`Room ${code} created.`],
    };
    const enemy = makeToken("Sweeper", "enemy", 12, 4, "#d9534f");
    state.tokens[enemy.id] = enemy;
    rooms.set(code, { state, gmKey });
    ack({ ok: true, code, gmKey });
  });

  socket.on("joinGm", ({ code, gmKey }, ack) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return ack({ ok: false, error: "Room not found." });
    if (room.gmKey !== gmKey) return ack({ ok: false, error: "Wrong GM key." });
    socket.data = { code: room.state.code, role: "gm" };
    socket.join(`${room.state.code}:gm`);
    ack({ ok: true });
    socket.emit("state", room.state);
  });

  socket.on("joinBoard", ({ code }, ack) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return ack({ ok: false, error: "Room not found." });
    socket.data = { code: room.state.code, role: "board" };
    socket.join(`${room.state.code}:public`);
    ack({ ok: true });
    socket.emit("state", publicView(room.state));
  });

  socket.on("joinPlayer", ({ code, name, playerId }, ack) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return ack({ ok: false, error: "Room not found." });
    const { state } = room;
    let player = playerId ? state.players[playerId] : undefined;
    if (!player) {
      const trimmed = name?.trim().slice(0, 24);
      if (!trimmed) return ack({ ok: false, error: "Enter a name." });
      player = { id: randomUUID(), name: trimmed, connected: true };
      state.players[player.id] = player;
      const n = Object.keys(state.players).length - 1;
      const token = makeToken(trimmed, "player", 2, 2 + n, PLAYER_COLORS[n % PLAYER_COLORS.length]);
      token.ownerId = player.id;
      state.tokens[token.id] = token;
      log(room, `${trimmed} joined.`);
    }
    player.connected = true;
    socket.data = { code: state.code, role: "player", playerId: player.id };
    socket.join(`${state.code}:public`);
    ack({ ok: true, playerId: player.id });
    broadcast(room);
  });

  socket.on("moveToken", ({ tokenId, x, y }, ack) => {
    const room = roomOf();
    const token = room?.state.tokens[tokenId];
    if (!room || !token) return ack({ ok: false, error: "Token not found." });
    const allowed =
      socket.data.role === "gm" || (socket.data.role === "player" && token.ownerId === socket.data.playerId);
    if (!allowed) return ack({ ok: false, error: "You can't move that token." });
    token.x = clamp(Math.round(x), 0, room.state.map.width - 1);
    token.y = clamp(Math.round(y), 0, room.state.map.height - 1);
    ack({ ok: true });
    broadcast(room);
  });

  socket.on("gmAddToken", ({ name, side, x, y }, ack) => {
    const room = gmRoom();
    if (!room) return ack({ ok: false, error: "GM only." });
    const token = makeToken(name.trim().slice(0, 24) || "Enemy", side, x, y, side === "enemy" ? "#d9534f" : "#4fb3bf");
    room.state.tokens[token.id] = token;
    log(room, `GM added ${token.name}.`);
    ack({ ok: true });
    broadcast(room);
  });

  socket.on("gmRemoveToken", ({ tokenId }, ack) => {
    const room = gmRoom();
    const token = room?.state.tokens[tokenId];
    if (!room || !token) return ack({ ok: false, error: "GM only." });
    delete room.state.tokens[tokenId];
    log(room, `GM removed ${token.name}.`);
    ack({ ok: true });
    broadcast(room);
  });

  socket.on("gmSetResources", ({ tokenId, patch }, ack) => {
    const room = gmRoom();
    const token = room?.state.tokens[tokenId];
    if (!room || !token) return ack({ ok: false, error: "GM only." });
    for (const [key, value] of Object.entries(patch)) {
      if (key in token.resources && typeof value === "number" && Number.isFinite(value)) {
        token.resources[key as keyof Resources] = Math.round(value);
      }
    }
    log(room, `GM override: ${token.name} ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    ack({ ok: true });
    broadcast(room);
  });

  socket.on("gmSetNotes", ({ tokenId, notes }, ack) => {
    const room = gmRoom();
    const token = room?.state.tokens[tokenId];
    if (!room || !token) return ack({ ok: false, error: "GM only." });
    token.gmNotes = notes.slice(0, 2000);
    ack({ ok: true });
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = roomOf();
    if (room && socket.data.role === "player" && socket.data.playerId) {
      const player = room.state.players[socket.data.playerId];
      if (player) player.connected = false;
      broadcast(room);
    }
  });
});

http.listen(PORT, "0.0.0.0", () => {
  console.log(`SoLP server listening on port ${PORT}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) console.log(`  LAN: http://${a.address}:${PORT}`);
    }
  }
});
