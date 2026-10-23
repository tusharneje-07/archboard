# Archboard Diagram JSON Skill

Use this skill when generating an architecture diagram that will be imported into Archboard.

## Output Contract

The final import file must be exactly one JSON object with exactly two top-level properties:

```json
{
  "nodes": [],
  "edges": []
}
```

Return valid JSON only when the user asks for an import file. Do not add Markdown, comments, explanations, trailing commas, or JavaScript expressions around the JSON. Every edge reference must resolve to an existing node ID.

## MCP Renderer Contract v1.1

When using Archboard through the MCP server, use the MCP contract below rather than assuming that every browser-editor field is rendered identically.

- MCP nodes use absolute canvas coordinates. `parentId` and `extent: "parent"` are ignored by the MCP renderer and produce validation warnings. Place Frame children with their absolute canvas positions.
- MCP labels are plain text. `html: true` is ignored and produces a warning.
- MCP labels are single-line. Literal `\n` or actual newline characters are replaced with a space and produce a warning. Use short labels or separate `text` nodes for multiline explanations.
- Frame labels render at the top-left with padding in MCP output. Ordinary node labels remain centered.
- Use MCP `mode: "validate"` before rendering when accuracy matters. It returns `valid`, per-field warnings, node bounding boxes, computed edge points, label anchor points, label rectangles, and overlap warnings without creating an image.
- Use MCP `format: "png"` for the default image. `filePath` writes the artifact to `/tmp` and returns `{ "path", "width", "height" }` metadata. `png_bytes: "base64"` also returns PNG image content.
- Use MCP `layout: "auto"` for deterministic rank layout. Use `layoutHints.rankDirection: "LR"` or `"TB"`; manual `position` values remain the override with `layout: "manual"`.
- MCP incremental operations are `add_node`, `move_node`, `update_node`, `remove_node`, `add_edge`, `update_edge`, and `remove_edge`.

Do not send unsupported browser-only assumptions to the MCP renderer. Always resolve validation warnings before asking for a final image.

## Node Schema

Every node uses this base structure:

```json
{
  "id": "api-gateway",
  "type": "shape",
  "position": { "x": 360, "y": 180 },
  "style": { "width": 190, "height": 76 },
  "zIndex": 2,
  "data": {
    "kind": "rounded",
    "label": "API Gateway",
    "html": false,
    "fill": "#DDF4FF",
    "border": "#5B9DBB",
    "textColor": "#173746",
    "borderWidth": 1,
    "borderStyle": "solid",
    "radius": 10,
    "fontFamily": "Arial",
    "fontSize": 14,
    "fontWeight": 600,
    "align": "center",
    "vertical": "center",
    "padding": 12,
    "width": 190,
    "height": 76
  }
}
```

### Required node properties

- `id`: unique stable string. Use deterministic IDs such as `web-api`, `postgres`, and `web-frame`.
- `type`: always `shape`.
- `position`: `{ "x": number, "y": number }`.
- `style.width` and `style.height`: the rendered dimensions in pixels.
- `data.kind`: one of `rectangle`, `rounded`, `ellipse`, `diamond`, `text`, `image`, or `container`.
- `data.label`: visible text. Use `\n` for plain-text line breaks.
- `data.html`: `false` for normal text; use `true` only for intentionally formatted, safe HTML.
- `data.fill`, `data.border`, and `data.textColor`: hex colors or `transparent`.
- `data.borderWidth`: normally `0` through `5`.
- `data.borderStyle`: `solid` or `dashed`.
- `data.radius`: corner radius in pixels.
- `data.fontFamily`, `data.fontSize`, and `data.fontWeight`.
- `data.align`: `left`, `center`, or `right`.
- `data.vertical`: `top`, `center`, or `bottom`.
- `data.padding`: inner padding in pixels.
- `data.width` and `data.height`: keep these equal to `style.width` and `style.height`.

### Optional style properties

- `fillOpacity`, `borderOpacity`, and `textOpacity`: numbers from `0` to `100`.
- `dashLength` and `dashGap`: numbers used for custom dashed container borders.
- `paddingX` and `paddingY`: optional axis-specific padding.
- `clipContent`: boolean; useful for Frames.
- `layout`: `free`, `grid`, `horizontal`, or `vertical`; used by Frames.

### Node kinds

- `rectangle`: standard rectangular component.
- `rounded`: component with rounded corners.
- `ellipse`: circular or oval component.
- `diamond`: decision or transformation component.
- `text`: standalone annotation. Use `fill: "transparent"`, `border: "transparent"`, and `borderWidth: 0`.
- `image`: image with optional text and configurable image placement.
- `container`: Frame or system boundary. Frames must be listed before their children.

### Image node properties

Image nodes use the normal node schema plus these properties:

```json
{
  "kind": "image",
  "label": "Central Database",
  "imageUrl": "https://example.com/database.svg",
  "imagePosition": "left",
  "imageFit": "contain",
  "imageSize": 42,
  "imageOpacity": 100,
  "imageRadius": 4,
  "imageSource": "url",
  "imageAssetId": "database-logo",
  "imageAssetSource": "simple-icons",
  "imageAssetName": "Database"
}
```

- `imageUrl`: remote URL, data URL, or stored asset URL.
- `imagePosition`: `left`, `right`, `top`, `bottom`, or `center`.
- `imageFit`: `contain`, `cover`, or `fill`.
- `imageSize`: image allocation percentage, normally `15` to `75`.
- `imageOpacity`: `0` to `100`.
- `imageRadius`: image corner radius in pixels.
- `imageSource`: `url`, `upload`, or `store`.
- `imageAssetId`, `imageAssetSource`, and `imageAssetName`: optional stable metadata for stored assets.

When an image has no label, use `imagePosition: "center"` to center it in the node. For a logo with text beside it, use `left` or `right`. For a logo above or below text, use `top` or `bottom`.

### Image and icon policy

Images are optional visual aids, not a requirement for architecture diagrams. Do not add images merely to make a diagram look richer.

- Add an image only when the user explicitly requests images, logos, icons, thumbnails, or visual assets.
- Add an image when an icon is part of the stated diagram requirement, for example "show the AWS logo" or "use service icons".
- Do not add images for ordinary components when the user has not requested them. A well-styled shape with a clear label is preferred.
- Never replace a required component label with an icon alone. Keep the label unless the user explicitly wants an icon-only node.
- Prefer a stable HTTPS SVG or PNG URL. Archboard renders `imageUrl` with a normal image element.
- Do not invent a URL that is likely to be unavailable. Use a known provider URL or omit the image.
- If a remote image is unavailable, the diagram must still communicate its meaning through `label`, `kind`, color, and shape.

Examples of optional icon URLs:

```json
{
  "kind": "image",
  "label": "React web client",
  "imageUrl": "https://cdn.simpleicons.org/react/61DAFB",
  "imagePosition": "left",
  "imageFit": "contain",
  "imageSize": 30,
  "imageOpacity": 100,
  "imageRadius": 4,
  "imageSource": "url"
}
```

```json
{
  "kind": "image",
  "label": "PostgreSQL",
  "imageUrl": "https://cdn.simpleicons.org/postgresql/4169E1",
  "imagePosition": "center",
  "imageFit": "contain",
  "imageSize": 55,
  "imageOpacity": 100,
  "imageRadius": 4,
  "imageSource": "url"
}
```

Use `imagePosition: "left"` or `"right"` when the label must sit beside the asset. Use `"top"` or `"bottom"` when the asset belongs above or below the label. Use `"center"` for an icon-only or image-dominant node. Keep the image allocation modest so the label remains readable.

## Frames and Hierarchy

Use `kind: "container"` for Frames and system boundaries.

```json
{
  "id": "application-frame",
  "type": "shape",
  "position": { "x": 320, "y": 80 },
  "style": { "width": 520, "height": 320 },
  "zIndex": 0,
  "data": {
    "kind": "container",
    "label": "Web Application",
    "html": false,
    "fill": "#F8FAFC",
    "border": "#597080",
    "textColor": "#173746",
    "borderWidth": 1,
    "borderStyle": "solid",
    "dashLength": 8,
    "dashGap": 5,
    "radius": 10,
    "fontFamily": "Arial",
    "fontSize": 14,
    "fontWeight": 600,
    "align": "left",
    "vertical": "top",
    "padding": 24,
    "width": 520,
    "height": 320,
    "layout": "free",
    "clipContent": false
  }
}
```

For a child inside a Frame:

- Put the Frame before the child in `nodes`.
- Set the child `parentId` to the Frame ID.
- Set the child `extent` to `parent`.
- Make the child `position` relative to the Frame, not the canvas.
- Use `zIndex: 0` for Frames and `zIndex: 2` for children.
- Leave at least `24px` horizontal padding and `48px` top space for a Frame title.
- Do not connect an edge to a nonexistent or renamed child ID.

## Edge Schema

Every connector should use this structure:

```json
{
  "id": "client-to-api",
  "source": "client",
  "target": "api-gateway",
  "type": "smart",
  "sourceHandle": "right",
  "targetHandle": "left-target",
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

### Edge fields

- `id`: unique stable string, normally `source-to-target`.
- `source`: ID of the node where the connection starts.
- `target`: ID of the node where the connection ends.
- `type`: always `smart`.
- `sourceHandle`: source-side handle ID.
- `targetHandle`: target-side handle ID.
- `data.route`: `straight`, `orthogonal`, or `free`.
- `data.arrow`: `none`, `single`, or `double`.
- `data.stroke`: hex stroke color.
- `data.width`: stroke width, normally `1` to `3`.
- `data.dashed`: boolean.
- `data.dash` and `data.gap`: dash and gap lengths when dashed.
- `data.label`: optional plain-text connector label. Use `\n` for multiline labels.
- `data.labelAt`: optional label position: `"source"`, `"mid"`, `"target"`, or a number from `0` to `1`. MCP uses this to move the label along the route.
- `data.labelDirection`: `horizontal`, `along`, or `vertical`.
- `data.labelHtml`: `false` unless safe formatting is intentionally required.

### React Flow marker properties

`markerEnd` and `markerStart` are optional serialized React Flow marker objects. Include them when you want the imported edge to carry explicit marker metadata in addition to `data.arrow`:

```json
{
  "markerEnd": { "type": "arrowclosed", "color": "#27576B" }
}
```

Use this mapping:

- `arrow: "none"`: omit both `markerStart` and `markerEnd`.
- `arrow: "single"`: omit `markerStart`; set `markerEnd` to a closed arrow marker.
- `arrow: "double"`: set both `markerStart` and `markerEnd` to closed arrow markers.

The application also renders arrow overlays from `data.arrow`, so `data.arrow` is authoritative. Keep marker metadata consistent with it. A target marker is always at the end of the semantic `source -> target` direction; it is not determined by whether the target is visually left, right, above, or below the source.

## Connector Handles and Arrow Direction

This section is mandatory. Arrow direction is determined by `source -> target`, not by the visual left/right position alone.

The custom node exposes these handles:

| Physical side | Source handle ID | Target handle ID |
| --- | --- | --- |
| Top | `top` | omit `targetHandle` |
| Bottom | `bottom` | `bottom-target` |
| Left | `left` | `left-target` |
| Right | `right` | `right-target` |

The top target handle is the default React Flow target and has no explicit ID. Do not write `targetHandle: "top"`; omit `targetHandle` for a top target.

### Correct directional templates

Client on the left, API on the right. The arrow points into the API:

```json
{
  "id": "client-to-api",
  "source": "client",
  "target": "api",
  "type": "smart",
  "sourceHandle": "right",
  "targetHandle": "left-target",
  "data": { "route": "orthogonal", "arrow": "single", "stroke": "#27576B", "width": 1.5, "dashed": false, "dash": 6, "gap": 5, "label": "Request", "labelDirection": "horizontal", "labelHtml": false }
}
```

API on the right sends a response back to the client. Reverse both node direction and handles:

```json
{
  "id": "api-to-client",
  "source": "api",
  "target": "client",
  "type": "smart",
  "sourceHandle": "left",
  "targetHandle": "right-target",
  "data": { "route": "orthogonal", "arrow": "single", "stroke": "#597080", "width": 1.5, "dashed": true, "dash": 6, "gap": 5, "label": "Response", "labelDirection": "horizontal", "labelHtml": false }
}
```

Top node sends down to a database below. The target is the database's top side, so omit `targetHandle`:

```json
{
  "id": "service-to-db",
  "source": "service",
  "target": "database",
  "type": "smart",
  "sourceHandle": "bottom",
  "data": { "route": "orthogonal", "arrow": "single", "stroke": "#27576B", "width": 1.5, "dashed": false, "dash": 6, "gap": 5, "label": "SQL", "labelDirection": "horizontal", "labelHtml": false }
}
```

Database below sends up to the service above:

```json
{
  "id": "db-to-service",
  "source": "database",
  "target": "service",
  "type": "smart",
  "sourceHandle": "top",
  "targetHandle": "bottom-target",
  "data": { "route": "straight", "arrow": "single", "stroke": "#27576B", "width": 1.5, "dashed": false, "dash": 6, "gap": 5, "label": "Results", "labelDirection": "horizontal", "labelHtml": false }
}
```

### Arrow modes

- `none`: no arrowhead.
- `single`: arrowhead at the target end only. Use this for normal flow.
- `double`: arrowheads at both source and target ends. Use this for bidirectional exchange, or use two separate edges when the two directions need different labels.

Never use `arrow: "single"` with reversed `source` and `target` just to make a visual arrow point a certain way. Make the semantic flow correct first, then choose handles from the physical geometry.

### Route modes

- `straight`: the default for a short, direct relationship between two nearby nodes. Use it when the line does not pass through another node or label. It is the least cluttered route and should be preferred whenever it is clear.
- `orthogonal`: a horizontal/vertical routed line with elbows. Use it only when a direct line would cross a node, when the diagram has a clear grid, or when a long process flow needs to stay aligned to rows and columns. Do not use it automatically for every edge. Too many orthogonal edges create parallel elbows and visual clutter.
- `free`: a curved Bezier relationship. Use it for feedback loops, return paths, exceptional paths, or relationships that must arc around the primary flow. Use it instead of adding several orthogonal bends around a dense cluster.

### Arrow route selection and anti-clutter rules

Choose the route after placing the nodes, not before. The physical route must support the semantic relationship and must not be used to compensate for poor node placement.

1. Place the primary flow in one direction, normally left-to-right for request flows or top-to-bottom for pipelines.
2. Use `straight` for a one-to-one connection when the open corridor between the nodes is clear.
3. Use `orthogonal` only for a connection that needs to leave one side and approach another side while avoiding a shape. Reserve it for the main lanes of a grid.
4. Use `free` for feedback, retry, error, response, or cross-cutting paths that would otherwise cross the primary lanes.
5. Do not create an orthogonal edge solely because it looks more architectural. Each elbow consumes space and creates another opportunity to cross a label or shape.
6. Do not route several unrelated edges through the same tiny corridor. Move nodes apart and give each lane room.
7. Keep parallel flows in separate horizontal or vertical lanes. Align their source and target handles consistently.
8. Keep a minimum visual clearance of `24px` between an edge route and any unrelated node. Use more space for a label or a dashed feedback route.
9. Prefer one edge for one semantic relationship. Do not split one relationship into multiple decorative segments.
10. Do not add duplicate edges in opposite directions unless the system genuinely has two independently meaningful flows.
11. If two nodes have a bidirectional relationship, use `double` only when both directions share the same meaning. Use two labeled single edges when request and response need separate labels or routes.
12. If a route would cross a node, first try moving the node or changing the source/target side. Only then change from `straight` to `orthogonal` or `free`.

Use these layout patterns:

- Linear pipeline: stack nodes vertically or arrange them horizontally; use `straight` or simple `orthogonal` edges in the same lane.
- Hub and spokes: place the hub centrally, give each spoke its own side or lane, and use `straight` edges where possible. Do not send all spokes through one elbow.
- Feedback loop: use one `free` edge around the outside of the flow, with a short label placed in the open outer area.
- External dependency: place the external system in a separate column and use one horizontal `straight` or `orthogonal` lane per dependency.
- Dense service graph: split the graph into Frames or subdiagrams instead of drawing every low-level relationship on one canvas.

The following is intentionally discouraged because it creates clutter:

```json
{
  "data": { "route": "orthogonal", "arrow": "single", "label": "Every tiny internal step" }
}
```

Do not label every edge by default. Label only a protocol, data type, important state transition, or user-visible meaning. An unlabeled edge is better than a label that makes the graph unreadable.

## Label Sizing and Collision Avoidance

Every connector label is a physical object with width and height. Treat it as a rectangle that must fit in the open space around its edge. Never place a label by semantic midpoint alone without checking the surrounding nodes.

Archboard renders edge labels with a compact monospace style, `3px` vertical padding, `6px` horizontal padding, a border, and a maximum width of approximately `220px`. Estimate label width before placing it:

- One short line of 10 to 24 characters usually needs about `90px` to `160px`.
- A line near the `220px` limit must be split with `\n` or shortened.
- Each additional line increases label height by roughly one text line plus vertical padding.
- `labelDirection: "horizontal"` is safest for short labels.
- Use `labelDirection: "along"` only when the edge has enough length and the rotated text will not collide with a node.
- Use `labelDirection: "vertical"` only for a deliberately vertical lane with generous clearance.

Before finalizing each labeled edge:

1. Estimate the label rectangle from its character count and line count.
2. Find the edge's label position: midpoint for `straight`, central lane for `orthogonal`, or the open middle of the curve for `free`.
3. Check that the label rectangle does not intersect the source node, target node, any unrelated node, a Frame title, another label, or another edge's arrowhead.
4. Keep at least `12px` between a label rectangle and a node border. Use `24px` when the edge is diagonal, dashed, or part of a dense cluster.
5. If the label collides, shorten it, split it with `\n`, move the nodes, change the edge side, or choose another route. Never leave it overlapping a shape.
6. If there is no safe label position, remove the label or convert the explanation into a separate `text` node placed in open space.

Good labels are short and specific:

```json
{
  "data": {
    "route": "straight",
    "arrow": "single",
    "label": "HTTPS\nJSON",
    "labelDirection": "horizontal",
    "labelHtml": false
  }
}
```

Bad labels are long sentences that force a wide box over nearby nodes:

```json
{
  "data": {
    "route": "orthogonal",
    "arrow": "single",
    "label": "This service sends the complete request payload to the gateway and waits for the response before continuing",
    "labelDirection": "horizontal",
    "labelHtml": false
  }
}
```

Use node dimensions that match the text. For ordinary components, start around `170px` to `220px` wide and `76px` to `110px` high. Increase dimensions for multiline labels rather than allowing text to touch borders. Keep at least `32px` between neighboring node rectangles before adding an edge label. For a label between two nodes, reserve the label width plus `24px` clearance as empty corridor space.

## Diagram Construction Rules

1. Identify users, clients, entry points, UI, APIs, workers, queues, databases, external services, and deployment boundaries.
2. Create Frames for major boundaries such as Browser, Web Application, Services, Data, External Systems, and Infrastructure.
3. Place the highest-level flow left-to-right or top-to-bottom.
4. Choose source and target from semantic direction, then choose handles from physical node placement.
5. Use `orthogonal` routes for primary flows and keep them from crossing labels or Frame titles.
6. Use stable deterministic IDs and never duplicate an ID.
7. Keep every edge source and target in the node ID set.
8. Keep nodes inside Frame bounds and use relative child positions.
9. Use short technical labels. Put explanations in connector labels or text nodes.
10. Use `transparent` fill and `borderWidth: 0` for annotation text.
11. Use `html: true` only for safe formatting. Archboard sanitizes displayed HTML, but generators should still avoid scripts, event handlers, and unsafe URLs.
12. Use the pastel palette for ordinary components and darker colors for gateways, infrastructure, or critical services.

## Project-to-Diagram Workflow

1. Extract the system actors and runtime components from the project description.
2. Group components into Frames and decide each Frame's dimensions before placing children.
3. Assign deterministic IDs to every node.
4. Place nodes with enough whitespace for labels and connectors.
5. Add edges only after all node IDs and positions are known.
6. For each edge, write down the semantic direction in plain language, for example `browser -> api`.
7. Select the source side and target side independently using the handle table above.
8. Select `straight`, `orthogonal`, or `free` only after checking the open corridor and possible collisions.
9. Select `single`, `double`, or `none` based on the meaning of the relationship.
10. Add labels only for information that improves comprehension; estimate each label's rectangle and check collisions.
11. Add images only when explicitly requested or when an icon is a stated requirement. Otherwise use normal shapes.
12. Validate JSON syntax, IDs, parent relationships, handles, route choice, label clearance, and arrow direction.
13. Return only the final `{ "nodes": [], "edges": [] }` JSON object.

## Preflight Checklist

- Top-level object contains only `nodes` and `edges`.
- Every node has a unique `id`, `type: "shape"`, `position`, `style`, and complete `data`.
- Every `data.kind` is allowed.
- Every `parentId` points to a `container` node.
- Every child has `extent: "parent"` and a Frame-relative position.
- Every edge has `id`, `source`, `target`, `type: "smart"`, and valid `data`.
- Every `source` and `target` exists in `nodes`.
- Every `sourceHandle` is one of `top`, `bottom`, `left`, or `right`.
- Every explicit `targetHandle` is one of `bottom-target`, `left-target`, or `right-target`.
- Top target connections omit `targetHandle`.
- `arrow: "single"` points from source to target; `arrow: "double"` is reserved for bidirectional exchange.
- Marker metadata agrees with `data.arrow`: single has only `markerEnd`, double has both markers, and none has neither.
- Routes and labels match the intended diagram flow.
- Straight edges are used when the corridor is clear; orthogonal elbows are not used by default.
- Every orthogonal edge has a reason: avoiding a shape, following a deliberate grid lane, or preserving a clear flow.
- Every labeled edge has enough empty space for the estimated label rectangle.
- No label overlaps a node, Frame title, other label, or arrowhead.
- Long labels are shortened or split with `\n`; explanatory prose is moved to a text node.
- Images and icons are absent unless requested or explicitly required; image nodes retain readable labels.
- JSON has no comments, trailing commas, undefined values, or duplicate IDs.

## MCP Tool Request Options

The MCP tool accepts the diagram plus these optional fields:

```json
{
  "diagram": { "nodes": [], "edges": [] },
  "mode": "validate",
  "format": "png",
  "filePath": "/tmp/architecture.png",
  "png_bytes": "base64",
  "layout": "manual",
  "layoutHints": { "rankDirection": "LR" },
  "operations": [
    { "op": "move_node", "id": "api", "x": 420, "y": 180 }
  ]
}
```

`mode: "validate"` is the cheapest accuracy loop. Inspect every warning before rendering. Geometry output reports each node `bbox`, each edge's `points`, `start`, `end`, and the label's `anchor`, `box`, normalized `at` value, `capacityChars`, and capacity hint. A `label_overlap` warning means the label rectangle intersects a node with clearance; fix it with `labelAt`, shorter text, a different route, or more node spacing.
