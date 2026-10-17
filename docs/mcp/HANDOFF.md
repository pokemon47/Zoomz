# MCP continuation checkpoint

Updated 2026-10-18. **STOPPED at 15% remaining; wait for user resumption.** Branch `MCP_start`. Implementation is **73% weighted verified**, currently browser acceptance/hardening. The current checkpoint below supersedes the older detailed checkpoint retained later in this file. Read PROGRESS.md, REFERENCE.md, and SETUP.md; do not repeat repository/provider discovery.

## Current resume checkpoint

- Last actual 300-minute allowance: **85% used, 15% remaining**. Stop policy is 15% remaining, not 15% used and not weekly usage. No further implementation or optional checks after this save.
- User explicitly approved official Playwright and Chromium. Installed `playwright==1.64.0`, `pyee==14.0.0`, `greenlet==3.5.6`, and only Chromium headless shell plus its official FFmpeg helper. No duplicate npm browser package or pytest plugin. Runtime requirements/lock updated because production screenshots use Playwright.
- New `backend/app/mcp_preview.py` and `frontend/src/pages/McpRenderPage.tsx` implement actual SpaceCanvas screenshots. `get_board_preview` is an async MCP tool, offloading capture to a thread so it does not block the MCP event loop. Isolated sandbox-enabled browsers receive only an authorized read-only subtree and authorized stored media by interception. No user credentials/session reach Chromium. No public snapshot API exists. External requests and WebSockets are blocked; remote fonts fall back locally.
- Limits: one render, 2,000 nodes, 64 levels, 8 MiB scene, bounded viewport, 25-second render deadline plus cleanup. Permissions are rechecked before returning, discarding images after revocation. Geometry and `content.frame` use the existing scene/camera. Optional board-local bounds select close-up views. Capability discovery reflects opt-in enablement.
- Verified with actual downloaded sandboxed Chromium: root/topic/close-up images, real nested composition, uploaded image, and real MCP SDK image-result delivery. Images were visually inspected. Artifacts: `/private/var/folders/xq/3_zry3k13tg2nh8hshlcbn_00000gn/T/pytest-of-doodleaks/pytest-19/test_real_renderer_nested_and_0/{root,topic,close}.jpg`. Later test runs produce equivalent fixtures under newer pytest directories.
- Latest full backend: **103 passed, 1 skipped** in 8.73s, command `ZOOMZ_BROWSER_TESTS=1 MCP_RENDER_ORIGIN=http://127.0.0.1:5178 .venv/bin/python -m pytest -q --tb=short`. Preview suite: **6 passed** in 3.76s. PostgreSQL remains skipped. Frontend **31 passed**, lint exit 0 with known warnings; final `npm run build` passed after the source Escape and draft-position changes. `pip check` and `git diff --check` passed before checkpoint docs.
- Browser script `backend/tests/mcp_browser_smoke.py` is **not fully passing**. Actual UI verified sign-in, endpoint, selected-workspace consent, real SDK writes arriving through WebSocket, source dialog, Escape closure, draft generating status, and Pause. It currently stops at `get_by_role('menuitem', name='Note', exact=True)` after opening Add. Likely accessible name includes shortcut `N`; this is an inference, not yet inspected. Do not skip/bypass the UI or claim later steps passed.
- Confirmed fixes: Vite proxy now matches only MCP endpoint paths, not `/mcp-render` or `/mcp-connect`; preview API proxy enables WebSockets. SourceIndicator explicitly closes on Escape while protecting canvas shortcuts. Draft panel moved from top 76 to 144 so it does not cover Add/scenery controls. Type/build passed; full browser acceptance remains incomplete.
- Dockerfile installs Chromium/system libraries at `/opt/zoomz-browsers`, preserving non-root user 10001. Operator Compose and env example add opt-in `MCP_RENDER_PREVIEWS=0` and same-image `MCP_RENDER_ORIGIN=http://127.0.0.1:8080`. Never use `--no-sandbox`, privileged containers, or capability escalation to force a launch. Docker/Linux sandbox/Zenith execution remains unverified. No Zenith manifest change or deployment. Official Zenith container page fetch failed; local skill retained without an unauthorized update.
- CI adds actual-renderer tests against built frontend in addition to existing checks. CI changes have not run remotely. `deploy/container_check.py` retains the prior guarded MCP restart/recovery probe.
- New/changed this resume: Dockerfile, `.github/workflows/checks.yml`, production env/Compose, runtime requirements, `mcp_preview.py`, `mcp_server.py`, `mcp_service.py`, `test_mcp_preview.py`, `mcp_browser_smoke.py`, App/McpRenderPage/SpaceCanvas, SourceIndicator, BoardPage, Vite config, docs/mcp. Earlier uncommitted MCP files remain; do not discard them. Nothing committed, pushed, published, deployed, or changed in production.
- Processes cleaned up: Vite exec session 11281 exited 130 after Ctrl-C; disposable Uvicorn PID 4730/session 93184 completed shutdown and exited 0. All browser/test processes exited. Disposable SQLite/media under `/private/tmp/zoomz-mcp-browser.*` retained; no real data touched. No automatic restart.

### Exact next step after user resumption

Read the current 300-minute allowance. Start the built frontend on 5178 and a **disposable** backend on 8017 using SETUP.md. Do not rerun source discovery or already passing screenshot tests just to resume. Inspect the Add menu's accessible name in the fresh test browser, correct the exact-name selector if warranted, and continue `tests/mcp_browser_smoke.py --url http://127.0.0.1:5178`. Its later manual-edit/undo/resume/bulk-upload/grant/approval/revocation steps remain unverified. Then test remaining UI elevation/recovery and nested navigation, run relevant checks at a milestone, and update weighted credit only for verified items. Docker/PostgreSQL and real Claude/ChatGPT acceptance still require working external infrastructure/access.

## Previous checkpoint details (historical)

## Quota guard

The user superseded the previous 55%-remaining threshold and 50% reserve with a **15%-remaining stop point**. Latest App Server reading: **55% used, 45% remaining** in the window with `windowDurationMins == 300`. Do not use the weekly window. At 15% remaining or less, stop new work, finish the atomic edit, update this handoff/progress, stop owned services, and end the turn. Never promise an exact reserve. If the interface fails, ask the user for `/status` rather than continuing without visibility.

The installed `codex app-server --listen stdio://` accepts JSON-lines `initialize`, `initialized`, then `account/rateLimits/read`. A short subprocess needs permission outside the restricted sandbox. Print only the selected window, not the whole account response. Terminate the subprocess after the response. No background quota service is installed.

## Completed and verified

- Official SDK remote Streamable HTTP inside FastAPI; real SDK protocol initialization, tools, bearer verification, metadata and OAuth PKCE/consent/rotation/revocation.
- User-bound workspace/board/all grants, current roles, exact destructive approvals, task/time/persistent elevation, recoverable owner-only scene snapshots.
- Existing-node batches, exact geometry and hierarchy, atomic caller transactions, stable retry IDs, conflicts, existing live operation delivery.
- Tasks/checkpoints, pause from both backend interfaces, manual editing while paused, fresh-revision resume, new-connection continuation and finalization.
- Existing upload pipeline, protected source references, SSRF-constrained optional attachment import, paginated structural inspection and long-note reading.
- Actual source-image/PDF-page MCP results through `get_source_visual`. Images use existing raster derivatives; PDFs use a shared PDFium lock also used by upload previews. Results include real JPEG content and bounded source metadata, not a replacement board renderer. Selected-page, raster proportions, scope denial, and official SDK image transport tests pass.
- UI connection/consent/grants, approvals, draft control, snapshot recovery, and source indicators compile; frontend suite passes. Browser integration is not verified.

Recent regressions reproduce and fix selected-board inspection wrongly requiring access to its parent. The authorized board's out-of-scope parent ID is hidden. Long manual notes are paged without truncating stored content, and geometry-only edits leave text intact.

Selected-board connections now discover only the workspaces containing their currently accessible authorized boards. A separate regression confirms an approved destructive request cannot be reused through another connection, even for the same user and identical parameters.

This resume added SQLite in-flight pause/write tests through browser API and MCP, consistent 100,000-character note-body validation for creation/updates, retry-safe OAuth revocation, production-compatible literal loopback callbacks for native OAuth clients, and an attachment-read deadline that rejects slow-drip responses. Whitespace/control characters in callbacks are rejected. New tests reproduced the revocation, callback, note-size and slow-drip defects before fixes.

## Test evidence

- Latest full backend `.venv/bin/python -m pytest -q --tb=short`: **97 passed, 1 skipped**, 4.55s. This includes the latest source, scope, concurrency, OAuth and deadline changes. PostgreSQL-dependent coverage is skipped. The initial resumed run was 91 passed and one skipped; the intermediate hardening run was 96 passed and one skipped.
- Latest focused `.venv/bin/python -m pytest tests/test_mcp.py -q --tb=short`: **35 passed**, 2.36s. One existing Starlette TestClient deprecation warning.
- Frontend `npm test`: **31 passed**. `npm run build`: passed TypeScript and Vite. `npm run lint -- src`: exit 0 with pre-existing warnings and two new async-effect warnings; not zero-warning lint.
- SQLite Alembic upgrade/check, downgrade to `7de3a94355d8`, re-upgrade/check: passed in disposable storage. `pip check`: passed. `git diff --check`: passed after the recent implementation edits.
- `tests/mcp_http_smoke.py --url http://127.0.0.1:5178`: passed real HTTP SDK/OAuth and synthetic generation through Vite. It used a disposable backend, not a real provider. It predates the latest paginated-inspection change, which is covered by unit integration tests.
- One narrow independent OAuth/permissions review found two medium defects: code replay could revoke before PKCE validation, and equal-length substantial replacement bypassed approval. Both were corrected and have passing regressions. No claim of comprehensive security certification.
- `deploy/container_check.py` Python syntax passed. Its new MCP checks run under the existing `ZOOMZ_CONTAINER_TEST=1` guard and existing CI workflow, but actual container execution is blocked. The probe uses synthetic CI-only credentials, verifies discovery/401/SDK calls through nginx, and checks task/checkpoint/content plus identical retry after restart and paired recovery. Never run it against real data.

No browser, MCP Inspector, real Claude, real ChatGPT Plus, current image build, PostgreSQL concurrency, production SMTP, or backup restore acceptance has passed for this MCP implementation.

## Architecture decisions

Reuse `Node`, `Space.seq`, `ops.apply`, storage, and `live.hub`; no parallel canvas or inference backend. `ops.apply` and `store_upload` accept caller-owned transactions without changing ordinary editor commits. SQLite starts an immediate transaction; PostgreSQL locks connection/space rows. One worker remains required. SDK app/session manager is recreated per FastAPI lifespan for tests.

Opaque credentials are hashed; OAuth resource is exactly `PUBLIC_URL/mcp`. Destructive grants are managed only through authenticated Zoomz UI. Approval binds full batch parameters and revision. Snapshot and reference assets are retained by housekeeping. Optional provider fetches require exact hosts, public-IP validation, pinned network destination, and normal TLS verification.

The existing WebSocket hub now dispatches to each socket's owning event loop. This fixed a full-suite hang with multiple TestClient loops; the collaboration regression and full suite pass. Do not restore the old process-global loop assumption.

## Working tree

All listed changes are uncommitted task work; no commit, push, deployment, or production-data change occurred. Preserve the diff.

Modified tracked files:

- `.env.production.example`, `compose.production.yml`
- `deploy/container_check.py`
- `backend/alembic/env.py`, `backend/requirements.txt`, `backend/requirements.lock`
- `backend/app/files.py`, `live.py`, `main.py`, `media.py`, `ops.py`
- `frontend/nginx.conf.template`, `frontend/vite.config.ts`
- `frontend/src/App.tsx`, `components/app/TopBar.tsx`, `components/space/SpaceCanvas.tsx`, `lib/types.ts`, `pages/BoardPage.tsx`

New files:

- `backend/alembic/versions/a90b4a770001_mcp.py`
- `backend/app/mcp_access.py`, `mcp_download.py`, `mcp_models.py`, `mcp_schema.py`, `mcp_server.py`, `mcp_service.py`, `mcp_ui.py`
- `backend/tests/test_mcp.py`, `backend/tests/mcp_http_smoke.py`
- `frontend/src/pages/AiPage.tsx`, `frontend/src/components/app/SourceIndicator.tsx`
- `docs/mcp/README.md`, `REFERENCE.md`, `SETUP.md`, `PROGRESS.md`, `HANDOFF.md`

## Incomplete work and blockers

- Real browser verification of connection/consent UI, permissions, approvals, sources, bulk upload, live drafts, manual editor compatibility, and undo. Browser bootstrap failed with `Importing module "node:process" is not allowed in node_repl`.
- Rendered-board screenshots are **not implemented**. Do not claim structural inspection meets the rendered-preview requirement. No misleading replacement renderer was added.
- Source upload supports originals and existing previews; PowerPoint slide/figure extraction, uncertain-match review, and the full multi-document lecture acceptance are not implemented/verified as a complete workflow.
- Real provider attachment transfer is unverified; guard and import tests use mocks. Plus write support is not established by the official help checked on 2026-10-18. No account or published plugin has been exercised.
- Docker daemon timed out on `docker info` again. Local context lookup found `default` and `desktop-linux`; explicitly checking `desktop-linux` also timed out after eight seconds. No `psql` or `initdb` was available. Container/production proxy/PostgreSQL race tests and recovery acceptance remain undone. Do not repeat daemon checks without a user-reported environment change.
- Cross-connection approval substitution and selected-board workspace discovery are now regression-tested. Further PostgreSQL races and production isolation remain unverified.
- Create/update note-size limits and capability text are now aligned at 100,000 characters, with explicit refusal instead of silent truncation. Replacement detection remains a heuristic, not semantic proof against all destructive edits.
- Official Playwright installation was rejected by the environment approval reviewer before execution because it mutates the project virtual environment with a new network dependency. A user approval question is pending. **Do not retry through another environment, package manager, or indirect command to bypass the denial.** No package was installed and no screenshot implementation files were added.
- Finish acceptance coverage and review docs against final behavior. `SETUP.md` and `REFERENCE.md` document current behavior, including gaps.

## Owned processes

Disposable development servers for the HTTP smoke test received **SIGTERM after matching their command identities**: Vite PID **1741** on 5178 and Uvicorn PID **2026** on 8017. No shutdown-exit poll was run after the checkpoint. If a port remains occupied on resumption, confirm command identity before reuse or cleanup. Do not stop unrelated application processes. The backend used isolated `/private/tmp/zoomz-mcp-http.*` database/storage, not user data. Test data is retained; no broad temp deletion is authorized.

Quota-query subprocesses terminate themselves. No active test suite or new agent task is intended. The one narrow review is finished.

No local app servers or browser processes were started in this resume. The full and focused pytest runs exited. Both bounded Docker probes exited after timeout. There is no new cleanup task.

## Exact next step

Resolve the pending Playwright approval first, then read the current 300-minute allowance using the new 15%-remaining threshold. Do not rerun the already passing 97-test backend suite merely to resume. If approved, install the official Python dependency, pin the actual resolved versions, and reuse installed macOS Chrome for application screenshot tests. Continue with the actual-renderer snapshot design in README.md. Preserve sandboxing and non-root deployment; refuse screenshots if the runtime cannot maintain those restrictions. Do not substitute a simplified renderer or treat source-page images as board screenshots.

If installation is declined, retain structural/source inspection and explicitly mark board screenshots incomplete. Browser-plugin repair, Docker responsiveness, and a public test instance/provider account remain external requirements. Once Docker is responsive, run existing PostgreSQL migrations/tests and the guarded CI restart/recovery probe. Do not rediscover completed source or provider research. No real-client acceptance may be claimed from SDK fixtures. Never deploy, publish, commit, or push without permission.
