# Approved Zoomz MCP v1 specification

This preserves the approved requirements, not a claim of implementation. [PROGRESS.md](PROGRESS.md) records completion; [REFERENCE.md](REFERENCE.md) describes current contracts.

## Product and platform contract

Users bring their existing AI assistant and subscription. The assistant interprets materials, selects important content, writes explanations, and controls composition. Zoomz supplies authenticated MCP tools, genuine editable canvas elements, nested boards, persistence, media, rendering, collaboration, and generation management. No mandatory paid LLM API, separate inference backend, or parallel scene model.

**Claude and ChatGPT Plus are both first-class targets.** Use provider-neutral standards-compliant remote MCP, preferably official Python SDK Streamable HTTP within FastAPI. Verify actual account/plan/product capabilities. Ordinary ChatGPT, Work, API, and published integrations differ. SDK/mock/Inspector success is not real-client proof. Implement the best supported path and report exact external restrictions without silently dropping Plus or substituting paid inference. Other compatible clients must remain possible.

## Content and composition

- Create normal editable existing Zoomz elements and nested boards, preserving rendering, movement, resizing, search, permissions, persistence, collaboration, and existing undo/revision behavior where available.
- Curate important source material by default, rather than copying every page. Honor explicit requests to preserve complete available sources. Let the assistant choose whole slides, diagrams, tables, equations, excerpts, and explanations case by case.
- Prefer user sources. Distinguish source-derived, supplementary AI-generated, and external content. Honor source-only requests.
- The assistant controls exact positions, dimensions, hierarchy, proximity, and supported relationships. Do not silently replace valid coordinates. Optional deterministic layout aids supplement composition. Do not add unsupported element types merely because an example mentions them.
- Support structural geometry/bounds/overlap inspection and actual renderer previews at useful zoom levels, followed by precise refinement. Do not create a misleading replacement renderer.

## Connections, authentication, and authority

- Provide honest guided Claude/ChatGPT setup, manual instance-specific endpoint, connection/grant management, and revocation. Do not imply unsupported one-click integration.
- Each connection authenticates as an existing individual Zoomz user. Implement applicable MCP OAuth discovery/resource metadata, registration, exact redirect validation, PKCE, resource/audience binding, expiration, refresh rotation, and revocation. No shared administrator credential or exposed internal signing secrets.
- Default to explicitly selected workspaces. Support selected boards and explicitly authorized all-access. Read-only versus creation/edit is independently configurable. Every resource/operation must intersect grants with current user roles. AI instructions cannot enlarge authority.
- Destructive deletion, substantial replacement/restructuring, and other material destruction default to secure approval. Alternatively block destruction or allow explicit elevation. Never accept an AI-supplied approval flag as evidence.
- Use verifiable client approval only where available. Otherwise provide authenticated Zoomz approval bound to user, connection, target, exact operation parameters, expiration, revision where relevant, and constrained single use. Prevent replay/substitution.
- Elevation supports one task by default, time-limited access, or persistent until revoked. Enforce expiration/revocation immediately. Audit sensitive changes and preserve recoverable state before significant destruction.
- Routine generation/editing is autonomous by default. Optional planning-first approval is distinct from destructive approval.

## Tools, transactions, and concurrency

- Capabilities describe supported types, operations, coordinates, limits, permissions, tasks, media, layout aids, and previews.
- Bounded/paginated discovery/search reveals only authorized workspaces, boards, elements, hierarchy, geometry, content, references, assets, revisions, and previews.
- Structured batches create nested boards and existing element types; update/move/resize/reparent; manage references and supported relationships; and delete with appropriate authority. Temporary references resolve to stable server IDs. Preserve valid exact geometry and hierarchy invariants.
- Validate entire batches before applying them. Transactions are atomic, including safe file staging/cleanup. Failure must not partially commit or undo earlier successful batches.
- Persist idempotency across restart: identical retries return previous results after current authorization checks; different data under a reused key is rejected. Lost responses must not duplicate elements.
- Optimistic revisions reject stale writes instead of overwriting newer manual changes. Return structured conflict information. Destructive retries retain their authorization/consumption protections.
- Reuse normal models, mutation/upload services, live events, and recovery. Support SQLite development and PostgreSQL production.

## Sources and media

- Preserve available title, filename, asset ID, page, slide, section, excerpt/location, URL, classification, and availability. Never fabricate missing metadata. Validate reference structure/access without claiming independent factual verification.
- Provide unobtrusive clickable references and protected originals, opening relevant pages/slides where supported. Preserve known details and explain when originals are unavailable.
- Prefer automatic transfer of genuinely available AI-chat media. Do not assume an attachment the assistant analyzed exposes bytes or transferable URLs. Avoid huge base64 arguments when a reliable alternative exists.
- Offer optional direct multi-file upload without demanding manual categorization. Associate exact sources where possible and flag uncertain matches instead of guessing. Missing originals must not block structured content.
- Prioritize reliable existing PDF, image, presentation-original, and document handling. Native parsing of every format is not required. State clearly what is stored versus extracted/rendered.
- Enforce authentication, asset permissions, file/body quotas, validated media, safe filenames, private storage, staged cleanup, controlled downloads, and SSRF protection. Do not fetch arbitrary model-proposed URLs.

## Live drafts, pause, and continuation

- Persist created/generating/paused/interrupted/completed/failed/cancelled states or equivalent. Show progressive normal scene edits and incomplete-draft status. Disconnecting does not finalize.
- Both Zoomz and MCP pause/resume use the same persistent state. Serialize pause with in-flight writes. Reject applicable AI mutations while paused; permit reads/manual edits. Resume from inspected fresh revisions without losing manual changes.
- Pausing Zoomz does not suspend provider inference. Further execution may require another user instruction. Do not promise automatic inference resumption.
- Persist bounded objective, target, completed phases, created IDs, remaining work, revisions, checkpoints, available references, missing sources, and relevant changes. Do not store hidden reasoning or unbounded transcripts.
- Same-provider new-conversation continuation is required. Cross-provider continuation is optional. Continue with available context and request only missing source material.
- Explicit finalization leaves ordinary persistent editable content with provenance and permissions intact.

## UI, deployment, and security

Keep frontend changes narrow and consistent. Include connection setup/endpoint/permissions/revocation, consent, approval/elevation management, draft status/errors/progress, pause/resume, source details, bulk fallback, and finalization. Preserve the existing camera and interaction identity.

Integrate with existing containers/nginx, HTTPS, PostgreSQL/migrations, persistent files, backups, and non-root restrictions. Verify streaming, discovery paths, forwarded headers, OAuth redirects, request limits, browser dependencies/isolation, and WebSockets. Do not add services without demonstrated need or deploy without permission.

Test unauthenticated/invalid/expired/revoked/wrong-audience tokens, role ceilings, cross-user/workspace/board isolation, readonly grants, callback abuse, exact approval/replay/expiry/revocation, destructive recovery, rollback, retries, conflicts, pause/write races, files/source permissions, SSRF, oversized requests, and resource bounds. Stored documents are untrusted data and cannot change server authority. Never leak credentials or auth tokens.

## Definition of done and acceptance

Automated tests cover nested creation, precise editing, media/references, lifecycle/recovery/new-connection continuation, both pause paths, manual edits while paused, finalization, and existing authentication/sharing/editor/collaboration/uploads. Run backend, frontend/type/build, migrations, protocol, deployment, and final security checks. Report real outcomes and environments.

A real assistant must use several realistic lecture documents containing multiple topics, text, diagrams, tables, and equations to create useful curated nested visual content. Demonstrate accessible sources, original visuals where transferable, intentional readable layout, live progress, inspection/refinement, both pause controls, manual-edit-safe resumption, new-conversation checkpoint recovery, safe retries, destructive safeguards, finalization, normal editability, collaboration, and restart persistence. Assess educational usefulness and visual quality, not only API responses.

Report Claude and ChatGPT Plus results independently from SDK, Inspector, and mocked tests. Record exact external limitations and reproducible procedures. Unimplemented requirements are not platform blockers. A responding endpoint alone does not complete v1.
