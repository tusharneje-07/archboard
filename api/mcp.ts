import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import sharp from "sharp";
import { z } from "zod";

type DiagramNode = {
  id: string;
  type?: string;
  position?: { x?: number; y?: number };
  parentId?: string;
  extent?: string;
  style?: { width?: number; height?: number };
  zIndex?: number;
  data?: Record<string, unknown>;
};
type DiagramEdge = {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: Record<string, unknown>;
};
type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[] };
type OutputFormat = "png" | "jpg" | "svg" | "json";
type Warning = { code: string; path: string; message: string };
type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
type FlatNode = { node: DiagramNode; position: Point; width: number; height: number; box: Box };

const serverInstructions = `You are connected to Archboard, a local-first system architecture diagram renderer and editor.

Archboard supports architecture shapes, Frames, editable labels, themes, colors, opacity, four-sided handles, straight/orthogonal/free connectors, connector labels, dashed lines, images, icon URLs, layers, zoom/pan, presentation mode, JSON import/editing, and PNG/SVG/JPG/JSON export. The MCP renderer is a server-side artifact renderer and has a deliberately smaller, explicit contract.

Use the generate_architecture_diagram tool for architecture diagrams, system designs, service maps, and visual explanations. The tool accepts a complete diagram or a complete diagram plus incremental operations. It returns PNG by default. Use mode: "validate" before rendering when geometry or collisions matter.

MCP renderer contract: every node must use absolute canvas coordinates. Do not use parentId or extent for MCP input; they are reported as unsupported warnings and are not used for layout. Frame nodes still work as visual boundaries, but child nodes must have their own absolute position. Labels are plain text only: html is ignored, and literal \\n in labels is replaced with a space and reported as a warning. Use short single-line labels, or separate text nodes for multiline explanation. Frame titles render top-left with padding.

The diagram object is { nodes: [], edges: [] }. Every node has id, type: "shape", position {x,y}, style {width,height}, and data. data.kind is rectangle, rounded, ellipse, diamond, text, image, or container. data contains label, html, fill, border, textColor, borderWidth, borderStyle, radius, fontFamily, fontSize, fontWeight, align, vertical, padding, width, and height. Image nodes may also contain imageUrl, imagePosition (left/right/top/bottom/center), imageFit (contain/cover/fill), imageSize, imageOpacity, imageRadius, imageSource, imageAssetId, imageAssetSource, and imageAssetName.

Edges have id, source, target, type: "smart", sourceHandle, targetHandle, and data. Source handles are top, bottom, left, right. Target handles are bottom-target, left-target, right-target; omit targetHandle for a top target. Edge data.route is straight, orthogonal, or free; data.arrow is none, single, or double; data.stroke, width, dashed, dash, gap, label, labelAt, labelDirection, and labelHtml control appearance. labelAt may be "source", "mid", "target", or a number from 0 to 1. Arrow direction is source -> target. single puts the arrow at target; double puts arrows at both ends.

Use straight routes for clear direct relationships. Use orthogonal routes only when avoiding a node or following a deliberate grid lane. Use free routes for feedback, retry, error, and return loops. Do not use elbow routes for every edge. Labels are physical boxes; keep them short, use labelAt to move them into open space, and resolve every collision warning before rendering.

Images and icons are optional. Do not add them unless the user explicitly requests images, logos, icons, thumbnails, or an icon is a stated requirement. If requested, use a stable HTTPS SVG or PNG imageUrl and retain a readable text label.

layout: "auto" provides a deterministic lightweight DAG layout. Use layoutHints.rankDirection "LR" or "TB", optional clusterBy data key, and optional edgePriority. Manual coordinates remain the override when layout is "manual".

Output options: format is png, jpg, svg, or json; mode is render or validate; filePath writes the artifact on the server and returns path, width, and height metadata; png_bytes: "base64" includes PNG bytes in the tool result.`;

const inputSchema = z.object({
  diagram: z.union([
    z.string().describe("A JSON string containing {nodes, edges}"),
    z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }).describe("An Archboard diagram object"),
  ]),
  format: z.enum(["png", "jpg", "svg", "json"]).default("png").describe("Output format. Defaults to png."),
  mode: z.enum(["render", "validate"]).default("render").describe("Validate returns geometry and warnings without rendering an image."),
  filePath: z.string().optional().describe("Optional local/server output path. Use /tmp in hosted environments."),
  png_bytes: z.enum(["base64"]).optional().describe("For PNG output, include base64 image bytes in addition to metadata."),
  layout: z.enum(["manual", "auto"]).default("manual").describe("Use auto for deterministic DAG placement."),
  layoutHints: z.object({
    rankDirection: z.enum(["LR", "TB"]).default("LR"),
    clusterBy: z.string().optional(),
    edgePriority: z.record(z.string(), z.number()).optional(),
  }).optional(),
  operations: z.array(z.record(z.string(), z.unknown())).optional().describe("Optional incremental operations: add_node, move_node, update_node, remove_node, add_edge, update_edge, remove_edge."),
});

const supportedNodeFields = new Set(["id", "type", "position", "parentId", "extent", "style", "zIndex", "data"]);
const supportedDataFields = new Set(["kind", "label", "html", "fill", "border", "textColor", "borderWidth", "borderStyle", "dashLength", "dashGap", "fillOpacity", "borderOpacity", "textOpacity", "radius", "fontFamily", "fontSize", "fontWeight", "align", "vertical", "padding", "paddingX", "paddingY", "width", "height", "clipContent", "layout", "imageUrl", "imagePosition", "imageFit", "imageSize", "imageOpacity", "imageRadius", "imageSource", "imageAssetId", "imageAssetSource", "imageAssetName"]);
const supportedEdgeFields = new Set(["id", "source", "target", "type", "sourceHandle", "targetHandle", "markerStart", "markerEnd", "data"]);
const supportedEdgeDataFields = new Set(["route", "arrow", "stroke", "width", "dashed", "dash", "gap", "label", "labelAt", "labelDirection", "labelHtml"]);
const sourceHandles = new Set(["top", "bottom", "left", "right"]);
const targetHandles = new Set(["bottom-target", "left-target", "right-target"]);

const numberValue = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringValue = (value: unknown, fallback: string) => typeof value === "string" ? value : fallback;
const escapeXml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
const safeColor = (value: unknown, fallback: string) => {
  const color = stringValue(value, fallback);
  return color === "transparent" || /^#[0-9a-f]{3,8}$/i.test(color) || /^rgba?\([\d\s,.%]+\)$/.test(color) ? color : fallback;
};
const stripHtml = (value: string) => value.replace(/<[^>]*>/g, "");
const displayLabel = (value: unknown, html = false) => stripHtml(stringValue(value, "")).replace(/\r?\n|\\n/g, " ");

function normalizeDiagram(value: unknown): Diagram {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { nodes?: unknown }).nodes) || !Array.isArray((parsed as { edges?: unknown }).edges)) throw new Error("diagram must contain nodes and edges arrays");
  return { nodes: (parsed as { nodes: DiagramNode[] }).nodes.map((node) => ({ ...node, data: { ...(node.data ?? {}) } })), edges: (parsed as { edges: DiagramEdge[] }).edges.map((edge) => ({ ...edge, data: { ...(edge.data ?? {}) } })) };
}

function applyOperations(diagram: Diagram, operations: Record<string, unknown>[] = []) {
  const next: Diagram = { nodes: diagram.nodes.map((node) => ({ ...node, data: { ...(node.data ?? {}) } })), edges: diagram.edges.map((edge) => ({ ...edge, data: { ...(edge.data ?? {}) } })) };
  for (const operation of operations) {
    const op = stringValue(operation.op, "");
    if (op === "add_node" && operation.node && typeof operation.node === "object") next.nodes.push(operation.node as DiagramNode);
    else if (op === "add_edge" && operation.edge && typeof operation.edge === "object") next.edges.push(operation.edge as DiagramEdge);
    else if (op === "move_node") { const node = next.nodes.find((item) => item.id === operation.id); if (node) node.position = { x: numberValue(operation.x, node.position?.x ?? 0), y: numberValue(operation.y, node.position?.y ?? 0) }; }
    else if (op === "update_node") { const node = next.nodes.find((item) => item.id === operation.id); if (node && operation.patch && typeof operation.patch === "object") Object.assign(node, operation.patch); }
    else if (op === "update_edge") { const edge = next.edges.find((item) => item.id === operation.id); if (edge && operation.patch && typeof operation.patch === "object") Object.assign(edge, operation.patch); }
    else if (op === "remove_node") { next.nodes = next.nodes.filter((node) => node.id !== operation.id); next.edges = next.edges.filter((edge) => edge.source !== operation.id && edge.target !== operation.id); }
    else if (op === "remove_edge") next.edges = next.edges.filter((edge) => edge.id !== operation.id);
  }
  return next;
}

function applyAutoLayout(diagram: Diagram, hints: { rankDirection?: "LR" | "TB"; clusterBy?: string; edgePriority?: Record<string, number> } = {}) {
  const direction = hints.rankDirection ?? "LR";
  const ranks = new Map(diagram.nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < diagram.nodes.length; pass++) for (const edge of diagram.edges) ranks.set(edge.target, Math.max(ranks.get(edge.target) ?? 0, (ranks.get(edge.source) ?? 0) + 1));
  const groups = new Map<string, DiagramNode[]>();
  for (const node of diagram.nodes) { const key = String(ranks.get(node.id) ?? 0); if (!groups.has(key)) groups.set(key, []); groups.get(key)?.push(node); }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b));
  const rankGap = 300, itemGap = 150;
  const edgePriority = hints.edgePriority ?? {};
  const priorityFor = (node: DiagramNode) => Math.max(0, ...diagram.edges.filter((edge) => edge.source === node.id).map((edge) => numberValue(edgePriority[edge.id ?? `${edge.source}-${edge.target}`], 0)));
  const clusterFor = (node: DiagramNode) => hints.clusterBy ? String(node.data?.[hints.clusterBy] ?? "") : "";
  return { ...diagram, nodes: sortedGroups.flatMap(([rank, group]) => [...group].sort((a, b) => clusterFor(a).localeCompare(clusterFor(b)) || priorityFor(b) - priorityFor(a)).map((node, index) => ({ ...node, parentId: undefined, extent: undefined, position: direction === "LR" ? { x: Number(rank) * rankGap, y: index * itemGap } : { x: index * rankGap, y: Number(rank) * itemGap } }))) };
}

function flattenNodes(diagram: Diagram): FlatNode[] {
  return diagram.nodes.map((node) => {
    const width = numberValue(node.style?.width, numberValue(node.data?.width, 170));
    const height = numberValue(node.style?.height, numberValue(node.data?.height, 76));
    const position = { x: numberValue(node.position?.x, 0), y: numberValue(node.position?.y, 0) };
    return { node, position, width, height, box: { ...position, width, height } };
  });
}

function handlePoint(item: FlatNode, handle: string | undefined, target: boolean): Point & { side: string } {
  const side = handle === "left" || handle === "left-target" ? "left" : handle === "right" || handle === "right-target" ? "right" : handle === "bottom" || handle === "bottom-target" ? "bottom" : target ? "top" : "top";
  return side === "left" ? { x: item.position.x, y: item.position.y + item.height / 2, side } : side === "right" ? { x: item.position.x + item.width, y: item.position.y + item.height / 2, side } : side === "bottom" ? { x: item.position.x + item.width / 2, y: item.position.y + item.height, side } : { x: item.position.x + item.width / 2, y: item.position.y, side };
}

function routePoints(start: Point, end: Point, route: string): Point[] {
  if (route === "orthogonal") { const midX = start.x + (end.x - start.x) / 2; return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]; }
  return [start, end];
}

function pointOnRoute(points: Point[], at: number): Point {
  const distance = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
  let remaining = distance * at;
  for (let index = 1; index < points.length; index++) { const from = points[index - 1], to = points[index], length = Math.hypot(to.x - from.x, to.y - from.y); if (remaining <= length) { const ratio = length ? remaining / length : 0; return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }; } remaining -= length; }
  return points[points.length - 1];
}

function rectsOverlap(a: Box, b: Box, padding = 0) { return a.x - padding < b.x + b.width && a.x + a.width + padding > b.x && a.y - padding < b.y + b.height && a.y + a.height + padding > b.y; }
function segmentHitsBox(a: Point, b: Point, box: Box) { const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y); return maxX >= box.x && minX <= box.x + box.width && maxY >= box.y && minY <= box.y + box.height; }

function analyzeDiagram(diagram: Diagram) {
  const warnings: Warning[] = [], items = flattenNodes(diagram), byId = new Map(items.map((item) => [item.node.id, item]));
  const ids = new Set<string>();
  diagram.nodes.forEach((node, index) => {
    if (!node.id) warnings.push({ code: "missing_node_id", path: `nodes[${index}].id`, message: "Node id is required." });
    if (ids.has(node.id)) warnings.push({ code: "duplicate_node_id", path: `nodes[${index}].id`, message: `Duplicate node id: ${node.id}.` });
    ids.add(node.id);
    for (const key of Object.keys(node)) if (!supportedNodeFields.has(key)) warnings.push({ code: "unsupported_field", path: `nodes[${index}].${key}`, message: `${key} is not used by the MCP renderer.` });
    for (const key of Object.keys(node.data ?? {})) if (!supportedDataFields.has(key)) warnings.push({ code: "unsupported_field", path: `nodes[${index}].data.${key}`, message: `${key} is not used by the MCP renderer.` });
    if (node.data?.html === true) warnings.push({ code: "html_ignored", path: `nodes[${index}].data.html`, message: "html ignored (label-only renderer)." });
    if (node.data?.label && /\r?\n|\\n/.test(String(node.data.label))) warnings.push({ code: "newline_unsupported", path: `nodes[${index}].data.label`, message: "\\n not supported in label; it is replaced with a space. Use a short label or a separate text node." });
    if (node.parentId || node.extent) warnings.push({ code: "parent_ignored", path: `nodes[${index}]`, message: "parentId+extent ignored by this renderer; provide absolute node positions." });
  });
  const edgeGeometry = diagram.edges.map((edge, index) => {
    for (const key of Object.keys(edge)) if (!supportedEdgeFields.has(key)) warnings.push({ code: "unsupported_field", path: `edges[${index}].${key}`, message: `${key} is not used by the MCP renderer.` });
    for (const key of Object.keys(edge.data ?? {})) if (!supportedEdgeDataFields.has(key)) warnings.push({ code: "unsupported_field", path: `edges[${index}].data.${key}`, message: `${key} is not used by the MCP renderer.` });
    if (!byId.has(edge.source) || !byId.has(edge.target)) warnings.push({ code: "missing_edge_node", path: `edges[${index}]`, message: `Edge references missing node: ${edge.source} -> ${edge.target}.` });
    if (edge.sourceHandle && !sourceHandles.has(edge.sourceHandle)) warnings.push({ code: "invalid_source_handle", path: `edges[${index}].sourceHandle`, message: `Invalid source handle: ${edge.sourceHandle}.` });
    if (edge.targetHandle && !targetHandles.has(edge.targetHandle)) warnings.push({ code: "invalid_target_handle", path: `edges[${index}].targetHandle`, message: `Invalid target handle: ${edge.targetHandle}; omit it for a top target.` });
    const source = byId.get(edge.source), target = byId.get(edge.target), data = edge.data ?? {}, route = stringValue(data.route, "straight"), start = source ? handlePoint(source, edge.sourceHandle, false) : { x: 0, y: 0, side: "top" }, end = target ? handlePoint(target, edge.targetHandle, true) : { x: 0, y: 0, side: "top" }, points = routePoints(start, end, route);
    const rawAt = data.labelAt, at = typeof rawAt === "number" ? Math.max(0, Math.min(1, rawAt)) : rawAt === "source" ? 0.2 : rawAt === "target" ? 0.8 : 0.5;
    const anchor = pointOnRoute(points, at), label = displayLabel(data.label, data.labelHtml === true), labelWidth = Math.min(220, Math.max(0, label.length * 6.2 + 14)), labelBox = { x: anchor.x - labelWidth / 2, y: anchor.y - 10, width: labelWidth, height: label ? 20 : 0 };
    if (label) for (const item of items) if (item.node.id !== edge.source && item.node.id !== edge.target && rectsOverlap(labelBox, item.box, 12)) warnings.push({ code: "label_overlap", path: `edges[${index}].data.label`, message: `Label overlaps node ${item.node.id}; move it with data.labelAt, shorten it, or move the node.` });
    for (const item of items) if (item.node.id !== edge.source && item.node.id !== edge.target && points.slice(1).some((point, pointIndex) => segmentHitsBox(points[pointIndex], point, item.box))) warnings.push({ code: "route_overlap", path: `edges[${index}]`, message: `Route intersects node ${item.node.id}; change handles, route, or node position.` });
    return { id: edge.id ?? `${edge.source}-${edge.target}`, source: edge.source, target: edge.target, route, points, start, end, label: label ? { text: label, anchor, box: labelBox, at, capacityChars: Math.floor(Math.max(0, labelWidth - 14) / 6.2), capacityHint: "approximately 14 characters per 100px at the default font" } : null };
  });
  return { warnings, geometry: { nodes: items.map((item) => ({ id: item.node.id, bbox: item.box })), edges: edgeGeometry } };
}

function renderSvg(diagram: Diagram, geometry: ReturnType<typeof analyzeDiagram>["geometry"]) {
  const items = flattenNodes(diagram), padding = 48, maxX = Math.max(...items.map((item) => item.position.x + item.width), 720), maxY = Math.max(...items.map((item) => item.position.y + item.height), 480), minX = Math.min(...items.map((item) => item.position.x), 0), minY = Math.min(...items.map((item) => item.position.y), 0), width = Math.ceil(maxX - minX + padding * 2), height = Math.ceil(maxY - minY + padding * 2), tx = padding - minX, ty = padding - minY;
  const defs = `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker></defs>`;
  const edgeSvg = geometry.edges.map((edge) => {
    const data = diagram.edges.find((item) => (item.id ?? `${item.source}-${item.target}`) === edge.id)?.data ?? {}, stroke = safeColor(data.stroke, "#27576B"), route = edge.route, start = edge.start, end = edge.end, midX = start.x + (end.x - start.x) / 2, path = route === "orthogonal" ? `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}` : route === "free" ? `M ${start.x} ${start.y} C ${start.x + (end.x - start.x) * 0.35} ${start.y}, ${end.x - (end.x - start.x) * 0.35} ${end.y}, ${end.x} ${end.y}` : `M ${start.x} ${start.y} L ${end.x} ${end.y}`, arrow = stringValue(data.arrow, "single"), dash = data.dashed ? ` stroke-dasharray="${numberValue(data.dash, 6)} ${numberValue(data.gap, 5)}"` : "", label = edge.label ? `<text x="${edge.label.anchor.x}" y="${edge.label.anchor.y}" text-anchor="middle" class="edge-label">${escapeXml(edge.label.text)}</text>` : "";
    return `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${numberValue(data.width, 1.5)}"${dash} ${arrow === "single" || arrow === "double" ? "marker-end=\"url(#arrow)\"" : ""}${arrow === "double" ? " marker-start=\"url(#arrow)\"" : ""}/>${label}`;
  }).join("");
  const nodeSvg = items.sort((a, b) => numberValue(a.node.zIndex, 0) - numberValue(b.node.zIndex, 0)).map(({ node, position, width: nodeWidth, height: nodeHeight }) => { const data = node.data ?? {}, kind = stringValue(data.kind, "rounded"), fill = safeColor(data.fill, "#DDF4FF"), border = safeColor(data.border, "#5B9DBB"), textColor = safeColor(data.textColor, "#173746"), radius = kind === "ellipse" ? nodeHeight / 2 : numberValue(data.radius, 8), shape = kind === "ellipse" ? `<ellipse cx="${position.x + nodeWidth / 2}" cy="${position.y + nodeHeight / 2}" rx="${nodeWidth / 2}" ry="${nodeHeight / 2}" fill="${fill}" stroke="${border}"/>` : kind === "diamond" ? `<polygon points="${position.x + nodeWidth / 2},${position.y} ${position.x + nodeWidth},${position.y + nodeHeight / 2} ${position.x + nodeWidth / 2},${position.y + nodeHeight} ${position.x},${position.y + nodeHeight / 2}" fill="${fill}" stroke="${border}"/>` : `<rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="${radius}" fill="${kind === "text" ? "transparent" : fill}" stroke="${kind === "text" ? "transparent" : border}"/>`, label = escapeXml(displayLabel(data.label, data.html === true)), isFrame = kind === "container", labelX = isFrame ? position.x + numberValue(data.padding, 12) : position.x + nodeWidth / 2, labelY = isFrame ? position.y + 22 : position.y + nodeHeight / 2, anchor = isFrame ? "start" : "middle"; return `${shape}${data.imageUrl ? `<image href="${escapeXml(data.imageUrl)}" x="${position.x + 10}" y="${position.y + 10}" width="${Math.min(nodeWidth - 20, numberValue(data.imageSize, 42))}" height="${Math.min(nodeHeight - 20, numberValue(data.imageSize, 42))}" preserveAspectRatio="xMidYMid meet"/>` : ""}<text x="${labelX}" y="${labelY}" text-anchor="${anchor}" dominant-baseline="middle" fill="${textColor}" class="node-label">${label}</text>`; }).join("");
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>.node-label{font:600 14px Arial,sans-serif}.edge-label{font:11px monospace;paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}</style>${defs}<g transform="translate(${tx} ${ty})">${edgeSvg}${nodeSvg}</g></svg>`, width, height };
}

function outputPath(filePath: string) {
  const candidate = isAbsolute(filePath) ? filePath : resolve("/tmp", filePath);
  if (!candidate.startsWith("/tmp/")) throw new Error("filePath must be inside /tmp for an unauthenticated server.");
  return candidate;
}

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "archboard", version: "1.1.0" }, { capabilities: { tools: {} }, instructions: serverInstructions });
  server.registerTool("generate_architecture_diagram", { description: "Validate, auto-layout, render, or incrementally edit an Archboard diagram. Returns geometry and warnings in validate mode. Returns PNG by default. Supports filePath, png_bytes: base64, labelAt, operations, and layout: auto.", inputSchema }, async ({ diagram, format, mode, filePath, png_bytes, layout, layoutHints, operations }) => {
    try {
      let normalized = applyOperations(normalizeDiagram(diagram), operations);
      if (layout === "auto") normalized = applyAutoLayout(normalized, layoutHints);
      const analysis = analyzeDiagram(normalized);
      if (mode === "validate") return { content: [{ type: "text", text: JSON.stringify({ valid: analysis.warnings.length === 0, warnings: analysis.warnings, geometry: analysis.geometry, diagram: normalized }, null, 2) }] };
      const rendered = renderSvg(normalized, analysis.geometry);
      if (format === "json") return { content: [{ type: "text", text: JSON.stringify({ diagram: normalized, warnings: analysis.warnings, width: rendered.width, height: rendered.height }, null, 2) }] };
      const source = new TextEncoder().encode(rendered.svg);
      const bytes = format === "svg" ? new TextEncoder().encode(rendered.svg) : format === "jpg" ? await sharp(source).jpeg({ quality: 92 }).toBuffer() : await sharp(source).png().toBuffer();
      const mimeType = format === "svg" ? "image/svg+xml" : format === "jpg" ? "image/jpeg" : "image/png";
      const metadata = { format, width: rendered.width, height: rendered.height, warnings: analysis.warnings };
      if (filePath) { const path = outputPath(filePath); const fileMetadata = { ...metadata, path }; await writeFile(path, bytes); return { content: [{ type: "text", text: JSON.stringify(fileMetadata, null, 2) }, ...(format === "png" && png_bytes === "base64" ? [{ type: "image" as const, data: Buffer.from(bytes).toString("base64"), mimeType }] : [])] }; }
      if (format === "svg") return { content: [{ type: "text", text: rendered.svg }, { type: "text", text: JSON.stringify(metadata, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }, { type: "image" as const, data: Buffer.from(bytes).toString("base64"), mimeType }] };
    } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Could not process diagram." }] }; }
  });
  return server;
}, { legacy: "stateless" });

const nodeHandler = toNodeHandler(handler);
export default nodeHandler;
export { serverInstructions };
