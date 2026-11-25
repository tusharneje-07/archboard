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
db.pragma("journal_mode = DELETE");
db.pragma("foreign_keys = ON");
db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, presentation INTEGER NOT NULL DEFAULT 0, node_count INTEGER NOT NULL, compression_codec TEXT NOT NULL, compression_data TEXT NOT NULL, compression_original_size INTEGER NOT NULL, workspace_id TEXT, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);`);
ensureAuthTokenSchema(db);

function loadEnv() {
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

async function resolveEmail(
  userId: string,
  hostname: string,
) {
  const stored = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email?: unknown } | undefined;
  const storedEmail = normalizedEmail(stored?.email);
  if (storedEmail) return storedEmail;

  const apiKey = process.env.WORKOS_API_KEY ?? "";
  if (!apiKey) return "";

  try {
    const response = await fetch(`https://${hostname}/user_management/users/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return "";
    const info = await response.json() as { email?: unknown };
    return normalizedEmail(info.email);
  } catch {
    return "";
  }
}

function normalizedEmail(value: unknown) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function profileHashFor(email: string) {
  return createHash("md5").update(email).digest("hex");
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Archboard-Email");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });

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
    const accessToken = match[1];
    const verified = await jwtVerify(accessToken, createRemoteJWKSet(new URL(jwksUrl)), { issuer });
    const tokenClientId = typeof verified.payload.client_id === "string" ? verified.payload.client_id : "";
    if (tokenClientId && tokenClientId !== clientId) {
      return sendJson(res, 401, { ok: false, error: "Access token was issued for a different WorkOS application." });
    }
    const userId = typeof verified.payload.sub === "string" ? verified.payload.sub : "";
    if (!userId) return sendJson(res, 401, { ok: false, error: "Access token has no subject." });

    const pathname = (req.url ?? "").split("?")[0];
    const requestUrl = new URL(req.url ?? "", "http://localhost");
    const routeHash = requestUrl.searchParams.get("profileHash") ?? pathname.match(/^\/([a-f0-9]{32})\/profile\/?$/)?.[1];
    if (!routeHash || !/^[a-f0-9]{32}$/.test(routeHash)) return sendJson(res, 403, { ok: false, error: "A valid profile hash is required." });

    const existingToken = db.prepare("SELECT token FROM user_auth_tokens WHERE user_id = ?").get(userId) as { token?: unknown } | undefined;
    const authToken = typeof existingToken?.token === "string" && existingToken.token ? existingToken.token : null;

    const storedRow = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email?: unknown } | undefined;
    const storedEmail = normalizedEmail(storedRow?.email);
    const sessionEmail = normalizedEmail(header(req, "x-archboard-email"));
    const sessionEmailMatchesRoute = sessionEmail !== "" && profileHashFor(sessionEmail) === routeHash;
    if (storedEmail && profileHashFor(storedEmail) !== routeHash) {
      return sendJson(res, 403, { ok: false, error: "Profile hash does not belong to the authenticated user." });
    }
    if (sessionEmail && !sessionEmailMatchesRoute) {
      return sendJson(res, 403, { ok: false, error: "Session email does not match the profile hash." });
    }

    if (req.method === "POST") {
      let email = storedEmail;
      if (!email) {
        const workosEmail = await resolveEmail(userId, hostname);
        if (workosEmail && profileHashFor(workosEmail) === routeHash) email = workosEmail;
      }
      if (!email && sessionEmailMatchesRoute) email = sessionEmail;
      if (!email) {
        return sendJson(res, 422, { ok: false, error: "Could not determine a valid email for this profile. Sign in again or provide a matching authenticated session email." });
      }
      db.prepare(`INSERT INTO users(id, email, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, updated_at=excluded.updated_at`).run(userId, email, Date.now(), Date.now());
      const createdToken = getOrCreateAuthToken(db, userId, email);
      return sendJson(res, 200, { ok: true, authToken: createdToken });
    }

    const countRow = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?").get(userId) as { count: number };
    const profileEmail = storedEmail || (sessionEmailMatchesRoute ? sessionEmail : "");
    return sendJson(res, 200, { ok: true, profile: { id: userId, name: profileEmail ? profileEmail.split("@")[0] : "", email: profileEmail, authToken, projectCount: countRow.count, projectLimit: FREE_PROJECT_LIMIT, profileUrl: `/${routeHash}`, profileApiUrl: `/${routeHash}/profile` } });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 401;
    return sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : "Authentication failed." });
  }
}
