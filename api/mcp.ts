import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import sharp from "sharp";
import { z } from "zod";

type DiagramNode = {
  id: string;
  type?: string;
  position?: { x?: number; y?: number };
  parentId?: string;
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

const serverInstructions = `You are connected to Archboard, a local-first system architecture diagram renderer and editor.

Archboard supports architecture shapes, Frames, editable labels, themes, colors, opacity, four-sided handles, straight/orthogonal/free connectors, connector labels, dashed lines, images, icon URLs, layers, zoom/pan, presentation mode, JSON import/editing, and PNG/SVG/JPG/JSON export. The MCP integration generates the diagram artifact directly; it does not need browser localStorage or an attached skill file.

Use the generate_architecture_diagram tool when the user asks for an architecture diagram, system design, flow diagram, service map, or visual explanation. You do not need to attach SKILL.md. Generate a complete Archboard diagram object with nodes and edges and pass it to the tool.

The diagram object is exactly { nodes: [], edges: [] }. Every node has id, type: "shape", position {x,y}, style {width,height}, and data. data.kind is rectangle, rounded, ellipse, diamond, text, image, or container. data contains label, html, fill, border, textColor, borderWidth, borderStyle, radius, fontFamily, fontSize, fontWeight, align, vertical, padding, width, and height. Image nodes may also contain imageUrl, imagePosition (left/right/top/bottom/center), imageFit (contain/cover/fill), imageSize, imageOpacity, imageRadius, imageSource, imageAssetId, imageAssetSource, and imageAssetName. Container nodes are Frames. A child Frame node uses parentId, extent: "parent", and a position relative to its parent.

Edges have id, source, target, type: "smart", sourceHandle, targetHandle, and data. Handle IDs are exact: source handles are top, bottom, left, right; target handles are bottom-target, left-target, right-target. The top target is the default handle, so omit targetHandle for a top target. Edge data.route is straight, orthogonal, or free; data.arrow is none, single, or double; data.stroke, width, dashed, dash, gap, label, labelDirection, and labelHtml control appearance. Arrow direction is source -> target. single puts the arrow at target; double puts arrows at both ends.

Use straight routes for clear direct relationships. Use orthogonal routes only when avoiding a node or following a deliberate grid lane; do not use elbow routes for every edge. Use free routes for feedback, retry, error, and return loops. Place nodes before drawing edges, use separate lanes, and avoid crossing shapes. Edge labels are physical boxes: keep them short, split long labels with \\n, reserve at least 12px around nodes and 24px in dense areas, and never overlap nodes, Frame titles, other labels, or arrowheads. Use unlabeled edges when a label adds no information.

Images and icons are optional. Do not add them unless the user explicitly requests images, logos, icons, thumbnails, or an icon is a stated requirement. If requested, use a stable HTTPS SVG or PNG imageUrl and retain a readable text label. If images are not requested, use normal shapes.

The tool returns PNG by default. Set format to svg, jpg, or json when the user requests that format.`;

const inputSchema = z.object({
  diagram: z.union([
    z.string().describe("A JSON string containing {nodes, edges}"),
    z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }).describe("An Archboard diagram object"),
  ]),
  format: z.enum(["png", "jpg", "svg", "json"]).default("png").describe("Output format. Defaults to png."),
});

const numberValue = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringValue = (value: unknown, fallback: string) => typeof value === "string" ? value : fallback;
const escapeXml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
const safeColor = (value: unknown, fallback: string) => {
  const color = stringValue(value, fallback);
  return color === "transparent" || /^#[0-9a-f]{3,8}$/i.test(color) || /^rgba?\([\d\s,.%]+\)$/.test(color) ? color : fallback;
};

function normalizeDiagram(value: unknown): Diagram {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { nodes?: unknown }).nodes) || !Array.isArray((parsed as { edges?: unknown }).edges)) {
    throw new Error("diagram must contain nodes and edges arrays");
  }
  return { nodes: (parsed as { nodes: DiagramNode[] }).nodes, edges: (parsed as { edges: DiagramEdge[] }).edges };
}

function flattenNodes(diagram: Diagram) {
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const positions = new Map<string, { x: number; y: number }>();
  const absolute = (node: DiagramNode, visiting = new Set<string>()): { x: number; y: number } => {
    const cached = positions.get(node.id);
    if (cached) return cached;
    const own = { x: numberValue(node.position?.x, 0), y: numberValue(node.position?.y, 0) };
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || visiting.has(node.id)) { positions.set(node.id, own); return own; }
    const parentPosition = absolute(parent, new Set(visiting).add(node.id));
    const parentWidth = numberValue(parent.style?.width, numberValue(parent.data?.width, 330));
    const parentHeight = numberValue(parent.style?.height, numberValue(parent.data?.height, 220));
    const result = own.x > parentWidth || own.y > parentHeight ? own : { x: parentPosition.x + own.x, y: parentPosition.y + own.y };
    positions.set(node.id, result);
    return result;
  };
  return diagram.nodes.map((node) => ({ node, position: absolute(node), width: numberValue(node.style?.width, numberValue(node.data?.width, 170)), height: numberValue(node.style?.height, numberValue(node.data?.height, 76)) }));
}

function handlePoint(item: ReturnType<typeof flattenNodes>[number], handle: string | undefined, target: boolean) {
  const side = handle === "left" || handle === "left-target" ? "left" : handle === "right" || handle === "right-target" ? "right" : handle === "bottom" || handle === "bottom-target" ? "bottom" : target ? "top" : "top";
  return side === "left" ? { x: item.position.x, y: item.position.y + item.height / 2, side } : side === "right" ? { x: item.position.x + item.width, y: item.position.y + item.height / 2, side } : side === "bottom" ? { x: item.position.x + item.width / 2, y: item.position.y + item.height, side } : { x: item.position.x + item.width / 2, y: item.position.y, side };
}

function renderSvg(diagram: Diagram) {
  const items = flattenNodes(diagram);
  const byId = new Map(items.map((item) => [item.node.id, item]));
  const padding = 48;
  const maxX = Math.max(...items.map((item) => item.position.x + item.width), 720);
  const maxY = Math.max(...items.map((item) => item.position.y + item.height), 480);
  const minX = Math.min(...items.map((item) => item.position.x), 0);
  const minY = Math.min(...items.map((item) => item.position.y), 0);
  const width = Math.ceil(maxX - minX + padding * 2), height = Math.ceil(maxY - minY + padding * 2);
  const tx = padding - minX, ty = padding - minY;
  const defs = `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker></defs>`;
  const edgeSvg = diagram.edges.map((edge) => {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target) return "";
    const start = handlePoint(source, edge.sourceHandle, false), end = handlePoint(target, edge.targetHandle, true);
    const data = edge.data ?? {};
    const route = stringValue(data.route, "straight"), stroke = safeColor(data.stroke, "#27576B"), lineWidth = numberValue(data.width, 1.5);
    const midX = start.x + (end.x - start.x) / 2;
    const path = route === "orthogonal" ? `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}` : route === "free" ? `M ${start.x} ${start.y} C ${start.x + (end.x - start.x) * 0.35} ${start.y}, ${end.x - (end.x - start.x) * 0.35} ${end.y}, ${end.x} ${end.y}` : `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    const arrow = stringValue(data.arrow, "single"), dash = data.dashed ? ` stroke-dasharray="${numberValue(data.dash, 6)} ${numberValue(data.gap, 5)}"` : "";
    const label = stringValue(data.label, "");
    const labelX = route === "orthogonal" ? midX : (start.x + end.x) / 2, labelY = route === "orthogonal" ? (start.y + end.y) / 2 - 8 : (start.y + end.y) / 2 - 8;
    const labelSvg = label ? `<text x="${labelX}" y="${labelY}" text-anchor="middle" class="edge-label">${escapeXml(label).replace(/\\n/g, "&#10;")}</text>` : "";
    return `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${lineWidth}"${dash} ${arrow === "single" || arrow === "double" ? "marker-end=\"url(#arrow)\"" : ""}${arrow === "double" ? " marker-start=\"url(#arrow)\"" : ""}/>${labelSvg}`;
  }).join("");
  const nodeSvg = items.sort((a, b) => numberValue(a.node.zIndex, 0) - numberValue(b.node.zIndex, 0)).map(({ node, position, width: nodeWidth, height: nodeHeight }) => {
    const data = node.data ?? {}, kind = stringValue(data.kind, "rounded"), fill = safeColor(data.fill, "#DDF4FF"), border = safeColor(data.border, "#5B9DBB"), textColor = safeColor(data.textColor, "#173746");
    const radius = kind === "ellipse" ? nodeHeight / 2 : numberValue(data.radius, 8), shape = kind === "ellipse" ? `<ellipse cx="${position.x + nodeWidth / 2}" cy="${position.y + nodeHeight / 2}" rx="${nodeWidth / 2}" ry="${nodeHeight / 2}" fill="${fill}" stroke="${border}"/>` : kind === "diamond" ? `<polygon points="${position.x + nodeWidth / 2},${position.y} ${position.x + nodeWidth},${position.y + nodeHeight / 2} ${position.x + nodeWidth / 2},${position.y + nodeHeight} ${position.x},${position.y + nodeHeight / 2}" fill="${fill}" stroke="${border}"/>` : `<rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="${radius}" fill="${kind === "text" ? "transparent" : fill}" stroke="${kind === "text" ? "transparent" : border}"/>`;
    const label = escapeXml(stringValue(data.label, "")).replace(/\\n/g, "&#10;");
    return `${shape}<text x="${position.x + nodeWidth / 2}" y="${position.y + nodeHeight / 2}" text-anchor="middle" dominant-baseline="middle" fill="${textColor}" class="node-label">${label}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>.node-label{font:600 14px Arial,sans-serif;white-space:pre}.edge-label{font:11px monospace;paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round;white-space:pre}</style>${defs}<g transform="translate(${tx} ${ty})">${edgeSvg}${nodeSvg}</g></svg>`;
}

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "archboard", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: serverInstructions });
  server.registerTool("generate_architecture_diagram", { description: "Generate an Archboard system architecture diagram from complete diagram JSON. Returns a PNG image by default. Use format svg, jpg, or json when requested. The diagram must contain nodes and edges; use the server instructions for the full schema, handles, route selection, labels, and image policy.", inputSchema }, async ({ diagram, format }) => {
    try {
      const normalized = normalizeDiagram(diagram);
      const svg = renderSvg(normalized);
      if (format === "json") return { content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }] };
      if (format === "svg") return { content: [{ type: "text", text: svg }] };
      const svgBytes = new TextEncoder().encode(svg);
      const image = await sharp(svgBytes).jpeg({ quality: 92 }).toBuffer();
      if (format === "jpg") return { content: [{ type: "image", data: image.toString("base64"), mimeType: "image/jpeg" }] };
      const png = await sharp(svgBytes).png().toBuffer();
      return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Could not render diagram." }] };
    }
  });
  return server;
}, { legacy: "stateless" });

const nodeHandler = toNodeHandler(handler);
export default nodeHandler;
export { serverInstructions };
