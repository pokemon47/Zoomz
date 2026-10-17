# Zoomz

Scrolling replaced with zooming. A moodboard you walk into: one continuous 2.5D space where boards hold their contents on their faces. Keep zooming and you step inside them, as many levels deep as the board goes. People sign in, build boards together in real time, upload images and files, and share them.

- **Original contract:** [`Zoomable_Board_POC_PRD.md`](Zoomable_Board_POC_PRD.md) (see [Deliberate changes](#deliberate-changes-from-the-prd))
- **Visual direction:** the Zoomboard design system in [`docs/design-system/`](docs/design-system/README.md)

```
frontend/            React + TypeScript + Vite, Tailwind v4, shadcn/ui, Motion — served by nginx in production
backend/             FastAPI, SQLAlchemy + Alembic (Postgres; SQLite locally), WebSockets
zenith-compose.yml   Deployment on Zenith: web, api, postgres, nightly backups, storage volumes
.github/workflows/   Tests (SQLite + Postgres), lint, build, manifest check, image publishing
docs/                Design system tokens, reference components, handoff notes
```

## Run it locally

You need **Python 3.9+** and **Node 20+**. Run each in its own terminal.

**1. API (port 8000)**

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000
```

Locally the API uses a SQLite file and stores uploads in `backend/data/` (both git-ignored). It creates the tables itself on start. Without a mail server it doesn't send sign-in emails: the sign-in page shows the link directly, and the API log prints it.

**2. Frontend (port 5173)**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in with any email. Your first sign-in creates an account with a personal workspace and a copy of the demo board. Vite proxies `/api`, including the live WebSocket, to `http://127.0.0.1:8000` (override with `VITE_API_PROXY_TARGET`). **/demo** opens the original demo board without an account; your changes there stay in the browser.

Optional local extras: `ffmpeg` on your PATH enables video posters and transcodes. Setting `PUBLIC_URL=http://localhost:5173` for the API makes emailed links point at the dev server.

## What you can do

**Moving around.** There are no folders to open. Every board shows what's inside it on its face, so you just keep moving toward what you want.

| Action | Mouse / trackpad | Keyboard |
| --- | --- | --- |
| Move closer / further | Scroll, two-finger scroll, or pinch (also on touch screens) | `+` / `-` |
| Pan | Drag the floor or a board's face | Arrow keys |
| Step inside a board | Keep zooming toward it | Tab to it, then Enter |
| Fly to anything | Double-click it, or ⌘K search | Enter |
| Go up a level | Breadcrumbs or Back | Escape |
| Frame the current board | **Fit board** | `0` |
| Jump somewhere on this board | Click or drag in the minimap | — |
| Move the path bar, zoom controls or map | Drag their grip | Grip + arrow keys |

**Editing.** Edits save instantly and appear for everyone on the board.

| Action | How |
| --- | --- |
| Add images, videos, PDFs, any file | Drop them on any board, paste with ⌘V, or **Add → Images & files…** (upload progress is shown on the card) |
| Add a link | Paste a URL. Links get a preview; YouTube, Vimeo and Figma play in place up close |
| New note / board | **Add**, or `N` / `B`. Pasting plain text also makes a note |
| Edit text | Double-click a note, or a board's title strip (Enter also edits a focused note) |
| Move | Drag. Dropping onto another board moves the card *into* it, at that level's size |
| Move a board | Drag its title strip (small boards: drag anywhere) |
| Resize | Select one card and drag the blue corner grip (images keep their shape; Shift frees it) |
| Select several | Shift-click, or Shift-drag on the floor for a marquee; ⌘A selects everything on this board |
| Copy / cut / paste / duplicate | ⌘C / ⌘X / ⌘V / ⌘D. This works across boards and spaces; files are copied along |
| Delete | Delete or Backspace |
| Undo / redo your own changes | ⌘Z / ⇧⌘Z |

**Working together.** Everyone on a board appears as an avatar in the top bar, with a live, named cursor. Click someone's avatar to follow their view; scroll or drag to stop. Cards other people are dragging move live. Being offline is fine: your edits queue and send when you reconnect, and the status pill shows anything unsaved.

**Sharing** (owners, via **Share**):

- **Invite by email** as an editor or viewer. The invite only works for that email address.
- **Join link:** anyone with it who signs in gets the access you pick. It can expire after 1, 7 or 30 days, and you can turn it off at any time.
- **Public link:** view-only, no account needed.
- **Per-board access:** give a member a different role inside one board and everything in it. For example, someone can edit the whole space but only view the "Final picks" board.
- **Team workspaces:** members see every board in the workspace with their workspace role. A person's role is the higher of their workspace role and their board-space role.

**Your account** (Settings): change your name and cursor colour, download all your data as a zip, or delete your account along with everything in the workspaces you created.

## Checks

```bash
cd backend && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q   # 31 API tests
cd frontend && npx tsc -b && npm test && npx oxlint src && npm run build                         # types, 16 unit tests, lint, build
python3 scripts/check-zenith.py                                                                  # deployment manifest rules
```

CI (`.github/workflows/ci.yml`) runs all of this on every push. The backend suite runs twice, against SQLite and against real Postgres, after `alembic upgrade head && alembic check`. On pushes it then builds and publishes `ghcr.io/<owner>/zoomz-api` and `zoomz-web`.

## Deploying on Zenith

Zenith runs the services in [`zenith-compose.yml`](zenith-compose.yml):

| Service | What it is |
| --- | --- |
| `web` | nginx with the built app. It's the only public port (8080), and it forwards `/api` and the live WebSockets to `api`. It sets the app's security headers (CSP, frame and referrer policies). |
| `api` | FastAPI. Runs migrations on start, stores uploads on the **Uploaded files** volume, and runs ffmpeg for videos. It starts as root only to take ownership of that volume, then drops to an unprivileged user. |
| `postgres` | The database, on the **Database** volume. |
| `backup` | `pg_dump` once a day to the **Database backups** volume, keeping the last 14. |

Secrets are generated by Zenith (`SECRET_KEY`, `POSTGRES_PASSWORD`), and `PUBLIC_URL` comes from `ZENITH_PUBLIC_URL`. When deploying you fill in the SMTP server and *From* address (required, since sign-in is by email). Google sign-in, Sentry and the upload limits are optional.

**Steps**

1. Push to `main`. CI tests everything and publishes `ghcr.io/pokemon47/zoomz-api:main` and `zoomz-web:main`.
2. In GitHub, under Packages, make both packages **public** so Zenith can pull them anonymously.
3. Optional but recommended: pin both images in `zenith-compose.yml` to the `@sha256:` digests CI printed, so a deployment never changes underneath you. Merge that.
4. Submit the repository on Zenith's **Publish an app** page, then deploy and enter the SMTP settings.
5. For Google sign-in, create an OAuth client with redirect URI `https://<your domain>/api/auth/google/callback` and set the two `GOOGLE_*` values.

**Manifest caveat:** Zenith's public developer page names `zenith-compose.yml` but doesn't publish its schema. This file follows the conventions in published Zenith submissions (`x-zenith` catalog, expose, storage, env with `generate` / `template` / `alias` / `input`), and `scripts/check-zenith.py` enforces the rules those submissions follow. Zenith's review is the final word.

**Restoring a backup:** copy a dump out of the backups volume and run `pg_restore --clean --if-exists -d zoomz <file>` against the database.

**Optional virus scanning:** run a ClamAV daemon and set `CLAMAV_ADDRESS=host:3310` on `api`. Uploads are then scanned before they're stored. It isn't in the manifest by default because ClamAV needs about 1.5 GB of memory and several minutes to load its signatures. If it's configured but unreachable, uploads are refused rather than stored unscanned.

## How it works

**The space** (frontend)

- **One continuous, infinitely nested space** (`frontend/src/lib/space.ts`). A board's contents are drawn on its card face, mapped into the board's stored content window (`content.frame`). The camera is always expressed in one board's own frame. When a child board covers the viewport, the camera re-anchors into it; when the current board stops covering the viewport, it re-anchors into the parent. Rendering is identical on both sides, so the transition is invisible and precision never runs out.
- **The board you're standing in** is drawn as a screen-sized floor, not as a card scaled 50× or more. A huge scaled card overflows GPU texture limits and flickers.
- **Walking, not scaling.** Things raised `z` above the floor get a perspective boost `g = 1 / (1 − z·s / eye)`, so notes rush toward you faster than prints. The pointer adds height-weighted parallax, and anything that reaches the eye fades as you pass it.
- **Scenery** (`frontend/src/lib/scenery.ts`). Studio, Mountains, Clouds, Forest, Dunes and Cosmos: endless low-poly layers you move through as you zoom, with haze, pass-by fades and parallax. Board floors are frosted so the world shows through. Editors set a board's scenery for everyone; viewers can choose their own.
- **Camera** (`frontend/src/lib/cameraEngine.ts`). Wheel input glides in log-scale. Pans and pinches are direct. Flights for search, breadcrumbs, Fit and follow interpolate across levels in a common frame. The frame loop only runs while something moves.

**Collaboration**

- **One path for every edit.** Each change is an operation (`create` / `update` / `delete` / `batch`). The scene store (`frontend/src/lib/store.ts`) applies it locally at once, records its inverse for your undo, and sends it over the board's WebSocket. The server (`backend/app/ops.py`) checks permissions and invariants (no board inside itself, the top board is protected, content fields are whitelisted and length-limited, coordinates are clamped). It writes the change, gives it the next sequence number, logs it and broadcasts the result.
- **Conflicts** resolve by the server's order: the last write to a field wins, and every client converges because results apply in sequence. While one of your own edits to a card is in flight, other people's updates to that card wait behind it. A rejected edit, or a gap in the log after a long disconnect, triggers a fresh snapshot, and anything you hadn't sent yet is re-applied on top.
- **Presence and drag previews** (`backend/app/live.py`) are relayed but never stored. Removing someone's access closes their socket immediately.

**Accounts, permissions, files** (backend)

- **Sign-in** by one-time email link (20 minutes, single use) or Google (OAuth with PKCE). Sessions are httpOnly, SameSite=Lax cookies stored hashed; so are magic-link and invite tokens. Every state-changing request must carry an `X-Zoomz` header (CSRF), and WebSockets check their Origin. Sign-in, invites, uploads, search and link previews are rate-limited.
- **Roles** (`backend/app/permissions.py`): owner > editor > viewer. Your space role is the higher of your workspace and space roles. A board override replaces it for one board and everything below it, and owners are never overridden. The snapshot tells the client your role in every board, so view-only boards don't offer edits.
- **Files** (`backend/app/files.py`, `media.py`, `storage.py`):
  - Type is decided from the file's bytes, not its name. Programs and installers are refused, and SVGs are rebuilt without scripts, event handlers or external references.
  - Size limits and per-board quotas apply, with optional ClamAV scanning.
  - Images get 256 px and 1024 px WebP thumbnails, and cards load the smallest one that's sharp at their on-screen size. PDFs get a first-page preview. Videos get a poster frame, plus an H.264 transcode if the browser can't play the original; this runs in the background and the card updates live.
  - File URLs are signed and expire, and they're served with a sandboxed CSP and `nosniff`, so a file can never run as part of the app. Unreferenced files are cleaned up after 30 days.
- **Search** covers every board you can access (titles, notes, descriptions, file names, link titles), and results fly you to the item.
- **Link previews** use oEmbed for YouTube and Vimeo, and page metadata otherwise. The server refuses private, loopback and link-local addresses on every redirect hop.
- **Your data:** `/api/me/export` returns a zip of your profile and the boards you own, with their files. Deleting your account cascades through your workspaces, boards and files.
- **Errors** in the browser are reported to `/api/client-errors` and logged (and sent to Sentry when `SENTRY_DSN` is set).

## Deliberate changes from the PRD

- **No "open board" action.** You enter a board by zooming into it; double-click and Enter fly you there. Board contents are drawn on board faces, reversing PRD §6.3.
- **Infinite zoom** through the nesting (PRD §6.2 asked for a clamp). Inside a single board, zoom stops at 14× its own scale.
- **Scroll moves you through depth**, and dragging pans (PRD §6.2 had scroll pan).
- **It's a real app now.** PRD §4 ruled out accounts, uploads, persistence and collaboration; those are the point of this version. `GET /api/demo-board` and **/demo** still serve the original fixture.
- **2.5D with real parallax and scenery**, beyond the static slab depth of §6.5.

## Known limitations

- The API runs as **one instance**. Live rooms and rate limits are in memory, so running several API replicas would need a shared broker such as Postgres LISTEN/NOTIFY or Redis.
- A board's content window is set when the board is created and doesn't grow. Things you drop are kept inside its face, and resizing the board card scales its contents.
- Copying files into another space copies the stored bytes. There's no deduplication.
- Link previews check addresses before each request, but a hostile DNS server could still rebind between the check and the connection. Previews only read public metadata and never return response bodies.
- Very large boards (thousands of cards on one board) haven't been profiled. Rendering culls off-screen cards, but there's no spatial index yet.
- Terms and Privacy pages are drafts and must be reviewed by a lawyer before launch. Billing isn't included.
- Postgres, ffmpeg and the Docker images are exercised in CI, not on the original development machine.
- Fonts load from Google Fonts; offline, the UI falls back to system fonts.
