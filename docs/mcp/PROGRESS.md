# MCP v1 progress

Updated 2026-10-18. **73% weighted verified estimate**, not remaining time or production readiness. Equal substantive item weights within each phase. Only verified completed items earn credit; in-progress/pending earn zero. Documentation cleanup earns no implementation credit.

`Zoomz MCP v1: [███████████████░░░░░] 73%`

Current phase: Phase 5 frontend integration and Phase 6 acceptance verification.

| Phase | Weight | Verified items | Earned |
| --- | ---: | ---: | ---: |
| 0. Repository and feasibility audit | 5% | 4/4 | 5.00% |
| 1. MCP foundation and authentication | 20% | 5/6 | 16.67% |
| 2. Board and element mutations | 20% | 4/5 | 16.00% |
| 3. Generation lifecycle and recovery | 20% | 5/6 | 16.67% |
| 4. Media and visual inspection | 15% | 4/6 | 10.00% |
| 5. Frontend integration | 10% | 1/5 | 2.00% |
| 6. Hardening and acceptance verification | 10% | 4/6 | 6.67% |

Unrounded sum **73.00%**; displayed phase values are rounded separately.

## Substantive requirements

- **Phase 0. Completed (4):** authoritative source review; reusable contracts/service review; official MCP/provider feasibility baseline; baseline verification. Dated research is not real-client acceptance.
- **Phase 1. Completed (5):** official SDK protocol/tools; registration/PKCE/consent; resource-bound expiry/rotation/revocation; current-role/scope enforcement; concurrent one-use credential consumption. **In progress (1):** public HTTPS client authorization. Evidence: test_mcp.py, actual SDK over ASGI/local HTTP, not Inspector or provider accounts.
- **Phase 2. Completed (4):** nested creation/exact geometry; atomic validation/rollback; persisted retries/concurrent SQLite retries; source-reference persistence/access validation. **In progress (1):** complete normal-editor rendering/collaboration/undo acceptance. Live browser operation delivery is observed but not the full workflow.
- **Phase 3. Completed (5):** lifecycle/checkpoints/new-connection continuation; pause through both backend interfaces/manual edits preserved; fresh-revision conflicts and approval/snapshot recovery; SQLite in-flight pause/write coordination; browser-visible generating status/Pause. **Pending, environment-blocked (1):** equivalent PostgreSQL concurrency verification. Full UI resume is separately unverified in Phase 5.
- **Phase 4. Completed (4):** inline media through existing validation; protected refs and real source-image/PDF-page results; structural bounds/overlaps/gaps; real sandboxed Chromium board screenshots, including nested/close-up. **In progress (2):** actual provider attachment transfer, mocked transport/security only; complete bulk-upload/source association. Native PowerPoint extraction is not implemented.
- **Phase 5. Completed (1):** actual-browser source indicator/citation dialog/Escape. **In progress (4):** full connection/permission management; approval/elevation/recovery; complete draft pause/manual-edit/resume/finalization; multi-file fallback. Consent and Pause have partial browser evidence, not whole-workflow credit.
- **Phase 6. Completed (4):** focused security regressions; frontend checks/build; narrow independent OAuth/permission review and fixes; full SQLite regression/migration round trip/synthetic HTTP SDK. **Pending (2):** PostgreSQL/production image/restart/recovery acceptance; real Claude/Plus and realistic lecture acceptance. Final security/high-reasoning review remains required, not already satisfied by the narrow review.

## Latest recorded evidence

Preserved from implementation, not rerun during handoff:

- Full backend **103 passed, 1 skipped**, with `ZOOMZ_BROWSER_TESTS=1 MCP_RENDER_ORIGIN=http://127.0.0.1:5178 .venv/bin/python -m pytest -q --tb=short`. PostgreSQL-dependent coverage skipped.
- Focused MCP **35 passed**; actual renderer suite **6 passed** with sandboxed Chromium and SDK image results.
- Frontend **31 passed**; lint exit 0 with warnings; final TypeScript/Vite build passed.
- SQLite Alembic upgrade/check/downgrade/re-upgrade/check and pip check passed.
- Synthetic local mcp_http_smoke.py passed through HTTP/Vite; not provider/lecture acceptance.
- Browser script verified login, consent, live changes, citations, generating status and Pause, then failed selecting Note by exact accessible name. Later steps remain unverified.

## Blockers and next step

1. Inspect Note menu accessibility and finish backend/tests/mcp_browser_smoke.py. [HANDOFF.md](HANDOFF.md) identifies relevant files and acceptance.
2. Working Docker/PostgreSQL environment. Both locally tried Docker contexts timed out; no current image/PG pass.
3. Authorized public HTTPS endpoint and real accounts. Claude/Plus writes and attachment transfer untested. Dated official research does not establish ordinary Plus write support.
4. Complete realistic lecture acceptance, production sandbox/recovery and final security review.

Resolved historical blockers: approved Playwright/Chromium installation succeeded; isolated browser tests work; real board screenshots are implemented/tested. The separate in-app browser plugin failure no longer blocks these tests.

## Quota checkpoint

Normal previous-session stop point was 15% remaining in the **300-minute** window. The documentation-only exception began at **87% used / 13% remaining**, aiming to preserve 10% where possible. It authorizes no feature work. No owned app/browser processes remain and none were started for handoff. New sessions must establish their operator's quota policy. No exact reserve is guaranteed.
