# Zoomz

A working desktop interaction prototype for collecting images and notes in continuously zoomable, nested boards. Includes 30 local architecture/interiors photos, five sample boards across three levels, live miniatures, cross-board arrangement, a minimap, and local persistence.

## Run locally

Use Node 22.12+ LTS or Node 24 LTS and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The separate Node API runs on port 3001. To run them separately, use `npm run dev:server` and `npm run dev:client` in two terminals. `GET /api/scene` returns the deterministic demo; `GET /api/health` returns its health status. There are no write endpoints.

The API accepts `HOST`, `PORT` and `FRONTEND_ORIGIN`. The Vite development and preview proxies accept `API_PROXY_TARGET`. For a separately hosted API, set `VITE_API_URL` to its origin before building and set the API's `FRONTEND_ORIGIN` to the frontend origin. `npm run build` produces `dist/`; `npm run preview` serves that build locally on port 4173. Keep `npm run start:server` running for its API. Hosting configuration and deployment are intentionally outside this prototype.

## Controls

- Wheel over the canvas to zoom toward the pointer. Pause briefly between board entries. Keep zooming out to reveal a parent.
- Drag empty canvas to pan. Hold Space and drag to pan over a card.
- Click to select. Drag an image, note or board frame to bring it forward and rearrange it. Right-click an item for Bring to Front, Bring Forward, Send Backward and Send to Back.
- Drag over a board's content to transfer an item into it. Drop outside a visible child boundary to move it to its parent. While dragging inside a deeply zoomed board, hold at a canvas edge for about 650ms to reveal one parent; continue dragging and release at the intended destination. Escape cancels a drag. Board transfers preserve their descendants' internal arrangements and cannot create cycles.
- Double-click to frame an image or note on the canvas, or to enter a board. Images use a contain fit with a small margin. Select an image and choose View full image for the separate viewer. Escape closes the viewer or clears selection.
- Back restores the preceding parent view. Breadcrumbs and Home return to an ancestor overview. Fit Board fits the current contents. Zoom buttons and `+` / `-` work without a wheel; `0` fits a focused canvas.
- Click the minimap to reposition the viewport. Browse items provides keyboard access to boards, images and notes. All toolbar controls and dialogs support the keyboard.
- Display contains independent Show Captions and Show Image Borders preferences. Captions are optional; toggling either preference leaves item geometry unchanged, including in previews.
- Reduce Motion defaults to the system preference. An explicit toggle is saved. Reset Demo asks for confirmation and restores hierarchy, geometry, layering and preferences. It clears only Zoomz's `zoomz:demo:v1` and `zoomz:demo:v2` storage keys.

Parent relationships, geometry, layer order and preferences are validated and saved after a short debounce. Valid v1 layouts migrate to v2 on the next save. Camera, selection, drag representations and animation state stay transient. If storage is blocked, the workspace remains usable for the session.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm audit
```

With the development servers running and Google Chrome installed, run `npm run test:browser`. Alternatively install Playwright's Chromium and change `channel` in `playwright.config.ts`. Unit tests cover framing, pointer anchoring, coordinate round trips, navigation guards, layers, transfers, hierarchy validation and storage migration. Browser tests exercise navigation, interruption, cross-board dragging, edge dwell, layers, persistence/reset, display preferences, the minimap, image dialogs, reduced motion, resizing and asset decoding.

## Sample assets

Photos are bundled in `public/images/` as 480px thumbnails and 1400px viewer images, under the [Unsplash License](https://unsplash.com/license). The license permits downloading and using these photos in this demo. No external image requests or keys are needed at runtime. The ordered photo IDs in [scripts/fetch-assets.mjs](scripts/fetch-assets.mjs) map directly to files `01` through `30`; each original source is `https://images.unsplash.com/photo-<ID>`. The script can replenish missing files. Collection titles are illustrative, not factual descriptions of the properties or their designers.

## Implementation and limitations

`shared/scene.ts` defines the validated scene. `src/lib/camera.ts` owns pure affine transforms, framing and navigation thresholds. `src/lib/layout.ts` owns hierarchy, geometry and explicit per-board layer order. The canvas renderer and controller remain independent of the API loader. Visible ancestors and siblings render at normal opacity and participate in hit testing. Rendering culls offscreen nodes, bounds preview recursion and loads sharper images only when useful. Motion drives interruptible camera travel and short drop settling. A screen-space drag representation keeps the pointer attached during parent reveal; persistent geometry changes only on release. The same transforms drive rendering, picking, transfers and the minimap.

This is a mouse-first demo with read-only bundled content. There is no import, content editing, upload or database. Transfers adapt sizes automatically; free resizing remains unsupported. Edge reveal deliberately navigates only one parent per drag. Large image assets are resized samples, not original-resolution files. Browser storage is local to one origin. The canvas is not a DOM document; use Browse items for keyboard reading and inspection. Cross-board transfers require a mouse. No frame-rate measurement or production-scale dataset validation is claimed.
