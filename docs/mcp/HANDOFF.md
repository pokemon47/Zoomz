# Zoomz MCP v1 developer handoff

Updated 2026-10-18 after single-agent implementation continuation. The current status below supersedes the original documentation-only transfer checkpoint.

## Live Zenith preview checkpoint

- Public preview `https://50f96289938d1461-ishaaq426.zh.run`, checked 2026-10-18 from 01:16 UTC. Preview expiry time is unknown. Zenith management reports unauthenticated, so deployment identity/lifetime cannot be inspected through its MCP connection.
- Local branch `MCP_start`, HEAD `87e56a7c4d8ab46cf21121d598a1b052eb6bded3` (`V1 completed`), initially clean. Public JS/CSS assets exactly match local `frontend/dist` bytes. Public health does not expose a backend revision; a matching deployed backend commit is not established.
- Valid public TLS, `/api/health` 200, `/healthz` 200, frontend/login/demo/render shell 200. Production auth configuration reports development login disabled. Anonymous `/api/me`, spaces, MCP connections/tasks/snapshots and MCP initialize return 401; invalid bearer returns 401. Production API docs return 404. OAuth discovery metadata uses this public HTTPS origin and `/mcp` resource. These verify observable ingress behavior, not the host's private nginx configuration.
- Actual sandboxed Playwright browser loads the public login and demo canvas without page errors. Anonymous `/ai` redirects to login. Anonymous public WSS handshake returns 403; authenticated collaboration is not yet verified on this preview.
- Public dynamic client registration returns 201. Insecure remote HTTP, fragment-bearing and credential-bearing callback registrations return 400. A loopback-only disposable SDK helper received explicit user consent for exactly one test workspace; no tokens or callback codes were logged. Its source is ignored `.audit/live_preview_accept.py` and used the retained production image, not new dependencies.
- User reports successful email delivery/sign-in using a controlled temporary account. This is user-observed SMTP evidence, not an independently inspected mailbox. Direct AI settings URL is `/ai`.
- User tested their actual ChatGPT Plus account, confirmed separate ChatGPT OAuth consent completed using the correct preview `/mcp` endpoint, and explicitly selected Zoomz. ChatGPT replied that the app was referenced but its moodboard-reading actions were unavailable. Its app details showed generic developer/version metadata, without a discovered tool list. OAuth success is user-observed; no provider tool invocation/write is evidenced, so **ChatGPT acceptance did not pass**. Investigate tool scan/action enablement/account capability before assigning cause to Zoomz or Plus restrictions. Existing server tools are `list_boards` and `list_workspaces`; the model's suggestion to add `list_moodboards` is not evidence of a missing requirement. User explicitly has not tested Claude. Do not infer provider compatibility from SDK checks.
- At 01:27 UTC actual public browser consent/callback/state/PKCE exchange passed (200), followed by authenticated SDK initialize and 13 discovered tools. In the one explicitly authorized test workspace, created only new board `https://50f96289938d1461-ishaaq426.zh.run/b/f8ace1b8e2304b2d810d3476c34fb459`. Nested atomic creation, exact note geometry, persisted identical retry, child-board read, checkpoint, pause/write rejection (409), resume and finalization passed. Synthetic source-reference content was used, not real lecture material.
- At 01:29 UTC a fresh separately authorized connection read the persisted disposable board. Screenshot error is exactly `Board previews are disabled; configure the sandboxed Chromium runtime first` (503). The deployed renderer is explicitly disabled; do not diagnose this as a Chromium sandbox failure or enable it without hosting approval and secure-runtime verification.
- Public revocation **passes** at 01:29 UTC with both required probe fields supplied: revoke returns 200 and a valid MCP initialize with the revoked token returns **401**. First harness omitted MCP Accept headers (406); second omitted required revocation `client_id`, correctly leaving access active (200). These were harness mistakes, not application defects. All owned loopback helper containers exited and were automatically removed. Earlier test connections named `Zoomz live preview acceptance` should be revoked through `/ai`; their credentials were memory-only and were not printed or saved.
- Public-client authorization now satisfies Phase 1 item 6. Weighted estimate **96%**, exact 95.83%. Live renderer failure remains a rollout blocker despite previous local sandbox acceptance. Source/provider/lecture acceptance and separately authorized final audit remain incomplete.
- No deployment, hosting configuration, production credentials, pre-existing boards or persistent Docker volumes were changed. Next immediate task is inspect the user's redacted ChatGPT app tool/action list, refresh/scan if available, then retry a new chat. Current OpenAI official guidance limits full custom MCP to Business/Enterprise/Edu; the observed Plus UI alone does not prove executable tools. Source: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt (checked 2026-10-18). Claude is not tested in this session. Real lecture/source attachment, host-enabled screenshot acceptance and final audit remain open.

## Prior sandbox checkpoint

- User explicitly approved testing Playwright's documented namespace seccomp policy while retaining all other security constraints. **93% weighted verified estimate**, exact 92.50%; Phase 6 now earns 5/6 items. No production deployment, push, merge or volume deletion.
- Verified `mcp_preview.py` already passes `chromium_sandbox=True`, with no sandbox-disabling arguments. No application launch change was required. Used the retained image and source project; no rebuild or repeat PostgreSQL/backup investigation.
- Added `deploy/seccomp/chromium.json`: the exact Docker 29.8.2 engine baseline at Moby commit `8af9fe3a36bab3e039862a2ab1cef1880c9b4d03`, dependency `moby/profiles/seccomp v0.2.3`, plus only Playwright's unconditional `clone`, `setns`, `unshare` allow rule. Default-deny action and all other rules/architecture/capability/argument filters are unchanged. `backend/tests/test_deployment.py` checks the exact added rule and canonical SHA-256 of the complete remaining baseline. Upstream license is retained.
- Initially applied through ignored `.audit/compose.chromium-test.yml`, then verified the prepared **opt-in** `compose.chromium.yml`. Base `compose.production.yml` and Zenith are unchanged. Main app container UID 10001/no-new-privileges/no added capabilities are retained. A merged-config comparison proves only app seccomp changes; actual container inspection confirms policy and loopback port bindings. The profile affects nginx/Uvicorn too because the existing renderer lives inside their container. Security scope, engine-upgrade review and usage are documented in `deploy/seccomp/README.md`.
- Added guarded read-only `deploy/chromium_check.py`. Actual Chromium renderer processes pass distinct user-namespace UID map, nested PID namespace, all visible UIDs 10001, NoNewPrivs 1, Seccomp 2, 3 installed filters versus its browser parent's 2, and zero effective capabilities. Actual browser command line has no sandbox-disabling flags. Headless shell has no `chrome://sandbox`, so the check reads kernel process state instead. Observed UID map `10001 10001 1`, NSpid `479 4 1` in the final probe.
- Actual `container_check.py preview` passes through authenticated MCP/nginx with JPEG decoding, dimensions/revision checks and the actual SpaceCanvas renderer. Focused suite inside a disposable non-root/profile-enabled test container passes **50 tests, no skips**, with real renderer tests enabled. Covers root/nested/close-up images, SDK image transport, scope isolation, concurrency admission/bounds, controlled mid-render revocation and the pinned-profile regression. Existing concurrency/revocation tests retain their controlled gate/stub; the real-renderer case runs Chromium.
- Regression container shared only the disposable app's private network namespace to reach its actual built frontend on loopback, used separate migrated database `zoomz_mcp_sandbox_suite`, and mounted test code read-only. It was removed automatically. The app's own network, filesystem mounts, ports, credentials, roles, preview interception, admission and resource limits remain unchanged.
- Branch remains `MCP_start` at `3ddd8c5`; previous uncommitted work is intact. Additional files in this follow-up are the optional Compose override, profile/provenance/license, sandbox checker, deployment regression and MCP documentation. No source redesign, new renderer service, paid inference or broader permission escalation.
- Next requirements are authorized public HTTPS/OAuth plus real Claude/ChatGPT Plus/media/lecture acceptance, actual instance SMTP/public ingress, and the separately requested comprehensive audit. The local container milestone is complete; production rollout remains unauthorized. Use both Compose files whenever starting/recreating an opted-in app, or the default policy will be restored.
- The owned test stack was stopped after successful acceptance; the recovery stack remains stopped. All existing persistent volumes, image tags and the prior paired backup are retained. Resume with the optional override and do not reseed existing data or restore over the populated target.

## Prior container checkpoint

- Still `MCP_start` at `3ddd8c5`. All prior uncommitted work preserved. Added only guarded acceptance checks in `deploy/container_check.py` and updated MCP documentation; Dockerfile, Compose, nginx, app code, dependencies and security settings are unchanged in this container follow-up. No push, merge, deployment or production-data access.
- **91% remains the weighted verified estimate**, exact 90.83%. Container build/persistence/recovery is verified, but the remaining production acceptance item stays open because actual production screenshots fail. Do not award the whole item for partial acceptance.
- Docker Engine 29.8.2 / Compose 5.6.0 work through WSL 2 with 7.43 GiB engine RAM. Built the existing image once, including Node 24 TypeScript/Vite build and Python 3.12 runtime/browser dependencies. Image `sha256:0d4deeefc41565ceed0b109fd8ec95791366f6012c9571b7d59a83e645d23ade` has both `zoomz-mcp-v1-test-app:latest` and `zoomz-mcp-v1-restore-app:latest` tags, without a second build.
- Created only new projects `zoomz-mcp-v1-test` and `zoomz-mcp-v1-restore`. Their env files are ignored `.audit/mcp-container.env` and `.audit/mcp-container-restore.env`, with synthetic local credentials and invalid SMTP/public hosts. App is production-configured, UID 10001, nonprivileged, `no-new-privileges:true`; nginx binds loopback ports 18087/18088. Backend/database ports remain unpublished.
- PostgreSQL **17.11**, migrations through `a90b4a770001`, Alembic schema check and pip check pass. Guarded `container_check.py verify` passes nginx health/demo/render-shell/auth routes, production auth config and anonymous rejection, HTTPS OAuth metadata, actual authenticated SDK calls, protected media checksum, WebSocket viewer rejection, persisted task/checkpoint/content and exact idempotent retry.
- Restarted both database/app; the probe passes afterward. Existing `deploy/backup.py` created paired archive `/tmp/zoomz-mcp-v1-container-backups/zoomz-backup-20261018T003838Z-4gy6dukk.tar`, directory 0700/archive 0600. Restored into the second initially empty project's new volumes and verified media/MCP state. A second restore refused the populated target; verification after restarting the stopped app confirmed no data loss.
- Focused MCP/preview-boundary/deployment tests inside a disposable production-image container against separate migrated database `zoomz_mcp_suite` passed **48 tests, 1 skipped**. The real-renderer pytest case was not enabled and is not counted as passed. Two initial harness attempts failed due to a backup-module mount-path mismatch and an unmigrated test database; corrected before rerunning. Those were setup mistakes, not app failures.
- **Actual screenshot check fails.** New `container_check.py preview` requires an authenticated MCP JPEG with renderer/revision/dimensions and decodes it. It currently receives generic 503. Direct `chromium_sandbox=True` launch reports **No usable sandbox**. Container diagnostics show UID 10001, NoNewPrivs 1, Seccomp 2, namespace limit 30401, and `unshare(CLONE_NEWUSER)` returning EPERM. App/database memory was about 104/41 MiB, not OOM. No repeated image rebuilds or security relaxation.
- Next action requires operator direction on the runtime policy. [Playwright's Docker guidance](https://playwright.dev/python/docs/docker#crawling-and-scraping) specifies non-root plus a seccomp profile permitting `clone`, `setns`, `unshare` for the Chromium namespace sandbox. Approval would permit preparing/testing that documented profile while retaining non-root, no-new-privileges, no added capabilities and Chromium sandboxing. No custom profile, disabled sandbox, privileged mode, extra capabilities or host policy changes have been applied. Reuse the retained image/data after approval; no architecture investigation or rebuild is needed.
- Real public HTTPS/OAuth, Claude and ChatGPT Plus account/media acceptance, realistic lecture assessment and final comprehensive audit remain separate and unverified. Local nginx forwarding is not public hosting, and synthetic credentials are not real-client proof.
- Both owned Compose projects were stopped after verification. Their containers, image tags, independent volumes and paired archive remain intact for follow-up. No volume/image cleanup was performed. Start only these named projects when resuming; never reseed the retained fixture or restore over its populated target.

## Prior editor/PostgreSQL checkpoint

- Branch `MCP_start`, HEAD `3ddd8c520e5198927d40d4b941e0bce86e67fe26`. Initially clean. No commit, push, deployment or production action performed. Origin remains `git@github.com:pokemon47/Zoomz.git`; remote contents were not queried.
- **91% weighted verified completion**, exact sum 90.83%. Existing scoring retained. Phase 5 is verified; Phase 6 production/provider acceptance remains open.
- Fixed the only reproduced application defect in `frontend/src/pages/BoardPage.tsx`: draft panel layer 30000 intercepted Add menu clicks. It now uses control layer 30 below standard overlays at 50. No camera or canvas redesign.
- Extended `backend/tests/mcp_browser_smoke.py`. Actual sandboxed Chromium passes login/OAuth consent, an invited editor in a separate authenticated context, live MCP changes, editing generated text, raised-card drag/resize/undo, manual creation/undo/redo while paused, resume, root/child/grandchild entry/exit, bulk text/PDF/image upload, exact source association and original bytes, unsigned anonymous rejection, actual PDF-page SDK image, board/workspace/all grants, read-only enforcement, exact approval, snapshot restore, one-task elevation, reload persistence, UI finalization and revocation. The menu's accessible name is `Note N`; the corrected test uses ordinary pointer clicks. Populated textareas and select fields use their accessible roles.
- Added guarded `backend/tests/mcp_restart_smoke.py`. Seed runs on disposable loopback PostgreSQL with temporary private state/media. After a real PostgreSQL restart, verify in a fresh application process proves OAuth credential persistence, paused-write rejection, checkpoint/source retention, idempotent retry without duplication, manual-edit preservation, media decoding and finalization by a new connection. No synthetic credentials enter source control.
- Verification this session: SQLite backend **103 passed, 1 PostgreSQL-only skip**; PostgreSQL 16.15 backend **104 passed, no skips**. Both included actual Chromium renderer tests. PostgreSQL Alembic upgrade/check passed. Frontend **31 passed**, lint exit 0 with existing warnings, TypeScript/Vite build passed. Pinned Python dependency integrity passed. Node is **22.14**, so production Node 24 is not verified here.
- Working changes are the two browser/restart scripts, `BoardPage.tsx`, and MCP handoff/progress/setup/reference documentation. Runtime dependencies and lockfiles are unchanged. `.audit/mcp-v1.todo.md` is ignored local planning.
- The transferred `backend/.venv` targets another Python installation and cannot import dependencies. Preserved unchanged. Existing pinned dependencies are installed in `/tmp/zoomz-mcp-v1-env`; Chromium is in `/tmp/zoomz-mcp-v1-browsers`. PostgreSQL 16.15 packages were extracted under `/tmp/zoomz-mcp-postgres.PmZpyo`, without installing a system service. Disposable UI SQLite/media is `/tmp/zoomz-mcp-v1.PkckrX`.
- All owned frontend, backend and PostgreSQL services were stopped after verification. Temporary test data remains under `/tmp`; the private restart-state JSON contains synthetic OAuth credentials and must not be committed or shared.
- Remaining requirements need a working Docker/runtime and authorized public HTTPS/account access: production PostgreSQL 17/container/nginx/Chromium/paired backup restore; real Claude and ordinary ChatGPT Plus acceptance and actual transferable provider media; realistic lecture composition and visual/educational assessment. No provider compatibility is claimed. Final comprehensive High-reasoning/security audit remains deferred to the user's separate instruction.
- Next task is production acceptance on a Docker-capable machine using existing CI/container probe, then provider acceptance on an explicitly authorized public endpoint. Do not repeat the local browser or PostgreSQL investigation unless changing relevant code. No inherited quota threshold applies; no subagents or automatic model changes.

## Original transfer record

The remaining sections preserve the original 73% handoff baseline and rationale. Their historical pending-work and environment statements are superseded by the continuation checkpoint above and current PROGRESS.md.

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
