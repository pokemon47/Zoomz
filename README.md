# Zoomz

A collaborative moodboard you can pan and zoom through. Nested boards show their actual contents. The existing React/TypeScript/Vite frontend, FastAPI backend, camera, artwork, and interaction design are preserved.

See [AGENTS.md](AGENTS.md) and the [codebase overview](docs/CODEBASE_OVERVIEW.md) for development guidance.

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

Open http://localhost:5173. Vite proxies HTTP and WebSocket API traffic to port 8000. The default database is SQLite at `backend/data/zoomz.db`; uploads live in `backend/data/files`.

Without SMTP, development sign-in and invitation responses contain a `devLink`. Email bodies and tokens are not logged. This fallback is forbidden in production. Local mail delivery can use the same SMTP variables as production.

Signed-in spaces persist edits/uploads on the server. `/demo` permits memory-only changes and resets on reload. Wheel zooms; floor drag pans; breadcrumbs/Escape go up; `0` fits. Drag cards across visible boards. Double-click images to frame them; editable notes open their editor. Add/drop/paste, search (Cmd/Ctrl+K), resize, undo/redo, and minimap are available.

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

## Zenith deployment handoff

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

## Current verification and limitations

Local verification: 59 backend tests pass with SQLite, with one PostgreSQL concurrency test skipped; frontend tests (16), TypeScript/build, lint, and runtime-dependency audit pass. SQLite migration/check/repeated upgrade and PostgreSQL offline SQL generation pass. Lint retains existing warnings. The local Node 23 installation is outside Vitest's declared support; CI and the container use Node 24.

The full npm audit reports seven high-severity build-tool findings rooted in the unpatched [braces recursion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through the shadcn CLI dependency tree. Runtime dependencies report zero findings. These tools are absent from the final static nginx image. Build only trusted repository content; do not apply npm's suggested major downgrade blindly.

Docker's daemon was stopped locally. Container builds, real PostgreSQL execution, end-to-end restore, and the new GitHub Actions workflow remain unverified until CI runs. Real Zenith SMTP, ingress, persistent-volume ownership/durability, backups, and production browser checks remain acceptance blockers. Optional Google/SMTP integrations require instance-specific configuration.

Bundled sample artwork is 34 deterministic SVG illustrations generated by `backend/scripts/generate_fixture.py`, alongside 8 boards and 7 notes. Runtime fonts use Google Fonts with local system fallbacks.
