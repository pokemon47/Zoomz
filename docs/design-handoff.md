# Zoomable Board — build handoff

You are building the proof of concept described in `PRD.md`. Read it fully first; it is the contract. Visual design must follow the **Zoomboard design system** in `design-system/`.

## Read in this order
1. `PRD.md` — scope, flows, acceptance criteria. Note §6.5: 2.5D + tactile motion is a CORE feature.
2. `design-system/README.md` — principles, semantic zoom table, motion specs, shading recipe.
3. `design-system/tokens.json` (source of truth) and `design-system/tokens.css` (generated CSS variables, light + dark).
4. `design-system/components/*/README.md` — guidelines per component.
5. `design-system/components/bundle.css` + `bundle.js` — a working reference implementation (plain React.createElement, global `window.Zoomboard`). `index.d.ts` documents props.

## How to use the design system in the app
- Copy `tokens.css` into `frontend/src/styles/` and import it first in the app entry.
- Port the components to **typed React/TSX** in `frontend/src/components/zoomboard/` (Button, IconButton, ZoomControls, Breadcrumbs, BoardCard, ImageCard, NoteCard, ZoomBadge, StatePanel). Reuse the class names/CSS from `bundle.css` (move it to `zoomboard.css`) — do not ship `bundle.js` itself.
- Replace CSS hover/press transitions on cards with **Motion** (`motion/react`) springs where the PRD asks (drag lift/tilt/settle, stack fan-out, camera dive). Keep pointer position 1:1 — only the lift/tilt springs.
- shadcn/ui: map its variables with `design-system/shadcn-theme.css`. Restyle shadcn primitives (tooltip, dialog, breadcrumb) to match: matte faces, `lift-*` shadows, no outlines.
- `components/*/preview.html` and `Cover/` are visual references only; `preview.html` files assume globals and won't run standalone.

## Non-negotiables (from the design system)
- Matte flat faces. No white glossy highlights, no glass, no multi-hue gradients.
- Depth = pedestal side (`*-side`, lighter tint) + soft floor shadow tinted in the object's own colour.
- Dotted canvas (`canvas-dot`, 24px pitch). No isometric grid lines.
- Ink text on coral/butter/mint/lavender/periwinkle. Never white on coral.
- Respect `prefers-reduced-motion`: keep static depth, drop tilt/bounce/flights.
- Images stay the hero: image cards use the neutral surface + neutral shadow.

## Workflow
Follow PRD §10 implementation order. After each step, run the app and check the demo flow. Finish with the acceptance criteria in PRD §9.
