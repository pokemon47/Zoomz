# Zoomz

Scrolling replaced with zooming. A moodboard you walk into: one continuous 2.5D space where boards hold their contents on their faces. Keep zooming and you step inside them, as many levels deep as the board goes. People sign in, build boards together in real time, upload images and files, and share them.

- **Original contract:** [`Zoomable_Board_POC_PRD.md`](Zoomable_Board_POC_PRD.md) (see [Deliberate changes](#deliberate-changes-from-the-prd))
- **Visual direction:** the Zoomboard design system in [`docs/design-system/`](docs/design-system/README.md)
- **Development guidance:** [AGENTS.md](AGENTS.md) and the [codebase overview](docs/CODEBASE_OVERVIEW.md)

```
frontend/            React + TypeScript + Vite, Tailwind v4, shadcn/ui, Motion
backend/             FastAPI, SQLAlchemy + Alembic (Postgres; SQLite locally), WebSockets
deploy/              nginx config, container entrypoint, backups, manifest check
Dockerfile           One app image: built frontend + nginx + the API
zenith-compose.yml   The published Zenith manifest
.github/workflows/   CI: tests (SQLite + Postgres), lint, build, containers, backups
```

## Local development

Use Python 3.12 and Node 24. Run these in separate terminals:

```sh
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.lock -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --port 8000 --no-access-log
```

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173 and sign in with any email. Your first sign-in creates an account with a personal workspace and a copy of the demo board. Vite proxies `/api`, including the live WebSocket, to `http://127.0.0.1:8000` (override with `VITE_API_PROXY_TARGET`). **/demo** opens the original demo board without an account; your changes there stay in the browser.

The default database is SQLite at `backend/data/zoomz.db` (migrated automatically on start); uploads live in `backend/data/files`. Without SMTP, development sign-in and invitation responses contain a `devLink`, shown on the sign-in page. Email bodies and tokens are not logged. This fallback is forbidden in production.

Optional local extras: `ffmpeg` on your PATH enables video posters and transcodes. Setting `PUBLIC_URL=http://localhost:5173` for the API makes emailed links point at the dev server.

## Checks

```sh
# backend/
.venv/bin/python -m pytest -q
# frontend/
npm test
npm run lint -- src
npm run build
npm audit --omit=dev --audit-level=high
```

GitHub Actions runs SQLite tests, PostgreSQL migrations and tests, frontend checks, container builds, nginx/WebSocket checks, and paired database/media backup recovery into a fresh project. CI must pass before deployment; configuring a workflow is not evidence it has run.

## What you can do

**Moving around.** There are no folders to open. Every board shows what's inside it on its face, so you just keep moving toward what you want.

| Action | Mouse / trackpad | Keyboard |
| --- | --- | --- |
| Move closer / further | Scroll, two-finger scroll, or pinch (also on touch screens) | `+` / `-` |
| Pan | Drag the floor or a board's face | Arrow keys |
| Step inside a board | Keep zooming toward it | Tab to it, then Enter |
| Fly to anything | Double-click it, or ⌘K search | Enter |
| Go up a level | Breadcrumbs or Back | Escape |
| Frame everything on the current board | **Fit board** | `0` |
| Back out to level 1 and see the whole canvas | The home button next to Fit board | `⇧0` |
| Hide or show board labels / photo labels (each on its own) | The two label buttons next to Fit board | `⇧L` / `L` |
| Jump somewhere on this board | Click or drag in the minimap (its eye button folds it away to a small tab at the side) | — |
| Move the path bar, zoom controls or map | Drag their grip | Grip + arrow keys |

**Editing.** Edits save instantly and appear for everyone on the board.

| Action | How |
| --- | --- |
| Add images, videos, PDFs, any file | Drop them (or whole folders: each folder becomes a board, subfolders become boards inside it) on any board, paste with ⌘V, or the picture button on the side toolbar (upload progress is shown on the card) |
| Add a link | Paste a URL. Links get a preview; YouTube, Vimeo and Figma play in place up close |
| New note / board / arrow | Drag it from the side toolbar and drop it exactly where you want it (or press `N` / `B` / `A` to put it in the middle). Click a tool first to pick its look: boards can be Plain (the background's own white, or dark in dark mode), Outline (a coloured rim and stack), Full colour (the deep colour on the rim and stack, a pastel of it on the surface) (Glass and Clear are built but switched off for now: `SEE_THROUGH_ENABLED` in `frontend/src/lib/fills.ts`); notes can be any colour; arrows pick their style. Right-click → Colour changes it later. A board's surface is also the floor once you step inside, so each board is a canvas of its own. Board surfaces are plain, without dots. The background dots stay one size at every zoom level, with a barely-there pulse as you zoom. Notes and boards open for typing straight away, no naming dialog. Pasting plain text also makes a note. Notes have no length limit: the text sizes itself to fill the note (a few words are big, a long note is small) and stays readable in the lightbox |
| Edit text | Click a note's text, or a board's title or description, and type right there (Esc or clicking away saves; dragging still just moves). Images, files and links: right-click → Edit |
| Connect things | Click the arrow on the side toolbar to pick its style (straight, curved or a 90° angle; solid or dotted; pointing forward, back, both ways or neither), then drag it onto the canvas. Select an arrow to change its style from the small bar over it; a curved arrow also shows a joint in its middle that you drag to set how much it bends. Drop an arrow on an item to start from it, then drag either end handle onto another item on the same board to attach it. Attached arrows follow their items around |
| Move | Drag. Dropping onto another board moves the card *into* it, at that level's size |
| Move a board | Drag its title strip (small boards: drag anywhere) |
| Resize | Select one card and drag the blue corner grip (pictures always keep their true shape) |
| Select several | Shift-click, or Shift-drag on the floor for a marquee; ⌘A selects everything on this board |
| Copy / cut / paste / duplicate | ⌘C / ⌘X / ⌘V / ⌘D. This works across boards and spaces; files are copied along |
| Delete | Delete or Backspace (undo brings it back, with everything inside a board) |
| Undo / redo your own changes | ⌘Z / ⇧⌘Z |

**Working together.** Everyone on a board appears as an avatar in the top bar, with a live, named cursor. Click someone's avatar to follow their view; scroll or drag to stop. Cards other people are dragging move live. Being offline is fine: your edits queue and send when you reconnect, and the status pill shows anything unsaved.

**Sharing** (owners, via **Share**):

- **Invite by email** as an editor or viewer. One click on the emailed link opens the board and signs the person in, with no second email. Someone new becomes a **guest**: they keep their invited access for 14 days (`GUEST_DAYS`), then sign in normally to keep going. The link works once, only for that email address, and opening it (as mail scanners do) doesn't use it up. If someone else is signed in on that browser, Zoomz asks which account to use.
- **Workspace invites** work the same way and give access to every board in the workspace. Owners can remove anyone's access from the share dialog or the workspace's Members; they're disconnected at once.
- **Join link:** anyone with it who signs in gets the access you pick. It can expire after 1, 7 or 30 days, and you can turn it off at any time.
- **Public link:** view-only, no account needed.
- **Per-board access:** give a member a different role inside one board and everything in it. For example, someone can edit the whole space but only view the "Final picks" board.
- **Team workspaces:** members see every board in the workspace with their workspace role. A person's role is the higher of their workspace role and their board-space role.

**Canvases.** Each workspace holds canvases (shown on the dashboard); each canvas holds boards, notes, pictures and arrows. Start one with **New blank canvas**, or **Import canvas** to bring back an exported one. Each canvas has a ⋯ menu: **Duplicate canvas** (a full copy: every item where it was, its files, and its scenery), **Export canvas** and, for owners, **Delete** (asks first, then deletes permanently). The workspace ⋯ menu renames it or deletes it with everything in it (type its name to confirm). Your Personal workspace can be renamed but not deleted.

**Exporting and importing.** A canvas (from the dashboard, or right-click any board inside one) downloads as a zip: a folder per board, pictures and files under their own names, notes as Markdown, links in `links.md`, and `zoomz-manifest.json` (format version 2) with everything needed to rebuild it exactly: every item's type, position, size, height, stacking, titles, captions, text, arrow ends and attachments, plus the canvas's scenery. **Import canvas** turns such a zip into a new canvas in the workspace, laid out exactly as it was; the files go through the normal upload checks.

**Your account** (Settings): change your name and cursor colour, choose **Light**, **Dark** or **System** appearance (remembered per browser, applied before the page paints), download all your data as a zip, or delete your account along with everything in the workspaces you created.

## Production configuration

For the standard Docker Compose deployment, copy `.env.production.example` to `.env.production`, restrict it to the operator (`chmod 600 .env.production`), and fill in private values. Zenith instead resolves the mappings in `zenith-compose.yml`. Never commit or print populated secret files or expanded configuration.

| Variable | Requirement |
| --- | --- |
| `APP_ENV` | `production`, set by Compose. |
| `PUBLIC_URL` | Exact public HTTPS origin, with no path/query. Used for links, cookies, and WebSocket origin validation. |
| `SECRET_KEY` | Stable, randomly generated value of at least 32 characters. Generate with `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'` and store privately. |
| `DATABASE_URL` | Explicit PostgreSQL URL; preferably `postgresql+psycopg://zoomz:ENCODED_PASSWORD@db:5432/zoomz`. Percent-encode reserved characters in credentials. SQLite is rejected in production. |
| `POSTGRES_PASSWORD` | Database password for the Compose PostgreSQL service, matching the URL. |
| `STORAGE_DIR` | Absolute writable persistent-media path. Compose mounts `/data/uploads`. |
| `SMTP_HOST`, `SMTP_PORT` | Values supplied for the provisioned Zenith instance. No automatic injection is assumed. |
| `SMTP_ENCRYPTION` | Explicit `starttls`, `tls` (implicit TLS), or `none`. Use `none` only for an isolated instance relay explicitly documented by Zenith. TLS certificates are verified. |
| `SMTP_USER`, `SMTP_PASSWORD` | Supply both if the instance relay requires authentication; otherwise leave both empty. |
| `SMTP_FROM`, `SMTP_FROM_NAME` | Authorized sender email and optional display name. Existing combined `Name <address>` sender syntax also works. |
| `SMTP_TIMEOUT` | Connection/socket timeout in seconds, 1–120; default 15. |
| `MAX_UPLOAD_MB`, `UPLOAD_BODY_LIMIT` | Backend file limit and nginx body limit. Defaults 200 and `201m`; allow multipart overhead when changing them. |
| `SPACE_QUOTA_MB` | Default 5120. Monitor available volume capacity separately. |
| `TRUSTED_PROXY_CIDR` | Exact ingress network confirmed by the host. Default only trusts loopback. Never use `0.0.0.0/0`. Correct configuration is needed for per-client IP rate limits. |
| `SESSION_DAYS`, `GUEST_DAYS`, `INVITE_DAYS` | How long a sign-in lasts (30), how long invite-only guests can use Zoomz before signing in (14), and how long an invite link is valid (14). Sessions have a fixed length: using Zoomz doesn't extend them. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. Register `PUBLIC_URL/api/auth/google/callback` with Google. |

Legacy development `SMTP_TLS` remains supported, but production requires explicit `SMTP_ENCRYPTION`. Missing or malformed production SMTP, URL, database, secret, and storage settings fail startup without exposing their values.

All emails use the same sender. SMTP failures return a generic 503 and do not claim delivery success. Failed email sends do not commit new login tokens, invitations, or workspace memberships. A successful SMTP response means the relay accepted the message, not that the recipient received it.

Tests use SMTP doubles; no real emails are sent. After provisioning, request a magic link and an invitation and confirm both arrive through Zenith. Confirm their HTTPS links work and responses expose no development links. Real Zenith delivery has not been verified.

## Containers and migrations

The root `Dockerfile` builds the frontend, then packages nginx and the Python backend in one non-root app image. This matches Zenith's single-source-build contract without changing the source architecture. A small Bash entrypoint stops the container if either child exits and forwards shutdown signals. PostgreSQL 17 remains a separate service.

`compose.production.yml` is the operator/local Compose variant. Only nginx binds a loopback host port, 8080 by default. A trusted HTTPS ingress must forward to it. Uvicorn listens only on the app container's loopback port; PostgreSQL has no public endpoint. `zenith-compose.yml` is the distinct published Zenith manifest.

```sh
docker compose --env-file .env.production -p zoomz -f compose.production.yml config -q
docker compose --env-file .env.production -p zoomz -f compose.production.yml up -d --build --wait
curl --fail http://127.0.0.1:8080/api/health
```

The backend checks media writability, runs `alembic upgrade head`, then starts Uvicorn without reload or URL access logging. Keep exactly **one backend replica and one worker**; live rooms and rate limits are process-local. PostgreSQL uses connection pre-ping and locks each space before applying edits/allocating sequence numbers.

For an explicit migration with a configured environment, from `backend/`:

```sh
.venv/bin/alembic upgrade head
.venv/bin/alembic check
```

nginx preserves SPA routes and proxies `/api/` and WebSocket upgrades to Uvicorn on loopback. It overwrites forwarded headers, reserves upload capacity, and keeps URLs/tokens out of access logs. Uvicorn trusts forwarded headers only from loopback. Host ingress logs must also redact query strings and invitation/join/public token paths.

Keep the `postgres-data` and `uploads` volumes across updates. Never run `docker compose down -v` against real data. With host bind mounts, prepare media ownership for UID/GID 10001. Production startup requires a media mount point, or a directory beneath one, and checks writability. A mount alone cannot prove the host's retention/durability guarantees; verify those with Zenith. Optional video transcoding needs ffmpeg, which is not installed in the minimal image; original-file playback remains available.

Frontend builds contain no SMTP, database, or OAuth secrets and use same-origin API URLs. Do not set secret `VITE_*` variables. Backend runtime dependencies are pinned in `requirements.lock`; review/regenerate that file when requirements change.

## Deploying on Zenith

The [official Compose reference](https://docs.zenith.hosting/content/zenith-compose-reference.md) documents the mappings used by `zenith-compose.yml`:

- `PUBLIC_URL` aliases `ZENITH_PUBLIC_URL`.
- SMTP host/port/user/password/from alias `ZENITH_SMTP_HOST`, `ZENITH_SMTP_PORT`, `ZENITH_SMTP_USER`, `ZENITH_SMTP_PASS`, and `ZENITH_SMTP_FROM`, scoped only to `app`. The documented relay uses port 587 and STARTTLS.
- A generated database password goes to PostgreSQL and the app's database URL. A separate generated stable signing key goes only to the app.
- Private storage declarations cover PostgreSQL and uploaded media.
- The only public endpoint is app port 8080. Zenith terminates HTTPS. Public image dependencies and one root `build: .` app follow the [container guide](https://docs.zenith.hosting/content/containerise.md).

Validation actually performed: Docker Compose parses the manifest; both schemas supplied by the official skill pass; the npm CLI's published schema and applicable semantic checks pass via `deploy/check_manifest.mjs`.

`NO_COLOR=1 zenith check --upload-size` was also run with npm CLI **0.1.4** and **fails** its stricter preview policy on the published `env` and `storage` blocks. The supplied skill schemas describe broader preview behavior than that npm release. This does not prove the published manifest invalid, nor does schema success prove server acceptance. No preview variant was created that drops required SMTP/secrets. Verify the target server/CLI compatibility before an authorized preview.

Next operator actions:

1. Let the CI container/PostgreSQL/recovery checks pass, or run their commands with a running Docker daemon.
2. Confirm Zenith volume ownership supports UID/GID 10001, identify the exact ingress CIDR for `TRUSTED_PROXY_CIDR`, and arrange independent backups.
3. Confirm catalogue licensing before publication. No license file exists; the manifest accurately says `UNLICENSED` and does not grant a new license.
4. With explicit permission, commit/push the reviewed files to the public repository and complete Zenith account/GitHub/Developer Agreement prerequisites. Then follow the [official publishing workflow](https://docs.zenith.hosting/content/publish.md), which builds the pinned GitHub source without requiring a separately published app image.
5. Once provisioned, run every acceptance check below, especially actual SMTP delivery and restore. No credentials need to be copied into source.

No authentication, preview upload, image publication, commit, push, or deployment was performed. Manifest server admission and the real instance's SMTP, ingress, volume permissions, and backup facilities remain unverified.

**Optional virus scanning:** run a ClamAV daemon and set `CLAMAV_ADDRESS=host:3310` on the app. Uploads are then scanned before they're stored; if it's configured but unreachable, uploads are refused rather than stored unscanned. It isn't in the manifest by default because ClamAV needs about 1.5 GB of memory.

## Backups and recovery

`deploy/backup.py` requires Python 3.12+, Docker Compose, and operator access. It briefly stops the single app writer, dumps PostgreSQL, archives all media, includes SHA-256 checksums, then restarts the backend if it was running. Backups use private permissions. Retention defaults to seven days and deletes only matching older backup files after a successful new archive.

```sh
backend/.venv/bin/python deploy/backup.py --project zoomz backup /mnt/independent-backups/zoomz --keep-days 7
```

Schedule this daily through an available operator/hosting scheduler. Copy completed archives to encrypted off-host storage with its own seven-day-or-longer retention. A second directory or volume on the same failed host is not disaster recovery. Restrict access: the archive contains user content and account data. Keep configuration secrets separately in a secure store.

**Before accepting real user data, confirm the scheduler, independent destination, copy-failure alert, and restore drill.** These hosting-specific facilities are not configured here. If Zenith gives no Compose/operator access, arrange its supported database-and-media backup/export mechanism instead. Database-only snapshots are insufficient.

Restore only a trusted archive into an **empty recovery project with fresh volumes**, using a separately prepared recovery environment and a different `WEB_PORT`. The utility refuses populated database/media targets and does not erase existing volumes.

```sh
# Build the recovery images first.
docker compose --env-file .env.recovery -p zoomz-recovery -f compose.production.yml build
backend/.venv/bin/python deploy/backup.py --env-file .env.recovery --project zoomz-recovery restore /path/to/zoomz-backup-TIMESTAMP-ID.tar --confirm-empty-target
docker compose --env-file .env.recovery -p zoomz-recovery -f compose.production.yml up -d --wait
```

Run the acceptance checks before switching traffic. Keep the original project intact until recovery is verified. An unsuccessful restore may leave a partial recovery target; inspect it and use new empty recovery volumes for another attempt.

## Deployment acceptance checklist

- [ ] Frontend and a directly loaded nested URL work over the correct public HTTPS origin.
- [ ] `/api/health` succeeds; production API docs are disabled.
- [ ] A new user receives and completes a Zenith SMTP magic-link sign-in.
- [ ] An existing user sends an invitation; its recipient joins with the intended role.
- [ ] A space can be edited and changes survive reload.
- [ ] Upload an image and confirm the original/preview remain after backend restart.
- [ ] Two browser sessions see edits and cursors through the production WebSocket proxy.
- [ ] Viewers/strangers cannot edit or access private files; production cookies are Secure/HttpOnly.
- [ ] Database and uploads survive container recreation with the same volumes.
- [ ] A scheduled paired backup reaches independent storage and is restored successfully.
- [ ] Ingress/application logs contain no sign-in tokens, SMTP credentials, or cookie values.

## How it works

**The space** (frontend)

- **One continuous, infinitely nested space** (`frontend/src/lib/space.ts`). A board's contents are drawn on its card face, mapped into the board's stored content window (`content.frame`). The camera is always expressed in one board's own frame. When a child board covers the viewport, the camera re-anchors into it; when the current board stops covering the viewport, it re-anchors into the parent. Rendering is identical on both sides, so the transition is invisible and precision never runs out.
- **The board you're standing in** is drawn as a screen-sized floor, not as a card scaled 50× or more. A huge scaled card overflows GPU texture limits and flickers.
- **Walking, not scaling.** Things raised `z` above the floor get a perspective boost `g = 1 / (1 − z·s / eye)`, so notes rush toward you faster than prints. The pointer adds height-weighted parallax, and anything that reaches the eye fades as you pass it.
- **Scenery** (`frontend/src/lib/scenery.ts`). Studio, Mountains, Clouds, Forest, Dunes and Cosmos, chosen from the small swatch next to search (hover it to see the others): endless low-poly layers you move through as you zoom, with haze, pass-by fades and parallax. Board floors are frosted so the world shows through. Editors set a board's scenery for everyone; viewers can choose their own.
- **Camera** (`frontend/src/lib/cameraEngine.ts`). Wheel input glides in log-scale. Pans and pinches are direct. Flights for search, breadcrumbs, Fit and follow interpolate across levels in a common frame. The frame loop only runs while something moves.

**Collaboration**

- **One path for every edit.** Each change is an operation (`create` / `update` / `delete` / `batch`). The scene store (`frontend/src/lib/store.ts`) applies it locally at once, records its inverse for your undo, and sends it over the board's WebSocket. The server (`backend/app/ops.py`) checks permissions and invariants (no board inside itself, the top board is protected, content fields are whitelisted and length-limited, coordinates are clamped). It writes the change, gives it the next sequence number, logs it and broadcasts the result.
- **Conflicts** resolve by the server's order: the last write to a field wins, and every client converges because results apply in sequence. While one of your own edits to a card is in flight, other people's updates to that card wait behind it. A rejected edit, or a gap in the log after a long disconnect, triggers a fresh snapshot, and anything you hadn't sent yet is re-applied on top.
- **Undo with collaborators** works like Google Docs or Canva: you only undo your own changes, and only the fields you changed, so a teammate's later edit to the same card stays. Parts of an undo that touch cards someone else has since deleted are skipped quietly. One action is one step: a drag, a resize, a paste of many cards or re-stacking a selection all undo at once.
- **Presence and drag previews** (`backend/app/live.py`) are relayed but never stored. Removing someone's access closes their socket immediately.

**Accounts, permissions, files** (backend)

- **Sign-in** by one-time email link (20 minutes, single use; the link opens a page and only its button signs in, so mail scanners can't use it up) or Google (OAuth with PKCE). Sessions last a fixed `SESSION_DAYS`; logging out revokes the session on the server. Sessions are httpOnly, SameSite=Lax cookies stored hashed; so are magic-link and invite tokens. Every state-changing request must carry an `X-Zoomz` header (CSRF), and WebSockets check their Origin. Sign-in, invites, uploads, search and link previews are rate-limited.
- **Roles** (`backend/app/permissions.py`): owner > editor > viewer. Your space role is the higher of your workspace and space roles. A board override replaces it for one board and everything below it, and owners are never overridden. The snapshot tells the client your role in every board, so view-only boards don't offer edits.
- **Files** (`backend/app/files.py`, `media.py`, `storage.py`):
  - Type is decided from the file's bytes, not its name. Programs and installers are refused, and SVGs are rebuilt without scripts, event handlers or external references.
  - Size limits and per-board quotas apply, with optional ClamAV scanning.
  - Images get 256 px and 1024 px WebP thumbnails, and cards load the smallest one that's sharp at their on-screen size. PDFs get a first-page preview. Videos get a poster frame, plus an H.264 transcode if the browser can't play the original; this runs in the background and the card updates live.
  - File URLs are signed and expire, and they're served with a sandboxed CSP and `nosniff`, so a file can never run as part of the app. Unreferenced files are cleaned up after 30 days.
- **Search** (⌘K) looks in the board you're in and everything inside it by default, or the whole workspace; on the dashboard, the workspace you're viewing. It covers titles, notes, descriptions, file names and link titles, respects every permission, and results fly you to the item.
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
- Edits larger than the live socket's 64 KB message cap (a very long note, a big paste) are sent over HTTP instead; everyone still receives them live.

## Current verification and limitations

Local verification: 59 backend tests pass with SQLite, with one PostgreSQL concurrency test skipped; frontend tests (16), TypeScript/build, lint, and runtime-dependency audit pass. SQLite migration/check/repeated upgrade and PostgreSQL offline SQL generation pass. Lint retains existing warnings. The local Node 23 installation is outside Vitest's declared support; CI and the container use Node 24.

The full npm audit reports seven high-severity build-tool findings rooted in the unpatched [braces recursion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through the shadcn CLI dependency tree. Runtime dependencies report zero findings. These tools are absent from the final static nginx image. Build only trusted repository content; do not apply npm's suggested major downgrade blindly.

Docker's daemon was stopped locally. Container builds, real PostgreSQL execution, end-to-end restore, and the new GitHub Actions workflow remain unverified until CI runs. Real Zenith SMTP, ingress, persistent-volume ownership/durability, backups, and production browser checks remain acceptance blockers. Optional Google/SMTP integrations require instance-specific configuration.

Bundled sample artwork is 34 deterministic SVG illustrations generated by `backend/scripts/generate_fixture.py`, alongside 8 boards and 7 notes. Runtime fonts use Google Fonts with local system fallbacks.
