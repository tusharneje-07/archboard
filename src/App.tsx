import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import DOMPurify from "dompurify";
import { toJpeg, toPng, toSvg } from "html-to-image";
import {
  addEdge,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Box,
  ChevronDown,
  Circle,
  Copy,
  Download,
  FileJson,
  Grid3X3,
  Group,
  Hand,
  Hexagon,
  Home,
  Link2,
  MousePointer2,
  PanelRight,
  Pentagon,
  Pipette,
  Plus,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";

type ShapeKind =
  | "rectangle"
  | "rounded"
  | "ellipse"
  | "diamond"
  | "text"
  | "container";
type NodeData = {
  kind: ShapeKind;
  label: string;
  html: boolean;
  fill: string;
  border: string;
  textColor: string;
  borderWidth: number;
  borderStyle: "solid" | "dashed";
  dashLength?: number;
  dashGap?: number;
  fillOpacity?: number;
  borderOpacity?: number;
  textOpacity?: number;
  radius: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  align: "left" | "center" | "right";
  vertical: "top" | "center" | "bottom";
  padding: number;
  paddingX?: number;
  paddingY?: number;
  width?: number;
  height?: number;
  clipContent?: boolean;
  layout?: "free" | "grid" | "horizontal" | "vertical";
};
type EdgeData = {
  route: "straight" | "orthogonal" | "free";
  arrow: "none" | "single" | "double";
  stroke: string;
  width: number;
  dashed: boolean;
  dash: number;
  gap: number;
  label?: string;
  labelDirection?: "horizontal" | "along" | "vertical";
  labelHtml?: boolean;
};
type Theme = { name: string; fill: string; border: string; text: string };
type DiagramSnapshot = { nodes: Node<NodeData>[]; edges: Edge<EdgeData>[] };
type Project = DiagramSnapshot & { id: string; name: string; createdAt: number; updatedAt: number };
type DiagramState = {
  nodes: Node<NodeData>[];
  edges: Edge<EdgeData>[];
  past: DiagramSnapshot[];
  future: DiagramSnapshot[];
  setDiagram: (nodes: Node<NodeData>[], edges: Edge<EdgeData>[]) => void;
  snapshot: () => void;
  undo: () => DiagramSnapshot | null;
  redo: () => DiagramSnapshot | null;
};

const themes: Theme[] = [
  ["Sky Blue", "#DDF4FF", "#5B9DBB", "#173746"],
  ["Soft Mint", "#DDF8E8", "#66A88B", "#174637"],
  ["Pale Green", "#CFF7C7", "#438C4A", "#183B1B"],
  ["Lavender", "#E6E5FF", "#8F8AD2", "#292957"],
  ["Lilac", "#F0DDF8", "#AA80BE", "#44264F"],
  ["Pale Pink", "#FFE0E8", "#CE8EA2", "#4D2733"],
  ["Warm Cream", "#FFF5DE", "#C9B98B", "#3F3928"],
  ["Butter Yellow", "#FFF3A6", "#C8B85A", "#454015"],
  ["Coral", "#FF8A65", "#C85A3D", "#3C1F17"],
  ["Peach", "#FFE0CA", "#D69A6A", "#57351F"],
  ["Light Cyan", "#CFF8F8", "#60B7B7", "#153D3D"],
  ["Teal Mint", "#D1F1EB", "#4B9D91", "#153F3B"],
  ["Deep Teal", "#00546D", "#003A4C", "#FFFFFF"],
  ["Navy Blue", "#003B5C", "#002B43", "#FFFFFF"],
  ["Dark Plum", "#4A004B", "#300031", "#FFFFFF"],
  ["Violet", "#5D4380", "#42305B", "#FFFFFF"],
  ["Soft Red", "#F5B9B9", "#C86E6E", "#4C2525"],
  ["Light Slate", "#EEF1F6", "#9AA4B2", "#28313D"],
  ["Clean White", "#FFFFFF", "#333333", "#202020"],
  ["Warm Beige", "#FFF0DD", "#CDAF87", "#4B3824"],
].map(([name, fill, border, text]) => ({ name, fill, border, text }));

const baseData = (kind: ShapeKind, label?: string): NodeData => ({
  kind,
  label:
    label ??
    (kind === "container"
      ? "System boundary"
      : kind === "text"
        ? "Annotation"
        : "Component"),
  html: false,
  fill: kind === "container" ? "#F8FAFC" : "#DDF4FF",
  border: kind === "container" ? "#597080" : "#5B9DBB",
  textColor: "#173746",
  borderWidth: 1,
  borderStyle: "solid",
  dashLength: 8,
  dashGap: 5,
  fillOpacity: 100,
  borderOpacity: 100,
  textOpacity: 100,
  radius: kind === "rounded" || kind === "container" ? 10 : 2,
  fontFamily: "Arial",
  fontSize: 14,
  fontWeight: 600,
  align: kind === "text" ? "left" : "center",
  vertical: "center",
  padding: 12,
  layout: kind === "container" ? "grid" : "free",
});
const initialNodes: Node<NodeData>[] = [
  {
    id: "client",
    type: "shape",
    position: { x: 100, y: 180 },
    style: { width: 170, height: 76 },
    data: baseData("rounded", "Client / Browser"),
  },
  {
    id: "api",
    type: "shape",
    position: { x: 390, y: 150 },
    style: { width: 210, height: 140 },
    data: baseData("container", "Web Application"),
  },
  {
    id: "service",
    type: "shape",
    parentId: "api",
    position: { x: 22, y: 48 },
    style: { width: 166, height: 62 },
    data: {
      ...baseData("rectangle", "API Gateway"),
      fill: "#00546D",
      border: "#003A4C",
      textColor: "#FFFFFF",
    },
  },
  {
    id: "db",
    type: "shape",
    position: { x: 720, y: 180 },
    style: { width: 170, height: 76 },
    data: baseData("ellipse", "PostgreSQL"),
  },
];
const initialEdges: Edge<EdgeData>[] = [
  {
    id: "client-api",
    source: "client",
    target: "api",
    type: "smart",
    data: {
      route: "orthogonal",
      arrow: "single",
      stroke: "#27576B",
      width: 1.5,
      dashed: false,
      dash: 6,
      gap: 5,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#27576B" },
  },
  {
    id: "api-db",
    source: "api",
    target: "db",
    type: "smart",
    data: {
      route: "straight",
      arrow: "double",
      stroke: "#27576B",
      width: 1.5,
      dashed: true,
      dash: 5,
      gap: 4,
    },
    markerStart: { type: MarkerType.ArrowClosed, color: "#27576B" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#27576B" },
  },
];

function normalizeLoadedNodes(input: Node<NodeData>[]): Node<NodeData>[] {
  const nodes = input.map((node) => ({ ...node }));
  const absolute = (node: Node<NodeData>): { x: number; y: number } => {
    const parent = node.parentId ? nodes.find((candidate) => candidate.id === node.parentId) : undefined;
    if (!parent) return node.position;
    const parentPosition = absolute(parent), parentWidth = Number(parent.style?.width ?? parent.data.width ?? 330), parentHeight = Number(parent.style?.height ?? parent.data.height ?? 220), savedAsAbsolute = node.position.x > parentWidth || node.position.y > parentHeight;
    return savedAsAbsolute ? node.position : { x: parentPosition.x + node.position.x, y: parentPosition.y + node.position.y };
  };
  const frames = nodes.filter((node) => node.data.kind === "container");
  return nodes.map((node) => {
    if (node.data.kind === "container") return node;
    const position = absolute(node), width = Number(node.style?.width ?? node.data.width ?? 170), height = Number(node.style?.height ?? node.data.height ?? 76);
    const frame = frames.find((candidate) => {
      if (candidate.id === node.id) return false;
      const framePosition = absolute(candidate), frameWidth = Number(candidate.style?.width ?? candidate.data.width ?? 330), frameHeight = Number(candidate.style?.height ?? candidate.data.height ?? 220);
      return position.x >= framePosition.x && position.y >= framePosition.y && position.x + width <= framePosition.x + frameWidth && position.y + height <= framePosition.y + frameHeight;
    });
    if (!frame) return node.parentId ? { ...node, parentId: undefined, extent: undefined, position } : node;
    const framePosition = absolute(frame);
    return { ...node, parentId: frame.id, extent: "parent" as const, position: { x: position.x - framePosition.x, y: position.y - framePosition.y } };
  });
}

function loadSavedDiagram() {
  const saved = JSON.parse(localStorage.getItem("archboard-diagram") || "null");
  return { nodes: saved?.nodes ? normalizeLoadedNodes(saved.nodes) : initialNodes, edges: saved?.edges ?? initialEdges };
}
const projectsKey = "archboard-projects";
function readProjects(): Project[] {
  try {
    const saved = JSON.parse(localStorage.getItem(projectsKey) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* Recover by migrating the legacy diagram below. */ }
  const diagram = loadSavedDiagram(), now = Date.now();
  const project: Project = { id: `project-${now}`, name: "Untitled architecture", ...diagram, createdAt: now, updatedAt: now };
  localStorage.setItem(projectsKey, JSON.stringify([project]));
  return [project];
}
function writeProjects(projects: Project[]) {
  localStorage.setItem(projectsKey, JSON.stringify(projects));
}
function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const useDiagram = create<DiagramState>((set, get) => ({
  nodes: loadSavedDiagram().nodes,
  edges: loadSavedDiagram().edges,
  past: [],
  future: [],
  snapshot: () => {
    const s = get();
    set({
      past: [...s.past.slice(-30), { nodes: s.nodes, edges: s.edges }],
      future: [],
    });
  },
  setDiagram: (nodes, edges) => set({ nodes, edges }),
  undo: () => {
    const s = get();
    const previous = s.past.at(-1);
    if (!previous) return null;
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      past: s.past.slice(0, -1),
      future: [{ nodes: s.nodes, edges: s.edges }, ...s.future],
    });
    return previous;
  },
  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return null;
    set({
      nodes: next.nodes,
      edges: next.edges,
      future: s.future.slice(1),
      past: [...s.past, { nodes: s.nodes, edges: s.edges }],
    });
    return next;
  },
}));

function ShapeNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const update = useDiagram((s) => s.setDiagram);
  const nodes = useDiagram((s) => s.nodes),
    edges = useDiagram((s) => s.edges);
  const input = useRef<HTMLDivElement>(null);
  const updateLabel = (value: string) =>
    update(
      nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label: value } } : n,
      ),
      edges,
    );
  const content = data.html
    ? DOMPurify.sanitize(data.label)
    : data.label.replaceAll("\n", "<br />");
  return (
    <div
      className={`diagram-node ${data.kind} ${selected ? "is-selected" : ""}`}
      style={{
         background: data.kind === "text" ? "transparent" : rgba(data.fill, data.fillOpacity),
         borderColor: rgba(data.border, data.borderOpacity),
         borderWidth: data.kind === "text" || data.kind === "container" ? 0 : data.borderWidth,
        borderStyle: data.borderStyle,
        borderRadius: data.kind === "ellipse" ? "50%" : data.radius,
         color: rgba(data.textColor, data.textOpacity),
        fontFamily: data.fontFamily,
        fontSize: data.fontSize,
         fontWeight: data.fontWeight,
         textAlign: data.align,
         flexDirection: "column",
         alignItems:
           data.align === "left"
             ? "flex-start"
             : data.align === "right"
               ? "flex-end"
               : "center",
         justifyContent:
          data.vertical === "top"
            ? "flex-start"
            : data.vertical === "bottom"
              ? "flex-end"
              : "center",
        padding: `${data.padding}px ${data.paddingX ?? data.padding}px`,
        overflow: data.kind === "container" && data.clipContent ? "hidden" : "visible",
      }}
    >
      {data.kind === "container" && data.borderWidth > 0 && (
        <svg className="container-border" aria-hidden="true" width="100%" height="100%" preserveAspectRatio="none">
          <rect
            x={data.borderWidth / 2}
            y={data.borderWidth / 2}
            width={`calc(100% - ${data.borderWidth}px)`}
            height={`calc(100% - ${data.borderWidth}px)`}
            rx={data.radius}
            fill="none"
            stroke={rgba(data.border, data.borderOpacity)}
            strokeWidth={data.borderWidth}
            strokeDasharray={data.borderStyle === "dashed" ? `${data.dashLength ?? 8} ${data.dashGap ?? 5}` : undefined}
          />
        </svg>
      )}
      {selected && (
        <NodeResizer
          minWidth={60}
          minHeight={32}
          color="#1c8da5"
          lineStyle={{ borderStyle: "dashed" }}
          onResizeEnd={(_, params) =>
            update(
              nodes.map((n) =>
                n.id === id
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        width: params.width,
                        height: params.height,
                      },
                      style: {
                        ...n.style,
                        width: params.width,
                        height: params.height,
                      },
                    }
                  : n,
              ),
              edges,
            )
          }
        />
      )}
      {data.kind !== "text" && (
        <>
          <Handle type="target" position={Position.Top} />
          <Handle type="source" position={Position.Top} id="top" />
          <Handle type="target" position={Position.Bottom} id="bottom-target" />
          <Handle type="source" position={Position.Bottom} id="bottom" />
          <Handle type="target" position={Position.Left} id="left-target" />
          <Handle type="source" position={Position.Left} id="left" />
          <Handle type="target" position={Position.Right} id="right-target" />
          <Handle type="source" position={Position.Right} id="right" />
        </>
      )}
      <div
        ref={input}
        className="node-copy"
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: content }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          e.currentTarget.focus();
          const range = document.createRange();
          range.selectNodeContents(e.currentTarget);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }}
        onBlur={(e) =>
          updateLabel(
            data.html
              ? e.currentTarget.innerHTML
              : e.currentTarget.textContent || "",
          )
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && !data.html) e.preventDefault();
        }}
      />
    </div>
  );
}

function SmartEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<Edge<EdgeData>>) {
  const update = useDiagram((s) => s.setDiagram),
    nodes = useDiagram((s) => s.nodes),
    edges = useDiagram((s) => s.edges);
  const outward = (position?: Position) => position === Position.Top ? { x: 0, y: -1 } : position === Position.Bottom ? { x: 0, y: 1 } : position === Position.Left ? { x: -1, y: 0 } : { x: 1, y: 0 };
  const sourceOutward = outward(sourcePosition), targetOutward = outward(targetPosition), endpointInset = 8;
  const lineSource = { x: sourceX - sourceOutward.x * endpointInset, y: sourceY - sourceOutward.y * endpointInset }, lineTarget = { x: targetX - targetOutward.x * endpointInset, y: targetY - targetOutward.y * endpointInset }, midX = lineSource.x + (lineTarget.x - lineSource.x) / 2;
  const curveDistance = Math.max(56, Math.min(150, Math.hypot(lineTarget.x - lineSource.x, lineTarget.y - lineSource.y) * 0.34));
  const controlOne = { x: lineSource.x + sourceOutward.x * curveDistance, y: lineSource.y + sourceOutward.y * curveDistance };
  const controlTwo = { x: lineTarget.x + targetOutward.x * curveDistance, y: lineTarget.y + targetOutward.y * curveDistance };
  const path = data?.route === "orthogonal" ? `M ${lineSource.x} ${lineSource.y} L ${midX} ${lineSource.y} L ${midX} ${lineTarget.y} L ${lineTarget.x} ${lineTarget.y}` : data?.route === "free" ? `M ${lineSource.x} ${lineSource.y} C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${lineTarget.x} ${lineTarget.y}` : `M ${lineSource.x} ${lineSource.y} L ${lineTarget.x} ${lineTarget.y}`;
  const labelX = data?.route === "orthogonal" ? midX : data?.route === "free" ? (lineSource.x + 2 * controlOne.x + 2 * controlTwo.x + lineTarget.x) / 6 : lineSource.x + (lineTarget.x - lineSource.x) / 2;
  const labelY = data?.route === "orthogonal" ? (lineSource.y + lineTarget.y) / 2 - 8 : data?.route === "free" ? (lineSource.y + 2 * controlOne.y + 2 * controlTwo.y + lineTarget.y) / 6 - 8 : lineSource.y + (lineTarget.y - lineSource.y) / 2 - 8;
  const endAngle = data?.route === "orthogonal" ? (lineTarget.x >= midX ? 0 : 180) : data?.route === "free" ? Math.atan2(lineTarget.y - controlTwo.y, lineTarget.x - controlTwo.x) * 180 / Math.PI : Math.atan2(lineTarget.y - lineSource.y, lineTarget.x - lineSource.x) * 180 / Math.PI;
  const startAngle = data?.route === "orthogonal" ? (lineSource.x <= midX ? 180 : 0) : data?.route === "free" ? Math.atan2(lineSource.y - controlOne.y, lineSource.x - controlOne.x) * 180 / Math.PI : endAngle + 180;
  const labelAngle = data?.labelDirection === "vertical" ? 90 : data?.labelDirection === "along" ? Math.atan2(lineTarget.y - lineSource.y, lineTarget.x - lineSource.x) * 180 / Math.PI : 0;
  const arrow = (x: number, y: number, angle: number) => (
    <polygon
      points="0,0 -12,-6 -12,6"
      transform={`translate(${x} ${y}) rotate(${angle})`}
      fill={data?.stroke}
      stroke={data?.stroke}
      strokeWidth="1"
    />
  );
  const endTip = lineTarget, startTip = lineSource;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: data?.stroke,
          strokeWidth: data?.width,
          strokeDasharray: data?.dashed
            ? `${data.dash} ${data.gap}`
            : undefined,
        }}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="edge-hit-area"
      />
      {data?.arrow !== "none" && <EdgeLabelRenderer><div className="edge-arrow-overlay" style={{ left: lineTarget.x, top: lineTarget.y, background: data?.stroke, transform: `translate(-16px, -50%) rotate(${endAngle}deg)` }} /></EdgeLabelRenderer>}
      {data?.arrow === "double" && <EdgeLabelRenderer><div className="edge-arrow-overlay" style={{ left: lineSource.x, top: lineSource.y, background: data?.stroke, transform: `translate(-16px, -50%) rotate(${startAngle}deg)` }} /></EdgeLabelRenderer>}
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="edge-label nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px) rotate(${labelAngle}deg)`,
            }}
            onDoubleClick={() => {
              const label = prompt("Connector label", data.label);
              if (label !== null)
                update(
                  nodes,
                  edges.map((e) =>
                    e.id === id ? { ...e, data: { ...e.data!, label } } : e,
                  ),
                );
            }}
          >{data.labelHtml ? <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(data.label) }} /> : data.label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { shape: ShapeNode },
  edgeTypes = { smart: SmartEdge };
const shapeOptions: [ShapeKind, string, typeof Square][] = [
  ["rectangle", "Rectangle", Square],
  ["rounded", "Rounded rectangle", Box],
  ["ellipse", "Ellipse", Circle],
  ["diamond", "Diamond", Hexagon],
  ["text", "Text", Type],
  ["container", "Frame", PanelRight],
];

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [projects, setProjects] = useState(readProjects);
  useEffect(() => {
    const onPopState = () => { setPath(window.location.pathname); setProjects(readProjects()); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const projectId = path.match(/^\/project\/([^/]+)\/?$/)?.[1];
  if (!projectId) return <HomeScreen projects={projects} refresh={() => setProjects(readProjects())} />;
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    navigate("/");
    return null;
  }
  return <ReactFlowProvider><Editor key={project.id} project={project} /></ReactFlowProvider>;
}
function HomeScreen({ projects, refresh }: { projects: Project[]; refresh: () => void }) {
  const [dialog, setDialog] = useState<{ type: "rename" | "delete"; project: Project } | null>(null);
  const [draftName, setDraftName] = useState("");
  const createProject = () => {
    const now = Date.now(), project: Project = { id: `project-${now}`, name: "Untitled architecture", nodes: [], edges: [], createdAt: now, updatedAt: now };
    writeProjects([project, ...projects]);
    refresh();
    navigate(`/project/${project.id}`);
  };
  const renameProject = (project: Project) => { setDraftName(project.name); setDialog({ type: "rename", project }); };
  const duplicateProject = (project: Project) => {
    const now = Date.now(), copy: Project = { ...project, id: `project-${now}`, name: `${project.name} copy`, createdAt: now, updatedAt: now, nodes: project.nodes.map((node) => ({ ...node, id: `${node.id}-${now}` })), edges: project.edges.map((edge) => ({ ...edge, id: `${edge.id}-${now}`, source: `${edge.source}-${now}`, target: `${edge.target}-${now}` })) };
    writeProjects([copy, ...projects]);
    refresh();
  };
  const deleteProject = (project: Project) => setDialog({ type: "delete", project });
  const closeDialog = () => setDialog(null);
  const submitDialog = () => {
    if (!dialog) return;
    if (dialog.type === "rename") {
      const name = draftName.trim();
      if (!name) return;
      writeProjects(projects.map((item) => item.id === dialog.project.id ? { ...item, name, updatedAt: Date.now() } : item));
    } else writeProjects(projects.filter((item) => item.id !== dialog.project.id));
    refresh();
    closeDialog();
  };
  return <main className="project-home">
    <header className="home-header"><div className="brand-mark"><span className="brand-glyph"><Square size={18} /></span><div><strong>archboard</strong><small>systems, clearly</small></div></div><button className="primary home-create" onClick={createProject}><Plus size={16} /> New project</button></header>
    <section className="home-content"><div className="home-intro"><div><span className="eyebrow">Workspace</span><h1>Your projects</h1><p>Local architecture diagrams, ready to pick up where you left off.</p></div><span className="project-count">{projects.length} {projects.length === 1 ? "project" : "projects"}</span></div>
      <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id} onDoubleClick={() => navigate(`/project/${project.id}`)}><button className="project-preview" onClick={() => navigate(`/project/${project.id}`)}><span className="preview-frame"><span /><span /><span /></span></button><div className="project-card-body"><div><h2>{project.name}</h2><p>{project.nodes.length} elements · Edited {new Date(project.updatedAt).toLocaleDateString()}</p></div><div className="project-actions"><button title="Open project" onClick={() => navigate(`/project/${project.id}`)}>Open</button><button title="Rename project" onClick={() => renameProject(project)}>Rename</button><button title="Duplicate project" onClick={() => duplicateProject(project)}><Copy size={14} /></button><button title="Delete project" onClick={() => deleteProject(project)}><Trash2 size={14} /></button></div></div></article>)}</div>
    </section>
    {dialog && <div className="project-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}><div className="project-dialog" role="dialog" aria-modal="true"><span className="eyebrow">{dialog.type === "rename" ? "Project name" : "Delete project"}</span><h2>{dialog.type === "rename" ? "Rename project" : `Delete “${dialog.project.name}”?`}</h2>{dialog.type === "rename" ? <input autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitDialog()} /> : <p>This project and its local diagram data will be removed.</p>}<div className="project-dialog-actions"><button onClick={closeDialog}>Cancel</button><button className={dialog.type === "delete" ? "danger" : "primary"} onClick={submitDialog}>{dialog.type === "rename" ? "Save name" : "Delete project"}</button></div></div></div>}
  </main>;
}
function Editor({ project }: { project: Project }) {
  const state = useDiagram(),
    {
      snapshot,
      undo,
      redo,
      setDiagram,
    } = state;
  const [nodes, setNodes, onNodesChange] = useNodesState(project.nodes),
    [edges, setEdges, onEdgesChange] = useEdgesState(project.edges);
  const [selectedId, setSelectedId] = useState(project.nodes[0]?.id ?? ""),
    [editingName, setEditingName] = useState(false),
    [nameDraft, setNameDraft] = useState(project.name),
    [tab, setTab] = useState<"text" | "appearance" | "themes" | "connector">(
      "appearance",
    ),
    [grid, setGrid] = useState(true),
    [snap, setSnap] = useState(true),
    [leftTab, setLeftTab] = useState<"shapes" | "layers">("shapes"),
    [leftWidth, setLeftWidth] = useState(250),
    [rightWidth, setRightWidth] = useState(250),
    [exportOpen, setExportOpen] = useState(false),
    [exportFormat, setExportFormat] = useState<"png" | "svg" | "jpg" | "json">("png"),
    [exportTransparent, setExportTransparent] = useState(false),
    [exportQuality, setExportQuality] = useState(90),
    [exportDpi, setExportDpi] = useState(144),
    [exportPreview, setExportPreview] = useState("");
  const reactFlow = useReactFlow(),
    canvas = useRef<HTMLDivElement>(null),
    dropRef = useRef(false);
  const layerRoot = useRef<Root | null>(null);
  const layerHost = useRef<HTMLDivElement | null>(null);
  const undoDiagram = () => { const previous = undo(); if (previous) { setNodes(previous.nodes); setEdges(previous.edges); } };
  const redoDiagram = () => { const next = redo(); if (next) { setNodes(next.nodes); setEdges(next.edges); } };
  const saveProjectName = () => {
    const name = nameDraft.trim();
    if (name) {
      writeProjects(readProjects().map((item) => item.id === project.id ? { ...item, name, updatedAt: Date.now() } : item));
      setNameDraft(name);
    } else setNameDraft(project.name);
    setEditingName(false);
  };
  const selectLayer = (id: string) => { setSelectedId(id); setNodes((items) => items.map((item) => ({ ...item, selected: item.id === id }))); };
  useEffect(() => {
    const host = document.createElement("div");
    host.className = "layers-float-host";
    layerHost.current = host;
    const panel = document.querySelector(".left-panel");
    const footer = panel?.querySelector(".left-footer");
    if (panel && footer) panel.insertBefore(host, footer);
    else panel?.appendChild(host);
    layerRoot.current = createRoot(host);
    return () => {
      layerRoot.current?.unmount();
      host.remove();
    };
  }, []);
  useEffect(() => {
    layerRoot.current?.render(
      <LayerView
        nodes={nodes}
        selectedId={selectedId}
        select={selectLayer}
        moveToFrame={moveNodeToFrame}
      />,
    );
  }, [nodes, selectedId]);
  useEffect(() => { if (layerHost.current) layerHost.current.style.display = leftTab === "layers" ? "block" : "none"; }, [leftTab]);
  const startPanelResize = (side: "left" | "right", event: React.PointerEvent) => { const start = event.clientX, width = side === "left" ? leftWidth : rightWidth; const move = (current: PointerEvent) => { const next = Math.max(190, Math.min(420, width + (side === "left" ? current.clientX - start : start - current.clientX))); side === "left" ? setLeftWidth(next) : setRightWidth(next); }; const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); };
  useEffect(() => {
    const onDragStart = (event: DragEvent) => {
      const item = (event.target as HTMLElement).closest(".shape-item");
      if (!item) return;
      const kind = shapeOptions.find(([, label]) =>
        item.textContent?.includes(label),
      )?.[0];
      if (kind)
        event.dataTransfer?.setData("application/archboard-shape", kind);
    };
    document.addEventListener("dragstart", onDragStart);
    return () => document.removeEventListener("dragstart", onDragStart);
  }, []);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer?.getData(
        "application/archboard-shape",
      ) as ShapeKind;
      if (!kind) return;
      dropRef.current = true;
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const width = kind === "text" ? 180 : kind === "container" ? 330 : 170,
        height = kind === "text" ? 48 : kind === "container" ? 220 : 76;
      const frame = kind === "container" ? undefined : frameAt(position, width, height);
      snapshot();
      const id = `${kind}-${Date.now()}`;
      setNodes((ns) => [
        ...ns,
        {
          id,
          type: "shape",
          parentId: frame?.id,
          extent: frame ? "parent" : undefined,
          position: frame ? { x: position.x - frame.position.x, y: position.y - frame.position.y } : position,
          zIndex: kind === "container" ? 0 : 2,
          style: { width, height },
          data: { ...baseData(kind), width, height },
        },
      ]);
      setSelectedId(id);
    };
    surface.addEventListener("dragover", (event) => event.preventDefault());
    surface.addEventListener("drop", onDrop);
    return () => surface.removeEventListener("drop", onDrop);
  }, [nodes, reactFlow, setNodes, snapshot]);
  useEffect(() => {
    setDiagram(nodes, edges);
    const projects = readProjects();
    writeProjects(projects.map((item) => item.id === project.id ? { ...item, nodes, edges, updatedAt: Date.now() } : item));
    localStorage.setItem("archboard-diagram", JSON.stringify({ nodes, edges }));
  }, [nodes, edges, project.id, setDiagram]);
  const deleteSelected = () => {
    const selectedNodes = nodes
        .filter((n) => n.selected || n.id === selectedId)
        .map((n) => n.id),
      selectedEdges = edges
        .filter((e) => e.selected || e.id === selectedId)
        .map((e) => e.id);
    if (!selectedNodes.length && !selectedEdges.length) return;
    snapshot();
    setNodes((ns) => ns.filter((n) => !selectedNodes.includes(n.id)));
    setEdges((es) =>
      es.filter(
        (e) =>
          !selectedEdges.includes(e.id) &&
          !selectedNodes.includes(e.source) &&
          !selectedNodes.includes(e.target),
      ),
    );
    setSelectedId("");
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redoDiagram() : undoDiagram();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") redoDiagram();
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (
          target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
        )
          return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, nodes, edges, redoDiagram, undoDiagram, snapshot]);
  const selected = nodes.find((n) => n.id === selectedId),
    selectedEdge = edges.find((e) => e.id === selectedId);
  const absolutePosition = (node: Node<NodeData>, allNodes = nodes): { x: number; y: number } => {
    const parent = node.parentId ? allNodes.find((item) => item.id === node.parentId) : undefined;
    if (!parent) return node.position;
    const parentPosition = absolutePosition(parent, allNodes), parentWidth = Number(parent.style?.width ?? parent.data.width ?? 330), parentHeight = Number(parent.style?.height ?? parent.data.height ?? 220), savedAsAbsolute = node.position.x > parentWidth || node.position.y > parentHeight;
    return savedAsAbsolute ? node.position : { x: node.position.x + parentPosition.x, y: node.position.y + parentPosition.y };
  };
  const getExportBounds = () => {
    const items = nodes.map((node) => ({ position: absolutePosition(node), width: Number(node.style?.width ?? node.data.width ?? 170), height: Number(node.style?.height ?? node.data.height ?? 76) }));
    if (!items.length) return null;
    return { minX: Math.min(...items.map((item) => item.position.x)), minY: Math.min(...items.map((item) => item.position.y)), maxX: Math.max(...items.map((item) => item.position.x + item.width)), maxY: Math.max(...items.map((item) => item.position.y + item.height)) };
  };
  const frameAt = (position: { x: number; y: number }, width: number, height: number, ignoredId?: string) =>
    nodes.find((frame) => {
      if (frame.data.kind !== "container" || frame.id === ignoredId) return false;
      const framePosition = absolutePosition(frame);
      const frameWidth = Number(frame.style?.width ?? frame.data.width ?? 330), frameHeight = Number(frame.style?.height ?? frame.data.height ?? 220);
      const overlaps = position.x < framePosition.x + frameWidth && position.x + width > framePosition.x && position.y < framePosition.y + frameHeight && position.y + height > framePosition.y;
      return overlaps;
    });
  const arrangeFrame = (frameId: string, items: Node<NodeData>[]) => {
    const frame = items.find((item) => item.id === frameId), children = items.filter((item) => item.parentId === frameId && item.data.kind !== "container");
    if (!frame || !children.length) return items;
    const columns = frame.data.layout === "horizontal" ? children.length : frame.data.layout === "vertical" ? 1 : Math.max(1, Math.ceil(Math.sqrt(children.length))), gap = 18, padding = 24, titleSpace = 48;
    const cellWidth = Math.max(150, ...children.map((child) => Number(child.style?.width ?? child.data.width ?? 170))), cellHeight = Math.max(56, ...children.map((child) => Number(child.style?.height ?? child.data.height ?? 76)));
    const rows = Math.ceil(children.length / columns), width = padding * 2 + columns * cellWidth + (columns - 1) * gap, height = titleSpace + padding + rows * cellHeight + (rows - 1) * gap + padding;
    return items.map((item) => {
      if (item.id === frameId) return { ...item, style: { ...item.style, width, height }, data: { ...item.data, width, height } };
      const index = children.findIndex((child) => child.id === item.id);
      return index === -1 ? item : { ...item, zIndex: 2, position: { x: padding + (index % columns) * (cellWidth + gap), y: titleSpace + (Math.floor(index / columns) * (cellHeight + gap)) } };
    });
  };
  useEffect(() => {
    let next = nodes, changed = false, framesToArrange = new Set<string>();
    nodes.filter((item) => !item.parentId && item.data.kind !== "container").forEach((item) => {
      const position = absolutePosition(item), width = Number(item.style?.width ?? item.data.width ?? 170), height = Number(item.style?.height ?? item.data.height ?? 76), frame = nodes.find((candidate) => {
        if (candidate.data.kind !== "container") return false;
        const framePosition = absolutePosition(candidate), frameWidth = Number(candidate.style?.width ?? candidate.data.width ?? 330), frameHeight = Number(candidate.style?.height ?? candidate.data.height ?? 220);
        return position.x >= framePosition.x && position.y >= framePosition.y && position.x + width <= framePosition.x + frameWidth && position.y + height <= framePosition.y + frameHeight;
      });
      if (frame) {
        const framePosition = absolutePosition(frame);
        next = next.map((candidate) => candidate.id === item.id ? { ...candidate, parentId: frame.id, extent: "parent" as const, position: { x: position.x - framePosition.x, y: position.y - framePosition.y } } : candidate);
        framesToArrange.add(frame.id);
        changed = true;
      }
    });
    framesToArrange.forEach((frameId) => { next = arrangeFrame(frameId, next); });
    if (changed) setNodes(next);
  }, [nodes]);
  const moveNodeToFrame = (nodeId: string, frameId?: string) => {
    const node = nodes.find((item) => item.id === nodeId), frame = frameId ? nodes.find((item) => item.id === frameId && item.data.kind === "container") : undefined;
    if (!node || node.data.kind === "container" || node.parentId === frameId) return;
    const absolute = absolutePosition(node), framePosition = frame ? absolutePosition(frame) : undefined;
    snapshot();
    setNodes((items) => {
      let next = items.map((item) => item.id === nodeId ? { ...item, parentId: frame?.id, extent: frame ? "parent" as const : undefined, position: framePosition ? { x: absolute.x - framePosition.x, y: absolute.y - framePosition.y } : absolute } : item);
      if (frame) next = arrangeFrame(frame.id, next);
      if (node.parentId) next = arrangeFrame(node.parentId, next);
      return next;
    });
  };
  const arrangeSelectedFrame = () => {
    if (!selected || selected.data.kind !== "container") return;
    snapshot();
    setNodes((items) => arrangeFrame(selected.id, items));
  };
  const addShape = useCallback(
    (kind: ShapeKind, pos = { x: 240, y: 160 }) => {
      if (dropRef.current) {
        dropRef.current = false;
        return;
      }
      snapshot();
      const id = `${kind}-${Date.now()}`;
      const width = kind === "text" ? 180 : kind === "container" ? 330 : 170,
        height = kind === "text" ? 48 : kind === "container" ? 220 : 76;
      const selectedFrame = selected?.data.kind === "container" ? selected : undefined;
      const selectedFramePosition = selectedFrame ? absolutePosition(selectedFrame) : undefined;
      const absolute = selectedFramePosition ? { x: selectedFramePosition.x + 24, y: selectedFramePosition.y + 56 } : pos;
      const node: Node<NodeData> = {
        id,
        type: "shape",
        parentId: selectedFrame && kind !== "container" ? selectedFrame.id : undefined,
        extent: selectedFrame && kind !== "container" ? "parent" : undefined,
        position: selectedFrame && kind !== "container" ? { x: 24, y: 56 } : absolute,
        zIndex: kind === "container" ? 0 : 2,
        style: { width, height },
        data: { ...baseData(kind), width, height },
      };
      setNodes((ns) => selectedFrame ? arrangeFrame(selectedFrame.id, [...ns, node]) : [...ns, node]);
      setSelectedId(id);
    },
    [selected, setNodes, snapshot],
  );
  const dropShape = (event: React.DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(
      "application/archboard-shape",
    ) as ShapeKind;
    if (kind) {
      dropRef.current = true;
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const width = kind === "text" ? 180 : kind === "container" ? 330 : 170,
        height = kind === "text" ? 48 : kind === "container" ? 220 : 76;
      const frame = kind === "container" ? undefined : frameAt(position, width, height);
      const framePosition = frame ? absolutePosition(frame) : undefined;
      snapshot();
      const id = `${kind}-${Date.now()}`;
      setNodes((ns) => {
        const nextNode: Node<NodeData> = {
          id,
          type: "shape",
          parentId: frame?.id,
          extent: frame ? ("parent" as const) : undefined,
          position: framePosition ? { x: position.x - framePosition.x, y: position.y - framePosition.y } : position,
          zIndex: kind === "container" ? 0 : 2,
          style: { width, height },
          data: { ...baseData(kind), width, height },
        };
        const next = [...ns, nextNode];
        return frame ? arrangeFrame(frame.id, next) : next;
      });
      setSelectedId(id);
    }
  };
  const onConnect = useCallback(
    (connection: Connection) => {
      snapshot();
      const data: EdgeData = {
        route: "straight",
        arrow: "single",
        stroke: "#27576B",
        width: 1.5,
        dashed: false,
        dash: 6,
        gap: 5,
      };
      setEdges((es) =>
        addEdge(
          {
            ...connection,
            id: `edge-${Date.now()}`,
            type: "smart",
            data,
            markerEnd: { type: MarkerType.ArrowClosed, color: data.stroke },
          },
          es,
        ),
      );
    },
    [setEdges, snapshot],
  );
  const updateSelected = (
    patch: Partial<NodeData> & { style?: React.CSSProperties },
  ) => {
    if (!selected) return;
    snapshot();
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selected.id
          ? {
              ...n,
              data: { ...n.data, ...patch },
              style: { ...n.style, ...patch.style },
            }
          : n,
      ),
    );
  };
  const updateEdge = (patch: Partial<EdgeData>) => {
    if (!selectedEdge) return;
    snapshot();
    setEdges((es) =>
      es.map((e) =>
        e.id === selectedEdge.id
          ? {
              ...e,
              data: { ...e.data!, ...patch },
              markerStart:
                patch.arrow === "double"
                  ? {
                      type: MarkerType.ArrowClosed,
                      color: patch.stroke ?? e.data?.stroke,
                    }
                  : undefined,
              markerEnd:
                patch.arrow === "none"
                  ? undefined
                  : {
                      type: MarkerType.ArrowClosed,
                      color: patch.stroke ?? e.data?.stroke,
                    },
            }
          : e,
      ),
    );
  };
  const groupSelected = () => {
    const selectedNodes = nodes.filter(
      (n) => n.selected && n.data.kind !== "container",
    );
    if (!selectedNodes.length) return;
    snapshot();
    const left = Math.min(...selectedNodes.map((n) => n.position.x)) - 24,
      top = Math.min(...selectedNodes.map((n) => n.position.y)) - 44,
      right =
        Math.max(
          ...selectedNodes.map(
            (n) => n.position.x + Number(n.style?.width ?? n.data.width ?? 170),
          ),
        ) + 24,
      bottom =
        Math.max(
          ...selectedNodes.map(
            (n) =>
              n.position.y + Number(n.style?.height ?? n.data.height ?? 76),
          ),
        ) + 24;
    const id = `container-${Date.now()}`,
      container: Node<NodeData> = {
        id,
        type: "shape",
        position: { x: left, y: top },
        zIndex: 0,
        style: { width: right - left, height: bottom - top },
        data: {
          ...baseData("container", "Frame"),
          width: right - left,
          height: bottom - top,
        },
      };
    setNodes((ns) => [
      container,
      ...ns.map((n) =>
        selectedNodes.some((s) => s.id === n.id)
          ? {
              ...n,
              parentId: id,
              extent: "parent" as const,
              position: { x: n.position.x - left, y: n.position.y - top },
            }
          : n,
      ),
    ]);
    setSelectedId(id);
  };
  const ungroupSelected = () => {
    if (!selected || selected.data.kind !== "container") return;
    snapshot();
    const parent = selected.position;
    setNodes((ns) =>
      ns
        .filter((n) => n.id !== selected.id)
        .map((n) =>
          n.parentId === selected.id
            ? {
                ...n,
                parentId: undefined,
                position: {
                  x: n.position.x + parent.x,
                  y: n.position.y + parent.y,
                },
              }
            : n,
        ),
    );
    setSelectedId("");
  };
  const handleNodeDragStop = (_event: MouseEvent | TouchEvent, node: Node<NodeData>) => {
    if (node.data.kind === "container") return;
    const currentParent = node.parentId ? nodes.find((item) => item.id === node.parentId) : undefined;
    const parentPosition = currentParent ? absolutePosition(currentParent) : { x: 0, y: 0 };
    const renderedPosition = (node as Node<NodeData> & { positionAbsolute?: { x: number; y: number } }).positionAbsolute ?? { x: node.position.x + parentPosition.x, y: node.position.y + parentPosition.y };
    const absolute = renderedPosition;
    const width = Number(node.style?.width ?? node.data.width ?? 170), height = Number(node.style?.height ?? node.data.height ?? 76);
    const intersectingFrame = reactFlow.getIntersectingNodes(node, true).find((item) => item.data.kind === "container" && item.id !== node.id);
    const frame = intersectingFrame ? nodes.find((item) => item.id === intersectingFrame.id) : frameAt(absolute, width, height, node.id), framePosition = frame ? ((frame as Node<NodeData> & { positionAbsolute?: { x: number; y: number } }).positionAbsolute ?? absolutePosition(frame)) : undefined;
    if (frame && frame.id !== node.parentId && framePosition) { snapshot(); setNodes((items) => arrangeFrame(frame.id, items.map((item) => item.id === node.id ? { ...item, parentId: frame.id, extent: "parent" as const, position: { x: absolute.x - framePosition.x, y: absolute.y - framePosition.y } } : item))); }
    else if (!frame && node.parentId) { snapshot(); setNodes((items) => arrangeFrame(node.parentId!, items.map((item) => item.id === node.id ? { ...item, parentId: undefined, position: absolute } : item))); }
  };
  useEffect(() => { if (!exportOpen || !canvas.current) return; const bounds = getExportBounds(); if (!bounds) return; const padding = 20, width = bounds.maxX - bounds.minX + padding * 2, height = bounds.maxY - bounds.minY + padding * 2, element = canvas.current, oldWidth = element.style.width, oldHeight = element.style.height, oldFlex = element.style.flex, oldOverflow = element.style.overflow, viewport = reactFlow.getViewport(); element.classList.add("exporting"); element.style.width = `${width}px`; element.style.height = `${height}px`; element.style.flex = "0 0 auto"; element.style.overflow = "visible"; reactFlow.setViewport({ x: padding - bounds.minX, y: padding - bounds.minY, zoom: 1 }); requestAnimationFrame(() => requestAnimationFrame(() => { toPng(element, { backgroundColor: exportTransparent ? undefined : "#f8fafc", pixelRatio: 1, width, height, style: { width: `${width}px`, height: `${height}px`, flex: "0 0 auto", overflow: "visible" } }).then(setExportPreview).catch(() => setExportPreview("")).finally(() => { element.classList.remove("exporting"); element.style.width = oldWidth; element.style.height = oldHeight; element.style.flex = oldFlex; element.style.overflow = oldOverflow; reactFlow.setViewport(viewport); }); })); }, [exportOpen, exportTransparent, nodes, edges]);
  const exportImage = async (format: "png" | "svg" | "jpg" | "json" = exportFormat) => {
    if (format === "json") { exportJson(); setExportOpen(false); return; }
    if (!canvas.current) return;
    const originalViewport = reactFlow.getViewport(), originalWidth = canvas.current.style.width, originalHeight = canvas.current.style.height, originalFlex = canvas.current.style.flex, originalOverflow = canvas.current.style.overflow;
    const bounds = getExportBounds();
    if (!bounds) return;
    const padding = 20, minX = bounds.minX, minY = bounds.minY, exportWidth = Math.max(1, bounds.maxX - bounds.minX + padding * 2), exportHeight = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
    canvas.current.classList.add("exporting");
    canvas.current.style.width = `${exportWidth}px`;
    canvas.current.style.height = `${exportHeight}px`;
    canvas.current.style.flex = "0 0 auto";
    canvas.current.style.overflow = "visible";
    reactFlow.setViewport({ x: padding - minX, y: padding - minY, zoom: 1 });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const backgroundColor = exportTransparent ? undefined : "#f8fafc";
    try {
      const exportStyle = { width: `${exportWidth}px`, height: `${exportHeight}px`, flex: "0 0 auto", overflow: "visible" };
      const options = { backgroundColor, quality: exportQuality / 100, pixelRatio: exportDpi / 96, width: exportWidth, height: exportHeight, style: exportStyle };
      const data = format === "png" ? await toPng(canvas.current, options) : format === "jpg" ? await toJpeg(canvas.current, options) : await toSvg(canvas.current, { backgroundColor, width: exportWidth, height: exportHeight, style: exportStyle });
      const a = document.createElement("a");
      a.href = data;
      a.download = `archboard.${format === "jpg" ? "jpg" : format}`;
      a.click();
      setExportOpen(false);
    } finally {
      canvas.current.classList.remove("exporting");
      canvas.current.style.width = originalWidth;
      canvas.current.style.height = originalHeight;
      canvas.current.style.flex = originalFlex;
      canvas.current.style.overflow = originalOverflow;
      reactFlow.setViewport(originalViewport);
    }
  };
  const downloadSkill = async () => { const response = await fetch("/SKILL.md"); const content = response.ok ? await response.text() : "Use Archboard's nodes and edges JSON format to draft an importable architecture diagram."; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type: "text/markdown" })); a.download = "SKILL.md"; a.click(); URL.revokeObjectURL(a.href); };
  const exportJson = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify({ nodes, edges }, null, 2)], {
        type: "application/json",
      }),
    );
    a.download = "archboard-diagram.json";
    a.click();
  };
  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = JSON.parse(String(reader.result));
      setNodes(value.nodes ?? []);
      setEdges(value.edges ?? []);
    };
    reader.readAsText(file);
  };
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <span>AB</span>
          <div>
            <strong>archboard</strong>
            <small>systems, clearly</small>
          </div>
        </div>
        <div className="document-title">
          <span className="live-dot" /> {editingName ? <input className="document-title-input" autoFocus value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onBlur={saveProjectName} onKeyDown={(event) => { if (event.key === "Enter") saveProjectName(); if (event.key === "Escape") { setNameDraft(project.name); setEditingName(false); } }} /> : <button className="document-name" onClick={() => setEditingName(true)} title="Rename project">{nameDraft}</button>}{" "}
          <span className="saved">Saved locally</span>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => navigate("/")} title="Home">
            <Home size={17} />
          </button>
          <label className="icon-button" title="Import JSON">
            <Upload size={17} />
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) =>
                e.target.files?.[0] && importJson(e.target.files[0])
              }
            />
          </label>
          <button className="skill-button" onClick={downloadSkill} title="Download SKILL">
            <FileJson size={16} />
            Download SKILL
          </button>
          <button className="primary" onClick={() => setExportOpen(true)}>
            <Download size={16} />
            Export
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="left-panel" style={{ width: leftWidth, flexBasis: leftWidth }}>
          <div className="panel-tabs">
            <button className={leftTab === "shapes" ? "active" : ""} onClick={() => setLeftTab("shapes")}>Shapes</button>
            <button className={leftTab === "layers" ? "active" : ""} onClick={() => setLeftTab("layers")}>Layers</button>
          </div>
          {leftTab === "shapes" && <><div className="panel-heading">
            <div>
              <span className="eyebrow">Library</span>
              <h2>Shapes</h2>
            </div>
            <button className="quiet">
              <ChevronDown size={16} />
            </button>
          </div>
          <p className="panel-note">Drag onto the canvas or click to place.</p>
          <div className="shape-list">
            {shapeOptions.map(([kind, label, Icon]) => (
              <button
                key={kind}
                className="shape-item"
                draggable
                onDragEnd={(e) => {
                  const rect = canvas.current?.getBoundingClientRect();
                  addShape(kind, {
                    x: e.clientX - (rect?.left ?? 0),
                    y: e.clientY - (rect?.top ?? 0),
                  });
                }}
                onClick={() => addShape(kind)}
              >
                <span className={`shape-icon ${kind}`}>
                  <Icon size={18} />
                </span>
                <span>{label}</span>
                <Plus size={13} className="shape-plus" />
              </button>
            ))}
          </div></>}
          <div className="left-footer">
            <div className="hint">
              <Hand size={14} /> Space + drag to pan
            </div>
            <div className="hint">
              <MousePointer2 size={14} /> Shift + click to multi-select
            </div>
          </div>
          <div className="panel-resizer right-edge" onPointerDown={(event) => startPanelResize("left", event)} />
        </aside>
        <section className="canvas-shell">
          <div className="canvas-stage" ref={canvas}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onlyRenderVisibleElements={false}
              onNodesChange={(changes) => {
                if (
                  changes.some(
                    (c) => c.type === "position" && c.dragging === true,
                  )
                )
                  snapshot();
                onNodesChange(changes);
              }}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStop={handleNodeDragStop}
              onNodeClick={(_, n) => {
                setSelectedId(n.id);
                setTab("appearance");
              }}
              onEdgeClick={(_, e) => {
                setSelectedId(e.id);
                setTab("connector");
              }}
              onPaneClick={() => setSelectedId("")}
              panOnDrag={false}
              panActivationKeyCode="Space"
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              snapToGrid={snap}
              snapGrid={[16, 16]}
              fitView
              defaultEdgeOptions={{ type: "smart" }}
            >
              <Background
                gap={20}
                size={2}
                color={grid ? "#b8cbd0" : "transparent"}
              />
              <MiniMap
                nodeColor={(n) => (n.data as NodeData).fill}
                maskColor="rgba(248,250,252,.75)"
              />
              <Controls showInteractive={false} />
            </ReactFlow>
            <div className="canvas-history">
              <button onClick={undoDiagram} disabled={!state.past.length} title="Undo">
                <Undo2 size={15} />
              </button>
              <button onClick={redoDiagram} disabled={!state.future.length} title="Redo">
                <Redo2 size={15} />
              </button>
            </div>
          </div>
        </section>
        <aside className="right-panel" style={{ width: rightWidth, flexBasis: rightWidth }}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Inspector</span>
              <h2>
                {selectedEdge
                  ? "Connector"
                  : selected
                    ? `${selected.data.kind[0].toUpperCase()}${selected.data.kind.slice(1)}`
                    : "Properties"}
              </h2>
            </div>
            <PanelRight size={17} />
          </div>
          {selected || selectedEdge ? (
            <>
              <div className="inspector-tabs">
                {(selectedEdge
                  ? ["connector"]
                  : ["text", "appearance", "themes"]
                ).map((t) => (
                  <button
                    className={tab === t ? "active" : ""}
                    key={t}
                    onClick={() => setTab(t as typeof tab)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {selected && !selectedEdge && tab === "text" && (
                <TextPanel data={selected.data} update={updateSelected} />
              )}{" "}
              {selected && !selectedEdge && tab === "appearance" && (
                <AppearancePanel data={selected.data} update={updateSelected} arrange={arrangeSelectedFrame} />
              )}{" "}
              {selected && !selectedEdge && tab === "themes" && (
                <ThemePanel
                  apply={(t) =>
                    updateSelected({
                      fill: t.fill,
                      border: t.border,
                      textColor: t.text,
                    })
                  }
                />
              )}{" "}
              {selectedEdge && tab === "connector" && (
                <ConnectorPanel data={selectedEdge.data!} update={updateEdge} />
              )}
              <button
                className="delete-object"
                onClick={() => {
                  snapshot();
                  setNodes((ns) => ns.filter((n) => n.id !== selectedId));
                  setEdges((es) =>
                    es.filter(
                      (e) =>
                        e.id !== selectedId &&
                        e.source !== selectedId &&
                        e.target !== selectedId,
                    ),
                  );
                  setSelectedId("");
                }}
              >
                <Trash2 size={14} /> Delete selected
              </button>
            </>
          ) : (
            <div className="empty-inspector">
              <Square size={24} />
              <strong>Select an object</strong>
              <span>Properties and styling controls will appear here.</span>
            </div>
          )}
          <div className="panel-resizer left-edge" onPointerDown={(event) => startPanelResize("right", event)} />
        </aside>
      </div>
      {exportOpen && (
        <div className="export-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setExportOpen(false)}>
          <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <div className="export-dialog-head"><div><span className="eyebrow">Canvas export</span><h2 id="export-title">Export</h2></div><button className="quiet" onClick={() => setExportOpen(false)}><X size={17} /></button></div>
            {exportPreview && <div className="export-preview"><img src={exportPreview} alt="Diagram export preview" /></div>}
            <div className="export-options">
              <Field label="Format"><select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}><option value="json">JSON</option><option value="png">PNG</option><option value="svg">SVG</option><option value="jpg">JPG</option></select></Field>
              <Field label="DPI"><select value={exportDpi} onChange={(e) => setExportDpi(+e.target.value)}><option value="96">96 DPI</option><option value="144">144 DPI</option><option value="192">192 DPI</option><option value="300">300 DPI</option></select></Field>
              {exportFormat !== "json" && <><Field label="Quality"><input type="range" min="40" max="100" value={exportQuality} onChange={(e) => setExportQuality(+e.target.value)} /><b>{exportQuality}%</b></Field><label className="export-check"><input type="checkbox" checked={exportTransparent} onChange={(e) => setExportTransparent(e.target.checked)} /> Transparent background</label></>}
            </div>
            <p className="helper">Preview shows the diagram artwork before download. JSON exports the complete editable structure; PNG, JPG, and SVG exclude editor controls.</p>
            <div className="export-actions"><button onClick={() => setExportOpen(false)}>Cancel</button><button className="primary" onClick={() => exportImage()}><Download size={15} /> Download {exportFormat.toUpperCase()}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function hexToHsv(value: string) {
  const hex = value.replace("#", "").padEnd(6, "0");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s: max ? (delta / max) * 100 : 0, v: max * 100 };
}
function hsvToHex(h: number, s: number, v: number) {
  const c = (v / 100) * (s / 100), x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v / 100 - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
function rgba(hex: string, opacity = 100) {
  const clean = hex.replace("#", "").padEnd(6, "0");
  return `rgba(${parseInt(clean.slice(0, 2), 16)}, ${parseInt(clean.slice(2, 4), 16)}, ${parseInt(clean.slice(4, 6), 16)}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}
function ColorPicker({ value, opacity = 100, onChange }: { value: string; opacity?: number; onChange: (color: string, opacity: number) => void }) {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ left: 12, top: 12 });
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [alpha, setAlpha] = useState(opacity);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setHsv(hexToHsv(value)); setAlpha(opacity); }, [value, opacity]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as unknown as globalThis.Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const update = (next: Partial<typeof hsv>, nextAlpha = alpha) => {
    const nextHsv = { ...hsv, ...next };
    setHsv(nextHsv);
    setAlpha(nextAlpha);
    onChange(hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v), nextAlpha);
  };
  const setFromPointer = (event: React.PointerEvent<HTMLDivElement>, mode: "sv" | "hue" | "alpha") => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    if (mode === "sv") update({ s: ratio * 100, v: 100 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 100 });
    else if (mode === "hue") update({ h: ratio * 360 });
    else update({}, ratio * 100);
  };
  const togglePicker = () => {
    if (!open && root.current) {
      const rect = root.current.getBoundingClientRect();
      const width = 264;
      const height = 330;
      setPopoverPosition({
        left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width)),
        top: rect.bottom + 8 + height > window.innerHeight ? Math.max(12, rect.top - height - 8) : rect.bottom + 8,
      });
    }
    setOpen(!open);
  };
  return <div className="color-picker" ref={root}>
    <button className="color-swatch" type="button" aria-label="Open color picker" onClick={togglePicker}>
      <span style={{ background: rgba(value, opacity) }} />
    </button>
    {open && <div className="color-popover" style={{ left: popoverPosition.left, top: popoverPosition.top }}>
      <div className="color-surface" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setFromPointer(event, "sv"); }} onPointerMove={(event) => { if (event.buttons) setFromPointer(event, "sv"); }}>
        <span className="color-picker-handle" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
      </div>
      <div className="color-control-row">
        <Pipette size={16} />
        <div className="color-hue" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setFromPointer(event, "hue"); }} onPointerMove={(event) => { if (event.buttons) setFromPointer(event, "hue"); }}><span className="color-picker-handle" style={{ left: `${hsv.h / 3.6}%` }} /></div>
      </div>
      <div className="color-alpha" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setFromPointer(event, "alpha"); }} onPointerMove={(event) => { if (event.buttons) setFromPointer(event, "alpha"); }}><span style={{ background: rgba(hsvToHex(hsv.h, hsv.s, hsv.v), alpha) }} /><i className="color-picker-handle" style={{ left: `${alpha}%` }} /></div>
      <div className="color-value-row">
        <select aria-label="Color format" defaultValue="hex"><option value="hex">Hex</option></select>
        <input aria-label="Hex color" value={hsvToHex(hsv.h, hsv.s, hsv.v)} onChange={(event) => { const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`; if (/^#[0-9a-f]{6}$/i.test(next)) { setHsv(hexToHsv(next)); onChange(next.toUpperCase(), alpha); } }} />
        <input aria-label="Opacity" type="number" min="0" max="100" value={Math.round(alpha)} onChange={(event) => update({}, Math.max(0, Math.min(100, +event.target.value)))} />
        <span>%</span>
      </div>
    </div>}
  </div>;
}
type NodeUpdate = (
  p: Partial<NodeData> & { style?: React.CSSProperties },
) => void;
function TextPanel({ data, update }: { data: NodeData; update: NodeUpdate }) {
  const [html, setHtml] = useState(data.html);
  return (
    <div className="inspector-content">
      <div className="segmented">
        <button
          className={!html ? "active" : ""}
          onClick={() => {
            setHtml(false);
            update({ html: false });
          }}
        >
          Text
        </button>
        <button
          className={html ? "active" : ""}
          onClick={() => {
            setHtml(true);
            update({ html: true });
          }}
        >
          HTML source
        </button>
      </div>
      <Field label="Content">
        <textarea
          value={data.label}
          onChange={(e) => update({ label: e.target.value })}
          rows={6}
        />
      </Field>
      <p className="helper">
        HTML is sanitized with DOMPurify. Use &lt;strong&gt;, &lt;em&gt;,
        &lt;u&gt;, &lt;p&gt;, lists, links and line breaks.
      </p>
      <Field label="Font family">
        <select
          value={data.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
        >
          {[
            "Arial",
            "Inter",
            "Roboto",
            "Georgia",
            "Times New Roman",
            "Verdana",
            "Courier New",
          ].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </Field>
      <div className="two-col">
        <Field label="Size">
          <input
            type="number"
            value={data.fontSize}
            onChange={(e) => update({ fontSize: +e.target.value })}
          />
        </Field>
        <Field label="Weight">
          <select
            value={data.fontWeight}
            onChange={(e) => update({ fontWeight: +e.target.value })}
          >
            <option value="400">Regular</option>
            <option value="600">Semibold</option>
            <option value="700">Bold</option>
          </select>
        </Field>
      </div>
      <div className="section-label">Alignment</div>
      <div className="align-row">
        <button
          className={data.align === "left" ? "active" : ""}
          onClick={() => update({ align: "left" })}
          title="Align left"
        >
          <AlignLeft size={16} />
        </button>
        <button
          className={data.align === "center" ? "active" : ""}
          onClick={() => update({ align: "center" })}
          title="Align center"
        >
          <AlignCenter size={16} />
        </button>
        <button
          className={data.align === "right" ? "active" : ""}
          onClick={() => update({ align: "right" })}
          title="Align right"
        >
          <AlignRight size={16} />
        </button>
        <span className="align-divider" />
        <button className={data.vertical === "top" ? "active" : ""} onClick={() => update({ vertical: "top" })} title="Align top">
          <AlignVerticalJustifyStart size={16} />
        </button>
        <button className={data.vertical === "center" ? "active" : ""} onClick={() => update({ vertical: "center" })} title="Align middle">
          <AlignVerticalJustifyCenter size={16} />
        </button>
        <button className={data.vertical === "bottom" ? "active" : ""} onClick={() => update({ vertical: "bottom" })} title="Align bottom">
          <AlignVerticalJustifyEnd size={16} />
        </button>
      </div>
    </div>
  );
}
function AppearancePanel({
  data,
  update,
  arrange,
}: {
  data: NodeData;
  update: NodeUpdate;
  arrange: () => void;
}) {
  return (
    <div className="inspector-content">
      <div className="color-row">
        <Field label="Fill">
          <ColorPicker value={data.fill} opacity={data.fillOpacity} onChange={(color, opacity) => update({ fill: color, fillOpacity: opacity })} />
        </Field>
        <Field label="Border">
          <ColorPicker value={data.border} opacity={data.borderOpacity} onChange={(color, opacity) => update({ border: color, borderOpacity: opacity })} />
        </Field>
        <Field label="Text">
          <ColorPicker value={data.textColor} opacity={data.textOpacity} onChange={(color, opacity) => update({ textColor: color, textOpacity: opacity })} />
        </Field>
      </div>
      <div className="two-col">
        <Field label="Width">
          <input
            type="number"
            value={data.width ?? 170}
            onChange={(e) =>
              update({
                width: +e.target.value,
                style: { width: +e.target.value },
              })
            }
          />
        </Field>
        <Field label="Height">
          <input
            type="number"
            value={data.height ?? 76}
            onChange={(e) =>
              update({
                height: +e.target.value,
                style: { height: +e.target.value },
              })
            }
          />
        </Field>
      </div>
      <Field label="Border width">
        <input
          type="range"
          min="0"
          max="5"
          step=".5"
          value={data.borderWidth}
          onChange={(e) => update({ borderWidth: +e.target.value })}
        />
        <b>{data.borderWidth}px</b>
      </Field>
      <div className="two-col">
        <Field label="Border style">
          <select
            value={data.borderStyle}
            onChange={(e) =>
              update({ borderStyle: e.target.value as NodeData["borderStyle"] })
            }
          >
            <option>solid</option>
            <option>dashed</option>
          </select>
        </Field>
        {data.kind === "container" && data.borderStyle === "dashed" && (
          <>
            <Field label="Dash length">
              <input
                type="number"
                min="1"
                value={data.dashLength ?? 8}
                onChange={(e) => update({ dashLength: Math.max(1, +e.target.value) })}
              />
            </Field>
            <Field label="Dash gap">
              <input
                type="number"
                min="1"
                value={data.dashGap ?? 5}
                onChange={(e) => update({ dashGap: Math.max(1, +e.target.value) })}
              />
            </Field>
          </>
        )}
        <Field label="Radius">
          <input
            type="number"
            value={data.radius}
            onChange={(e) => update({ radius: +e.target.value })}
          />
        </Field>
      </div>
      <Field label="Inner padding">
        <input
          type="range"
          min="0"
          max="32"
          value={data.padding}
          onChange={(e) => update({ padding: +e.target.value })}
        />
        <b>{data.padding}px</b>
      </Field>
      {data.kind === "container" && (
        <>
          <div className="section-label">Flow</div>
          <div className="segmented">
            <button className={(data.layout ?? "grid") === "free" ? "active" : ""} onClick={() => update({ layout: "free" })}>Free</button>
            <button className={(data.layout ?? "grid") === "grid" ? "active" : ""} onClick={() => update({ layout: "grid" })}>Grid</button>
            <button className={data.layout === "horizontal" ? "active" : ""} onClick={() => update({ layout: "horizontal" })}>Row</button>
            <button className={data.layout === "vertical" ? "active" : ""} onClick={() => update({ layout: "vertical" })}>Column</button>
          </div>
          <button className="arrange-frame" onClick={arrange}><Grid3X3 size={14} /> Arrange children</button>
          <label className="frame-toggle"><input type="checkbox" checked={data.clipContent ?? false} onChange={(e) => update({ clipContent: e.target.checked })} /> Clip content to frame</label>
        </>
      )}
       <div className="section-label">Alignment</div>
       <div className="align-row">
         <button className={data.align === "left" ? "active" : ""} onClick={() => update({ align: "left" })} title="Align left">
           <AlignLeft size={16} />
         </button>
         <button className={data.align === "center" ? "active" : ""} onClick={() => update({ align: "center" })} title="Align center">
           <AlignCenter size={16} />
         </button>
         <button className={data.align === "right" ? "active" : ""} onClick={() => update({ align: "right" })} title="Align right">
           <AlignRight size={16} />
         </button>
         <span className="align-divider" />
         <button className={data.vertical === "top" ? "active" : ""} onClick={() => update({ vertical: "top" })} title="Align top">
           <AlignVerticalJustifyStart size={16} />
         </button>
         <button className={data.vertical === "center" ? "active" : ""} onClick={() => update({ vertical: "center" })} title="Align middle">
           <AlignVerticalJustifyCenter size={16} />
         </button>
         <button className={data.vertical === "bottom" ? "active" : ""} onClick={() => update({ vertical: "bottom" })} title="Align bottom">
           <AlignVerticalJustifyEnd size={16} />
         </button>
       </div>
    </div>
  );
}
function ThemePanel({ apply }: { apply: (theme: Theme) => void }) {
  return (
    <div className="theme-grid">
      {themes.map((t) => (
        <button className="theme-swatch" key={t.name} onClick={() => apply(t)}>
          <span
            style={{ background: t.fill, borderColor: t.border, color: t.text }}
          />
          <small>{t.name}</small>
        </button>
      ))}
    </div>
  );
}
function ConnectorPanel({
  data,
  update,
}: {
  data: EdgeData;
  update: (p: Partial<EdgeData>) => void;
}) {
  return (
    <div className="inspector-content">
      <Field label="Label">
        <textarea
          value={data.label ?? ""}
          placeholder="e.g. HTTPS / events"
          rows={3}
          onChange={(e) => update({ label: e.target.value })}
        />
      </Field>
      <div className="segmented">
        <button className={!data.labelHtml ? "active" : ""} onClick={() => update({ labelHtml: false })}>Plain text</button>
        <button className={data.labelHtml ? "active" : ""} onClick={() => update({ labelHtml: true })}>HTML source</button>
      </div>
      <p className="helper">Supports line breaks and sanitized HTML such as &lt;strong&gt;, &lt;em&gt;, lists, links and inline formatting.</p>
      <div className="section-label">Label direction</div>
      <div className="segmented">
        <button className={(data.labelDirection ?? "horizontal") === "horizontal" ? "active" : ""} onClick={() => update({ labelDirection: "horizontal" })}>Horizontal</button>
        <button className={data.labelDirection === "along" ? "active" : ""} onClick={() => update({ labelDirection: "along" })}>Along line</button>
        <button className={data.labelDirection === "vertical" ? "active" : ""} onClick={() => update({ labelDirection: "vertical" })}>Vertical</button>
      </div>
      <div className="section-label">Arrowhead</div>
      <div className="segmented">
        <button
          className={data.arrow === "none" ? "active" : ""}
          onClick={() => update({ arrow: "none" })}
        >
          Plain
        </button>
        <button
          className={data.arrow === "single" ? "active" : ""}
          onClick={() => update({ arrow: "single" })}
        >
          Single
        </button>
        <button
          className={data.arrow === "double" ? "active" : ""}
          onClick={() => update({ arrow: "double" })}
        >
          Double
        </button>
      </div>
      <div className="section-label">Route</div>
      <div className="segmented">
        <button
          className={data.route === "straight" ? "active" : ""}
          onClick={() => update({ route: "straight" })}
        >
          Straight
        </button>
        <button
          className={data.route === "orthogonal" ? "active" : ""}
          onClick={() => update({ route: "orthogonal" })}
        >
          Elbow
        </button>
        <button
          className={data.route === "free" ? "active" : ""}
          onClick={() => update({ route: "free" })}
        >
          Free
        </button>
      </div>
      <div className="color-row">
        <Field label="Line">
          <input
            type="color"
            value={data.stroke}
            onChange={(e) => update({ stroke: e.target.value })}
          />
        </Field>
        <Field label="Width">
          <input
            type="number"
            min=".5"
            max="8"
            step=".5"
            value={data.width}
            onChange={(e) => update({ width: +e.target.value })}
          />
        </Field>
      </div>
      <Field label="Stroke">
        <select
          value={data.dashed ? "dashed" : "solid"}
          onChange={(e) => update({ dashed: e.target.value === "dashed" })}
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
        </select>
      </Field>
      {data.dashed && (
        <div className="two-col">
          <Field label="Dash length">
            <input
              type="number"
              value={data.dash}
              onChange={(e) => update({ dash: +e.target.value })}
            />
          </Field>
          <Field label="Gap">
            <input
              type="number"
              value={data.gap}
              onChange={(e) => update({ gap: +e.target.value })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function LayerView({
  nodes,
  selectedId,
  select,
  moveToFrame,
}: {
  nodes: Node<NodeData>[];
  selectedId: string;
  select: (id: string) => void;
  moveToFrame: (nodeId: string, frameId?: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const roots = nodes.filter((node) => !node.parentId).slice().reverse();
  const renderLayer = (node: Node<NodeData>, depth: number): React.ReactNode[] => [
    <button
      key={node.id}
      className={node.id === selectedId ? "active" : ""}
      style={{ paddingLeft: 9 + depth * 17 }}
      draggable
      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/archboard-layer", node.id); event.dataTransfer.setData("text/plain", node.id); }}
      onDragOver={(event) => { if (node.data.kind === "container") { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const nodeId = event.dataTransfer.getData("application/archboard-layer") || event.dataTransfer.getData("text/plain"); if (nodeId && nodeId !== node.id && node.data.kind === "container") moveToFrame(nodeId, node.id); }}
      onClick={() => select(node.id)}
    >
      <span className="layer-caret" onClick={(event) => { event.stopPropagation(); setExpanded((current) => ({ ...current, [node.id]: current[node.id] === false })); }}>{nodes.some((child) => child.parentId === node.id) ? expanded[node.id] === false ? "›" : "⌄" : ""}</span>
      <span className={`layer-tree-guide ${depth ? "visible" : ""}`} />
      <span className={`layer-dot ${node.data.kind}`} />
      <span>{node.data.label.replace(/<[^>]+>/g, "").slice(0, 22) || "Untitled"}</span>
      <small>{node.data.kind === "container" ? "FRAME" : node.data.kind.toUpperCase()}</small>
    </button>,
    ...(expanded[node.id] !== false ? nodes.filter((child) => child.parentId === node.id).slice().reverse().flatMap((child) => renderLayer(child, depth + 1)) : []),
  ];
  return (
    <div className="layers-float">
      <div className="layers-canvas-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const nodeId = event.dataTransfer.getData("application/archboard-layer"); if (nodeId) moveToFrame(nodeId); }}>Canvas</div>
      <div className="layers-float-list">
        {roots.flatMap((node) => renderLayer(node, 0))}
      </div>
    </div>
  );
}

export default App;
