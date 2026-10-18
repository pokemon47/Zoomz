import { GripVertical } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
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

// v3: the map moved to the bottom right, above the zoom controls; older saved spots start fresh.
const KEY = (id: string) => `zoomz.panel.v3.${id}`
const load = (id: string, fallback: Pos): Pos => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(id)) ?? "null") as Pos | null
    return v && typeof v.dx === "number" && typeof v.dy === "number" && v.corner ? v : fallback
  } catch {
    return fallback
  }
}

const MARGIN = 8

/** Where a panel of size w×h may sit in a W×H viewport: fully on screen with a small margin.
 *  A panel bigger than the screen keeps its top-left (and its grip) visible. */
export function clampToViewport(left: number, top: number, w: number, h: number, W: number, H: number) {
  return {
    left: Math.max(MARGIN, Math.min(left, W - w - MARGIN)),
    top: Math.max(MARGIN, Math.min(top, H - h - MARGIN)),
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
    const { left: l, top: t } = clampToViewport(left, top, w, h, W, H)
    const corner = `${t + h / 2 < H / 2 ? "t" : "b"}${l + w / 2 < W / 2 ? "l" : "r"}` as Corner
    setPos({ corner, dx: corner[1] === "l" ? l : W - l - w, dy: corner[0] === "t" ? t : H - t - h })
  }

  // A remembered spot can be off screen after the window shrinks (or on a smaller display), or
  // when the panel grows: pull it back in whenever any of that changes.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fix = () => {
      if (drag.current) return
      const r = el.getBoundingClientRect()
      // Hidden (e.g. the map on a phone): nothing to measure, and its spot must not change.
      if (!r.width || !r.height) return
      const c = clampToViewport(r.left, r.top, r.width, r.height, window.innerWidth, window.innerHeight)
      if (Math.abs(c.left - r.left) > 0.5 || Math.abs(c.top - r.top) > 0.5) settle(c.left, c.top)
    }
    fix()
    window.addEventListener("resize", fix)
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fix) : null
    ro?.observe(el)
    return () => {
      window.removeEventListener("resize", fix)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const el = ref.current!
    d.at = clampToViewport(d.left + e.clientX - d.px, d.top + e.clientY - d.py, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight)
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
