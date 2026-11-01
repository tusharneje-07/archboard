import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

type HeaderValue = string | string[] | undefined;
type ApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};
type ApiResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Buffer) => void;
};
type UploadPayload = {
  token: string;
  diagram: unknown;
  fileName: string;
  name: string;
};

const maxUploadBytes = 5 * 1024 * 1024;
const tokenFile = resolve(process.cwd(), "demo_auth_tokens.yaml");
const indexFile = resolve(process.cwd(), "dist/index.html");

function header(req: ApiRequest, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function queryValue(req: ApiRequest, name: string) {
  const fromQuery = req.query?.[name];
  if (Array.isArray(fromQuery)) return fromQuery[0] ?? "";
  if (typeof fromQuery === "string") return fromQuery;
  try {
    return new URL(req.url ?? "/", "https://archboard.local").searchParams.get(name) ?? "";
  } catch {
    return "";
  }
}

function setCors(res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token, Accept, Origin, X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res: ApiResponse, status: number, payload: unknown) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ApiResponse, status: number, html: string) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

async function readBody(req: ApiRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object") return Buffer.from(JSON.stringify(req.body));
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function tokenEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry.trim()].filter(Boolean);
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const token = record.token ?? record.value ?? record.auth_token;
    return typeof token === "string" ? [token.trim()].filter(Boolean) : [];
  });
}

async function readDemoTokens() {
  const source = await readFile(tokenFile, "utf8");
  const parsed = parseYaml(source) as unknown;
  const root = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const list = Array.isArray(root) ? root : root.demo_auth_tokens ?? root.tokens;
  const tokens = tokenEntries(list);
  if (!tokens.length) throw new Error("demo_auth_tokens.yaml does not contain any demo_auth_tokens entries.");
  return new Set(tokens);
}

async function parseUpload(req: ApiRequest, raw: Buffer): Promise<UploadPayload> {
  const contentType = header(req, "content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const request = new Request("https://archboard.local/view-archboard-dig", {
      method: "PUT",
      headers: { "content-type": contentType },
      body: new Uint8Array(raw),
    });
    const form = await request.formData();
    const fileValue = form.get("file") ?? form.get("json") ?? form.get("diagram_file") ?? form.get("json_file");
    let diagramText = "";
    let fileName = "";
    if (typeof fileValue === "string") diagramText = fileValue;
    else if (fileValue && typeof fileValue === "object" && "text" in fileValue) {
      fileName = "name" in fileValue && typeof fileValue.name === "string" ? fileValue.name : "";
      diagramText = await fileValue.text();
    }
    if (!diagramText) {
      const diagramField = form.get("diagram");
      if (typeof diagramField === "string") diagramText = diagramField;
    }
    return {
      token: String(form.get("auth_token") ?? ""),
      diagram: diagramText ? JSON.parse(diagramText) as unknown : undefined,
      fileName,
      name: String(form.get("name") ?? ""),
    };
  }

  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Request body must contain a JSON diagram.");
  const record = parsed as Record<string, unknown>;
  return {
    token: typeof record.auth_token === "string" ? record.auth_token : "",
    diagram: record.diagram ?? (Array.isArray(record.nodes) && Array.isArray(record.edges) ? record : undefined),
    fileName: typeof record.fileName === "string" ? record.fileName : "",
    name: typeof record.name === "string" ? record.name : "",
  };
}

function validateDiagram(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("The uploaded file must contain a JSON diagram object.");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) throw new Error("The diagram must contain nodes and edges arrays.");
  if (record.nodes.length > 10_000 || record.edges.length > 20_000) throw new Error("The diagram is too large.");
  record.nodes.forEach((node, index) => {
    if (!node || typeof node !== "object") throw new Error(`Node ${index + 1} must be an object.`);
    const item = node as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) throw new Error(`Node ${index + 1} is missing an id.`);
    const position = item.position;
    if (!position || typeof position !== "object" || typeof (position as Record<string, unknown>).x !== "number" || typeof (position as Record<string, unknown>).y !== "number") throw new Error(`Node ${index + 1} has an invalid position.`);
  });
  record.edges.forEach((edge, index) => {
    if (!edge || typeof edge !== "object") throw new Error(`Edge ${index + 1} must be an object.`);
    const item = edge as Record<string, unknown>;
    if (typeof item.source !== "string" || typeof item.target !== "string") throw new Error(`Edge ${index + 1} is missing source or target.`);
  });
  return { nodes: record.nodes, edges: record.edges };
}

function displayName(fileName: string, fallback: string) {
  const base = (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.json$/i, "").trim();
  return (base || fallback.trim() || "Uploaded architecture").slice(0, 160);
}

function encodeViewPayload(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function wantsJson(req: ApiRequest) {
  return (header(req, "accept") ?? "").includes("application/json") || queryValue(req, "response") === "json";
}

async function handlePut(req: ApiRequest, res: ApiResponse) {
  const raw = await readBody(req);
  if (raw.length > maxUploadBytes) return sendJson(res, 413, { ok: false, error: "The uploaded file must be 5 MB or smaller." });

  const upload = await parseUpload(req, raw);
  const bearer = (header(req, "authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const token = upload.token || queryValue(req, "auth_token") || header(req, "x-auth-token") || bearer;
  if (!token) return sendJson(res, 401, { ok: false, error: "Missing auth_token." });

  let validTokens: Set<string>;
  try {
    validTokens = await readDemoTokens();
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Could not read demo_auth_tokens.yaml." });
  }
  if (!validTokens.has(token.trim())) return sendJson(res, 401, { ok: false, error: "Invalid auth_token." });

  let diagram: { nodes: unknown[]; edges: unknown[] };
  try {
    diagram = validateDiagram(upload.diagram);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid diagram." });
  }

  const name = displayName(upload.fileName, upload.name);
  const viewUrl = `/view-archboard-dig#data=${encodeViewPayload({ name, ...diagram })}`;
  if (wantsJson(req)) return sendJson(res, 200, { ok: true, name, nodes: diagram.nodes.length, edges: diagram.edges.length, viewUrl });
  setCors(res);
  res.statusCode = 303;
  res.setHeader("Location", viewUrl);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

async function handleGet(res: ApiResponse) {
  try {
    const html = await readFile(indexFile, "utf8");
    sendHtml(res, 200, html);
  } catch {
    sendHtml(res, 500, "<!doctype html><html><body><h1>Archboard view is unavailable</h1><p>The presentation bundle could not be loaded.</p></body></html>");
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      await handleGet(res);
      return;
    }
    if (req.method === "PUT") {
      await handlePut(req, res);
      return;
    }
    res.setHeader("Allow", "GET, PUT, OPTIONS");
    sendJson(res, 405, { ok: false, error: "Method not allowed. Use PUT to upload a diagram." });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Unexpected server error." });
  }
}
