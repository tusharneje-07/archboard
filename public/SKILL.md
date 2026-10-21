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

- `orthogonal`: preferred for architecture diagrams. Use for left-to-right or top-to-bottom flows.
- `straight`: preferred for a direct relationship with no routing turns.
- `free`: rendered as a curved Bezier relationship. Use for feedback loops or relationships that would otherwise cross the main flow.

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
8. Select `single`, `double`, or `none` based on the meaning of the relationship.
9. Validate JSON syntax, IDs, parent relationships, handles, and arrow direction.
10. Return only the final `{ "nodes": [], "edges": [] }` JSON object.

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
- JSON has no comments, trailing commas, undefined values, or duplicate IDs.
