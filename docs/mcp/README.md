# Zoomz MCP v1

The implementation is in development, not accepted for production use. [PROGRESS.md](PROGRESS.md) records verified milestones and gaps. [HANDOFF.md](HANDOFF.md) records the current continuation point.

See [the tool and security reference](REFERENCE.md) for the implemented API, authorization boundaries, generation lifecycle, and limits. See [client setup and verification](SETUP.md) for commands and external-client acceptance checks.

## Implementation plan

The existing flat `Node` tree, `Space.seq`, `ops.apply()`, file storage, and WebSocket hub remain authoritative. MCP is an adapter, not a second scene engine. One primary agent handles implementation under the requested orchestration constraint.

1. Add persisted OAuth clients, short-lived grants, user connections, rotating tokens, approvals, tasks, and retry records. Use opaque hashed credentials, PKCE S256, exact registered redirect URIs, and resource-bound tokens.
2. Mount the official Python SDK's stateless Streamable HTTP transport at `/mcp`. Validate each bearer token on every call. Route browser consent and management through existing cookie authentication.
3. Reuse `ops.apply()` with an optional caller-owned transaction. Serialize connection revocation, task state, space revisions, approval consumption, retry results, and canvas edits within that transaction. Preserve normal manual editing and live events.
4. Add bounded discovery, structured batches with temporary references, tasks/checkpoints, media access, and structural inspection. Use existing upload processing; do not fetch arbitrary model-supplied URLs.
5. Add small existing-style connection/consent/task/reference UI. Route OAuth discovery and MCP streaming through nginx.
6. Verify with an actual SDK client, focused adversarial tests, normal regression checks, and container/build checks where available. Record missing real-client and independent-review access honestly.

## Contracts and ownership

`McpConnection` binds a user and OAuth client to a server-approved workspace/board allowlist, edit permission, and destructive policy. `McpCredential` stores only opaque token hashes and expiry. `GenerationTask` persists state/checkpoints without hidden reasoning. `McpBatch` binds an idempotency key to a canonical request hash and committed result. `McpApproval` binds single-use consent to exact parameters and revision; recovery snapshots retain affected content.

The alternative of a separate MCP service calling authenticated REST would duplicate credentials and make atomic task/retry/approval commits difficult. In-process adaptation is selected. The existing `z` remains elevation, `rank` remains stacking, coordinates remain board-local, and `content.frame` remains stable.

## Provider feasibility, checked 2026-10-18

Use an instance-specific HTTPS endpoint, not a shared gateway or paid inference API. [OpenAI's custom MCP help](https://help.openai.com/en/articles/12584461) currently limits full custom MCP support to Business and Enterprise/Edu; its Pro FAQ describes read/fetch-only custom connections. This does not verify ChatGPT Plus write support. [Plugin setup](https://developers.openai.com/plugins/deploy/connect-chatgpt) is the supported distribution route to investigate with an eligible account; publishing and account access remain external gates. Ordinary chat, Work, and API access are not interchangeable.

[Claude's connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) documents remote MCP on Free/Pro/Max/Team/Enterprise, with one custom connector on Free. Remote connectors run from provider infrastructure and require a reachable endpoint. Neither real provider account has been tested here.

[MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) requires PKCE and resource validation. The [official Python SDK](https://github.com/modelcontextprotocol/python-sdk) supplies transport and protocol types. Tool outputs containing stored text remain untrusted data. No server-side semantic analysis or paid LLM calls are introduced.

Attachments are not assumed transferable merely because the assistant can read them. OpenAI documents plugin file inputs, but direct raw-MCP attachment availability must be tested in the actual account. Direct authenticated multi-file uploads remain the fallback. Original references must not claim verified citations or licence rights.

## Rendered inspection continuation

Board screenshots now use the official Playwright Python runtime, installed with explicit user approval. Only Chromium headless shell and its required official helper were downloaded; no Firefox, WebKit, npm Playwright package, or pytest browser plugin was added. Playwright is a production dependency because the screenshot tool runs in the backend.

`mcp_preview.py` opens the existing React `SpaceCanvas` and `SceneStore` through `/mcp-render`. The isolated, sandboxed browser receives a bounded authorized subtree through request interception, not an account session or bearer credential. Authorized stored media is intercepted from disk; unrelated APIs, WebSockets, external images, and remote fonts are blocked. The browser and context close after each render. Board-local geometry and `content.frame` remain unchanged. Root, nested-board, close-up, and actual MCP image-result tests pass. External fonts fall back to local fonts in these network-isolated previews.

Screenshots are opt-in with `MCP_RENDER_PREVIEWS=1`. The Dockerfile installs the pinned runtime and Chromium system dependencies without changing the non-root user. Linux hosting still needs a verified sandbox-capable kernel/container policy; launch fails closed rather than adding `--no-sandbox`. Actual container/PostgreSQL execution and real-provider acceptance remain unverified. No Zenith manifest schema or deployment was changed for screenshots.
