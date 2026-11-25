import Database from "better-sqlite3";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type HeaderValue = string | string[] | undefined;
type ApiRequest = { method?: string; url?: string; headers: Record<string, HeaderValue>; body?: unknown };
type ApiResponse = { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string | Buffer) => void };
type ShareFormat = "png" | "svg";
const databasePath = resolve(process.cwd(), process.env.ARCHBOARD_SQLITE_PATH ?? "./data/archboard.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = DELETE");
db.pragma("foreign_keys = ON");
db.exec(`CREATE TABLE IF NOT EXISTS project_shares (
  project_id TEXT NOT NULL, user_id TEXT NOT NULL, profile_hash TEXT NOT NULL, format TEXT NOT NULL,
  artifact TEXT NOT NULL, revision TEXT NOT NULL, source_updated_at INTEGER NOT NULL,
  published_at INTEGER NOT NULL, PRIMARY KEY(project_id, user_id, format),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
); CREATE INDEX IF NOT EXISTS idx_project_shares_public ON project_shares(profile_hash, format);`);

function header(req: ApiRequest, name: string) { const value = req.headers[name.toLowerCase()]; return Array.isArray(value) ? value[0] : value; }
function json(res: ApiResponse, status: number, payload: unknown) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(payload)); }
async function body(req: ApiRequest) {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
function env() {
  if (!process.env.WORKOS_CLIENT_ID && !process.env.VITE_WORKOS_CLIENT_ID) {
    try { for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ""); } } catch { /* hosting env */ }
  }
  return { clientId: process.env.WORKOS_CLIENT_ID ?? process.env.VITE_WORKOS_CLIENT_ID ?? "", hostname: process.env.WORKOS_API_HOSTNAME ?? "api.workos.com" };
}
let jwks: { id: string; issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | null = null;
async function authenticate(req: ApiRequest) {
  const config = env(); if (!config.clientId) throw Object.assign(new Error("WorkOS client is not configured."), { status: 500 });
  if (!jwks || jwks.id !== config.clientId) {
    let issuer = `https://${config.hostname}/`, url = `https://${config.hostname}/sso/jwks/${config.clientId}`;
    try { const response = await fetch(`https://${config.hostname}/user_management/${config.clientId}/.well-known/openid-configuration`); if (response.ok) { const metadata = await response.json() as { issuer?: string; jwks_uri?: string }; issuer = metadata.issuer ?? issuer; url = metadata.jwks_uri ?? url; } } catch { /* fallback */ }
    jwks = { id: config.clientId, issuer, keys: createRemoteJWKSet(new URL(url)) };
  }
  const token = (header(req, "authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw Object.assign(new Error("Authentication required."), { status: 401 });
  const verified = await jwtVerify(token, jwks.keys, { issuer: jwks.issuer });
  const tokenClientId = typeof verified.payload.client_id === "string" ? verified.payload.client_id : "";
  if (tokenClientId && tokenClientId !== config.clientId) {
    throw Object.assign(new Error("Access token was issued for a different WorkOS application."), { status: 401 });
  }
  const userId = typeof verified.payload.sub === "string" ? verified.payload.sub : "";
  if (!userId) throw Object.assign(new Error("Access token has no subject."), { status: 401 });
  const email = typeof verified.payload.email === "string" ? verified.payload.email.trim().toLowerCase() : "";
  const now = Date.now();
  db.prepare("INSERT INTO users(id,email,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at").run(userId, email, now, now);
  return { userId, email, profileHash: createHash("md5").update(email).digest("hex") };
}
function normalizeSvgArtifact(value: string) {
  let svg = value;
  const dataUri = value.match(/^data:([^,]*),([\s\S]*)$/i);
  if (dataUri) {
    const metadata = dataUri[1].split(";").map((part) => part.trim().toLowerCase());
    if (metadata[0] !== "image/svg+xml") throw new Error("Invalid SVG artifact.");
    const payload = dataUri[2];
    if (metadata.includes("base64")) {
      const encodedPayload = decodeURIComponent(payload);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encodedPayload) || encodedPayload.length % 4 === 1) throw new Error("Invalid SVG artifact.");
      svg = Buffer.from(encodedPayload, "base64").toString("utf8");
    } else {
      svg = decodeURIComponent(payload);
    }
  } else {
    // Legacy rows sometimes contain a URI-encoded SVG without its data URI.
    // Only attempt this once, and only when the value does not already expose
    // an SVG root.
    const withoutBom = value.replace(/^\uFEFF/, "");
    if (!/<svg(?:\s|>)/i.test(withoutBom) && /%[0-9a-f]{2}/i.test(value)) {
      try { svg = decodeURIComponent(value); } catch { /* validate the original below */ }
    }
  }

  const withoutBom = svg.replace(/^\uFEFF/, "");
  const svgRoot = withoutBom.search(/<svg(?:\s|>)/i);
  if (svgRoot < 0) throw new Error("Invalid SVG artifact.");
  const xmlDeclaration = withoutBom.search(/<\?xml\b/i);
  const start = xmlDeclaration >= 0 && xmlDeclaration < svgRoot ? xmlDeclaration : svgRoot;
  const normalized = withoutBom.slice(start);
  if (!/^<(?:(?:\?xml)\b|svg(?:\s|>))/i.test(normalized) || !/<svg(?:\s|>)/i.test(normalized)) {
    throw new Error("Invalid SVG artifact.");
  }
  if (Buffer.byteLength(normalized, "utf8") > 10 * 1024 * 1024) throw new Error("Shared artifact exceeds 10 MB.");
  return normalized;
}
function parseArtifact(format: ShareFormat, data: string) {
  if (format === "png") {
    const match = data.match(/^data:([^,]*),([\s\S]*)$/i);
    if (!match) throw new Error("Invalid PNG artifact.");
    const metadata = match[1].toLowerCase();
    const payload = match[2];
    if (metadata !== "image/png;base64" || !/^[A-Za-z0-9+/=]+$/.test(payload)) throw new Error("Invalid PNG artifact.");
    if (Buffer.byteLength(payload, "utf8") > 10 * 1024 * 1024) throw new Error("Shared artifact exceeds 10 MB.");
    return payload;
  }
  const normalized = normalizeSvgArtifact(data);
  return normalized;
}
function publicUrl(hash: string, format: ShareFormat, projectId: string) { return `/${hash}/live/img/${format}/${encodeURIComponent(projectId)}.${format}`; }
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const path = requestUrl.pathname;
  const originalMatch = path.match(/^\/([a-f0-9]{32})\/live\/img\/(svg|png)\/([^/]+)\.(svg|png)\/?$/);
  const rewrittenHash = requestUrl.searchParams.get("profileHash");
  const rewrittenFormat = requestUrl.searchParams.get("format");
  const rewrittenFilename = requestUrl.searchParams.get("filename");
  const rewrittenMatch = rewrittenHash && (rewrittenFormat === "png" || rewrittenFormat === "svg") && rewrittenFilename
    ? rewrittenFilename.match(/^(.+)\.(svg|png)$/)
    : null;
  const rewrittenPublicMatch = rewrittenHash && rewrittenFormat && rewrittenFilename && rewrittenMatch &&
    (rewrittenFormat === "png" || rewrittenFormat === "svg") &&
    rewrittenFormat === rewrittenMatch[2] &&
    /^[a-f0-9]{32}$/.test(rewrittenHash)
    ? { hash: rewrittenHash, format: rewrittenFormat, filename: rewrittenMatch[1], extension: rewrittenMatch[2] }
    : null;
  const publicMatch = originalMatch
    ? { hash: originalMatch[1], format: originalMatch[2], filename: originalMatch[3], extension: originalMatch[4] }
    : rewrittenPublicMatch;
  if (publicMatch && req.method === "GET") {
    try {
      const projectId = decodeURIComponent(publicMatch.filename);
      const row = db.prepare("SELECT artifact, format FROM project_shares WHERE profile_hash=? AND project_id=? AND format=?").get(publicMatch.hash, projectId, publicMatch.format) as { artifact: string; format: ShareFormat } | undefined;
      if (!row) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("Shared image not found."); return; }
      const data = row.format === "png" ? Buffer.from(row.artifact, "base64") : Buffer.from(normalizeSvgArtifact(row.artifact), "utf8");
      res.statusCode = 200; res.setHeader("Content-Type", row.format === "png" ? "image/png" : "image/svg+xml; charset=utf-8"); res.setHeader("Cache-Control", "public, max-age=60, must-revalidate"); res.end(data); return;
    } catch {
      res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("Shared image not found."); return;
    }
  }
  try {
    const auth = await authenticate(req);
    if (req.method === "GET") {
      const projectId = new URL(req.url ?? "", "http://localhost").searchParams.get("projectId") ?? "";
      const rows = db.prepare("SELECT format,revision,published_at FROM project_shares WHERE project_id=? AND user_id=?").all(projectId, auth.userId) as Array<{ format: ShareFormat; revision: string; published_at: number }>;
      return json(res, 200, { ok: true, shares: rows.map((row) => ({ format: row.format, revision: row.revision, publishedAt: row.published_at, url: publicUrl(auth.profileHash, row.format, projectId) })) });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed." });
    const value = JSON.parse(await body(req)) as Record<string, unknown>;
    const projectId = typeof value.projectId === "string" ? value.projectId : "", format = value.format === "png" || value.format === "svg" ? value.format : null;
    if (!projectId || !format || typeof value.data !== "string" || typeof value.revision !== "string" || typeof value.sourceUpdatedAt !== "number") return json(res, 400, { ok: false, error: "Invalid share payload." });
    const owned = db.prepare("SELECT id FROM projects WHERE id=? AND user_id=?").get(projectId, auth.userId);
    if (!owned) return json(res, 404, { ok: false, error: "Project not found." });
    const artifact = parseArtifact(format, value.data), now = Date.now();
    db.prepare(`INSERT INTO project_shares(project_id,user_id,profile_hash,format,artifact,revision,source_updated_at,published_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,user_id,format) DO UPDATE SET profile_hash=excluded.profile_hash,artifact=excluded.artifact,revision=excluded.revision,source_updated_at=excluded.source_updated_at,published_at=excluded.published_at`)
      .run(projectId, auth.userId, auth.profileHash, format, artifact, value.revision, value.sourceUpdatedAt, now);
    return json(res, 200, { ok: true, share: { format, revision: value.revision, publishedAt: now, url: publicUrl(auth.profileHash, format, projectId) } });
  } catch (error) { return json(res, (error as { status?: number }).status ?? 400, { ok: false, error: error instanceof Error ? error.message : "Share request failed." }); }
}
