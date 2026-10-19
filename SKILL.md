# Archboard Diagram JSON Skill

Use this skill when the user wants an architecture diagram drafted for import into Archboard.

## Goal

Convert a project description, repository summary, or system design into a complete Archboard JSON document. The result must be importable through Archboard's JSON import control and must preserve frames, shapes, connectors, labels, colors, and hierarchy.

## Output Contract

Return one JSON object with exactly these top-level properties:

```json
{
  "nodes": [],
  "edges": []
}
```

Do not wrap the final JSON in explanatory prose when the user asks for an import file. If the chat interface cannot create files, provide the JSON in a single fenced `json` block and tell the user to save it as `archboard-diagram.json`.

## Node Schema

Every node must use this structure:

```json
{
  "id": "unique-id",
  "type": "shape",
  "position": { "x": 100, "y": 100 },
  "style": { "width": 180, "height": 76 },
  "data": {
    "kind": "rectangle",
    "label": "Component",
    "html": false,
    "fill": "#DDF4FF",
    "border": "#5B9DBB",
    "textColor": "#173746",
    "borderWidth": 1,
    "borderStyle": "solid",
    "radius": 2,
    "fontFamily": "Arial",
    "fontSize": 14,
    "fontWeight": 600,
    "align": "center",
    "vertical": "center",
    "padding": 12,
    "width": 180,
    "height": 76
  }
}
```

Allowed `data.kind` values are `rectangle`, `rounded`, `ellipse`, `diamond`, `text`, and `container`. Use `container` for Frames.

For a child inside a Frame, add `parentId` with the Frame id, set `extent` to `parent`, and make `position` relative to the Frame. Put the Frame before its children in the `nodes` array. Use `zIndex: 0` for Frames and `zIndex: 2` for children.

Frames should have a label such as `Web Application`, `Data Platform`, or `AWS VPC`, a light fill, a visible border, and enough dimensions for their children. Keep at least 24px horizontal padding and 48px top space for the Frame title.

Standalone text objects use `kind: "text"`, `html: true` only when the label contains HTML, and a transparent fill with `borderWidth: 0`.

## Edge Schema

Every connector must use:

```json
{
  "id": "source-target",
  "source": "source-node-id",
  "target": "target-node-id",
  "type": "smart",
  "sourceHandle": "right",
  "targetHandle": "left",
  "data": {
    "route": "orthogonal",
    "arrow": "single",
    "stroke": "#27576B",
    "width": 1.5,
    "dashed": false,
    "dash": 6,
    "gap": 5,
    "label": "HTTPS",
    "labelDirection": "horizontal",
    "labelHtml": false
  }
}
```

Allowed routes are `straight`, `orthogonal`, and `free`. Use `orthogonal` for architecture flows, `straight` for direct relationships, and `free` for curved relationships. Allowed arrow modes are `none`, `single`, and `double`.

Use `sourceHandle` and `targetHandle` values from `top`, `bottom`, `left`, or `right` when the connection direction is clear. Omit them only when the editor should choose the default handles.

Connector labels support multiline text with `\n`. Set `labelHtml: true` only for safe formatting such as `<strong>HTTPS</strong><br />request`; Archboard sanitizes HTML before rendering.

## Diagramming Rules

1. Start with one or more top-level Frames for major boundaries such as Browser, Web Application, Services, Data, External Systems, or Infrastructure.
2. Keep related components inside the same Frame and use `parentId` consistently.
3. Arrange children in compact rows and columns rather than scattering them.
4. Keep connectors readable and avoid crossing labels or Frame titles.
5. Use the Archboard pastel palette for ordinary components and dark teal/navy for important gateways, services, or infrastructure.
6. Use short technical labels. Put longer explanations in connector labels or standalone text objects.
7. Use stable deterministic ids derived from component names, for example `web-api`, `postgres`, and `web-frame`.
8. Every edge must reference existing node ids. Never create dangling connectors.
9. Use valid JSON only: double quotes, no comments, no trailing commas, and no JavaScript expressions.

## Project-to-Diagram Workflow

When given a project or repository description:

1. Identify users, clients, entry points, UI, APIs, workers, databases, queues, third-party services, and deployment boundaries.
2. Group those systems into Frames.
3. Place the highest-level flow left-to-right or top-to-bottom.
4. Add connectors with meaningful handles, routes, arrow modes, and labels.
5. Validate all ids, parent ids, edge references, and required properties.
6. Return only the final import-ready JSON unless the user asks for an explanation.

If important architecture information is unknown, make a conservative assumption and encode it as a clearly labeled `Annotation` text node rather than inventing infrastructure.
