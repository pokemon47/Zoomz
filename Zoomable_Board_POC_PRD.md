# Product Requirements Document: Zoomable Board Proof of Concept

**Status:** Draft for implementation  
**Product name:** Zoomable Board (working title)  
**Target:** Hackathon proof of concept  
**Primary validation question:** Can a first-time user understand and enjoy moving through a visual project by zooming into nested boards?

## 1. Product summary

Build a desktop-first web app where a person explores a moodboard as a continuous, zoomable space. A board contains image cards, short notes, and child boards. Users pan around, zoom toward a point, open a child board with a camera transition, and return through breadcrumbs.

This proof of concept uses a fixed demo dataset. It is intended to test the camera, nested-board navigation, and semantic zoom before investing in folder import, file storage, or persistence.

## 2. Problem and audience

Canvas tools often require people to build their layout manually. Folder trees make content easy to file but hide the visual whole. This prototype tests whether an automatically arranged visual space can help designers, students, and other creative people understand a project at both a glance and close range.

The first demo should feel like a small visual inspiration board, not a general-purpose file manager.

## 3. Goals and success measures

### Product goals

1. Make panning and zooming feel responsive, smooth, and easy to learn.
2. Show at least three nested board levels while keeping the user oriented.
3. Make zoom change the presentation of content, not just its scale.
4. Demonstrate that cards can be rearranged without reshuffling the rest of the board.
5. Keep the frontend and Python backend separate and ready for later Zenith.hosting deployment.

### Prototype success measures

- A first-time user can pan, zoom, open a child board, and return to the parent within one minute without a walkthrough.
- The user can tell which board they are viewing at all times.
- The camera remains smooth with the demo dataset on a typical laptop.
- In a short usability session, users describe the transition as useful or enjoyable and can point to a reason to use this over a folder list.

These are validation measures for the prototype, not automated release gates.

## 4. Scope

### In scope

- A single seeded moodboard with three nested levels.
- Approximately 30 image nodes distributed across the boards, plus several notes and child-board cards.
- Fixed, deterministic positions in board-local coordinates.
- Mouse or trackpad pan and zoom.
- Animated transitions into child boards and back to parent boards.
- Breadcrumb navigation and basic zoom controls.
- Semantic rendering at far, medium, and close zoom.
- Dragging a card to a new position for the current browser session.
- A separate React frontend and Python FastAPI backend.
- A small JSON-backed demo API; no database.
- A README with reliable local run and verification instructions.

### Out of scope

- Importing or watching user folders.
- Uploading, moving, or writing real files.
- Saving edits across reloads or users.
- Database, accounts, authentication, billing, or cloud sync.
- Collaboration, mobile-specific layouts, or native apps.
- Global Cmd/Ctrl-K search, visual-similarity embeddings, and auto-layout algorithms.
- PDFs, video, or arbitrary file types.
- 2.5D depth, parallax, tilt, or other spatial effects.
- Actual Zenith publishing or submission.

Do not add these features just to make the demo look more complete. The key question is whether nested camera navigation works.

## 5. Primary user flow

1. The user opens the app and lands on a populated top-level moodboard.
2. They pan the empty canvas and zoom toward an area of interest.
3. They see child boards as visual cards with a title and preview mosaic.
4. They open a child board by double-clicking its card or selecting it and using its visible **Open board** action.
5. The camera flies into that board. The breadcrumb updates to show the path.
6. They zoom closer to see image thumbnails and readable note text.
7. They drag an image or note to a new location.
8. They select a breadcrumb or use the Back control to return to a parent board.

## 6. Functional requirements

### 6.1 Scene and sample data

- The backend serves one deterministic demo scene from a JSON fixture.
- Model the scene as a flat list of nodes. Every node has:
  - **id**
  - **type**: **board**, **image**, or **note**
  - **parentId**
  - **x**, **y**, **w**, **h** in the parent board’s local coordinate system
  - **content**, with type-specific fields
- The root board has **parentId: null**. A child board is a node in its parent board; its own contents use that child board’s **id** as **parentId**.
- Use fixed positions and dimensions in the fixture. Reloading the demo must not reshuffle nodes.
- Include image alt text. Use bundled sample assets or locally created placeholder artwork; do not depend on remote image URLs or user files.
- Include at least three board levels (root, child, grandchild), approximately 30 image nodes total, and several notes with short, demo-appropriate text.
- Keep coordinates local to each board. Do not use a single unbounded coordinate system.

Suggested type shape:

~~~ts
type BaseNode = {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

type BoardNode = BaseNode & {
  type: "board";
  content: { title: string; description?: string };
};

type ImageNode = BaseNode & {
  type: "image";
  content: { title: string; src: string; alt: string };
};

type NoteNode = BaseNode & {
  type: "note";
  content: { title: string; body: string };
};

type Scene = { rootBoardId: string; nodes: Array<BoardNode | ImageNode | NoteNode> };
~~~

Adjust the exact schema only if the existing codebase requires it; keep the contract documented and consistent between Python and TypeScript.

### 6.2 Camera and navigation

- Render the current board as a two-dimensional spatial canvas.
- Pan by dragging the empty canvas. Dragging a node moves that node instead of panning.
- Normal wheel/trackpad scrolling pans the canvas. Ctrl/Cmd plus wheel zooms toward the pointer position. Provide visible zoom-in, zoom-out, and **Fit board** controls.
- Zooming must keep the point under the pointer visually anchored as scale changes.
- Clamp zoom to a practical range and prevent the page itself from scrolling while the pointer is over the canvas.
- Enter a child board by double-clicking its board card or using its **Open board** action. Animate the camera into the selected board, then render its children in that board’s local coordinate space.
- Return using a breadcrumb, Back control, or Escape. Animate back toward the selected board’s place in the parent.
- Keep a navigation path so breadcrumbs always show the current board and its ancestors.
- Avoid abrupt position jumps when changing between parent and child coordinate systems. The selected board should visually fill the viewport at the transition point.
- Use a subtle spring for fly-in/fly-out transitions. Direct pointer-driven pan and drag should follow input without a laggy spring.
- Respect **prefers-reduced-motion**: use a short fade or immediate state change instead of long camera movement.

### 6.3 Semantic zoom

Use configurable scale thresholds in one place in the frontend. Exact values can be tuned during implementation.

- **Far:** prioritize board labels and small preview mosaics. Image nodes become compact visual tiles; notes show a short title or label.
- **Medium:** show image thumbnails, board titles/previews, and note titles.
- **Close:** show larger images and the full short note text.
- Cross-fade or otherwise soften level-of-detail changes so content does not pop abruptly.
- Keep text legible and avoid rendering long note bodies at far zoom.
- Child-board contents appear after opening that board; they are not drawn recursively inside the parent board.

### 6.4 Moving cards

- Image and note cards can be dragged to new positions within the current board.
- Board cards may be repositioned as well, but must remain openable.
- Update position in the frontend’s in-memory scene state on drop. The change remains until reload; persistence is not part of this prototype.
- Moving a node must not reposition siblings or reorder the underlying fixture.

### 6.5 Orientation and controls

- Keep the current path visible in breadcrumbs.
- Provide **Back**, **Fit board**, zoom in, zoom out, and a visible current zoom percentage.
- Ensure board cards have a clear focus state and an accessible **Open board** action.
- A minimap is optional. Add it only if the main navigation works well first.
- Global search is deferred; do not let it delay the camera prototype.

### 6.6 Loading and error states

- Show a simple loading state while fetching the demo scene.
- If the API is unavailable, show a clear retry action and readable error message.
- The frontend must load its scene through the backend API rather than duplicating the fixture in UI code.

## 7. Technical requirements

### Frontend

- React + TypeScript + Vite in a dedicated **frontend/** directory.
- Use **shadcn/ui** for conventional interface controls such as buttons, tooltips, breadcrumbs, and dialogs. Keep spatial cards and the board rendering custom so the board remains visually distinct.
- Use Tailwind CSS as required by the selected shadcn setup.
- Use Motion for React (**motion** package, imports from **motion/react**) for camera transitions and small UI transitions.
- Represent camera translation and scale with Motion values so pointer-driven updates do not require a React render on every frame.
- Render the prototype scene with positioned DOM elements and CSS transforms. Do not add a canvas/WebGL engine or spatial-indexing library unless measured performance makes the DOM approach inadequate.
- Keep motion and zoom thresholds in named constants/hooks rather than scattering them across components.
- The app should work with mouse, trackpad, and keyboard. Keep the layout desktop-first.

### Backend

- Python 3 with FastAPI in a dedicated **backend/** directory.
- **GET /api/health** returns a small health response.
- **GET /api/demo-board** returns the seeded scene contract described above.
- Store demo data as a checked-in JSON fixture. The API does not write to disk.
- Keep the API path configurable or proxyable so the production frontend does not depend on a hard-coded localhost URL.
- Avoid adding a database, file-upload endpoint, or CORS complexity if the Vite development proxy can route **/api** to FastAPI.

### Suggested repository layout

~~~text
/
  frontend/
  backend/
    app/
      main.py
      data/demo-board.json
  README.md
~~~

Use the existing repository layout if one already exists. If starting from an empty directory, keep the frontend and backend independently installable and runnable.

### Zenith.hosting compatibility

Zenith.hosting is the intended future host. Keep frontend and API as separate, container-friendly services, and avoid assumptions that require a writable application container filesystem. The current prototype has no user uploads or persistent data, so it does not require a volume or database.

Do not guess Zenith’s manifest syntax or claim a deployment is ready without checking the current official developer instructions. Actual publishing is out of scope for this proof of concept. Before adding a **zenith-compose.yml**, verify the supported service routing, ports, environment variables, and persistence model against Zenith’s current guidance. The eventual deployment should expose the frontend and route **/api** to the backend, with production URLs configured outside source code.

## 8. Visual and interaction direction

- Use a calm, editorial moodboard style: warm neutral canvas, clear typography, generous whitespace, colorful image content, and restrained shadows.
- The board should feel like a designed space rather than a dashboard or file browser.
- Keep chrome light: a compact header, breadcrumbs, and a small floating zoom-control group.
- Make camera movement the main animation. Avoid animating every card continuously.
- Use reduced-motion preferences, visible focus rings, keyboard-operable controls, sufficient contrast, and alt text.
- Avoid motion that continues after navigation or makes the user lose their place.

## 9. Acceptance criteria

The proof of concept is ready for a hackathon demo when all of the following are true:

1. The frontend and backend run as separate services using documented local commands.
2. The frontend fetches the seeded scene from **GET /api/demo-board**; **GET /api/health** works.
3. The scene includes at least three board levels, about 30 images, several notes, and deterministic positions.
4. Users can pan, zoom toward the pointer, fit the current board, open a child board, and return to a parent.
5. Breadcrumbs update correctly at every depth.
6. Far, medium, and close zoom visibly present different levels of detail.
7. Users can move a card without moving its siblings; the new position remains for the current session.
8. Camera transitions are smooth, direct manipulation feels responsive, and reduced-motion settings are respected.
9. Loading and API error states are understandable.
10. The README explains setup, run commands, controls, and known limitations.
11. Frontend production build and backend checks/tests pass; there are no obvious browser console errors during the demo flow.
12. No database, real-file import, file upload, auth, or persistent user data has been introduced.

## 10. Suggested implementation order

1. Inspect the repository and its **AGENTS.md** instructions. If it is empty, scaffold separate frontend and backend services.
2. Build the API health endpoint and deterministic demo-scene endpoint.
3. Render a static board from the API fixture with three nested levels.
4. Add camera pan, pointer-centered zoom, and fit-board behavior.
5. Add nested-board entry/exit and breadcrumbs.
6. Add semantic zoom states and refine transitions.
7. Add card dragging and session-only position updates.
8. Add loading/error states, reduced-motion support, keyboard details, README, and verification.
9. Try the demo from a fresh browser session and tune interaction quality before adding optional polish.

## 11. Codex CLI handoff

Use this PRD as the implementation contract. Inspect the repository and project instructions first. If the Poteto/pstack mode is installed in Codex CLI, use it to choose and carry out the engineering workflow; it is a workflow aid, not a dependency of the app. Build the in-scope proof of concept only, then run the checks and demo flow in the acceptance criteria. If a Zenith-specific decision cannot be verified from current official guidance, keep the local app runnable and report the exact deployment question instead of inventing manifest configuration.

## 12. Reference documentation

- [Vite guide](https://vite.dev/guide/)
- [shadcn/ui installation for Vite](https://ui.shadcn.com/docs/installation/vite)
- [Motion for React](https://motion.dev/docs/react)
- [FastAPI documentation](https://fastapi.tiangolo.com/)
- [Zenith developer guide](https://zenith.hosting/developers)
- [Poteto pstack for Codex](https://github.com/chid/pstack)

