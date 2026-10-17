import { GripVertical } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type Corner = "tl" | "tr" | "bl" | "br"
/** Position as an offset from a viewport corner, so panels stay put when the window resizes. */
type Pos = { corner: Corner; dx: number; dy: number }

type Props = {
  /** Remembered per browser under this key. */
  id: string
  label: string
  defaultPos: Pos
  className?: string
  children: ReactNode
}

const KEY = (id: string) => `zoomz.panel.v2.${id}`
const load = (id: string, fallback: Pos): Pos => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(id)) ?? "null") as Pos | null
    return v && typeof v.dx === "number" && typeof v.dy === "number" && v.corner ? v : fallback
  } catch {
    return fallback
  }
}

/**
 * A floating chrome slab you can pick up by its grip and put anywhere. It snaps its
 * anchor to the nearest corner on drop, so it keeps its place when the window resizes.
 */
export function DraggablePanel({ id, label, defaultPos, className, children }: Props) {
  const [pos, setPos] = useState<Pos>(() => load(id, defaultPos))
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ px: number; py: number; left: number; top: number; at: { left: number; top: number } } | null>(null)
  const [live, setLive] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(KEY(id), JSON.stringify(pos))
    } catch {
      /* private mode: just don't remember */
    }
  }, [id, pos])

  const style = live
    ? { left: live.left, top: live.top }
    : {
        [pos.corner[0] === "t" ? "top" : "bottom"]: pos.dy,
        [pos.corner[1] === "l" ? "left" : "right"]: pos.dx,
      }

  const settle = (left: number, top: number) => {
    const el = ref.current!
    const W = window.innerWidth, H = window.innerHeight
    const w = el.offsetWidth, h = el.offsetHeight
    const l = Math.min(Math.max(8, left), W - w - 8)
    const t = Math.min(Math.max(8, top), H - h - 8)
    const corner = `${t + h / 2 < H / 2 ? "t" : "b"}${l + w / 2 < W / 2 ? "l" : "r"}` as Corner
    setPos({ corner, dx: corner[1] === "l" ? l : W - l - w, dy: corner[0] === "t" ? t : H - t - h })
  }

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    const r = ref.current!.getBoundingClientRect()
    drag.current = { px: e.clientX, py: e.clientY, left: r.left, top: r.top, at: { left: r.left, top: r.top } }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the pointer already went away */
    }
    setDragging(true)
    setLive({ left: r.left, top: r.top })
  }
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    d.at = { left: d.left + e.clientX - d.px, top: d.top + e.clientY - d.py }
    setLive(d.at)
  }
  const onUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    settle(d.at.left, d.at.top)
    setLive(null)
    setDragging(false)
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 48 : 12
    const r = ref.current!.getBoundingClientRect()
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const m = moves[e.key]
    if (!m) return
    e.preventDefault()
    e.stopPropagation()
    settle(r.left + m[0], r.top + m[1])
  }

  return (
    <div ref={ref} className={cn("zb-panel-float", dragging && "is-moving", className)} style={style}>
      <button
        type="button"
        className="zb-panel-grip"
        aria-label={`Move ${label} (arrow keys)`}
        title={`Drag to move ${label}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        <GripVertical size={16} strokeWidth={2.25} aria-hidden />
      </button>
      {children}
    </div>
  )
}
