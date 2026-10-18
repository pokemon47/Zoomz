# MCP v1 progress

Updated 2026-10-18. **96% weighted verified estimate**, not remaining time or production readiness. Equal substantive item weights within each phase. Only verified completed items earn credit; in-progress/pending earn zero. Documentation cleanup earns no implementation credit.

`Zoomz MCP v1: [███████████████████░] 96%`

Current phase: Phase 6 real-client acceptance and final audit. Public HTTPS OAuth and authenticated SDK operations now pass. The local production-container milestone passes, but the live Zenith preview screenshot call returns 503 and is not verified there. No production deployment has been performed.

| Phase | Weight | Verified items | Earned |
| --- | ---: | ---: | ---: |
| 0. Repository and feasibility audit | 5% | 4/4 | 5.00% |
| 1. MCP foundation and authentication | 20% | 6/6 | 20.00% |
| 2. Board and element mutations | 20% | 5/5 | 20.00% |
| 3. Generation lifecycle and recovery | 20% | 6/6 | 20.00% |
| 4. Media and visual inspection | 15% | 5/6 | 12.50% |
| 5. Frontend integration | 10% | 5/5 | 10.00% |
| 6. Hardening and acceptance verification | 10% | 5/6 | 8.33% |

Unrounded sum **95.83%**; displayed phase values are rounded separately. Displayed total uses whole-percent rounding. The remaining public renderer failure is a rollout blocker despite locally verified renderer credit.

## Substantive requirements

- **Phase 0. Completed (4):** authoritative source review; reusable contracts/service review; official MCP/provider feasibility baseline; baseline verification. Dated research is not real-client acceptance.
- **Phase 1. Completed (6):** official SDK protocol/tools; registration/PKCE/consent; resource-bound expiry/rotation/revocation; current-role/scope enforcement; concurrent one-use credential consumption; public HTTPS client authorization. Public evidence includes real browser consent/callback/state/PKCE exchange and authenticated SDK initialize/discovery/write operations through Zenith ingress. This is not provider-account acceptance.
- **Phase 2. Completed (5):** nested creation/exact geometry; atomic validation/rollback; persisted retries/concurrent SQLite retries; source-reference persistence/access validation; normal-editor acceptance. Browser evidence includes an invited editor observing live MCP edits, editing a generated note, raised-card drag/resize and undo, manual creation/undo/redo, root/child/grandchild navigation and reload persistence. MCP edits arrive as remote operations; they do not enter another user's local undo stack.
- **Phase 3. Completed (6):** lifecycle/checkpoints/new-connection continuation; pause through both backend interfaces/manual edits preserved; fresh-revision conflicts and approval/snapshot recovery; SQLite in-flight pause/write coordination; browser-visible generating status/Pause; equivalent PostgreSQL concurrency verification. PostgreSQL 16.15 passes the entire backend suite, including both pause interfaces. A separate seed/restart/verify exercise preserves OAuth, paused state, checkpoint, safe retry, manual edit and media, then finalizes through a new connection in a fresh application process.
- **Phase 4. Completed (5):** inline media through existing validation; protected refs and real source-image/PDF-page results; structural bounds/overlaps/gaps; real sandboxed Chromium board screenshots, including nested/close-up; bulk-upload/source association. The browser uploads text originals, a two-page PDF and an image, associates an exact asset ID, retrieves original bytes through the citation, rejects anonymous unsigned access and receives PDF page 2 as an actual SDK image. **In progress (1):** actual provider attachment transfer, mocked transport/security only. Native PowerPoint extraction is not implemented or required; provider source transfer remains unverified.
- **Phase 5. Completed (5):** source indicator/citation dialog/Escape; connection/permission management; approval/elevation/recovery; draft pause/manual-edit/resume/finalization; multi-file fallback. The expanded browser script passes workspace/board/all scope changes, read-only enforcement, revocation, exact approval, owner snapshot restore, one-task elevation and UI finalization. Time/persistent elevation enforcement also has backend coverage, not separate browser acceptance.
- **Phase 6. Completed (5):** focused security regressions; frontend checks/build; narrow independent OAuth/permission review and fixes; full SQLite regression/migration round trip/synthetic HTTP SDK; PostgreSQL/production image/restart/recovery and sandboxed renderer acceptance. **Pending (1):** real Claude/Plus and realistic lecture acceptance. Final security/high-reasoning review remains required, not already satisfied by the narrow review.

## Latest recorded evidence

Live preview checkpoint, 2026-10-18 from 01:16 UTC:

- Public preview `https://50f96289938d1461-ishaaq426.zh.run` has valid TLS, frontend/login/demo/render-shell responses 200, `/api/health` 200 and `/healthz` 200. OAuth discovery is 200 with the correct public HTTPS issuer/resource/routes. Anonymous account/workspace/MCP management endpoints and MCP initialize reject access with 401; an invalid bearer also returns 401. Production API docs are disabled (404).
- Actual sandboxed browser loads login/demo canvas without page errors; anonymous `/ai` redirects to login and WSS rejects an anonymous handshake with 403. Public registration returns 201 and unsafe redirect registrations return 400. Authenticated WebSocket acceptance is not yet established publicly.
- Public frontend JS/CSS exactly match local built assets. Local HEAD is `87e56a7c4d8ab46cf21121d598a1b052eb6bded3`; deployed backend commit is unknown. Zenith management is unauthenticated and expiry time cannot be read.
- SMTP delivery/sign-in succeeded according to the user's controlled-account observation. In their actual ChatGPT Plus account, the user confirmed OAuth consent completed with the correct `/mcp` endpoint and selected Zoomz, but ChatGPT reported that moodboard-reading actions were not available. App details showed metadata without a discovered action list. **ChatGPT acceptance did not pass**; no actual provider tool call or write is evidenced. Tool scanning, action enablement and account capability remain to be distinguished. The user explicitly has not tested Claude yet. Provider attachments and lecture quality remain unverified.
- Public browser OAuth consent, callback/state and PKCE token exchange passed (200), followed by authenticated HTTPS SDK initialize and discovery of 13 tools. Created only the new disposable board `/b/f8ace1b8e2304b2d810d3476c34fb459`. Nested atomic batch, exact note geometry, identical persisted retry, child-board read, checkpoint, paused-write rejection (409), resume and finalization passed. Synthetic source-reference content is not original-media or educational-quality acceptance.
- A fresh separately authorized connection read the persisted test board. Actual public `get_board_preview` returned **503**, with message `Board previews are disabled; configure the sandboxed Chromium runtime first`. This confirms deployment feature disablement, not a demonstrated sandbox failure. Hosting configuration was not changed.
- Corrected public revocation **passes** at 01:29 UTC: revoke returns 200, then a valid MCP initialize request using the revoked token returns **401**. The first harness omitted MCP Accept headers (406); the second omitted the required revocation client ID and correctly left access active (200). Both were harness mistakes, not application defects. Earlier test connections should be revoked through `/ai` after acceptance; no credentials were logged or saved.

Current continuation evidence, using disposable local data:

- Full SQLite backend **103 passed, 1 skipped**, with real sandboxed Chromium renderer tests enabled. PostgreSQL-dependent coverage skipped in this run. Interpreter `/tmp/zoomz-mcp-v1-env/bin/python`, pinned runtime requirements installed unchanged.
- Full PostgreSQL 16.15 backend **104 passed, no skips**, with the same renderer configuration and `TEST_DATABASE_URL` pointing only at disposable loopback PostgreSQL. Alembic upgrade/check passed. `mcp_restart_smoke.py seed`, actual PostgreSQL stop/start, and `verify` in a fresh process passed. These do not verify PostgreSQL 17, Docker or nginx.
- Container milestone on Docker Engine **29.8.2**, Compose **5.6.0**, WSL 2, 7.43 GiB engine RAM: the existing image built once using **Node 24/Python 3.12**, started healthy as UID 10001 with `no-new-privileges`, and migrated **PostgreSQL 17.11** through `a90b4a770001`. Alembic check and pip check passed. Database/backend ports are unpublished; nginx binds loopback only.
- `deploy/container_check.py verify` passes nginx health/demo/render-shell/auth routes, HTTPS OAuth metadata, unauthenticated rejection, SDK authentication/tools, protected media checksum, WebSocket viewer rejection, task/checkpoint retention and idempotent retry. Passed after restarting both app/database and after paired PostgreSQL/media recovery into a second initially empty project. Both projects use image `sha256:0d4deeefc41565ceed0b109fd8ec95791366f6012c9571b7d59a83e645d23ade`. A repeat restore correctly refused the populated target; subsequent verification confirmed retained data. Archive directory/file permissions are 0700/0600.
- Focused PostgreSQL 17 container regressions **48 passed, 1 skipped**. The actual-renderer pytest case was not enabled in this run, not counted as passed. Initial harness attempts failed on a mount-path mismatch and an unmigrated separate test database; corrected before the successful run. No application defect was inferred from those setup errors.
- Initial screenshot attempt under Docker's default profile failed with `No usable sandbox`/EPERM. After explicit user approval, `compose.chromium.yml` adds only Playwright's `clone`/`setns`/`unshare` allow rule to the running Docker 29.8.2 engine's exact pinned default profile. A regression verifies the complete remainder's canonical SHA-256; other syscall restrictions are preserved. Base Compose and Zenith remain unchanged. Rendering shares the main app container, so the broader syscall scope for nginx/Uvicorn as well as Chromium is documented in `deploy/seccomp/README.md`.
- `deploy/chromium_check.py` **passes** against actual processes: renderer UID 10001, a distinct single-user UID map, nested PID namespaces, NoNewPrivs 1, Seccomp 2 with 3 filters and zero effective capabilities. Actual browser arguments contain no sandbox-disabling flags. No privileged mode, root browser, extra capabilities, unrestricted seccomp, host networking or new storage mounts were used.
- `container_check.py preview` **passes** an actual JPEG through authenticated MCP/nginx with the prepared opt-in configuration. Focused PostgreSQL 17 container suite with `ZOOMZ_BROWSER_TESTS=1` **50 passed, no skips**, including actual root/nested/close-up images, SDK image transport, scope isolation, concurrency admission/bounds, mid-render revocation regression and the pinned-policy invariant. The existing concurrency/revocation tests use their existing controlled gate/stub; the real-renderer test uses Chromium. No PostgreSQL or backup acceptance was unnecessarily repeated.
- Merged Compose comparison and actual container inspection confirm that only app seccomp changes; UID, no-new-privileges, capabilities, ports, networks and filesystem configuration remain intact. No image rebuild was needed.
- Focused MCP **35 passed**; actual renderer suite **6 passed** with sandboxed Chromium and SDK image results.
- Frontend **31 passed**; lint exit 0 with existing warnings from prior continuation. TypeScript/Vite production build now also passes inside the Dockerfile's Node 24 stage. No frontend source changed during container verification.
- Historical implementation evidence: SQLite Alembic downgrade/re-upgrade round trip and synthetic `mcp_http_smoke.py` through HTTP/Vite. These were not separately repeated during continuation; expanded browser acceptance does use real HTTP SDK calls.
- Expanded `mcp_browser_smoke.py` passes the complete workflow with an invited editor in an independent authenticated browser context. The Note item is named `Note N`; its menu was also obstructed by the draft panel's z-index 30000. The panel now uses control layer 30, below standard overlay layer 50. Ordinary pointer clicks prove the fix.
- Migrated fresh disposable SQLite storage to head; pinned dependency integrity passes. Original virtualenv was transferred from a different Python installation and is unusable; preserved unchanged. Browser binaries and new Python dependencies live only under `/tmp`.

## Blockers and next step

1. Live renderer is explicitly disabled (503). Enabling it requires a separately approved hosting configuration change and secure runtime verification on that host. Public HTTPS SDK authorization and revocation are verified; Claude/Plus writes and attachment transfer remain untested. Dated official research does not establish ordinary Plus write support.
2. Complete realistic lecture acceptance and final security review. The final High-reasoning audit requires the user's separate instruction; no model or reasoning-mode change was made.
3. Before any authorized production rollout, review the app-wide syscall scope and engine-pinned policy, verify the intended host, and confirm actual instance SMTP/public ingress. The optional configuration is prepared and locally tested, not deployed.

Resolved historical blockers: approved Playwright/Chromium installation succeeded; isolated browser tests work; real board screenshots are implemented/tested. The separate in-app browser plugin failure no longer blocks these tests.

## Session policy

One primary agent, no subagents or automatic model changes. The previous session's quota policy does not apply. No commit, push, publication or deployment is authorized.
