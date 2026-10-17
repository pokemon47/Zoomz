# Zoomboard

**A board you fall into.** Zoomboard is the design system for the zoomable, nested moodboard: a warm paper canvas you pan and dive through, populated by chunky, tactile objects that look like they could be picked up. It borrows the confidence of "not boring" software — bold colour, soft-lit 2.5D objects that look like toys and slabs on an isometric floor, springy tactile feedback — and points it at artists, designers, filmmakers, fashion people, project managers and brands.

## Principles

1. **The work is the colour; the chrome is the toy.** Images carry the board's colour. UI uses the pastel brand hues (`tomato` coral, `cobalt` periwinkle, `lemon` butter, `mint`, `lilac`) in solid, flat fields — never gradients — and only on objects you can act on.
2. **Everything raised is an object with thickness — modern skeuomorphism, not glossy.** Matte, solid faces; a pedestal side in a lighter tint of the face (`*-side`), like frosted acrylic; and a soft floor shadow tinted with the object's own colour, so each object glows faintly onto the floor. No white highlights, no gloss, no glass reflections, no outlines.
3. **Press it and it sinks; touch it and it tilts.** Press drops the slab into its side face (`press`). Hover lifts and tilts a card toward the camera (rotateX 6°, rotateY −4°). Drag lifts it higher (`lift-3`), tilts 10° and scales 1.03. All on a spring with a little overshoot.
4. **The camera is the hero animation.** Fly-ins and fly-outs are the big moment; cards never idle-animate. Reduced motion swaps flights for a 120ms fade.
5. **Always know where you are.** Each level inward tints the ground (`depth-0` → `depth-3`) and the breadcrumb repeats that tint as a coloured dot per level.

## Content & voice

Short, warm, direct. Verb-first actions: "Open board", "Fit board", "Try again". Sentence case everywhere except the display face at far zoom. No exclamation marks in errors; one is allowed in empty states. Examples: *"Couldn't reach the board. Check the server and try again."* · *"Nothing here yet — drop some inspiration in."*

## Visual foundations

- **Ground:** `canvas`, a soft off-white, with a `canvas-dot` dot grid at `space-6` pitch — a studio table, not graph paper.
- **Type:** *Bricolage Grotesque* (display, 700–800, tight tracking) for board titles and hero moments; *DM Sans* for UI and notes; *JetBrains Mono* for the zoom readout only.
- **Objects:** face + `*-side` + `cast`, `radius-md` (images, notes) or `radius-lg` (boards). A child board is a **stack**: its card sits on a `lilac` and a `mint` slab, the layers you'll fall through; on hover the stack fans open. Notes are `lemon` with a strip of masking tape (the collage nod). Level dots in breadcrumbs glow softly in their level colour.
- **Shading recipe:** face = flat colour (at most a 3% darkening toward the bottom). Depth comes only from the pedestal side and the coloured glow. Palette is pastel-but-saturated: coral, periwinkle, butter, mint, lavender — soft enough to sit beside people's images, saturated enough to feel bold.
- **Colour contrast:** `tomato`, `lemon`, `mint` and `lilac` always carry `ink` text. `cobalt` carries `on-cobalt` (ink). Never white on tomato.
- **Selection & focus:** a `cobalt` ring (`focus` width, 3px offset). Selection adds a cobalt "Open board" handle on board cards.

## Semantic zoom

| level | scale | board card | image | note |
| --- | --- | --- | --- | --- |
| far | < 0.45 | title in `board-title-far` + 4-tile mosaic | solid colour tile | title only |
| medium | 0.45–1.2 | title, count, mosaic | thumbnail + title | title |
| close | > 1.2 | full card + description | large image + caption | full body |

Cross-fade between levels in 160ms; never scale text below 11px on screen — swap levels instead.

## Motion

- Camera flight: spring, stiffness 170, damping 26 (≈ 600ms), no overshoot past the target board.
- Press: 70ms down; release on a spring with ~8% overshoot (`cubic-bezier(.34,1.56,.64,1)`, 220ms).
- Hover tilt: 320ms on the same spring. A board's stack fans out by 4px/12px per layer.
- Fly-in: the camera dives *through* the stack — the board card scales to fill the viewport while its two under-layers slide away and fade, so the transition reads as falling one level deeper.
- Drag lift: spring to `lift-3`, rotateX 10°, rotateZ 2°, scale 1.03; drop settles with one small bounce.
- LOD cross-fade: 160ms ease-out. `prefers-reduced-motion`: all flights become a 120ms fade; no tilt, no fan-out; slabs keep their thickness (depth is static, not motion).

## Iconography

Rounded 2px-stroke line icons (Lucide at stroke-width 2.25 fits) in `ink`, 18px in controls. No filled or duotone icons; colour comes from the button, not the glyph.

## Components

Button, IconButton, ZoomControls, Breadcrumbs, BoardCard, ImageCard, NoteCard, ZoomBadge, StatePanel. Spatial cards are custom; conventional controls can be shadcn/ui primitives restyled with these tokens.
