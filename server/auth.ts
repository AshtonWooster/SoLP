import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { User } from "../shared/types.ts";
import { db } from "./db.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = "solp_session";
const SESSION_DAYS = 30;

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(key, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Looks up the logged-in user from a raw Cookie header. Used by both HTTP and live connections. */
export async function userFromCookieHeader(header: string | undefined): Promise<User | null> {
  const token = parseCookies(header)[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db.query<User>(
    `SELECT u.id, u.email, u.display_name AS "displayName"
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    req.user = (await userFromCookieHeader(req.headers.cookie)) ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Please log in." });
  next();
}

async function startSession(res: Response, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [
    sha256(token),
    userId,
    expires,
  ]);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    path: "/",
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const displayName = String(req.body?.displayName ?? "").trim().slice(0, 32);
  const password = String(req.body?.password ?? "");
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!displayName) return res.status(400).json({ error: "Enter a display name." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const existing = await db.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
  if (existing.length) return res.status(409).json({ error: "An account with that email already exists." });

  const id = randomUUID();
  try {
    await db.query(`INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)`, [
      id,
      email,
      displayName,
      await hashPassword(password),
    ]);
  } catch (err: any) {
    // Two signups with the same email at once: the unique index catches the second.
    if (err?.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    throw err;
  }
  await startSession(res, id);
  res.json({ user: { id, email, displayName } satisfies User });
});

authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const rows = await db.query<{ id: string; display_name: string; password_hash: string }>(
    `SELECT id, display_name, password_hash FROM users WHERE email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return res.status(401).json({ error: "Wrong email or password." });
  }
  await startSession(res, row.id);
  res.json({ user: { id: row.id, email, displayName: row.display_name } satisfies User });
});

authRouter.post("/logout", async (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});
