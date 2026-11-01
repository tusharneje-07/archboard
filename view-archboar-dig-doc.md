# `/view-archboard-dig` API

Upload an Archboard JSON diagram with a demo token and open it directly in presentation mode.

The route accepts `PUT` requests for uploads and `GET` requests for the presentation page. Uploaded diagrams are not persisted on the server. The upload response redirects to a URL containing the diagram payload in the URL fragment, so the presentation URL is self-contained.

## Authentication

Tokens are read from [`demo_auth_tokens.yaml`](./demo_auth_tokens.yaml).

```yaml
demo_auth_tokens:
  - token: archboard-demo-token
    description: Default Archboard demo token
  - token: archboard-demo-2026
    description: Archboard demo token for 2026
```

The `auth_token` can be supplied in any of these places:

- Multipart form field: `auth_token`
- JSON body field: `auth_token`
- Query string: `?auth_token=...`
- Header: `X-Auth-Token: ...`
- Header: `Authorization: Bearer ...`

Missing or invalid tokens return `401 Unauthorized`.

## Upload a diagram

### Multipart form request

The preferred request is `multipart/form-data` with a JSON file and the token.

```bash
curl -i -X PUT https://archboard-iota.vercel.app/view-archboard-dig \
  -F "auth_token=archboard-demo-token" \
  -F "file=@architecture.json;type=application/json"
```

Accepted file field names: `file`, `json`, `diagram_file`, or `json_file`.

On success the browser/API client receives `303 See Other` with a `Location` header like:

```text
/view-archboard-dig#data=eyJuYW1lIjoi...
```

Opening that URL renders the uploaded diagram in presentation mode.

### JSON request body

For API clients that prefer JSON, send the token and diagram directly:

```bash
curl -i -X PUT https://archboard-iota.vercel.app/view-archboard-dig \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "auth_token": "archboard-demo-token",
    "name": "Payments architecture",
    "nodes": [],
    "edges": []
  }'
```

The body can contain either:

- `diagram: { nodes, edges }`, or
- top-level `nodes` and `edges` arrays.

### JSON response

Add `Accept: application/json` or append `?response=json` to receive the view URL instead of a redirect:

```bash
curl -X PUT "https://archboard-iota.vercel.app/view-archboard-dig?response=json" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "auth_token": "archboard-demo-token",
    "name": "Payments architecture",
    "nodes": [],
    "edges": []
  }'
```

```json
{
  "ok": true,
  "name": "Payments architecture",
  "nodes": 0,
  "edges": 0,
  "viewUrl": "/view-archboard-dig#data=..."
}
```

## View a diagram

```bash
curl -i https://archboard-iota.vercel.app/view-archboard-dig
```

`GET /view-archboard-dig` serves the Archboard presentation bundle. If the URL contains a `#data=` payload, the app opens the diagram directly in presentation mode.

The presentation view for this route:

- Opens in presentation mode by default.
- Keeps the laser, pencil, highlighter, eraser, color, size, and clear controls.
- Does **not** render the presentation Exit button.

## Naming

When using multipart upload, the project title comes from the uploaded filename with the `.json` extension removed. For example, `payments-architecture.json` becomes `payments-architecture`.

For JSON requests, use the optional `name` field. If no name is provided, the title is `Uploaded architecture`.

## Limits and validation

- Maximum request body: 5 MB.
- Maximum nodes: 10,000.
- Maximum edges: 20,000.
- The diagram must contain `nodes` and `edges` arrays.
- Every node must have an `id` and a numeric `position.x` / `position.y`.
- Every edge must have string `source` and `target` values.

## Status codes

| Status | Meaning |
| --- | --- |
| `200` | JSON response returned successfully. |
| `303` | Upload accepted; redirect to the presentation URL. |
| `400` | Invalid diagram or request body. |
| `401` | Missing or invalid `auth_token`. |
| `405` | Method is not `PUT`, `GET`, or `OPTIONS`. |
| `413` | Upload exceeds the 5 MB limit. |
| `500` | Token file, presentation bundle, or unexpected server error. |

## CORS

The endpoint allows cross-origin requests from any origin and supports:

- Methods: `GET`, `PUT`, `OPTIONS`
- Headers: `Content-Type`, `Authorization`, `X-Auth-Token`

## Local development

`npm run dev` mounts the same endpoint in Vite’s development middleware. `PUT` and `OPTIONS` requests work at `http://localhost:5173/view-archboard-dig` and return open CORS headers, so a browser page served from another local port can call it directly.

## Deployment note

`vercel.json` rewrites `/view-archboard-dig` to the serverless function at `api/view-archboard-dig.ts`. The function bundles `demo_auth_tokens.yaml` and `dist/index.html` so the endpoint can validate tokens and serve the presentation shell in production.
