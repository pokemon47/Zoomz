// Report uncaught browser errors to the API (which logs them and forwards to Sentry if set up).

let sent = 0

function report(message: string, stack?: string) {
  if (sent++ > 10) return // one bad page shouldn't flood the logs
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Zoomz": "1" },
    body: JSON.stringify({ message: message.slice(0, 500), stack: stack?.slice(0, 3000), url: location.pathname }),
    keepalive: true,
  }).catch(() => {})
}

export function installErrorReporting() {
  window.addEventListener("error", (e) => report(e.message || "error", e.error?.stack))
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined
    if (r && "status" in (r as object)) return // API errors are already shown to the user
    report(r?.message ?? String(e.reason), r?.stack)
  })
}
