import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { readFile, writeFile } from "node:fs/promises";
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

Use the generate_architecture_diagram tool for architecture diagrams, system designs, service maps, and visual explanations. The tool accepts a complete diagram or a complete diagram plus incremental operations. It returns PNG by default, but strict validation is enabled by default: if any warning exists, the tool returns a repair report instead of a misleading image. Fix every warning and call the tool again. You may use mode: "validate" first for a cheap geometry-only pass.

MCP renderer follows the complete SKILL.md diagram contract. It supports relative Frame children through parentId and extent, multiline labels, node styling, images, handles, semantic arrow direction, straight/orthogonal/free routes, connector labels, and marker metadata. Read archboard://skill before generating a diagram and preserve the complete diagram semantics. html labels are sanitized to plain SVG text by the artifact renderer.

The diagram object is { nodes: [], edges: [] }. Every node has id, type: "shape", position {x,y}, style {width,height}, and data. data.kind is rectangle, rounded, ellipse, diamond, text, image, or container. data contains label, html, fill, border, textColor, borderWidth, borderStyle, radius, fontFamily, fontSize, fontWeight, align, vertical, padding, width, and height. Image nodes may also contain imageUrl, imagePosition (left/right/top/bottom/center), imageFit (contain/cover/fill), imageSize, imageOpacity, imageRadius, imageSource, imageAssetId, imageAssetSource, and imageAssetName.

Edges have id, source, target, type: "smart", sourceHandle, targetHandle, and data. Source handles are top, bottom, left, right. Target handles are bottom-target, left-target, right-target; omit targetHandle for a top target. Edge data.route is straight, orthogonal, or free; data.arrow is none, single, or double; data.stroke, width, dashed, dash, gap, label, labelAt, labelDirection, and labelHtml control appearance. labelAt may be "source", "mid", "target", or a number from 0 to 1. Arrow direction is source -> target. single puts the arrow at target; double puts arrows at both ends.

Use straight routes for clear direct relationships. Use orthogonal routes only when avoiding a node or following a deliberate grid lane. Use free routes for feedback, retry, error, and return loops. Do not use elbow routes for every edge. Labels are physical boxes; keep them short, use labelAt to move them into open space, and resolve every collision warning before rendering.

Images and icons are optional. Do not add them unless the user explicitly requests images, logos, icons, thumbnails, or an icon is a stated requirement. If requested, use a stable HTTPS SVG or PNG imageUrl and retain a readable text label.

layout: "auto" provides a deterministic lightweight DAG layout. Use layoutHints.rankDirection "LR" or "TB", optional clusterBy data key, and optional edgePriority. Manual coordinates remain the override when layout is "manual".

Output options: format is png, jpg, svg, or json; mode is render or validate; strict defaults to true and blocks inaccurate output when warnings exist; filePath writes the artifact on the server and returns path, width, and height metadata; png_bytes: "base64" includes PNG bytes in the tool result.`;

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
  strict: z.boolean().default(true).describe("When true, return validation errors instead of an image if any warning exists."),
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
const displayLabel = (value: unknown, html = false) => stripHtml(stringValue(value, "")).replace(/\\n/g, "\n");
const labelLines = (value: string) => value.split(/\r?\n/);

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
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const absolutePosition = (node: DiagramNode, visiting = new Set<string>()): Point => {
    const local = { x: numberValue(node.position?.x, 0), y: numberValue(node.position?.y, 0) };
    if (!node.parentId || visiting.has(node.id)) return local;
    const parent = byId.get(node.parentId);
    if (!parent) return local;
    visiting.add(node.id);
    const parentPosition = absolutePosition(parent, visiting);
    return { x: parentPosition.x + local.x, y: parentPosition.y + local.y };
  };
  return diagram.nodes.map((node) => {
    const width = numberValue(node.style?.width, numberValue(node.data?.width, 170));
    const height = numberValue(node.style?.height, numberValue(node.data?.height, 76));
    const position = absolutePosition(node);
    return { node, position, width, height, box: { ...position, width, height } };
  });
}

function handlePoint(item: FlatNode, handle: string | undefined, target: boolean): Point & { side: string } {
  const side = handle === "left" || handle === "left-target" ? "left" : handle === "right" || handle === "right-target" ? "right" : handle === "bottom" || handle === "bottom-target" ? "bottom" : target ? "top" : "top";
  return side === "left" ? { x: item.position.x, y: item.position.y + item.height / 2, side } : side === "right" ? { x: item.position.x + item.width, y: item.position.y + item.height / 2, side } : side === "bottom" ? { x: item.position.x + item.width / 2, y: item.position.y + item.height, side } : { x: item.position.x + item.width / 2, y: item.position.y, side };
}

function offsetPoint(point: Point & { side: string }, amount: number): Point & { side: string } {
  const offsets: Record<string, Point> = { left: { x: -amount, y: 0 }, right: { x: amount, y: 0 }, top: { x: 0, y: -amount }, bottom: { x: 0, y: amount } };
  const offset = offsets[point.side] ?? offsets.top;
  return { x: point.x - offset.x, y: point.y - offset.y, side: point.side };
}

function curveControls(start: Point & { side: string }, end: Point & { side: string }) {
  const outward: Record<string, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
  const sourceOutward = outward[start.side] ?? outward.top, targetOutward = outward[end.side] ?? outward.top;
  const distance = Math.max(56, Math.min(150, Math.hypot(end.x - start.x, end.y - start.y) * 0.34));
  return { controlOne: { x: start.x + sourceOutward.x * distance, y: start.y + sourceOutward.y * distance }, controlTwo: { x: end.x + targetOutward.x * distance, y: end.y + targetOutward.y * distance } };
}

function routePoints(start: Point, end: Point, route: string): Point[] {
  if (route === "orthogonal") {
    const verticalTarget = ["top", "bottom"].includes((end as Point & { side?: string }).side ?? "");
    if (verticalTarget) { const midY = start.y + (end.y - start.y) / 2; return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]; }
    const midX = start.x + (end.x - start.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  if (route === "free") {
    const { controlOne, controlTwo } = curveControls(start as Point & { side: string }, end as Point & { side: string });
    return Array.from({ length: 13 }, (_, index) => {
      const t = index / 12, inverse = 1 - t;
      return { x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlOne.x + 3 * inverse * t ** 2 * controlTwo.x + t ** 3 * end.x, y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlOne.y + 3 * inverse * t ** 2 * controlTwo.y + t ** 3 * end.y };
    });
  }
  return [start, end];
}

function routePath(start: Point, end: Point, route: string) {
  if (route === "orthogonal") { const verticalTarget = ["top", "bottom"].includes((end as Point & { side?: string }).side ?? ""); if (verticalTarget) { const midY = start.y + (end.y - start.y) / 2; return `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`; } const midX = start.x + (end.x - start.x) / 2; return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`; }
  if (route === "free") { const { controlOne, controlTwo } = curveControls(start as Point & { side: string }, end as Point & { side: string }); return `M ${start.x} ${start.y} C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${end.x} ${end.y}`; }
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
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
    const label = displayLabel(node.data?.label, node.data?.html === true), padding = numberValue(node.data?.padding, 12), availableWidth = numberValue(node.style?.width, numberValue(node.data?.width, 170)) - padding * 2, estimatedWidth = Math.max(...labelLines(label).map((line) => line.length)) * numberValue(node.data?.fontSize, 14) * 0.52 + padding * 2;
    if (label && estimatedWidth > availableWidth) warnings.push({ code: "text_overflow", path: `nodes[${index}].data.label`, message: `Label is approximately ${Math.ceil(estimatedWidth)}px wide but the node content is only ${Math.max(0, Math.floor(availableWidth))}px wide; shorten the label, enlarge the node, or split the component.` });
  });
  for (let first = 0; first < items.length; first++) for (let second = first + 1; second < items.length; second++) {
    const a = items[first], b = items[second];
    if (a.node.data?.kind !== "container" && b.node.data?.kind !== "container" && rectsOverlap(a.box, b.box)) warnings.push({ code: "node_overlap", path: "nodes", message: `Nodes ${a.node.id} and ${b.node.id} overlap; move them apart before rendering.` });
  }
  const edgeGeometry = diagram.edges.map((edge, index) => {
    for (const key of Object.keys(edge)) if (!supportedEdgeFields.has(key)) warnings.push({ code: "unsupported_field", path: `edges[${index}].${key}`, message: `${key} is not used by the MCP renderer.` });
    for (const key of Object.keys(edge.data ?? {})) if (!supportedEdgeDataFields.has(key)) warnings.push({ code: "unsupported_field", path: `edges[${index}].data.${key}`, message: `${key} is not used by the MCP renderer.` });
    if (!byId.has(edge.source) || !byId.has(edge.target)) warnings.push({ code: "missing_edge_node", path: `edges[${index}]`, message: `Edge references missing node: ${edge.source} -> ${edge.target}.` });
    if (edge.sourceHandle && !sourceHandles.has(edge.sourceHandle)) warnings.push({ code: "invalid_source_handle", path: `edges[${index}].sourceHandle`, message: `Invalid source handle: ${edge.sourceHandle}.` });
    if (edge.targetHandle && !targetHandles.has(edge.targetHandle)) warnings.push({ code: "invalid_target_handle", path: `edges[${index}].targetHandle`, message: `Invalid target handle: ${edge.targetHandle}; omit it for a top target.` });
    const source = byId.get(edge.source), target = byId.get(edge.target), data = edge.data ?? {}, rawRoute = stringValue(data.route, "straight"), route = ["straight", "orthogonal", "free"].includes(rawRoute) ? rawRoute : "straight", arrow = stringValue(data.arrow, "single");
    if (!["straight", "orthogonal", "free"].includes(rawRoute)) warnings.push({ code: "invalid_route", path: `edges[${index}].data.route`, message: `Invalid route: ${rawRoute}. Use straight, orthogonal, or free.` });
    if (!["none", "single", "double"].includes(arrow)) warnings.push({ code: "invalid_arrow", path: `edges[${index}].data.arrow`, message: `Invalid arrow mode: ${arrow}. Use none, single, or double.` });
    if (edge.markerStart && arrow !== "double") warnings.push({ code: "marker_mismatch", path: `edges[${index}].markerStart`, message: "markerStart requires data.arrow: double; omit it for none or single." });
    if (edge.markerEnd && arrow === "none") warnings.push({ code: "marker_mismatch", path: `edges[${index}].markerEnd`, message: "markerEnd is not used when data.arrow is none." });
    const start = source ? offsetPoint(handlePoint(source, edge.sourceHandle, false), 8) : { x: 0, y: 0, side: "top" }, end = target ? offsetPoint(handlePoint(target, edge.targetHandle, true), 8) : { x: 0, y: 0, side: "top" }, points = routePoints(start, end, route);
    const rawAt = data.labelAt, at = typeof rawAt === "number" ? Math.max(0, Math.min(1, rawAt)) : rawAt === "source" ? 0.2 : rawAt === "target" ? 0.8 : 0.5;
    const anchor = pointOnRoute(points, at), label = displayLabel(data.label, data.labelHtml === true), labelWidth = Math.min(220, Math.max(0, Math.max(...labelLines(label).map((line) => line.length)) * 6.2 + 14)), labelBox = { x: anchor.x - labelWidth / 2, y: anchor.y - (label ? labelLines(label).length * 10 : 0), width: labelWidth, height: label ? labelLines(label).length * 20 : 0 };
    if (label) for (const item of items) if (rectsOverlap(labelBox, item.box, 12)) warnings.push({ code: "label_overlap", path: `edges[${index}].data.label`, message: `Label overlaps node ${item.node.id}; move it with data.labelAt, shorten it, or move the node.` });
    for (const item of items) if (item.node.id !== edge.source && item.node.id !== edge.target && points.slice(1).some((point, pointIndex) => segmentHitsBox(points[pointIndex], point, item.box))) warnings.push({ code: "route_overlap", path: `edges[${index}]`, message: `Route intersects node ${item.node.id}; change handles, route, or node position.` });
    return { id: edge.id ?? `${edge.source}-${edge.target}`, source: edge.source, target: edge.target, route, points, start, end, label: label ? { text: label, anchor, box: labelBox, at, capacityChars: Math.floor(Math.max(0, labelWidth - 14) / 6.2), capacityHint: "approximately 14 characters per 100px at the default font" } : null };
  });
  return { warnings, geometry: { nodes: items.map((item) => ({ id: item.node.id, bbox: item.box })), edges: edgeGeometry } };
}

function renderSvg(diagram: Diagram, geometry: ReturnType<typeof analyzeDiagram>["geometry"]) {
  const items = flattenNodes(diagram), padding = 48, maxX = Math.max(...items.map((item) => item.position.x + item.width), 720), maxY = Math.max(...items.map((item) => item.position.y + item.height), 480), minX = Math.min(...items.map((item) => item.position.x), 0), minY = Math.min(...items.map((item) => item.position.y), 0), width = Math.ceil(maxX - minX + padding * 2), height = Math.ceil(maxY - minY + padding * 2), tx = padding - minX, ty = padding - minY;
  const defs = `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker></defs>`;
  const edgeSvg = geometry.edges.map((edge) => {
    const data = diagram.edges.find((item) => (item.id ?? `${item.source}-${item.target}`) === edge.id)?.data ?? {}, stroke = safeColor(data.stroke, "#27576B"), route = edge.route, start = edge.start, end = edge.end, path = routePath(start, end, route), arrow = stringValue(data.arrow, "single"), dash = data.dashed ? ` stroke-dasharray="${numberValue(data.dash, 6)} ${numberValue(data.gap, 5)}"` : "", labelDirection = stringValue(data.labelDirection, "horizontal"), angle = labelDirection === "vertical" ? 90 : labelDirection === "along" ? Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI : 0, label = edge.label ? renderText(edge.label.text, edge.label.anchor.x, edge.label.anchor.y, "middle", "font-family=monospace font-size=11px", "#111111", 1, 14, "edge-label").replace("<text ", `<text transform="rotate(${angle} ${edge.label.anchor.x} ${edge.label.anchor.y})" `) : "";
    return `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${numberValue(data.width, 1.5)}"${dash} ${arrow === "single" || arrow === "double" ? "marker-end=\"url(#arrow)\"" : ""}${arrow === "double" ? " marker-start=\"url(#arrow)\"" : ""}/>${label}`;
  }).join("");
  const nodeSvg = items.sort((a, b) => numberValue(a.node.zIndex, 0) - numberValue(b.node.zIndex, 0)).map(({ node, position, width: nodeWidth, height: nodeHeight }) => { const data = node.data ?? {}, kind = stringValue(data.kind, "rounded"), fill = safeColor(data.fill, "#DDF4FF"), border = safeColor(data.border, "#5B9DBB"), textColor = safeColor(data.textColor, "#173746"), radius = kind === "ellipse" ? nodeHeight / 2 : numberValue(data.radius, 8), borderWidth = numberValue(data.borderWidth, 1), borderStyle = stringValue(data.borderStyle, "solid"), style = `fill-opacity="${numberValue(data.fillOpacity, 100) / 100}" stroke-opacity="${numberValue(data.borderOpacity, 100) / 100}"`, shape = kind === "ellipse" ? `<ellipse cx="${position.x + nodeWidth / 2}" cy="${position.y + nodeHeight / 2}" rx="${nodeWidth / 2}" ry="${nodeHeight / 2}" fill="${fill}" stroke="${border}" stroke-width="${borderWidth}" stroke-dasharray="${borderStyle === "dashed" ? `${numberValue(data.dashLength, 8)} ${numberValue(data.dashGap, 5)}` : "none"}" ${style}/>` : kind === "diamond" ? `<polygon points="${position.x + nodeWidth / 2},${position.y} ${position.x + nodeWidth},${position.y + nodeHeight / 2} ${position.x + nodeWidth / 2},${position.y + nodeHeight} ${position.x},${position.y + nodeHeight / 2}" fill="${fill}" stroke="${border}" stroke-width="${borderWidth}" ${style}/>` : `<rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="${radius}" fill="${kind === "text" ? "transparent" : fill}" stroke="${kind === "text" ? "transparent" : border}" stroke-width="${kind === "text" ? 0 : borderWidth}" stroke-dasharray="${borderStyle === "dashed" ? `${numberValue(data.dashLength, 8)} ${numberValue(data.dashGap, 5)}` : "none"}" ${style}/>`;
    const label = displayLabel(data.label, data.html === true), isFrame = kind === "container", align = isFrame ? "start" : stringValue(data.align, "center"), labelX = isFrame ? position.x + numberValue(data.padding, 12) : align === "left" ? position.x + numberValue(data.padding, 12) : align === "right" ? position.x + nodeWidth - numberValue(data.padding, 12) : position.x + nodeWidth / 2, vertical = isFrame ? "top" : stringValue(data.vertical, "center"), labelY = isFrame ? position.y + 22 : vertical === "top" ? position.y + numberValue(data.padding, 12) + numberValue(data.fontSize, 14) : vertical === "bottom" ? position.y + nodeHeight - numberValue(data.padding, 12) : position.y + nodeHeight / 2, anchor = align === "left" ? "start" : align === "right" ? "end" : "middle", font = `font-family="${escapeXml(stringValue(data.fontFamily, "Arial"))}" font-size="${numberValue(data.fontSize, 14)}" font-weight="${numberValue(data.fontWeight, 600)}"`;
    const imagePosition = stringValue(data.imagePosition, "left"), imageSize = Math.min(nodeWidth - 20, nodeHeight - 20, numberValue(data.imageSize, 42)), imageX = imagePosition === "right" ? position.x + nodeWidth - imageSize - 10 : imagePosition === "center" ? position.x + (nodeWidth - imageSize) / 2 : position.x + 10, imageY = imagePosition === "bottom" ? position.y + nodeHeight - imageSize - 10 : imagePosition === "center" ? position.y + (nodeHeight - imageSize) / 2 : position.y + 10, image = data.imageUrl ? `<image href="${escapeXml(data.imageUrl)}" x="${imageX}" y="${imageY}" width="${imageSize}" height="${imageSize}" opacity="${numberValue(data.imageOpacity, 100) / 100}" preserveAspectRatio="${stringValue(data.imageFit, "contain") === "cover" ? "xMidYMid slice" : stringValue(data.imageFit, "contain") === "fill" ? "none" : "xMidYMid meet"}"/>` : "";
    return `${shape}${image}${renderText(label, labelX, labelY, anchor, font, textColor, numberValue(data.textOpacity, 100) / 100, numberValue(data.fontSize, 14) * 1.2, "node-label")}`; }).join("");
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>.edge-label{paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}</style>${defs}<g transform="translate(${tx} ${ty})">${edgeSvg}${nodeSvg}</g></svg>`, width, height };
}

function outputPath(filePath: string) {
  const candidate = isAbsolute(filePath) ? filePath : resolve("/tmp", filePath);
  if (!candidate.startsWith("/tmp/")) throw new Error("filePath must be inside /tmp for an unauthenticated server.");
  return candidate;
}

function renderText(value: string, x: number, y: number, anchor: string, font: string, fill: string, opacity: number, lineHeight: number, className = "") {
  const lines = labelLines(value), startY = y - (lines.length - 1) * lineHeight / 2;
  return `<text x="${x}" y="${startY}" text-anchor="${anchor}" dominant-baseline="middle" ${font} fill="${fill}" fill-opacity="${opacity}" class="${className}">${lines.map((line, index) => `<tspan x="${x}" y="${startY + index * lineHeight}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "archboard", version: "1.1.0" }, { capabilities: { tools: {}, resources: { listChanged: false, subscribe: false } }, instructions: serverInstructions });
  server.registerResource("archboard-skill", "archboard://skill", { title: "Canonical Archboard SKILL.md", description: "The authoritative Archboard diagram-generation contract. Read this before generating a diagram.", mimeType: "text/markdown" }, async (uri) => {
    let text = serverInstructions;
    try { text = await readFile(resolve(process.cwd(), "SKILL.md"), "utf8"); } catch { /* The deployed fallback still contains the MCP contract. */ }
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
  });
  server.registerTool("generate_architecture_diagram", { description: "FIRST read the archboard://skill resource. It is the complete, authoritative SKILL.md contract and must be followed exactly, including source/target handles, semantic source-to-target direction, marker behavior, and route geometry. Then validate, auto-layout, render, or incrementally edit an Archboard diagram. Strict validation is enabled by default and returns a repair report instead of an inaccurate image when nodes, labels, or routes overlap. Supports geometry, filePath, png_bytes: base64, labelAt, operations, and layout: auto.", inputSchema }, async ({ diagram, format, mode, filePath, png_bytes, layout, layoutHints, operations, strict }) => {
    try {
      let normalized = applyOperations(normalizeDiagram(diagram), operations);
      if (layout === "auto") normalized = applyAutoLayout(normalized, layoutHints);
      const analysis = analyzeDiagram(normalized);
      if (mode === "validate") return { content: [{ type: "text", text: JSON.stringify({ valid: analysis.warnings.length === 0, warnings: analysis.warnings, geometry: analysis.geometry, diagram: normalized }, null, 2) }] };
      if (strict && analysis.warnings.length) return { isError: true, content: [{ type: "text", text: JSON.stringify({ valid: false, message: "Rendering blocked by validation warnings. Fix every warning and retry.", warnings: analysis.warnings, geometry: analysis.geometry, diagram: normalized }, null, 2) }] };
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
