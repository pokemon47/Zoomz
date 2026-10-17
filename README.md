# Zoomz — Zoomable Board proof of concept

Scrolling replaced with zooming. A moodboard you walk into: one continuous 2.5D space where boards hold their contents on their faces. Keep zooming and you step inside them, as many levels deep as the board goes. Built to answer one question: *can a first-time user understand and enjoy moving through a visual project by zooming into nested boards?*

- **Contract:** [`Zoomable_Board_POC_PRD.md`](Zoomable_Board_POC_PRD.md)
- **Visual direction:** the Zoomboard design system in [`docs/design-system/`](docs/design-system/README.md) (handoff notes in [`docs/design-handoff.md`](docs/design-handoff.md))

```
frontend/   React + TypeScript + Vite, Tailwind v4, shadcn/ui, Motion
backend/    Python 3.9+ FastAPI serving a read-only JSON fixture + bundled SVG art
docs/       Design system tokens, reference components, handoff notes
```

## Run it locally

You need **Python 3.9+** and **Node 20+**. Run each service in its own terminal.

**1. API (port 8000)**

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000
```

Check it: `curl localhost:8000/api/health` should return `{"status":"ok"}`.

**2. Frontend (port 5173)**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `http://127.0.0.1:8000`. To proxy somewhere else, set `VITE_API_PROXY_TARGET`. If the API is down, the app shows a "Couldn't reach the board" panel with **Try again**.

## Controls

There are no folders to open. Every board shows what's inside it on its face, even from far away, so you just keep moving toward what you want.

| Action | Mouse / trackpad | Keyboard |
| --- | --- | --- |
| Move closer / further | Scroll wheel, two-finger scroll, or pinch | `+` / `-` |
| Pan | Drag the floor (or the face of a board) | Arrow keys |
| Step inside a board | Keep zooming toward it | Tab to it, then Enter (flies you in) |
| Fly to a card or board | Double-click it | Enter |
| Go up a level | Breadcrumbs, or Back | Escape |
| Frame the current board | **Fit board** | `0` |
| Move a card | Drag it. Drop it on another board and it moves *into* that board, taking on that level's size. | — |
| Move a board | Drag its title strip (small boards: drag anywhere) | — |
| Add images and files | Drag them in from your desktop onto any board, paste with ⌘V, or **Add → Images & files…** | ⌘V |
| New note / board | **Add → Note / Board** (pasting plain text makes a note too) | `N` / `B` |
| Delete / undo | — | Delete, then ⌘Z |
| Change the world behind | **Scenery** picker (top right) | — |

The breadcrumb, the level badge and the floor tint always show which board you're in, and they update on their own as you zoom.

Added images and files live in memory only, as object URLs. Nothing is uploaded, and a reload restores the demo board.

## Checks

```bash
# backend: API contract, 3+ levels, ~30 images, determinism, assets
cd backend && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q

# frontend: types, unit tests, lint, production build
cd frontend && npm test && npx oxlint src && npm run build
```

## How it works

- **Scene contract.** `GET /api/demo-board` returns `{ rootBoardId, nodes[] }`, a flat list of `board`, `image` and `note` nodes. Each node has `x/y/w/h` in its **parent board's local coordinates**, plus `z`: its height above that board's floor. The Pydantic models in `backend/app/main.py` and the types in `frontend/src/lib/types.ts` are the two halves of the contract.
- **Fixture.** 8 boards over 4 levels (Summer Light → Colour story → Sunset palette → Peach tones), 34 images and 7 notes. The images are vector SVG posters, so they stay sharp at any zoom. Boards lie on the floor, prints are raised 10–46 units, and notes float at 70–120. `backend/scripts/generate_fixture.py` regenerates everything deterministically.
- **One continuous, infinitely nested space** (`frontend/src/lib/space.ts`). A board's contents are drawn on its card face, scaled into the face's content window. The camera is always expressed in one board's own frame. As soon as a child board's card covers the whole viewport, the camera re-anchors into that child; when the current board stops covering the viewport, it re-anchors into the parent. Rendering is identical on both sides of a re-anchor, so the transition is invisible and precision never runs out. Only the current room and the one around it are drawn, with off-screen culling.
- **Walking, not scaling.** The camera has an eye height (`SPACE.eye`). Something raised `z` above the floor gets a perspective boost `g = 1 / (1 − z·s / eye)`, applied about the screen centre. As you approach, notes grow faster than prints, and prints faster than the floor. The pointer adds parallax in proportion to height. When something gets close enough to reach the eye, it fades and flies past you. Raised objects cast softer, further shadows, and a light vignette darkens the edges of the room.
- **No covers.** A board always draws its contents on its face, from the root down, as soon as the card is about 56 px on screen. Below that it's just a labelled stack. Far away, a board's title floats above it as a counter-scaled chip, so it stays readable over any scenery.
- **Moving across levels.** While you drag, the deepest board under the pointer becomes the target, and the card re-parents into it live. Sizes are in each board's own units, so a card shrinks when you drag it into a board and grows when you drag it back out. A short morph (scaled about the grab point) keeps it under your pointer. On drop it's clamped inside the board's face. `localFromScreen` in `space.ts` inverts the depth projection, so raised cards track the pointer exactly.
- **Scenery** (`frontend/src/lib/scenery.ts`). Six options: Studio (the plain dotted floor), Mountains, Clouds, Forest, Dunes, Cosmos. Each is an endless stack of low-poly "theatre flats" spaced one unit apart in depth. Every e-fold of zoom moves the camera ~0.85 layers forward through the stack. Each layer is scaled by `focal / depth` about a vanishing point, hazed toward the sky colour with distance, and faded out as you walk through it. Layers are generated per index from a seeded RNG, so the world never ends and looks the same when you come back. Pans and the pointer slide near layers more than far ones. Board floors become frosted (`SPACE.faceAlpha`) so the world shows through at every depth. The choice is remembered per browser.
- **Adding things.** Drop or paste images (they keep their aspect ratio), videos (they preview inline and play up close), and any other file (a typed slab with name, size and an **Open** link up close). Things land in the board under the pointer, or in the board you're in when added from the menu, with a small pop-in. Notes and boards come from a restyled shadcn dialog.
- **Camera engine** (`frontend/src/lib/cameraEngine.ts`). Wheel input moves a target camera, and the displayed camera glides after it in log-scale, which gives the fluid feel. Pans are direct, 1:1 with the pointer. Flights for breadcrumbs, double-click and Fit interpolate across levels in a common frame. The frame loop runs only while something is moving.
- **2.5D objects.** Cards are `TactileSlab`s: a matte face, a pedestal side in a lighter tint (`*-side`), and a shadow tinted with the object's own colour. Hover tilts the card, press sinks it, drag lifts it with a tilt, and drop settles with one bounce. Board cards are real stacks (lilac + mint layers) that fan out on hover.
- **Level of detail** comes from each card's on-screen size, not a global zoom: image tile → thumbnail + caption → large image + description; note title → full text.
- **Tunables** (eye height, reveal thresholds, parallax, glide, zoom limits, tilt) all live in `frontend/src/lib/constants.ts`.
- **Reduced motion.** No glide, no flights (instant jumps), no pointer parallax, no tilt or bounce. Depth stays, but only as a static cue.

## Deliberate changes from the PRD

Product direction after the first build, which supersedes these PRD points:

- **No "open board" action.** PRD §5/§6.2 described opening a child board by double-click or an **Open board** button. Now a board's contents are drawn on its face, and you enter it simply by zooming. That reverses PRD §6.3's "child-board contents are not drawn recursively". Double-click and Enter remain as shortcuts that fly you there.
- **Infinite zoom.** PRD §6.2 asked to clamp zoom to a practical range. Zoom is now unlimited through the nesting, and only clamped inside a single board.
- **Scroll moves you through depth.** PRD §6.2 had plain scroll pan the canvas. Now every scroll moves you closer or further, and you pan by dragging.
- **Adding files (demo only).** PRD §4 ruled out uploads. To show what building a real moodboard would feel like, you can now drop, paste or pick images and files. They stay in the browser as object URLs, there's still no upload endpoint or persistence, and the backend is unchanged.
- **No covers, and a scenery backdrop.** Boards show their contents from any distance. The plain floor can be swapped for a scenery you move through. The PRD's "Studio" dotted floor is still one of the options.
- **The space is 2.5D with real parallax.** Items have heights and you approach them like walking through a room, inspired by the depth demo. It goes beyond the static slab depth of §6.5.

## Known limitations

- Everything you add or move lasts only for the current session (by design; there is no persistence or upload yet).
- A board's frame is fixed when the demo loads, so dropping many new things into a board doesn't make it grow. They're kept inside its face.
- Desktop-first. Touch panning works through pointer events, but there's no pinch-zoom gesture on touch screens and no mobile layout.
- No minimap or search (both optional or deferred in the PRD).
- Zoom is unlimited *into boards*; inside a single board you can zoom up to 14× its own scale (enough for any print to fill the screen).
- Dragging a card is approximate for strongly raised items very close to the camera (the perspective boost is taken from the moment you grab it).
- Fonts load from Google Fonts; offline, the UI falls back to system fonts.
- The frontend bundle is ~500 kB (≈160 kB gzipped). Vite warns about chunk size, but it's acceptable for a demo.

## Deployment notes (Zenith.hosting)

The frontend and API are separate, stateless, container-friendly services. Neither needs a volume or database. In production the frontend should be served as static files (`npm run build` → `frontend/dist`), with `/api` routed to the FastAPI service (`uvicorn app.main:app --host 0.0.0.0 --port 8000`). The frontend uses relative `/api` URLs by default. `VITE_API_BASE` can point it at a separate origin at build time, though that would need CORS, which the API doesn't enable today.

No `zenith-compose.yml` is included. Zenith's manifest syntax, routing, ports and environment conventions haven't been checked against its current developer guide, and the PRD asks not to guess them. **Open question for deployment:** how does Zenith route a path prefix (`/api`) from the public frontend service to a second internal service, and which port and env-var conventions does it expect?
