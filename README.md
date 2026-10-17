# Zoomz — Zoomable Board proof of concept

Scrolling replaced with zooming. A moodboard you fall into: pan around a warm paper floor, zoom toward anything, and dive into nested boards with a camera transition. Built to answer one question: *can a first-time user understand and enjoy moving through a visual project by zooming into nested boards?*

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

| Action | Mouse / trackpad | Keyboard |
| --- | --- | --- |
| Pan | Drag empty floor, or scroll / two-finger swipe | Arrow keys |
| Zoom toward pointer | Ctrl/⌘ + scroll, or pinch | `+` / `-` (around centre) |
| Fit board | **Fit board** button | `0` |
| Open a child board | Double-click its card, or **Open board** | Tab to the card, then Enter |
| Go back | Back button or any breadcrumb | Escape |
| Move a card | Drag it (session only, resets on reload) | — |

Semantic zoom: **far** (< 45%) shows board labels and image tiles. **Medium** shows thumbnails, captions and note titles. **Close** (> 120%) shows large images with descriptions and full note text. The small pill beside the zoom controls names the current level.

## Checks

```bash
# backend: API contract, 3+ levels, ~30 images, determinism, assets
cd backend && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q

# frontend: types, unit tests, lint, production build
cd frontend && npm test && npx oxlint src && npm run build
```

## How it works

- **Scene contract.** `GET /api/demo-board` returns `{ rootBoardId, nodes[] }`, a flat list of `board`, `image` and `note` nodes. Each node has `x/y/w/h` in its **parent board's local coordinates**. The Pydantic models in `backend/app/main.py` and the types in `frontend/src/lib/types.ts` are the two halves of the contract.
- **Fixture.** `backend/app/data/demo-board.json` has 8 boards over 4 levels (Summer Light → Colour story → Sunset palette → Peach tones), 34 images and 7 notes. The images are abstract SVG posters in `backend/app/static/art/`, served at `/api/assets/art/*`. Both come from `backend/scripts/generate_fixture.py`, which is deterministic; re-running it gives identical files. The API never writes to disk.
- **Camera.** `frontend/src/hooks/useCamera.ts` keeps translation and scale in Motion values, so panning, wheel-zoom and dragging never cause a React render per frame. Zoom keeps the point under the pointer fixed. All three axes share one spring, so animated zooms stay anchored as well.
- **Nested navigation.** `frontend/src/components/board/BoardCanvas.tsx` has three phases:
  1. The camera dives until the board card covers the viewport. The card's two under-layers slide away and its face fades to the next level's floor colour.
  2. While the screen shows only that floor, it swaps to the child's coordinate space.
  3. The child's content springs up toward you.

  Going back reverses this, and returns to the camera you left the parent at.
- **2.5D.** Cards are `TactileSlab`s: a matte face, a pedestal side in a lighter tint (`*-side`), and a soft shadow tinted with the object's own colour. Hover tilts the card (6°/−4°). Press sinks it, drag lifts it to `lift-3` with a 10° tilt and 1.03 scale, and drop settles with one bounce. Card position follows the pointer 1:1; only the lift and tilt spring. Board cards are real stacks (lilac + mint layers) that fan out on hover.
- **Tunables.** Zoom range, LOD thresholds, springs and tilt angles all live in `frontend/src/lib/constants.ts`.
- **Reduced motion.** Under `prefers-reduced-motion`, flights become a 120ms fade, and tilt, fan-out and bounce are removed. Slabs keep their static depth.

## Known limitations

- Card moves last only for the current session (by design; there is no persistence).
- Desktop-first. Touch panning works through pointer events, but there's no pinch-zoom gesture on touch screens and no mobile layout.
- No minimap or search (both optional or deferred in the PRD).
- The board doesn't refit when the window is resized; press **Fit board** (or `0`).
- Fonts load from Google Fonts; offline, the UI falls back to system fonts.
- The frontend bundle is ~500 kB (≈160 kB gzipped). Vite warns about chunk size, but it's acceptable for a demo.

## Deployment notes (Zenith.hosting)

The frontend and API are separate, stateless, container-friendly services. Neither needs a volume or database. In production the frontend should be served as static files (`npm run build` → `frontend/dist`), with `/api` routed to the FastAPI service (`uvicorn app.main:app --host 0.0.0.0 --port 8000`). The frontend uses relative `/api` URLs by default. `VITE_API_BASE` can point it at a separate origin at build time, though that would need CORS, which the API doesn't enable today.

No `zenith-compose.yml` is included. Zenith's manifest syntax, routing, ports and environment conventions haven't been checked against its current developer guide, and the PRD asks not to guess them. **Open question for deployment:** how does Zenith route a path prefix (`/api`) from the public frontend service to a second internal service, and which port and env-var conventions does it expect?
