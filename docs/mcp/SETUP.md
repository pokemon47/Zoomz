# Connect and verify Zoomz MCP

## Prepare a new machine

Use Python 3.12 and Node 24. These bootstrap commands match the repository dependencies, but the complete fresh-machine sequence has **not** been verified on another machine. Obtain the full MCP_start branch including its handoff documentation commit; see [HANDOFF.md](HANDOFF.md) for sharing status.

```sh
git clone <repository-url> zoomz
cd zoomz
git switch MCP_start
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.lock -r backend/requirements-dev.txt
npm --prefix frontend ci
backend/.venv/bin/python -m playwright install --only-shell chromium
```

On Linux, Playwright may need OS packages. The Dockerfile uses `playwright install --with-deps --only-shell chromium`; this Linux installation has not been verified locally. No Firefox/WebKit or duplicate npm browser dependency is required. Browser binaries and OS libraries are needed in production only when runtime screenshots are enabled, but the current Dockerfile installs them explicitly. Python Playwright is a runtime dependency. Test scripts remain under backend/tests.

For a disposable browser/HTTP test backend, run from the repository root:

```sh
cd backend
zoomz_test_data=$(mktemp -d "${TMPDIR:-/tmp}/zoomz-mcp.XXXXXX")
export APP_ENV=development
export DATABASE_URL="sqlite:///$zoomz_test_data/test.db"
export STORAGE_DIR="$zoomz_test_data/files"
export PUBLIC_URL=http://127.0.0.1:5178
export SMTP_HOST=
export SENTRY_DSN=
export MCP_RENDER_PREVIEWS=1
export MCP_RENDER_ORIGIN=http://127.0.0.1:5178
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8017 --no-access-log
```

This configuration follows the successfully used isolated environment. The exact combined bootstrap block is not itself a separately recorded test. Clear or review inherited application environment settings before using it. Never point smoke scripts at real account data. In a second terminal, build and serve frontend as shown below. The standard development server uses a different port; match PUBLIC_URL and MCP_RENDER_ORIGIN to the actual frontend origin if changing ports.

## Run locally

Use the existing backend environment and frontend dependencies. Apply migrations before starting the backend:

```sh
cd backend
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
cd frontend
npm run dev
```

MCP runs inside FastAPI, not in another service. Open `/ai` while signed in to inspect the endpoint and manage connections. Set `PUBLIC_URL` to the frontend's exact origin, including the port in local development. Vite proxies `/mcp`, OAuth metadata, and existing API routes. A wrong `PUBLIC_URL` produces incorrect discovery resources and OAuth redirects.

For isolated smoke testing, use a disposable SQLite database and storage directory. The test creates synthetic account data and must not run against an ordinary development account database. Set `APP_ENV=development`, an explicit loopback `PUBLIC_URL`, no `SMTP_HOST`, and the existing `DATABASE_URL` and `STORAGE_DIR` to those disposable locations. Run the frontend proxy against that backend using `VITE_API_PROXY_TARGET` if its port differs from 8000.

```sh
cd backend
.venv/bin/python tests/mcp_http_smoke.py --url http://127.0.0.1:5178
```

Replace the port with your disposable frontend's port. The script refuses non-loopback or non-development targets. It uses the real SDK over HTTP and normal development authentication, not a shared administrator credential.

## Connect a remote client

The instance must be reachable by the provider over HTTPS. Use the exact endpoint displayed on Zoomz's `/ai` page. Do not point a cloud connector at localhost.

For Claude, follow [the official custom connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). Add the HTTPS MCP URL, use automatic OAuth registration where available, sign in to Zoomz, and choose explicit workspace or board access. Confirm discovered read and write tools before a disposable write test.

For ChatGPT, first check whether your account exposes [custom MCP integration](https://help.openai.com/en/articles/12584461). The documented [plugin connection flow](https://developers.openai.com/plugins/deploy/connect-chatgpt) is account/product-dependent. Configure the instance URL and OAuth only where supported. A Zoomz plugin has not been published. Do not substitute paid API inference or assume Work access proves ordinary ChatGPT Plus compatibility.

For other MCP clients, configure remote Streamable HTTP with OAuth resource discovery and public-client registration. Consent is always completed in the Zoomz-hosted browser flow.

## Verify capabilities without overstating compatibility

| Path | Current result |
| --- | --- |
| Official Python SDK over ASGI | Tested initialization, discovery, authenticated invocation |
| Source image/PDF inspection over SDK | Tested actual image result and selected PDF page; not a board screenshot |
| Official Python SDK over real local HTTP through Vite | Tested OAuth and synthetic generation workflow |
| MCP Inspector | Not run |
| Claude account | Not tested; public endpoint/account access required |
| ChatGPT Plus account | Not tested; current official documentation does not establish required write support |
| Published ChatGPT plugin | Not implemented or submitted |
| Browser UI | Expanded sandboxed Chromium workflow passes, including invited-editor collaboration, nested navigation, normal edits/undo, sources, grants, recovery and draft finalization. See HANDOFF.md. |
| Realistic lecture visual/educational quality | Not verified |
| Rendered board screenshot | Tested actual root/nested/close-up SpaceCanvas captures and SDK image transport in local sandboxed Chromium |

For each real provider test, record provider, plan, product surface, date, endpoint, available tool approvals, and result. Start with `get_capabilities`, `list_workspaces`, and `get_board`. Create one disposable board, one nested board, a cited note, and an image if actual bytes are available. Verify normal editing and collaboration in Zoomz. Revoke access and confirm the next call fails. A successful SDK test is not proof of provider compatibility.

## Run checks

```sh
cd backend
.venv/bin/python -m pytest tests/test_mcp.py -q
.venv/bin/python -m pytest -q
.venv/bin/alembic check
```

Run `alembic check` only against an appropriate local database already migrated to head. Use disposable PostgreSQL for concurrency and migration checks, not production.

```sh
cd frontend
npm test
npm run lint -- src
npm run build
```

The SDK dependency is pinned in `backend/requirements.lock`. Use existing project installation instructions when creating an environment. Never put bearer tokens in command lines, source, screenshots, or test reports.

## Verify screenshots and browser controls

Playwright 1.64.0 is a backend runtime dependency, not a frontend or test-only duplicate. Test scripts remain under `backend/tests/`; no browser-specific pytest plugin is required. Install only Chromium:

```sh
cd backend
.venv/bin/python -m playwright install --only-shell chromium
```

After building the frontend, serve it on loopback in a separate terminal:

```sh
cd frontend
VITE_API_PROXY_TARGET=http://127.0.0.1:8017 npm run preview -- --host 127.0.0.1 --port 5178 --strictPort
```

Run self-contained renderer tests against that frontend. Database/media fixtures are disposable; no running backend is needed for these tests:

```sh
cd backend
ZOOMZ_BROWSER_TESTS=1 MCP_RENDER_ORIGIN=http://127.0.0.1:5178 .venv/bin/python -m pytest tests/test_mcp_preview.py -q -s
```

For the broader UI workflow, also start a disposable backend on 8017 with the development database/storage settings described above, `PUBLIC_URL=http://127.0.0.1:5178`, no SMTP, and optionally `MCP_RENDER_PREVIEWS=1`. Then run:

```sh
cd backend
.venv/bin/python tests/mcp_browser_smoke.py --url http://127.0.0.1:5178
```

The browser script uses synthetic owner and invited-editor accounts, real UI controls, normal authentication, and SDK calls. The complete expanded workflow passes locally. It refuses non-loopback targets. It does not control a personal browser profile or prove Claude/ChatGPT compatibility. A transferred virtualenv may target a different Python installation; check imports before using it. The continuation used pinned dependencies in `/tmp/zoomz-mcp-v1-env` and `PLAYWRIGHT_BROWSERS_PATH=/tmp/zoomz-mcp-v1-browsers`, leaving the transferred virtualenv unchanged.

To enable runtime screenshots, set `MCP_RENDER_PREVIEWS=1` and `MCP_RENDER_ORIGIN` to the app's exact origin or an explicit HTTP loopback origin. Production defaults to the same-image nginx origin `http://127.0.0.1:8080`. The Dockerfile installs only Chromium headless shell with its system dependencies, preserving user 10001 and existing restrictions. The operator Compose file exposes these optional settings; the Zenith manifest is unchanged. Verify sandboxed launch on the actual host before enabling. Some Linux hosts require user-namespace policy not available under their container restrictions. Do not disable the sandbox or add privileged capabilities as a workaround. See [Playwright's container guidance](https://playwright.dev/python/docs/docker).

Browsers receive read-only snapshot data by interception, not a public preview API or an application session. Direct visits to `/mcp-render` cannot retrieve private scenes. External fonts and media are blocked, so previews use local font fallbacks and graceful placeholders for external-only images. PostgreSQL/container/Zenith runtime execution remains unverified.

## Deploy with the existing application

PostgreSQL **16.15** migrations and the full **104-test** backend suite pass locally. PostgreSQL **17.11** production-container migrations/schema checks and **48 focused regressions** now pass as well; one renderer pytest case was not enabled and skipped. Apply migrations to a separate regression database before running its tests. The backend test fixture reads `TEST_DATABASE_URL` and otherwise forces disposable SQLite. Against an empty disposable PostgreSQL database only, run the following from backend after setting TEST_DATABASE_URL to its SQLAlchemy URL:

```sh
DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/alembic upgrade head
DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/alembic check
TEST_DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/python -m pytest -q --tb=short
```

Never use production: tests reset database content. Do not assume setting DATABASE_URL alone makes tests exercise PostgreSQL.

For an actual database/application restart check, `tests/mcp_restart_smoke.py` has separate seed and verify phases. Use a migrated disposable loopback PostgreSQL database whose name starts with `zoomz_mcp_test`, `APP_ENV=development`, `PUBLIC_URL=http://testserver`, no SMTP, explicit temporary `STORAGE_DIR`, and `ZOOMZ_RESTART_TEST=1`. From backend, run:

```sh
.venv/bin/python -m tests.mcp_restart_smoke seed --state /tmp/zoomz-mcp-restart-state.json
# Restart only the disposable PostgreSQL server before starting the verify process.
.venv/bin/python -m tests.mcp_restart_smoke verify --state /tmp/zoomz-mcp-restart-state.json
```

Set `DATABASE_URL` to that disposable database for both commands. Each phase starts a fresh application process. The state file is created exclusively with mode 0600 and contains synthetic OAuth credentials; never commit or share it. Use a fresh state-file path for another seed. The check verifies existing-token acceptance, paused-write rejection, checkpoint/media retention, exact idempotent retry, preserved manual edits and finalization through a new connection. This passed after an actual PostgreSQL 16.15 restart. It does not exercise container/nginx or backup restoration.

The existing production image builds with Node 24/Python 3.12 and starts healthy with PostgreSQL 17.11. nginx/MCP/WebSocket routing, non-root restrictions, restart persistence and paired database/media restore pass on Docker Desktop/WSL 2. **Sandboxed screenshots now pass with the approved opt-in seccomp override**. Default Compose still uses Docker's default policy and disables previews unless enabled. Prepare an isolated operator configuration and storage targets using the root [README.md](../../README.md), not real production volumes, then run:

```sh
docker compose --env-file .env.production -p zoomz-mcp-test -f compose.production.yml config -q
docker compose --env-file .env.production -p zoomz-mcp-test -f compose.production.yml build
docker compose --env-file .env.production -p zoomz-mcp-test -f compose.production.yml up -d --wait
```

Run these from the repository root. `.env.production.example` is a template, not a credential-bearing deployable configuration. Do not copy live production secrets into test fixtures. Do not run destructive volume cleanup. The guarded CI container probe is for disposable projects only; use the existing CI invocation rather than inventing a production test command.

Apply the existing README's production procedure. There is no separate MCP container or port. The image's nginx template proxies `/mcp` without buffering and forwards OAuth metadata. Existing WebSocket routes remain unchanged. Keep one backend worker because collaboration and rate limiting are process-local.

Production requires HTTPS `PUBLIC_URL`, PostgreSQL migrations through `a90b4a770001`, persistent media storage, the existing stable application secret, and configured instance SMTP. MCP generates its endpoint from `PUBLIC_URL`; it needs no paid AI key. Leave `MCP_SOURCE_HOSTS` empty unless you have verified the exact provider attachment host and its transfer contract. Never allow a wildcard or a private host.

Existing paired database/media backups cover the new tables and originals. Verify a restore with MCP tasks, connections, and source files before admitting real data. Do not expose database/backend ports or weaken non-root container settings.

Docker Engine 29.8.2/Compose 5.6.0 are available on the continuation machine. The disposable `zoomz-mcp-v1-test` and `zoomz-mcp-v1-restore` projects use ignored `.audit/mcp-container.env` and `.audit/mcp-container-restore.env`. They share the same built image, with independent database/media volumes. Actual Zenith SMTP and public hosting remain unverified. No deployment has been performed.

The existing guarded `deploy/container_check.py` includes production route/auth configuration checks, MCP discovery, unauthenticated rejection, actual SDK invocation, protected media/WebSockets and persisted task/checkpoint/content/idempotency checks after restart and paired recovery. The existing CI invokes its `seed` and `verify` modes; these modes now pass locally in Docker. Never set `ZOOMZ_CONTAINER_TEST=1` on a real instance.

The separate `preview` mode requires an actual SpaceCanvas JPEG through authenticated MCP/nginx, checks dimensions/revision and decodes the image. With the retained disposable project running, reproduce it from the repository root:

```sh
docker compose --env-file .audit/mcp-container.env -p zoomz-mcp-v1-test -f compose.production.yml exec -T -e ZOOMZ_CONTAINER_TEST=1 app python - preview < deploy/container_check.py
```

The original default-policy attempt failed with generic 503/`No usable sandbox`. After explicit user approval, the tested optional override adds [Playwright's namespace operations](https://playwright.dev/python/docs/docker#crawling-and-scraping) `clone`, `setns`, `unshare` to the exact running Docker engine's default policy. Actual sandboxed screenshots pass; the focused container suite reports **50 passed, no skips** with renderer tests enabled.

Read [the policy scope and provenance](../../deploy/seccomp/README.md) before opting in. Because rendering runs inside the main backend container, all app processes gain these three syscall permissions. The base production and Zenith configurations remain unchanged; the prepared override was used only on disposable infrastructure. No production deployment occurred. Keep both Compose files in subsequent start/recreate commands:

```sh
docker compose --env-file .audit/mcp-container.env -p zoomz-mcp-v1-test -f compose.production.yml -f compose.chromium.yml up -d --no-build --wait
docker compose --env-file .audit/mcp-container.env -p zoomz-mcp-v1-test -f compose.production.yml -f compose.chromium.yml exec -T -e ZOOMZ_CONTAINER_TEST=1 app python - < deploy/chromium_check.py
docker compose --env-file .audit/mcp-container.env -p zoomz-mcp-v1-test -f compose.production.yml -f compose.chromium.yml exec -T -e ZOOMZ_CONTAINER_TEST=1 app python - preview < deploy/container_check.py
```

The read-only sandbox checker confirms a real renderer's distinct user-namespace UID map, nested PID namespace, UID 10001, no-new-privileges, additional seccomp filters, zero effective capabilities, and no disabling flags in the actual browser command line. The profile regression fingerprints the complete original Docker policy, so unrelated syscall changes fail verification. Review the baseline on Docker upgrades. Do not disable Chromium's sandbox, run privileged, add capabilities, or disable seccomp to obtain a pass. If the intended host still denies namespaces, stop escalation and use a supported host or keep previews disabled pending a separately approved renderer design.

The paired archive is `/tmp/zoomz-mcp-v1-container-backups/zoomz-backup-20261018T003838Z-4gy6dukk.tar`. Recovery into the initially empty second project passed; retrying restore into that populated project was refused, then its data verified intact. Preserve these disposable volumes/image for the sandbox follow-up; no second build is needed.

## Complete the acceptance exercise

Use a disposable workspace and several real lecture documents containing diagrams, tables, equations, and multiple topics. Ask the connected assistant to curate a nested revision board and distinguish source-derived material from supplementary explanations.

Inspect progressive updates in Zoomz. Pause once from Zoomz and once through MCP; confirm writes stop while manual edits remain possible. Resume from fresh revisions. Start a new conversation and continue from the stored checkpoint, requesting only missing source material. Retry an identical batch, exercise one refused destructive request and one exact approved request, then finalize. Confirm references, normal editability, geometry, collaboration, and persistence after restart. Assess readability and educational usefulness in the real editor.

Record any attachment that the client cannot transfer. Upload originals through the existing multi-file editor control and associate exact asset IDs rather than guessing. Neither the local synthetic smoke script nor automated tests complete this real-client acceptance exercise.
