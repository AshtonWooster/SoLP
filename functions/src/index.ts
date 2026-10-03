import { randomInt, randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import type {
  GameDoc,
  GameRole,
  GmMeta,
  Resources,
  Side,
  TableAction,
  TableState,
  Token,
  UserDoc,
} from "../../shared/types.ts";

initializeApp();
const db = getFirestore();

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1, easy to read aloud
const PLAYER_COLORS = ["#4fb3bf", "#e0b04f", "#9b7ede", "#6cc070", "#e07a9b", "#5c8fe0"];

function requireUid(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please log in.");
  return req.auth.uid;
}

async function displayNameOf(req: CallableRequest): Promise<string> {
  const snap = await db.doc(`users/${req.auth!.uid}`).get();
  const doc = snap.data() as UserDoc | undefined;
  return doc?.displayName || req.auth!.token.name || req.auth!.token.email || "Player";
}

function newInviteCode(): string {
  return Array.from({ length: 6 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
}

function defaultResources(): Resources {
  // Placeholder values until rank/stat tables are filled in the rules.
  return { hp: 30, maxHp: 30, stagger: 20, maxStagger: 20, light: 3, maxLight: 3, sanity: 0, maxSanity: 15 };
}

function makeToken(name: string, side: Side, x: number, y: number, color: string): Token {
  return { id: randomUUID(), name, side, x, y, color, resources: defaultResources() };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
}

function newTable(): TableState {
  const enemy = makeToken("Sweeper", "enemy", 12, 4, "#d9534f");
  return {
    map: { name: "Training Floor", width: 16, height: 10 },
    tokens: { [enemy.id]: enemy },
    log: ["Table created."],
  };
}

export const createGame = onCall(async (req) => {
  const uid = requireUid(req);
  const name = String(req.data?.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpsError("invalid-argument", "Give your game a name.");
  const displayName = await displayNameOf(req);
  const gameRef = db.collection("games").doc();

  await db.runTransaction(async (tx) => {
    // Pick an unused invite code.
    let code = newInviteCode();
    for (let i = 0; (await tx.get(db.doc(`inviteCodes/${code}`))).exists; i++) {
      if (i > 5) throw new HttpsError("internal", "Couldn't create an invite code. Try again.");
      code = newInviteCode();
    }
    const game: GameDoc = {
      name,
      gmId: uid,
      memberIds: [uid],
      members: { [uid]: { displayName, role: "gm" } },
      createdAt: Date.now(),
    };
    tx.set(gameRef, game);
    tx.set(gameRef.collection("gm").doc("meta"), { inviteCode: code } satisfies GmMeta);
    tx.set(gameRef.collection("gm").doc("notes"), { tokens: {} });
    tx.set(gameRef.collection("table").doc("state"), newTable());
    tx.set(db.doc(`inviteCodes/${code}`), { gameId: gameRef.id });
  });
  return { id: gameRef.id };
});

/** Joining is permanent: the game stays on the player's front page from then on. */
export const joinGame = onCall(async (req) => {
  const uid = requireUid(req);
  const code = String(req.data?.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new HttpsError("not-found", "No game with that invite code.");
  const invite = await db.doc(`inviteCodes/${code}`).get();
  const gameId = invite.data()?.gameId as string | undefined;
  if (!gameId) throw new HttpsError("not-found", "No game with that invite code.");
  const displayName = await displayNameOf(req);

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`games/${gameId}`);
    const game = (await tx.get(ref)).data() as GameDoc | undefined;
    if (!game) throw new HttpsError("not-found", "No game with that invite code.");
    if (game.memberIds.includes(uid)) return; // already in (GM or player)
    tx.update(ref, {
      memberIds: [...game.memberIds, uid],
      [`members.${uid}`]: { displayName, role: "player" satisfies GameRole },
    });
  });
  return { id: gameId };
});

/** The referee: every change to a table is checked and applied here, never by clients directly. */
export const tableAction = onCall(async (req) => {
  const uid = requireUid(req);
  const gameId = String(req.data?.gameId ?? "");
  const action = req.data?.action as TableAction | undefined;
  if (!/^[A-Za-z0-9]{1,40}$/.test(gameId) || !action || typeof action !== "object") {
    throw new HttpsError("invalid-argument", "Bad request.");
  }

  await db.runTransaction(async (tx: Transaction) => {
    const gameRef = db.doc(`games/${gameId}`);
    const tableRef = gameRef.collection("table").doc("state");
    const [gameSnap, tableSnap] = await Promise.all([tx.get(gameRef), tx.get(tableRef)]);
    const game = gameSnap.data() as GameDoc | undefined;
    const role = game?.members[uid]?.role;
    if (!game || !role) throw new HttpsError("permission-denied", "You're not in this game.");
    const table = (tableSnap.data() as TableState | undefined) ?? newTable();
    const isGm = role === "gm";
    const gmOnly = () => {
      if (!isGm) throw new HttpsError("permission-denied", "GM only.");
    };
    const tokenOf = (id: unknown) => {
      const t = table.tokens[String(id)];
      if (!t) throw new HttpsError("not-found", "Token not found.");
      return t;
    };
    const log = (line: string) => {
      table.log.push(line);
      if (table.log.length > 100) table.log.splice(0, table.log.length - 100);
    };
    const { width, height } = table.map;

    switch (action.type) {
      case "takeSeat": {
        if (isGm) throw new HttpsError("permission-denied", "You're the GM of this game. Use the GM screen.");
        if (Object.values(table.tokens).some((t) => t.ownerId === uid)) return; // nothing to change
        const n = Object.values(table.tokens).filter((t) => t.side === "player").length;
        const name = game.members[uid].displayName;
        const token = makeToken(name, "player", 2, clamp(2 + n, 0, height - 1), PLAYER_COLORS[n % PLAYER_COLORS.length]);
        token.ownerId = uid;
        table.tokens[token.id] = token;
        log(`${name} took a seat.`);
        break;
      }
      case "move": {
        const token = tokenOf(action.tokenId);
        if (!isGm && token.ownerId !== uid) throw new HttpsError("permission-denied", "You can't move that token.");
        token.x = clamp(action.x, 0, width - 1);
        token.y = clamp(action.y, 0, height - 1);
        break;
      }
      case "step": {
        const token = tokenOf(action.tokenId);
        if (!isGm && token.ownerId !== uid) throw new HttpsError("permission-denied", "You can't move that token.");
        token.x = clamp(token.x + clamp(action.dx, -1, 1), 0, width - 1);
        token.y = clamp(token.y + clamp(action.dy, -1, 1), 0, height - 1);
        break;
      }
      case "addToken": {
        gmOnly();
        const side: Side = action.side === "player" ? "player" : "enemy";
        const name = String(action.name ?? "").trim().slice(0, 24) || "Enemy";
        const token = makeToken(name, side, clamp(action.x, 0, width - 1), clamp(action.y, 0, height - 1), side === "enemy" ? "#d9534f" : "#4fb3bf");
        table.tokens[token.id] = token;
        log(`GM added ${token.name}.`);
        break;
      }
      case "removeToken": {
        gmOnly();
        const token = tokenOf(action.tokenId);
        delete table.tokens[token.id];
        log(`GM removed ${token.name}.`);
        break;
      }
      case "setResources": {
        gmOnly();
        const token = tokenOf(action.tokenId);
        const applied: string[] = [];
        for (const [key, value] of Object.entries(action.patch ?? {})) {
          if (key in token.resources && typeof value === "number" && Number.isFinite(value)) {
            token.resources[key as keyof Resources] = Math.round(value);
            applied.push(`${key}=${Math.round(value)}`);
          }
        }
        if (applied.length) log(`GM override: ${token.name} ${applied.join(", ")}`);
        break;
      }
      default:
        throw new HttpsError("invalid-argument", "Unknown action.");
    }
    tx.set(tableRef, table);
  });
  return { ok: true };
});
