import { useEffect, useState } from "react"
import { SpaceCanvas } from "@/components/space/SpaceCanvas"
import { StatePanel } from "@/components/zoomboard/StatePanel"
import { api } from "@/lib/http"
import { THEMES } from "@/lib/scenery"
import { SceneStore, type SceneSnapshot } from "@/lib/store"
import type { Rect } from "@/lib/space"

type RenderState =
  | { kind: "loading" }
  | { kind: "ready"; store: SceneStore; bounds: Rect | null }
  | { kind: "error" }

/** Only the server's isolated browser supplies this read-only, in-memory snapshot. */
export function McpRenderPage() {
  const [state, setState] = useState<RenderState>({ kind: "loading" })
  useEffect(() => {
    let alive = true
    let store: SceneStore | null = null
    void api<{ snapshot: SceneSnapshot; bounds: Rect | null }>("/api/mcp/preview-scene").then((payload) => {
      if (!alive) return
      store = new SceneStore(payload.snapshot)
      setState({ kind: "ready", store, bounds: payload.bounds })
    }).catch(() => { if (alive) setState({ kind: "error" }) })
    return () => { alive = false; store?.close() }
  }, [])
  if (state.kind !== "ready") return <StatePanel kind={state.kind === "error" ? "error" : "loading"} title="Board preview" message="Previews are available only through an authorized MCP request." />
  const scenery = THEMES.find((theme) => theme.id === state.store.scenery)?.id ?? "studio"
  return <main className="mcp-render fixed inset-0" data-mcp-ready="true" style={{ pointerEvents: "none" }}>
    <style>{".mcp-render > div > :not(.zb-viewport) { display: none !important; }"}</style>
    <SpaceCanvas store={state.store} scenery={scenery} initialView={state.bounds ?? undefined} />
  </main>
}
