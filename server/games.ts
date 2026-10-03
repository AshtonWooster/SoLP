import { randomInt, randomUUID } from "node:crypto";
import { Router } from "express";
import type { GameDetail, GameRole, GameSummary } from "../shared/types.ts";
import { requireUser } from "./auth.ts";
import { db } from "./db.ts";

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1, easy to read aloud

function newInviteCode(): string {
  return Array.from({ length: 6 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
}

/** The caller's role in a game, or null if they aren't a member. */
export async function roleIn(gameId: string, userId: string): Promise<GameRole | null> {
  const rows = await db.query<{ role: GameRole }>(
    `SELECT role FROM game_members WHERE game_id = $1 AND user_id = $2`,
    [gameId, userId],
  );
  return rows[0]?.role ?? null;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export const gamesRouter = Router();
gamesRouter.use(requireUser);

gamesRouter.get("/", async (req, res) => {
  const games = await db.query<GameSummary>(
    `SELECT g.id, g.name, m.role, owner.display_name AS "gmName",
            (SELECT count(*)::int FROM game_members WHERE game_id = g.id AND role = 'player') AS "playerCount"
       FROM game_members m
       JOIN games g ON g.id = m.game_id
       JOIN users owner ON owner.id = g.owner_id
      WHERE m.user_id = $1
      ORDER BY m.joined_at DESC`,
    [req.user!.id],
  );
  res.json({ games });
});

gamesRouter.post("/", async (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Give your game a name." });
  const id = randomUUID();
  // Retry on the (very unlikely) chance of an invite code collision.
  for (let attempt = 0; ; attempt++) {
    try {
      await db.query(`INSERT INTO games (id, name, invite_code, owner_id) VALUES ($1, $2, $3, $4)`, [
        id,
        name,
        newInviteCode(),
        req.user!.id,
      ]);
      break;
    } catch (err: any) {
      if (err?.code !== "23505" || attempt >= 5) throw err;
    }
  }
  await db.query(`INSERT INTO game_members (game_id, user_id, role) VALUES ($1, $2, 'gm')`, [id, req.user!.id]);
  res.json({ id });
});

/** Joining is permanent: the game stays on the player's front page from then on. */
gamesRouter.post("/join", async (req, res) => {
  const code = String(req.body?.code ?? "").trim().toUpperCase();
  const rows = await db.query<{ id: string }>(`SELECT id FROM games WHERE invite_code = $1`, [code]);
  const game = rows[0];
  if (!game) return res.status(404).json({ error: "No game with that invite code." });
  await db.query(
    `INSERT INTO game_members (game_id, user_id, role) VALUES ($1, $2, 'player')
     ON CONFLICT (game_id, user_id) DO NOTHING`,
    [game.id, req.user!.id],
  );
  res.json({ id: game.id });
});

gamesRouter.get("/:id", async (req, res) => {
  const id = req.params.id;
  const role = UUID_RE.test(id) ? await roleIn(id, req.user!.id) : null;
  if (!role) return res.status(404).json({ error: "Game not found." });
  const [game] = await db.query<{ id: string; name: string; invite_code: string }>(
    `SELECT id, name, invite_code FROM games WHERE id = $1`,
    [id],
  );
  const members = await db.query<GameDetail["members"][number]>(
    `SELECT u.id, u.display_name AS "displayName", m.role
       FROM game_members m JOIN users u ON u.id = m.user_id
      WHERE m.game_id = $1
      ORDER BY m.role DESC, m.joined_at`,
    [id],
  );
  const detail: GameDetail = {
    id: game.id,
    name: game.name,
    role,
    // Only the GM sees the invite code; they decide who joins.
    inviteCode: role === "gm" ? game.invite_code : undefined,
    members,
  };
  res.json({ game: detail });
});
