# MCP v1 progress

Updated 2026-10-18. **73% weighted, verified estimate.** This is not a time estimate. Only completed items earn credit; in-progress and pending items earn zero. Each phase's substantive items have equal weight within that phase. Weighted total: 73.00%.

`Zoomz MCP v1: [███████████████░░░░░] 73%`

| Phase | Weight | Completed items | Earned |
| --- | ---: | ---: | ---: |
| 0. Repository and feasibility audit | 5% | 4/4 | 5.00% |
| 1. MCP foundation and authentication | 20% | 5/6 | 16.67% |
| 2. Board and element mutations | 20% | 4/5 | 16.00% |
| 3. Generation lifecycle and recovery | 20% | 5/6 | 16.67% |
| 4. Media and visual inspection | 15% | 4/6 | 10.00% |
| 5. Frontend integration | 10% | 1/5 | 2.00% |
| 6. Hardening and acceptance verification | 10% | 4/6 | 6.67% |

## Evidence and remaining work

Status key: **done** means executable/source evidence exists; **in progress** means implemented but incomplete verification; **pending** means absent or blocked.

- **Phase 0.** Done: authoritative source/service review; official MCP/provider feasibility check; concise integration contracts in [README.md](README.md); baseline backend suite, 62 passed and one PostgreSQL-only skip.
- **Phase 1.** Done: official SDK initialization/discovery/tool call; OAuth registration/PKCE/consent; token resource/expiry/rotation/revocation; scoped role enforcement; concurrent single-use consent/code/refresh consumption. In progress: externally reachable end-to-end client authorization. Evidence: `backend/tests/test_mcp.py`, including actual SDK ClientSession over ASGI, not Inspector or provider-account testing.
- **Phase 2.** Done: nested creation and exact geometry; atomic validation/rollback; persisted retry keys and concurrent SQLite retry; source reference persistence/access validation. In progress: verified normal-editor rendering, live collaboration, and existing undo behavior for MCP changes. Existing mutation/event services are reused but that alone is not end-to-end proof.
- **Phase 3.** Done: persisted tasks/checkpoints and continuation by another connection; pause via both backend interfaces with manual edits preserved; revision conflicts on resumption; destructive approval and recoverable snapshot restore. In-flight write/pause coordination now has SQLite concurrency tests through both control paths. In progress: running those tests on PostgreSQL; browser-visible draft progression. Evidence: targeted task, approval, retry, and recovery tests in `test_mcp.py`.
- **Phase 4.** Done: stored inline media through existing validation; source/slide/page metadata and protected-source resolution, including actual source-image/PDF-page MCP results; structural bounds/overlaps/gaps. Source visual tests verify two-page PDF selection, raster aspect ratio, access restrictions, and actual SDK image-result transport. In progress: provider attachment transfer, with mocked transport/security tests but no real provider file; bulk-upload and explicit source association in the UI. Pending: actual rendered-board screenshots. Source page rendering is not a board screenshot.
- **Phase 5.** Done: source indicator, citation dialog, and Escape closure in actual Chromium UI. In progress: connection/consent/permission management; destructive approval/elevation/recovery; complete draft control workflow; multi-file fallback. Consent and UI pause have been exercised, but the whole browser script has not passed, so no complete-workflow credit is awarded.
- **Phase 6.** Done: focused security regressions, **35 MCP tests passed**; frontend suite, 31 passed, plus TypeScript/production build from the prior checkpoint; one independent OAuth/authorization review, with two medium findings corrected and regression-tested; full backend regression, SQLite migration round trip, and synthetic live HTTP/SDK contract exercise through Vite. Latest full backend result: **97 passed, 1 skipped**. The skip requires PostgreSQL. New regressions cover in-flight pause, consistent note-size limits, idempotent revocation, native loopback OAuth callbacks, and slow-drip attachment deadlines. The guarded CI container probe now checks MCP proxy/authentication and task/checkpoint/content/retry persistence across restart and backup restore; only its syntax was checked locally. Pending: actual production container/PostgreSQL verification; real Claude and ChatGPT Plus acceptance, including realistic lecture materials and visual quality. The HTTP test does not substitute for either acceptance requirement.

## Quota policy

**Current checkpoint supersedes older evidence descriptions below.** Actual sandboxed Chromium screenshots now pass root, nested, close-up, SDK image transport, scope, bounds, concurrency admission, and mid-render revocation checks. This completes Phase 4's screenshot item. Actual UI shows MCP changes live, draft status and successful Pause, completing Phase 3's browser-visible progression item; PostgreSQL races remain unverified. Full backend run: **103 passed, 1 skipped**, including six preview tests. Frontend: **31 passed**, lint exit 0 with existing warnings, and successful final TypeScript/Vite build. Source-dialog Escape was reproduced and fixed. Draft panel moved clear of Add controls; the browser workflow now stops at `get_by_role('menuitem', name='Note', exact=True)`, not at screenshot rendering. No complete UI acceptance pass is claimed.

The latest 300-minute allowance is **85% used, 15% remaining**. **Implementation is stopped.** Disposable Vite and Uvicorn servers exited; no new task, test, or phase may start until user resumption. The following previous-checkpoint paragraphs are retained as evidence history, not current blocker status.

The user resumed implementation and changed the stop point to **15% remaining** in the 300-minute window. This supersedes the previous 55% threshold and 50% reserve objective. Latest observed App Server reading: **55% used, 45% remaining**. Weekly usage is not used for this decision. Stop starting work at or below 15% remaining, finish only the atomic step, save this ledger and [HANDOFF.md](HANDOFF.md), clean up owned processes, and end the turn. These checkpoint reads cannot guarantee an exact reserve. Current work is awaiting dependency approval and unavailable test infrastructure, not the quota threshold. No test servers were started during this resume.

## Blockers and qualifications

- Docker Desktop was retried once on the selected context and explicitly on `desktop-linux`; both timed out. No current container or PostgreSQL pass is claimed. No local `psql` or `initdb` was found.
- Browser driver initialization fails with `Importing module "node:process" is not allowed in node_repl`; browser verification has not occurred.
- Real-provider accounts and a public HTTPS test endpoint have not been used. OpenAI's cited help does not establish Plus custom-MCP write support. Ordinary ChatGPT, Work, API, and published-plugin support are distinct.
- Rendered screenshots are not implemented. Structural inspection and links to the actual editor are available.
- Adding the official Playwright Python dependency was blocked by the environment's approval reviewer before execution. User approval was requested; no package was installed and no workaround was attempted. This blocks the chosen actual-renderer screenshot implementation.

Resolved since the previous checkpoint: the user explicitly approved installation; official Playwright 1.64.0, its required Python dependencies, and Chromium headless shell were installed. Actual renderer/browser tests now run in fresh sandboxed contexts. Screenshots are implemented and opt-in; production Linux sandbox support and Docker execution remain unverified. Remote fonts/media are intentionally blocked. Browser-plugin bootstrap remains broken, but is no longer a blocker for the approved isolated application tests. Do not treat the older installation/screenshot blockers above as current.
- The progress ledger is local implementation evidence, not a production-readiness declaration. No production deployment, push, or production-data mutation occurred.
