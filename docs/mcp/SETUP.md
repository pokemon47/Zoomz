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
| Browser UI | Partial actual Chromium verification; complete smoke script currently fails selecting Note. See HANDOFF.md. |
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

The browser script uses a new synthetic account, real UI controls, normal authentication, and SDK calls. It is an acceptance check still under refinement; consult HANDOFF.md for its last observed result rather than assuming the complete workflow passes. It refuses non-loopback targets. It does not control a personal browser profile or prove Claude/ChatGPT compatibility.

To enable runtime screenshots, set `MCP_RENDER_PREVIEWS=1` and `MCP_RENDER_ORIGIN` to the app's exact origin or an explicit HTTP loopback origin. Production defaults to the same-image nginx origin `http://127.0.0.1:8080`. The Dockerfile installs only Chromium headless shell with its system dependencies, preserving user 10001 and existing restrictions. The operator Compose file exposes these optional settings; the Zenith manifest is unchanged. Verify sandboxed launch on the actual host before enabling. Some Linux hosts require user-namespace policy not available under their container restrictions. Do not disable the sandbox or add privileged capabilities as a workaround. See [Playwright's container guidance](https://playwright.dev/python/docs/docker).

Browsers receive read-only snapshot data by interception, not a public preview API or an application session. Direct visits to `/mcp-render` cannot retrieve private scenes. External fonts and media are blocked, so previews use local font fallbacks and graceful placeholders for external-only images. PostgreSQL/container/Zenith runtime execution remains unverified.

## Deploy with the existing application

Optional PostgreSQL verification is **unverified locally**. The backend test fixture reads `TEST_DATABASE_URL` and otherwise forces disposable SQLite. Against an empty disposable PostgreSQL database only, run the following from backend after setting TEST_DATABASE_URL to its SQLAlchemy URL:

```sh
DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/alembic upgrade head
DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/alembic check
TEST_DATABASE_URL="$TEST_DATABASE_URL" .venv/bin/python -m pytest -q --tb=short
```

Never use production: tests reset database content. Do not assume setting DATABASE_URL alone makes tests exercise PostgreSQL.

Container commands are **unverified for this MCP revision**. Prepare an isolated operator configuration and storage targets using the root [README.md](../../README.md), not real production volumes, then run:

```sh
docker compose --env-file .env.production -p zoomz-mcp-test -f compose.production.yml config -q
docker compose --env-file .env.production -p zoomz-mcp-test -f compose.production.yml build
docker compose --env-file .env.production -p zoomz-mcp-test -f compose.production.yml up -d --wait
```

Run these from the repository root. `.env.production.example` is a template, not a credential-bearing deployable configuration. Do not copy live production secrets into test fixtures. Do not run destructive volume cleanup. The guarded CI container probe is for disposable projects only; use the existing CI invocation rather than inventing a production test command.

Apply the existing README's production procedure. There is no separate MCP container or port. The image's nginx template proxies `/mcp` without buffering and forwards OAuth metadata. Existing WebSocket routes remain unchanged. Keep one backend worker because collaboration and rate limiting are process-local.

Production requires HTTPS `PUBLIC_URL`, PostgreSQL migrations through `a90b4a770001`, persistent media storage, the existing stable application secret, and configured instance SMTP. MCP generates its endpoint from `PUBLIC_URL`; it needs no paid AI key. Leave `MCP_SOURCE_HOSTS` empty unless you have verified the exact provider attachment host and its transfer contract. Never allow a wildcard or a private host.

Existing paired database/media backups cover the new tables and originals. Verify a restore with MCP tasks, connections, and source files before admitting real data. Do not expose database/backend ports or weaken non-root container settings.

The current Docker daemon did not respond during verification. The new container, PostgreSQL races, proxy streaming in production, actual Zenith SMTP, and backup recovery have not been accepted for this MCP change. No deployment has been performed.

The existing guarded `deploy/container_check.py` now includes MCP discovery, unauthenticated rejection, actual SDK invocation, and persisted task/checkpoint/content/idempotency checks after restart and paired recovery. The existing CI workflow invokes it in disposable projects. Syntax checks passed, but Docker execution has not run for this change. Never set `ZOOMZ_CONTAINER_TEST=1` on a real instance to run this fixture.

## Complete the acceptance exercise

Use a disposable workspace and several real lecture documents containing diagrams, tables, equations, and multiple topics. Ask the connected assistant to curate a nested revision board and distinguish source-derived material from supplementary explanations.

Inspect progressive updates in Zoomz. Pause once from Zoomz and once through MCP; confirm writes stop while manual edits remain possible. Resume from fresh revisions. Start a new conversation and continue from the stored checkpoint, requesting only missing source material. Retry an identical batch, exercise one refused destructive request and one exact approved request, then finalize. Confirm references, normal editability, geometry, collaboration, and persistence after restart. Assess readability and educational usefulness in the real editor.

Record any attachment that the client cannot transfer. Upload originals through the existing multi-file editor control and associate exact asset IDs rather than guessing. Neither the local synthetic smoke script nor automated tests complete this real-client acceptance exercise.
