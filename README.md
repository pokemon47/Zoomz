# Zoomz
Scrolling replaced with zooming

This repository contains the deterministic scene API and a zoomable frontend board view. The frontend reads the scene from the API and explores three nested board levels. Each board displays its direct image, note, and child-board cards at their fixed local coordinates.

## Requirements

- Python 3.10 or newer
- Node.js 22.12 or newer and npm

## Run locally

In one terminal, start the API:

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

In another terminal, start the frontend:

```bash
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite. Its `/api` proxy forwards requests to the backend at `127.0.0.1:8000`. The frontend's API prefix defaults to `/api`; set `VITE_API_BASE_URL` to a full prefix ending in `/api` at build time for a different deployment. See `frontend/.env.example`.

## API and checks

- `GET /api/health` returns `{ "status": "ok" }`.
- `GET /api/demo-board` returns `Scene(rootBoardId, nodes)` from the checked-in JSON fixture. Each node is a board, image, or note with a parent board and fixed board-local geometry. Images point to bundled SVG artwork under `frontend/public/assets`. The [PRD section 6.1](Zoomable_Board_POC_PRD.md#61-scene-and-sample-data) defines the wire contract.

Run the backend contract checks from `backend/`:

```bash
.venv/bin/python -m pytest -q
```

Build the frontend from `frontend/`:

```bash
npm run build
```

Run the camera and navigation geometry checks from `frontend/`:

```bash
npm test
```

Drag empty canvas to pan. Wheel or trackpad scrolling pans; hold Ctrl or Command while scrolling to zoom toward the pointer. The floating controls zoom around the viewport center or fit the current board and all its direct cards. The focused canvas supports arrow keys to pan, `+` and `-` to zoom, and `0` to fit. Zoom is limited to 20% to 300%.

Double-click a child-board card to open it, or select the card and click **Open board**. Tab focuses a board card and reveals its action. Enter or Space on the card also opens it. The camera moves into the card, then fits the child board's contents. Use **Back**, Escape, or an ancestor breadcrumb to return. Returning restores the parent's previous view. If the viewport has resized, the remembered board position stays at its center with the same zoom.

Camera and navigation controls pause during a transition. Reduced-motion preferences make navigation immediate, including when the preference changes during a transition. Child-board previews contain images from their immediate children. Moving cards, semantic zoom, and polished loading and retry controls belong to later stages. The sample scene is read-only and does not require a database or writable app filesystem.
