# Archboard

Archboard is a local-first system architecture diagram editor for dense, technical diagrams. It uses React, TypeScript, Vite, React Flow, Zustand, DOMPurify, and html-to-image.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Production checks are available with `npm run lint` and `npm run build`.

## Included

- Drag-and-drop or click-to-place architecture shapes and containers
- Editable text and sanitized HTML content
- Four-sided connection handles, orthogonal/straight routing, labels, arrows, and configurable dashes
- 20 reference-inspired themes plus per-object appearance controls
- React Flow selection, moving, resizing, zooming, panning, snapping, grid, minimap, and fit-to-screen
- LocalStorage autosave, JSON import/export, PNG/SVG export, and keyboard undo/redo/delete

## Notes

Containers support parent-child positioning in imported/initial diagrams and can be used as system boundaries. For the most reliable grouping workflow, create a container first and place child shapes over its area, then use React Flow's normal multi-selection and movement tools. PNG/SVG export captures the canvas viewport; zoom to fit before exporting for a complete diagram.
