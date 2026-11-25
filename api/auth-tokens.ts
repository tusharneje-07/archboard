import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

type TokenDatabase = Pick<Database.Database, "exec" | "prepare">;

export function ensureAuthTokenSchema(db: TokenDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_auth_tokens (
      user_id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_auth_tokens_token ON user_auth_tokens(token);
  `);
}

export function getOrCreateAuthToken(db: TokenDatabase, userId: string, email: string) {
  const existing = db.prepare("SELECT token FROM user_auth_tokens WHERE user_id = ?").get(userId) as { token?: unknown } | undefined;
  if (typeof existing?.token === "string" && existing.token) return existing.token;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const timestamp = Date.now() + attempt;
    const digest = createHash("md5").update(`${email}${timestamp}`).digest("hex");
    const token = `sk_${digest}`;
    try {
      db.prepare("INSERT OR IGNORE INTO user_auth_tokens(user_id, token, created_at) VALUES (?, ?, ?)").run(userId, token, timestamp);
      const created = db.prepare("SELECT token FROM user_auth_tokens WHERE user_id = ?").get(userId) as { token?: unknown } | undefined;
      if (typeof created?.token === "string" && created.token) return created.token;
    } catch {
      // Retry with the next timestamp if a practically impossible token collision occurs.
    }
  }
  throw new Error("Could not create an authentication token.");
}

export function isValidAuthToken(db: TokenDatabase, token: string) {
  const row = db.prepare("SELECT 1 AS valid FROM user_auth_tokens WHERE token = ? LIMIT 1").get(token.trim()) as { valid?: number } | undefined;
  return row?.valid === 1;
}
