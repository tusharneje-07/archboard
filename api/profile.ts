import Database from "better-sqlite3";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ensureAuthTokenSchema, getOrCreateAuthToken } from "./auth-tokens";

type HeaderValue = string | string[] | undefined;
type ApiRequest = { method?: string; url?: string; headers: Record<string, HeaderValue>; };
type ApiResponse = { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string | Buffer) => void };

const FREE_PROJECT_LIMIT = 25;
const databasePath = resolve(process.cwd(), process.env.ARCHBOARD_SQLITE_PATH ?? "./data/archboard.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, presentation INTEGER NOT NULL DEFAULT 0, node_count INTEGER NOT NULL, compression_codec TEXT NOT NULL, compression_data TEXT NOT NULL, compression_original_size INTEGER NOT NULL, workspace_id TEXT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);`);
ensureAuthTokenSchema(db);

function loadEnv() {
  if (process.env.WORKOS_CLIENT_ID || process.env.VITE_WORKOS_CLIENT_ID) return;
  try {
    for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* Hosting platforms provide environment variables directly. */ }
}

function header(req: ApiRequest, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res: ApiResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed." });

  loadEnv();
  const clientId = process.env.WORKOS_CLIENT_ID ?? process.env.VITE_WORKOS_CLIENT_ID ?? "";
  const hostname = process.env.WORKOS_API_HOSTNAME ?? "api.workos.com";
  if (!clientId) return sendJson(res, 500, { ok: false, error: "WorkOS client is not configured." });
  const match = (header(req, "authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) return sendJson(res, 401, { ok: false, error: "Authentication required." });

  try {
    let issuer = `https://${hostname}/`;
    let jwksUrl = `https://${hostname}/sso/jwks/${clientId}`;
    try {
      const discovery = await fetch(`https://${hostname}/user_management/${clientId}/.well-known/openid-configuration`);
      if (discovery.ok) {
        const metadata = await discovery.json() as { issuer?: string; jwks_uri?: string };
        if (metadata.issuer) issuer = metadata.issuer;
        if (metadata.jwks_uri) jwksUrl = metadata.jwks_uri;
      }
    } catch { /* Fallback issuer/JWKS configuration is used. */ }
    const verified = await jwtVerify(match[1], createRemoteJWKSet(new URL(jwksUrl)), { issuer });
    const userId = typeof verified.payload.sub === "string" ? verified.payload.sub : "";
    const email = typeof verified.payload.email === "string" ? verified.payload.email.trim().toLowerCase() : "";
    if (!userId || !email) return sendJson(res, 401, { ok: false, error: "Authenticated identity is incomplete." });
    const hash = createHash("md5").update(email).digest("hex");
    const pathname = (req.url ?? "").split("?")[0];
    const routeHash = pathname.match(/^\/([a-f0-9]{32})\/profile\/?$/)?.[1];
    if (routeHash !== hash) return sendJson(res, 403, { ok: false, error: "Profile hash does not belong to the authenticated user." });
    db.prepare(`INSERT INTO users(id, email, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, updated_at=excluded.updated_at`).run(userId, email, Date.now(), Date.now());
    const authToken = getOrCreateAuthToken(db, userId, email);
    const countRow = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?").get(userId) as { count: number };
    return sendJson(res, 200, { ok: true, profile: { id: userId, name: email.split("@")[0], email, authToken, projectCount: countRow.count, projectLimit: FREE_PROJECT_LIMIT, profileUrl: `/${hash}`, profileApiUrl: `/${hash}/profile` } });
  } catch (error) {
    return sendJson(res, 401, { ok: false, error: error instanceof Error ? error.message : "Authentication failed." });
  }
}
