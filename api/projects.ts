import Database from "better-sqlite3";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ensureAuthTokenSchema } from "./auth-tokens";

type HeaderValue = string | string[] | undefined;
type ApiRequest = { method?: string; url?: string; headers: Record<string, HeaderValue>; body?: unknown };
type ApiResponse = { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string | Buffer) => void };

type ProjectRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  presentation?: boolean;
  nodeCount: number;
  compression: { codec: "deflate"; data: string; originalSize: number };
  workspaceId?: string | null;
};

const FREE_PROJECT_LIMIT = 25;
const databasePath = resolve(process.cwd(), process.env.ARCHBOARD_SQLITE_PATH ?? "./data/archboard.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = DELETE");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    presentation INTEGER NOT NULL DEFAULT 0,
    node_count INTEGER NOT NULL,
    compression_codec TEXT NOT NULL,
    compression_data TEXT NOT NULL,
    compression_original_size INTEGER NOT NULL,
    workspace_id TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);
`);
ensureAuthTokenSchema(db);

let jwksCache: { clientId: string; hostname: string; issuer: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;

function loadLocalEnvFallback() {
  if (process.env.WORKOS_CLIENT_ID || process.env.VITE_WORKOS_CLIENT_ID) return;
  try {
    const envPath = resolve(process.cwd(), ".env");
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* Environment variables may be supplied by the hosting platform. */ }
}

function workosConfig() {
  loadLocalEnvFallback();
  const clientId = process.env.WORKOS_CLIENT_ID ?? process.env.VITE_WORKOS_CLIENT_ID ?? "";
  const hostname = process.env.WORKOS_API_HOSTNAME ?? "api.workos.com";
  return { clientId, hostname };
}

async function workosJwks() {
  const { clientId, hostname } = workosConfig();
  if (!clientId) return null;
  if (!jwksCache || jwksCache.clientId !== clientId || jwksCache.hostname !== hostname) {
    let issuer = `https://${hostname}/`;
    let jwksUrl = `https://${hostname}/sso/jwks/${clientId}`;
    try {
      const discovery = await fetch(`https://${hostname}/user_management/${clientId}/.well-known/openid-configuration`);
      if (discovery.ok) {
        const metadata = await discovery.json() as { issuer?: string; jwks_uri?: string };
        if (metadata.issuer) issuer = metadata.issuer;
        if (metadata.jwks_uri) jwksUrl = metadata.jwks_uri;
      }
    } catch { /* Fallback to the environment API origin and legacy JWKS URL. */ }
    jwksCache = { clientId, hostname, issuer, jwks: createRemoteJWKSet(new URL(jwksUrl)) };
  }
  return { clientId, hostname, issuer: jwksCache.issuer, jwks: jwksCache.jwks };
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

async function readBody(req: ApiRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object") return Buffer.from(JSON.stringify(req.body));
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function authenticate(req: ApiRequest) {
  const config = await workosJwks();
  if (!config) throw Object.assign(new Error("WorkOS client is not configured."), { status: 500 });
  const match = (header(req, "authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Authentication required."), { status: 401 });
  const verified = await jwtVerify(match[1], config.jwks, { issuer: config.issuer });
  const tokenClientId = typeof verified.payload.client_id === "string" ? verified.payload.client_id : "";
  if (tokenClientId && tokenClientId !== config.clientId) {
    throw Object.assign(new Error("Access token was issued for a different WorkOS application."), { status: 401 });
  }
  const userId = typeof verified.payload.sub === "string" ? verified.payload.sub : "";
  if (!userId) throw Object.assign(new Error("Access token has no subject."), { status: 401 });
  const email = typeof verified.payload.email === "string" ? verified.payload.email : null;
  const now = Date.now();
  db.prepare(`INSERT INTO users(id, email, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=COALESCE(excluded.email, users.email), updated_at=excluded.updated_at`).run(userId, email, now, now);
  return { userId, email };
}

function rowToProject(row: any): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    presentation: row.presentation === 1,
    nodeCount: row.node_count,
    compression: { codec: "deflate", data: row.compression_data, originalSize: row.compression_original_size },
    workspaceId: row.workspace_id ?? null,
  };
}

function listProjects(userId: string) {
  const rows = db.prepare(`SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC`).all(userId);
  return rows.map(rowToProject);
}

function validateProject(value: unknown): ProjectRecord {
  if (!value || typeof value !== "object") throw new Error("Project body is required.");
  const source = value as Record<string, unknown>;
  const compression = source.compression as Record<string, unknown> | undefined;
  if (typeof source.id !== "string" || !source.id || typeof source.name !== "string" || typeof source.createdAt !== "number" || typeof source.updatedAt !== "number") throw new Error("Invalid project metadata.");
  if (typeof source.nodeCount !== "number" || !compression || compression.codec !== "deflate" || typeof compression.data !== "string" || typeof compression.originalSize !== "number") throw new Error("Project compression data is invalid.");
  if (Buffer.byteLength(compression.data, "utf8") > 5 * 1024 * 1024) throw new Error("Compressed project exceeds 5 MB.");
  return {
    id: source.id,
    name: source.name.slice(0, 160),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    presentation: typeof source.presentation === "boolean" ? source.presentation : false,
    nodeCount: source.nodeCount,
    compression: { codec: "deflate", data: compression.data, originalSize: compression.originalSize },
    workspaceId: typeof source.workspaceId === "string" ? source.workspaceId : null,
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }

  let auth: { userId: string; email: string | null };
  try { auth = await authenticate(req); }
  catch (error) { const status = (error as { status?: number }).status ?? 401; return sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : "Authentication failed." }); }

  try {
    const pathname = (req.url ?? "").split("?")[0];
    const profileMatch = pathname.match(/^\/([a-f0-9]{32})\/profile\/?$/);
    if (profileMatch && req.method === "GET") {
      const hash = profileMatch[1];
      const crypto = await import("node:crypto");
      const email = auth.email?.trim().toLowerCase() ?? "";
      if (!email || crypto.createHash("md5").update(email).digest("hex") !== hash) {
        return sendJson(res, 403, { ok: false, error: "Profile hash does not belong to the authenticated user." });
      }
      const countRow = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?").get(auth.userId) as { count: number };
      return sendJson(res, 200, {
        ok: true,
        profile: {
          id: auth.userId,
          name: email.split("@")[0],
          email,
          projectCount: countRow.count,
          projectLimit: FREE_PROJECT_LIMIT,
          profileUrl: `/${hash}`,
          profileApiUrl: `/${hash}/profile`,
        },
      });
    }
    if (req.method === "GET") {
      const countRow = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?").get(auth.userId) as { count: number };
      return sendJson(res, 200, { ok: true, limit: FREE_PROJECT_LIMIT, count: countRow.count, projects: listProjects(auth.userId) });
    }

    if (req.method === "POST") {
      const raw = await readBody(req);
      if (raw.length > 6 * 1024 * 1024) return sendJson(res, 413, { ok: false, error: "Project payload is too large." });
      const project = validateProject(JSON.parse(raw.toString("utf8")));
      const countRow = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?").get(auth.userId) as { count: number };
      const count = countRow.count;
      const existing = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(project.id, auth.userId);
      if (!existing && count >= FREE_PROJECT_LIMIT) return sendJson(res, 403, { ok: false, error: `Free accounts are limited to ${FREE_PROJECT_LIMIT} projects.`, limit: FREE_PROJECT_LIMIT, count });
      db.prepare(`INSERT INTO projects(id,user_id,name,created_at,updated_at,presentation,node_count,compression_codec,compression_data,compression_original_size,workspace_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at,presentation=excluded.presentation,node_count=excluded.node_count,
        compression_codec=excluded.compression_codec,compression_data=excluded.compression_data,compression_original_size=excluded.compression_original_size,workspace_id=excluded.workspace_id`).run(project.id, auth.userId, project.name, project.createdAt, project.updatedAt, project.presentation ? 1 : 0, project.nodeCount, project.compression.codec, project.compression.data, project.compression.originalSize, project.workspaceId);
      return sendJson(res, 200, { ok: true, project });
    }

    if (req.method === "DELETE") {
      const raw = await readBody(req);
      const value = raw.length ? JSON.parse(raw.toString("utf8")) as { ids?: unknown } : {};
      const ids = Array.isArray(value.ids) ? value.ids.filter((id): id is string => typeof id === "string") : [];
      if (!ids.length) return sendJson(res, 400, { ok: false, error: "Project ids are required." });
      const remove = db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?");
      const transaction = db.transaction((items: string[]) => { for (const id of items) remove.run(id, auth.userId); });
      transaction(ids);
      return sendJson(res, 200, { ok: true, deleted: ids.length });
    }

    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    return sendJson(res, error instanceof SyntaxError ? 400 : 500, { ok: false, error: error instanceof Error ? error.message : "Project storage failed." });
  }
}
