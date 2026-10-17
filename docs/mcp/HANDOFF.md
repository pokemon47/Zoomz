# Zoomz MCP v1 developer handoff

Updated 2026-10-18. This replaces earlier contradictory checkpoint history. No features, services, browser sessions, dependency installations, or test suites ran during this documentation-only handoff.

## A. Executive summary

Zoomz MCP lets users' existing AI assistants build real editable nested moodboards. The assistant supplies reasoning and composition. Zoomz supplies scoped tools, normal scene operations, persistence, media, rendering, and durable drafts. No paid LLM inference, separate AI backend, gateway, or parallel canvas model was added.

**73% weighted verified completion.** Backend functionality and real Chromium screenshots are substantially implemented. Full editor browser acceptance, PostgreSQL/container execution, public OAuth, and real Claude/ChatGPT Plus acceptance remain incomplete. This is not a production-readiness declaration. [SPECIFICATION.md](SPECIFICATION.md) preserves the approved scope; [PROGRESS.md](PROGRESS.md) scores actual evidence.

## B. Repository state and transfer

- Branch `MCP_start`.
- Code baseline HEAD `5a1c7222f35fe9de766991b0bae026d3b5f4e891`.
- Subject `almost doen can continue based on docs/progress and docs/handoff`.
- Working tree was **clean** at handoff start. Older claims that MCP implementation files were uncommitted are obsolete.
- Local `origin/MCP_start` matches that SHA. Live `git ls-remote` failed in this environment, so the remote's current contents are not independently confirmed.
- This handoff modifies only five existing documentation files and adds SPECIFICATION.md. No newly untracked implementation, migration, dependency, or generated artifacts were present.

All of these required source artifacts are already tracked in the baseline:

```text
backend/app/mcp_access.py          backend/app/mcp_download.py
backend/app/mcp_models.py          backend/app/mcp_preview.py
backend/app/mcp_schema.py          backend/app/mcp_server.py
backend/app/mcp_service.py         backend/app/mcp_ui.py
backend/alembic/versions/a90b4a770001_mcp.py
backend/tests/test_mcp.py          backend/tests/test_mcp_preview.py
backend/tests/mcp_http_smoke.py    backend/tests/mcp_browser_smoke.py
frontend/src/pages/AiPage.tsx      frontend/src/pages/McpRenderPage.tsx
frontend/src/components/app/SourceIndicator.tsx
```

Transfer the **whole branch**, including its existing integration changes to backend main/ops/files/media/live, Alembic registration, frontend routing/types/BoardPage/SpaceCanvas/TopBar, runtime requirements/lockfiles, Dockerfile, Compose/env example, nginx/Vite routing, CI, container probe, and docs. Do not transfer private environment files, databases, node_modules, virtual environments, browser caches, ignored audit files, or temporary screenshots as source artifacts. Locally installed skills are not application dependencies.

After reviewing the documentation diff, the user may run the following. **The handoff agent has not committed or pushed.**

```sh
git switch MCP_start
git diff --check
git add -- docs/mcp/HANDOFF.md docs/mcp/PROGRESS.md docs/mcp/SPECIFICATION.md docs/mcp/SETUP.md docs/mcp/REFERENCE.md docs/mcp/README.md
git diff --cached --stat
git diff --cached --check
git commit -m "Document Zoomz MCP v1 engineering handoff"
git push origin MCP_start
```

If the push is rejected, inspect the remote changes. Do not force-push. Confirm the shared branch before telling the recipient to clone it. The documentation commit will have a different SHA from the baseline.

Alternatively, **after committing the documents**, run `git bundle create zoomz-mcp-handoff.bundle MCP_start`. The recipient runs `git clone -b MCP_start /path/to/zoomz-mcp-handoff.bundle zoomz`. Bundles omit uncommitted/ignored files. Review repository history before sharing outside trusted collaborators.

## C. Documents to read, in order

1. Root [AGENTS.md](../../AGENTS.md).
2. [SPECIFICATION.md](SPECIFICATION.md), approved requirements.
3. [PROGRESS.md](PROGRESS.md), evidence and scoring.
4. [SETUP.md](SETUP.md), commands and verification qualifications.
5. [REFERENCE.md](REFERENCE.md), implemented tools, security, models, and limits.
6. Relevant sections of [CODEBASE_OVERVIEW.md](../CODEBASE_OVERVIEW.md) for normal scene/store/camera behavior.

[README.md](README.md) retains the concise plan and dated provider research. Read affected source/tests as needed, not another full repository audit.

## D. Implemented architecture

React 19/TypeScript/Vite and the Python 3.12 FastAPI/SQLAlchemy backend remain authoritative. Node 24 is supported.

- `backend/app/mcp_server.py`: official SDK 1.30.0 stateless Streamable HTTP at `/mcp`. `build_server()` and `install()` integrate with FastAPI lifespan; `Verifier.verify_token()` and `current_connection()` bind requests to grants.
- `mcp_access.py`: OAuth discovery/registration/consent/PKCE/token rotation/revocation, role/scope checks, transaction locks. `mcp_ui.py`: cookie-authenticated connections, approvals, tasks, protected sources, recovery.
- `mcp_service.py`: normal `Node`, `Space.seq`, `ops.apply(..., commit=False)`, uploads, and `live.hub`. One transaction covers scene changes, retry results, approval consumption, audits, and checkpoints. Normal editor callers keep default commit behavior.
- `mcp_models.py` and migration `a90b4a770001`: eight OAuth/connection/task/retry/approval/audit tables. SQLite immediate transactions are tested; PostgreSQL row-lock behavior is not locally verified.
- `AiPage.tsx`: consent, connections/grants, approvals/recovery and draft controls; `DraftStatus` polls every three seconds outside the canvas loop. `BoardPage.tsx` displays draft state; `SourceIndicator.tsx` displays citations. Existing WebSockets publish normal operations.
- `mcp_preview.py`: isolated sandboxed Chromium renders an authorized snapshot through the actual `McpRenderPage.tsx`/`SpaceCanvas.tsx`. No user cookies/tokens reach Chromium. External requests and WebSockets are blocked; authorization is checked before and after capture. Async MCP capture offloads blocking browser work to a thread.

Preserve flat nodes linked by parentId, board-local coordinates, rank as stacking, z as elevation, and stable content.frame. Do not replace the camera or invent preview geometry. Details and exact limits are in REFERENCE.md.

## E. Verified functionality

These are recorded implementation-session results, **not reruns during handoff**:

| Check | Latest recorded outcome |
| --- | --- |
| Full backend with real-renderer fixtures | **103 passed, 1 skipped**, 8.73 seconds. PostgreSQL-only coverage skipped. |
| Focused test_mcp.py | **35 passed**, before the separate preview suite was added. |
| Real test_mcp_preview.py | **6 passed**, sandboxed Chromium, nested/close-up rendering, image transport, scope, bounds, admission and mid-render revocation. |
| Frontend tests | **31 passed**. |
| Frontend lint | Exit 0 with warnings, including two async-effect warnings. |
| Frontend build | TypeScript and Vite passed after the latest dialog/draft-position fixes. |
| SQLite migrations | Upgrade/check/downgrade to 7de3a94355d8/re-upgrade/check passed with disposable storage. |
| Dependency integrity | pip check passed. |
| Local HTTP smoke | Real SDK/OAuth and synthetic nested generation through Vite passed. Not real-provider or lecture acceptance. |
| Narrow independent review | Two medium OAuth/destructive-edit findings corrected with regressions. Not a final comprehensive audit. |

Tests cover token/resource/current-role/scope enforcement, atomic nested batches, exact geometry, retries/conflicts, source references, SQLite pause/write races, persisted continuation, approval/elevation, and recovery.

Actual browser observations include normal sign-in, selected-workspace consent, live MCP writes over WebSockets, citation dialog and Escape, draft generation status, and successful Pause. Actual nested/close-up screenshots were visually inspected. Temporary image artifacts are disposable, not required for transfer.

## F. Known bugs and blockers

- Current browser script stops at `get_by_role('menuitem', name='Note', exact=True).click()` after Add opens. A shortcut may make its accessible name include N. This is an **unconfirmed explanation**, not a proven app bug. Later script steps have not passed.
- Already fixed: Vite wrongly proxying /mcp-render; disabled preview WebSockets; source-dialog Escape; draft panel covering Add. The current build includes these fixes.
- The separate in-app browser plugin's node:process bootstrap error is **not a blocker** for the approved isolated Playwright tests, which now work.
- Docker timed out on default and desktop-linux contexts; no local psql/initdb was available. No current container, PostgreSQL concurrency, production Chromium sandbox, restart/recovery, or hosted streaming pass is claimed. Another machine may resolve this.
- No public HTTPS OAuth, real Claude, real ChatGPT Plus, or Inspector acceptance. Dated research does not establish ordinary Plus custom write support. Work, API, ordinary chat, and published plugins are distinct. No Zoomz plugin was published.
- Provider attachment transfer has mocked transport/security evidence, not actual provider bytes. Presentation originals can be stored; native PowerPoint extraction is not implemented.
- Full permission/elevation/recovery UI, bulk/source association, normal editor undo/redo/collaboration acceptance, realistic lecture curation, and final high-reasoning/security review remain incomplete.

## G. Remaining work, prioritised

| Objective and relevant files | Next step and acceptance |
| --- | --- |
| Finish browser workflow: backend/tests/mcp_browser_smoke.py, frontend components/zoomboard/AddMenu.tsx, AiPage.tsx, BoardPage.tsx. | Inspect Note's actual accessible name. Correct test or app only as evidence warrants. Run the complete script on disposable data. Verify manual edits, undo/redo, pause/resume, grant changes, approvals, reload, finalization and revocation. Exercise elevation/recovery separately if needed. |
| Normal editor integration: lib/store.ts, SpaceCanvas.tsx, ops.py, live.py, test_mcp.py. | Two authenticated sessions must observe MCP edits and retain normal editing and root/child/grandchild navigation. Establish actual undo/revision semantics; do not assume AI operations enter a user's local undo history. |
| PostgreSQL/production: test_mcp.py, migration, Dockerfile, Compose, nginx, CI, deploy/container_check.py. | Apply migrations on disposable PostgreSQL; test locks/pause/retries/credential consumption. Build/start non-root image, verify streaming and sandboxed screenshots, restart persistence, paired backup restore. No sandbox weakening. |
| Media/source workflow: files.py, mcp_download.py, mcp_service.py, SourceIndicator, browser smoke. | Multi-file supported originals, raster and PDF-page results must render and associate exact asset references with protected access. Test missing/uncertain sources. Test real attachment transfer only with a genuine client contract. |
| Public OAuth and actual clients: mcp_access.py, mcp_server.py, nginx, SETUP.md. | With hosting/account authorization, verify HTTPS discovery/consent/refresh/revoke in Claude and Plus. Record plan/surface/date/approvals/writes/media separately. Document exact external blockers rather than claim compatibility. |
| Realistic acceptance and final review: SPECIFICATION.md and affected boundaries. | Several lecture documents with text/diagrams/tables/equations must produce useful editable nested composition. Exercise both pause controls, manual edits/resume, new-conversation continuation, retries, approvals, finalization and persistence. Assess visual/educational quality. Complete security/high-reasoning review and relevant regressions. |

Existing CI/probes are implementation, not evidence that remote CI or restore passed. Optional layout helpers do not justify an editor rewrite.

## H. Development environment

Use SETUP.md for fresh installation and exact commands. Fresh-machine bootstrap is not yet verified as one complete procedure. Playwright 1.64.0 and Chromium headless shell are runtime dependencies for screenshots as well as development test requirements. No duplicate npm browser package is needed.

Use disposable SQLite/media and synthetic accounts, never real account data. No owned app/browser processes remained at the implementation checkpoint; none were started for this handoff. Local temporary databases are not needed to resume.

## I. Safety and security constraints

- Enforce current roles and per-connection scope on every read/write/retry/file/preview, including after revocation.
- Preserve exact OAuth callback/resource binding, PKCE, hashes, rotation, expiration, CSRF on cookie-management writes, generic errors, and secret-free logs.
- Never trust AI claims of approval. Hosted consent binds user, connection, exact operation, revision, expiration and single use. Elevation is authenticated and revocable.
- Preserve atomic retries/checkpoints/audits, revision conflicts, pause/write serialization and recoverable destructive edits.
- Citations are not independently fact-checked. Stored document content cannot alter server authority.
- Keep remote-fetch host opt-in, public-IP/DNS pinning, TLS validation, deadlines, quotas, private assets and cleanup.
- Chromium stays isolated, sandboxed, bounded and credential-free. Never use no-sandbox, privileged mode or extra capabilities to force a pass.
- Keep one backend worker because rooms/rate limits are process-local. Preserve HTTPS, PostgreSQL, persistent media, SMTP, backups, non-root execution and existing Zenith security.
- Use one agent and targeted verification. Use poteto-mode if installed; report absence rather than installing automatically. No paid inference workaround or production changes without approval.

## J. Suggested first task

Inspect and resolve the Note menu interaction in the existing browser smoke script, then finish that script against disposable local data. This unlocks the largest current integration gap without repeating architecture discovery.

## K. Copyable continuation prompt

```text
Continue Zoomz MCP v1 on MCP_start. Read AGENTS.md and docs/mcp/HANDOFF.md first, then SPECIFICATION.md, PROGRESS.md, and relevant SETUP.md commands. Inspect Git status and preserve unrelated work. Do not repeat completed repository/provider discovery. Use one agent and Medium reasoning, with poteto-mode if installed. First inspect the actual accessible name of Add > Note and resolve backend/tests/mcp_browser_smoke.py's current failure using disposable data. Complete the browser workflow, then follow HANDOFF.md's remaining priorities. Keep actual SpaceCanvas previews and all role/scope/approval/atomicity/revision boundaries. No paid inference. Update weighted progress only from verified evidence. Distinguish SDK, browser, Docker, Claude and ChatGPT Plus results. Do not commit, push, deploy or change production without permission. Ask the new operator for its quota policy; do not inherit the previous session's documentation-only exception.
```

The final handoff session observed **87% used / 13% remaining** in the actual 300-minute window before writing. The user authorized documentation only below the usual 15% stop point. That exception ends with this handoff. No exact reserve is guaranteed.
