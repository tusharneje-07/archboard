# Archboard

Archboard is a local-first system architecture diagram editor for dense, technical diagrams. It uses React, TypeScript, Vite, React Flow, Zustand, DOMPurify, and html-to-image.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Production checks are available with `npm run lint` and `npm run build`.

## Authentication and persistent storage

Configure these values in `.env`:

```text
WORKOS_API_KEY=sk_test_...
WORKOS_CLIENT_ID=client_...
VITE_WORKOS_CLIENT_ID=client_...
WORKOS_API_HOSTNAME=api.workos.com
VITE_WORKOS_API_HOSTNAME=
VITE_ARCHBOARD_DEV=true
VITE_WORKOS_DEV_REDIRECT_URI=http://localhost:5173/callback
VITE_WORKOS_PROD_REDIRECT_URI=https://archboard-iota.vercel.app/callback
ARCHBOARD_SQLITE_PATH=./data/archboard.sqlite
```

In the WorkOS dashboard configure:

Staging environment:
- Configure CORS / Allowed web origin: `http://localhost:5173`
- Redirect URI: `http://localhost:5173/callback`
- Initiate login URI: `http://localhost:5173/login`
- Sign-out redirect: `http://localhost:5173`
- Allowed web origin: `http://localhost:5173`

Production environment:
- Redirect URI: `https://archboard-iota.vercel.app/callback`
- Initiate login URI: `https://archboard-iota.vercel.app/login`
- Sign-out redirect: `https://archboard-iota.vercel.app/`
- Allowed web origin: `https://archboard-iota.vercel.app`

Set `VITE_ARCHBOARD_DEV=true` for local/development and `VITE_ARCHBOARD_DEV=false` for production. Production uses `https://archboard-iota.vercel.app/` as the redirect URI and disables AuthKit `devMode`. Configure the corresponding callback, login, sign-out, and allowed-origin values in both WorkOS environments.

Authenticated projects are stored in SQLite at `data/archboard.sqlite` and cached in browser localStorage for offline/UI resilience. Each WorkOS user can create and retain 25 projects on the free tier. The API stores the existing compressed project JSON blob.

## Included

- Drag-and-drop or click-to-place architecture shapes and containers
- Editable text and sanitized HTML content
- Four-sided connection handles, orthogonal/straight routing, labels, arrows, and configurable dashes
- 20 reference-inspired themes plus per-object appearance controls
- React Flow selection, moving, resizing, zooming, panning, snapping, grid, minimap, and fit-to-screen
- LocalStorage autosave, JSON import/export, PNG/SVG export, and keyboard undo/redo/delete
- Stateless unauthenticated MCP endpoint at `/api/mcp` for generating diagram artifacts from ChatGPT or other MCP clients

## Notes

Containers support parent-child positioning in imported/initial diagrams and can be used as system boundaries. For the most reliable grouping workflow, create a container first and place child shapes over its area, then use React Flow's normal multi-selection and movement tools. PNG/SVG export captures the canvas viewport; zoom to fit before exporting for a complete diagram.

## MCP connection

The deployed MCP endpoint is:

```text
https://archboard-iota.vercel.app/api/mcp
```

It exposes the `generate_architecture_diagram` tool. The tool accepts an Archboard `{ "nodes": [], "edges": [] }` diagram and returns PNG by default. Set `format` to `svg`, `jpg`, or `json` when another format is requested. The endpoint is intentionally unauthenticated for the current deployment.
