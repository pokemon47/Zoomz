# Chromium namespace sandbox policy

This profile is for the optional screenshot runtime. It retains the Docker
29.8.2 default seccomp policy and prepends only Playwright's documented
`clone`, `setns`, `unshare` allow rule. The default action remains
`SCMP_ACT_ERRNO`; all original architecture, capability and argument filters
remain unchanged. It is not an unrestricted profile.

Sources:

- [Playwright guidance](https://playwright.dev/python/docs/docker#crawling-and-scraping).
- [Official namespace rule](https://github.com/microsoft/playwright/blob/main/utils/docker/seccomp_profile.json).
- [Exact running-engine baseline](https://github.com/moby/moby/blob/8af9fe3a36bab3e039862a2ab1cef1880c9b4d03/vendor/github.com/moby/profiles/seccomp/default.json), pinned dependency `github.com/moby/profiles/seccomp v0.2.3`.

After removing the first syscall rule, canonical JSON with sorted keys and
separators `(',', ':')` has SHA-256
`9da637d2ab0a204fcbd91bd88f1be9e004a3acab61c571a9f5b8870e588a17d2`.
Review the baseline when upgrading Docker; a pinned custom profile does not
automatically inherit later Docker security changes.

## Scope and security implications

Zoomz currently renders in a bounded browser launched by its main backend
container. There is no separate renderer service to scope this policy to.
Applying the profile therefore permits these namespace syscalls for every
process in that app container, including nginx and Uvicorn, not only Chromium.
This increases the app container's permitted kernel interface. Browser child
process isolation must be verified before considering production adoption.

Keep UID 10001, no-new-privileges, Chromium sandboxing, existing capability
limits, network routing and storage mounts. The profile adds no capabilities,
host namespaces, devices or mounts. Authorization, browser request interception,
credential isolation, time/node/image limits and the single-render admission
gate remain owned by the existing application code.

The base production Compose and Zenith configurations retain their existing
security policy. `compose.chromium.yml` is an explicit opt-in override for
operators who have reviewed this broader app-container syscall scope. It has
been applied only to disposable local infrastructure; no production deployment
has been performed. Use both files from the repository root:

```sh
docker compose --env-file .env.production -f compose.production.yml -f compose.chromium.yml config -q
```

Set `MCP_RENDER_PREVIEWS=1` only after the sandbox and actual renderer checks
pass on the intended host. Compose merges the profile into the app service;
database policy, ports, networks, volumes and capabilities are unchanged.

The guarded `deploy/chromium_check.py` runs a real renderer and checks its
distinct user-namespace UID map, nested PID namespaces, non-root UID,
no-new-privileges, zero effective capabilities and additional Chromium seccomp
filters. It checks the browser's actual command
line for sandbox-disabling flags. `chrome://sandbox` is unavailable in the
headless shell, so this uses kernel process state rather than that UI.

If the kernel or another runtime policy still denies namespaces, stop rather
than relaxing additional controls. Use a host that supports the namespace
sandbox, or leave screenshots disabled until a separately designed isolated
renderer is approved.
