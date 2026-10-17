# Working on Zoomz

Zoomz is a zoomable, nested moodboard application. This checkout is the authoritative implementation, not earlier Zoomz prototypes or historical specifications. Read the affected source before changing it. Prefer targeted changes, preserve unrelated work, and do not redesign the established interface without a request.

See [the codebase overview](docs/CODEBASE_OVERVIEW.md) for the module map and camera mathematics, and [README.md](README.md) for current setup/deployment commands. Historical PRDs and `docs/design-handoff.md` describe an older stage. The backend is not read-only; the app has a minimap, search, uploads, and collaboration.

## Stack and commands

- `frontend/`: React 19, TypeScript, Vite, Tailwind CSS v4, Base UI-backed shadcn components, Motion, and Lucide. The `@/` alias points to `frontend/src/`.
- `backend/`: FastAPI, SQLAlchemy, Alembic, SQLite by default, optional PostgreSQL, and filesystem-backed uploads. Runtime settings are in `backend/app/config.py`.
- Run commands in the indicated directory. There is no root package manifest. Do not mistake leftover root `node_modules` for a correctly installed frontend environment.

With dependencies already installed, use these commands in separate terminals:

```sh
cd backend
.venv/bin/uvicorn app.main:app --port 8000
```

```sh
cd frontend
npm run dev
```

Frontend checks, from `frontend/`:

```sh
npm test
npm run lint -- src
npm run build
```

`build` runs `tsc -b` before Vite. Backend tests, from `backend/`, use `.venv/bin/python -m pytest -q`. Requirements are in `requirements.txt` and `requirements-dev.txt`. Do not install or replace dependencies without task authority. Report missing tools rather than silently using incompatible ancestor packages. Production-schema changes use Alembic, not SQLite startup table creation.

## Source ownership

Frontend paths below are relative to `frontend/src/` unless otherwise stated.

- `App.tsx`, `app/router.tsx`, and `app/session.tsx` own routing and session context.
- `pages/BoardPage.tsx` loads either the public demo or a server snapshot and creates a `SceneStore`.
- `lib/types.ts` defines the flat `SceneNode` union. Nodes are independent entities linked by `parentId`, not embedded child arrays.
- `lib/scene.ts` indexes nodes. `lib/space.ts` owns mutable geometry, hierarchy indexes, projection, camera-frame conversions, and layout.
- `lib/cameraEngine.ts` owns displayed and target cameras, flights, wheel smoothing, and scenery travel.
- `components/space/SpaceCanvas.tsx` connects gestures, selection, camera, store, layout, and DOM rendering. It deliberately reads mutable external state during render.
- `lib/store.ts` owns optimistic operations, undo/redo, pending edits, uploads, and WebSocket synchronization. Persistent edits go through `SceneStore.commit()`. Gesture previews use `Space.setPos()` and temporary hierarchy changes, then commit or restore.
- `backend/app/ops.py` validates and persists node operations from both REST and WebSocket routes. Update client and server contracts together.

## Coordinate and navigation invariants

- `Cam = { b, x, y, s }`: `b` names the board coordinate frame. Floor projection is `screen = local * s + translation`, with positive uniform `s`.
- A child board maps into its parent as `parentLocal = (ax, ay) + childLocal * k`. Use `Space.frameOf()`, `toChild()`, `toParent()`, and `toFrame()` rather than duplicating conversions.
- `z` is height above a board's floor, **not stacking order**. Raised cards have perspective and pointer parallax. Drag placement must invert both through `localFromScreen()`.
- `content.frame` is a board's stable internal content window. Resizing or moving its outer card must not rearrange descendants. The demo falls back to cached child bounds when no frame exists.
- `normalize()` changes coordinate frames when board cards cover or uncover the viewport. Re-anchoring must preserve equivalent screen geometry. Layout-derived `focus` drives breadcrumbs and differs from `cam.b` and selection.
- Use the existing `CameraEngine` for camera motion. Keep direct manipulation responsive, stop or redirect flights on new input, and preserve system reduced-motion behavior.
- Keep `Space.index.byId`, `children`, live positions, and cached frames consistent. `setParent()` itself does not validate hierarchy cycles. Gesture targeting and server operations supply those checks.

## Rendering, appearance, and persistence

The main canvas is transformed HTML, not Canvas2D or WebGL. An on-demand animation loop triggers React renders and `layout()` computes screen-space items. Keep culling, size-based detail, thumbnail selection, and short-lived drag transforms intact. Do not introduce another camera owner or assume camera changes bypass React.

Preserve the matte pastel slabs, tinted pedestal shadows, warm dotted floors, neutral image mats, lilac/mint board stacks, and scenery. Runtime styling lives in `frontend/src/styles/tokens.css`, `frontend/src/styles/zoomboard.css`, and `frontend/src/index.css`. `docs/design-system/` is a reference, not a guarantee of current behavior. Reuse the Zoomboard controls and Base UI patterns. Keep outer geometry transforms separate from inner tactile Motion transforms.

Live scenes persist in the backend database and file storage. Demo edits and undo history are memory-only. Local storage holds `zoomz.scenery` and `zoomz.panel.v2.*` panel positions, not scene layouts. Pending offline edits do not survive reload. Never treat real account data as disposable fixture data.

## Expectations for changes

Add focused tests for changes to geometry, hierarchy, navigation, or synchronization. Existing frontend tests are in `lib/scene.test.ts`; backend tests are in `backend/tests/`. Check nested entry/exit, raised-card pointer attachment, sibling navigation, cancellation, and live versus demo behavior when relevant. Run existing checks, report actual failures, and distinguish source inspection from browser verification. Do not claim measured smoothness or visual correctness without testing it. Avoid new dependencies unless necessary and authorized.

## Production deployment

Use Node 24 and Python 3.12. Backend runtime dependencies are pinned in `backend/requirements.lock`. The root Dockerfile packages nginx, the compiled frontend, and Uvicorn in one app image to meet Zenith's single-build contract. `compose.production.yml` is the operator variant; `zenith-compose.yml` uses the verified published schema and explicit SMTP built-in aliases. Container startup checks mounted storage, migrates, and starts one backend worker. Do not add replicas: rooms/rate limits are process-local. Never expose backend/database ports publicly or delete real data volumes.

Production requires explicit PostgreSQL, HTTPS `PUBLIC_URL`, persistent `STORAGE_DIR`, a stable secret, and instance SMTP settings. All mail uses `app/mail.py`; errors must stay generic and must not log bodies, credentials, or auth links. Development links exist only in development responses. Durable WebSocket edits recheck current access; transient drag/presence data is validated before relay. Preserve these boundaries.

`deploy/backup.py` creates paired database/media archives and restores only into empty recovery targets. `deploy/container_check.py` is test-data setup for disposable CI projects only, guarded by `ZOOMZ_CONTAINER_TEST=1`. Do not run it on real instances. Follow README acceptance checks, confirm independent backups and actual Zenith SMTP delivery, and verify server admission before claiming deployment readiness. npm Zenith CLI 0.1.4 rejects the production manifest's env/storage blocks under its stricter preview policy; do not remove essential production configuration to obtain a preview pass. Do not publish or deploy without explicit permission.
