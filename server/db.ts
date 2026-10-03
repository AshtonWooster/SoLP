import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Postgres access. In production DATABASE_URL points at a real Postgres
 * (e.g. Railway). Without it, an embedded Postgres (PGlite) stores data in
 * ./data so local development needs no setup. Both speak the same SQL.
 */
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export let db: Db;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY,
     email text NOT NULL UNIQUE,
     display_name text NOT NULL,
     password_hash text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS games (
     id uuid PRIMARY KEY,
     name text NOT NULL,
     invite_code text NOT NULL UNIQUE,
     owner_id uuid NOT NULL REFERENCES users(id),
     state jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS game_members (
     game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role text NOT NULL CHECK (role IN ('gm', 'player')),
     joined_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (game_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS game_members_user ON game_members(user_id)`,
];

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: url,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
    db = { query: async (sql, params) => (await pool.query(sql, params)).rows };
    console.log("Database: Postgres (DATABASE_URL)");
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = path.resolve(process.env.DATA_DIR ?? "data", "pglite");
    mkdirSync(dir, { recursive: true });
    const lite = await PGlite.create(dir);
    db = { query: async (sql, params) => (await lite.query<any>(sql, params)).rows };
    console.log(`Database: embedded PGlite at ${dir}`);
  }
  for (const sql of MIGRATIONS) await db.query(sql);
}
