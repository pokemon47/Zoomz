import { useCallback, useEffect, useState } from "react"
import { BoardCanvas } from "@/components/board/BoardCanvas"
import { StatePanel } from "@/components/zoomboard/StatePanel"
import { TooltipProvider } from "@/components/ui/tooltip"
import { fetchScene } from "@/lib/api"
import type { Scene } from "@/lib/types"

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; scene: Scene }

export default function App() {
  const [load, setLoad] = useState<Load>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    fetchScene(ctrl.signal)
      .then((scene) => setLoad({ status: "ready", scene }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        const offline = err instanceof TypeError || (err instanceof Error && /\b5\d\d\b/.test(err.message))
        setLoad({
          status: "error",
          message: offline
            ? "Check the API server is running, then try again."
            : "The board came back in a shape we didn’t expect. Try again in a moment.",
        })
      })
    return () => ctrl.abort()
  }, [attempt])

  // Session-only edits: positions live in memory until reload.
  const moveNode = useCallback((id: string, x: number, y: number) => {
    setLoad((prev) =>
      prev.status === "ready"
        ? { ...prev, scene: { ...prev.scene, nodes: prev.scene.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) } }
        : prev,
    )
  }, [])

  return (
    <TooltipProvider delay={400}>
      <main className="relative h-full w-full overflow-hidden bg-canvas">
        <h1 className="sr-only">Zoomable Board</h1>
        {load.status === "ready" ? (
          <BoardCanvas scene={load.scene} onMoveNode={moveNode} />
        ) : (
          <div className="zb-viewport grid place-items-center" style={{ backgroundSize: "24px 24px" }}>
            <div className="relative">
              {load.status === "loading" ? (
                <StatePanel kind="loading" />
              ) : (
                <StatePanel kind="error" message={load.message} onRetry={() => {
                    setLoad({ status: "loading" })
                    setAttempt((a) => a + 1)
                  }} />
              )}
            </div>
          </div>
        )}
      </main>
    </TooltipProvider>
  )
}
