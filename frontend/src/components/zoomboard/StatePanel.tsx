import { Button } from "./Button"

export type StatePanelProps = {
  kind: "loading" | "error"
  title?: string
  message?: string
  onRetry?(): void
}

/** Centred panel for loading and API errors. Never shows a raw stack trace. */
export function StatePanel({ kind, title, message, onRetry }: StatePanelProps) {
  const err = kind === "error"
  return (
    <div className="zb-panel" role={err ? "alert" : "status"}>
      <div className={`zb-blob ${err ? "zb-tomato" : "zb-lemon zb-spin"}`} aria-hidden>
        {err ? "!" : "✦"}
      </div>
      <h3>{title ?? (err ? "Couldn’t reach the canvas" : "Loading your canvas")}</h3>
      <p>{message ?? (err ? "Check the server is running, then try again." : "Laying out the pieces…")}</p>
      {err && (
        <Button variant="primary" onClick={onRetry} autoFocus>
          Try again
        </Button>
      )}
    </div>
  )
}
