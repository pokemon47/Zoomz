import { Eye } from "lucide-react"
import { useRef, useState, type PointerEvent } from "react"
import { DEPTH_DOT, floorFor } from "@/lib/constants"
import { arrowEnds, curveControl, styleOf } from "@/lib/arrows"
import { fileKind } from "@/lib/files"
import { titleOf } from "@/lib/scene"
import type { Cam, Space, Viewport } from "@/lib/space"

type Props = {
  space: Space
  /** The board you're in (breadcrumb focus). */
  focus: string
  /** Current camera, in any frame. */
  cam: Cam
  vp: Viewport
  /** Centre the camera on a point of the focus board (local units). */
  onCenter(x: number, y: number, glide: boolean): void
  /** Fold the map away. */
  onHide?(): void
}

const MAP_W = 232
const MAP_H = 150
const TONE: Record<string, string> = { "zb-tomato": "var(--tomato)", "zb-cobalt": "var(--cobalt)", "zb-mint": "var(--mint)", "zb-lilac": "var(--lilac)", "zb-lemon": "var(--lemon)" }

/**
 * Where you are: the board you're standing in, everything on it, and a frame for what's
 * on screen. Step into another board and the map falls into it with you.
 */
export function Minimap({ space, focus, cam, vp, onCenter, onHide }: Props) {
  const board = space.node(focus)
  const depth = space.depthOf(focus)
  const kids = space.index.children.get(focus) ?? []
  // Map the board's content (live positions) into the map box.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of kids) {
    const p = space.at(n)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + n.w)
    maxY = Math.max(maxY, p.y + n.h)
  }
  if (!kids.length) [minX, minY, maxX, maxY] = [0, 0, 800, 600]
  const pad = 40
  const bx = minX - pad, by = minY - pad, bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2

  // What's on screen, in the focus board's coordinates.
  const c = space.toFrame(cam, focus)
  const view = { x: -c.x / c.s, y: -c.y / c.s, w: vp.w / c.s, h: vp.h / c.s }

  // Fall in when going deeper, pull back when going up.
  const prev = useRef({ focus, depth })
  const [anim, setAnim] = useState<{ key: string; dir: "in" | "out" }>({ key: focus, dir: "in" })
  if (prev.current.focus !== focus) {
    const dir = depth >= prev.current.depth ? "in" : "out"
    prev.current = { focus, depth }
    setAnim({ key: focus, dir })
  }

  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const toLocal = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: bx + ((e.clientX - r.left) / r.width) * bw, y: by + ((e.clientY - r.top) / r.height) * bh }
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    const p = toLocal(e)
    onCenter(p.x, p.y, true)
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return
    const p = toLocal(e)
    onCenter(p.x, p.y, false)
  }
  const onUp = () => (dragging.current = false)

  const path: string[] = []
  for (let id: string | null = focus; id; id = space.parentOf(id)) path.unshift(id)

  return (
    <div className="zb-minimap" aria-label={`Map of ${board ? titleOf(board) : "the board"}`}>
      <div className="zb-minimap-head">
        <span className="zb-minimap-trail" aria-hidden>
          {path.map((id, i) => (
            <span key={id} className="zb-dot" style={{ ["--d" as string]: DEPTH_DOT[Math.min(i, 3)], width: i === path.length - 1 ? 12 : 8, height: i === path.length - 1 ? 12 : 8 }} />
          ))}
        </span>
        <span className="zb-minimap-title">{board ? titleOf(board) : ""}</span>
        <span className="zb-meta">L{depth + 1}</span>
        {onHide && (
          <button type="button" className="zb-minimap-hide" onClick={onHide} aria-label="Hide the map" title="Hide the map" data-no-drag>
            <Eye size={14} strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>
      <div className="zb-minimap-well" style={{ background: floorFor(depth) }}>
        <svg
          key={anim.key}
          ref={svg}
          className={`zb-minimap-svg is-${anim.dir}`}
          viewBox={`${bx} ${by} ${bw} ${bh}`}
          width={MAP_W}
          height={MAP_H}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Click or drag to move the view"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <defs>
            <clipPath id={`mm-${focus}`}>
              <rect x={bx} y={by} width={bw} height={bh} />
            </clipPath>
          </defs>
          {kids.map((n) => {
            const p = space.at(n)
            const r = Math.min(n.w, n.h) * 0.08
            if (n.type === "board")
              return (
                <g key={n.id}>
                  <rect x={p.x + n.w * 0.06} y={p.y + n.h * 0.08} width={n.w} height={n.h} rx={r * 1.5} fill="var(--mint)" />
                  <rect x={p.x + n.w * 0.03} y={p.y + n.h * 0.04} width={n.w} height={n.h} rx={r * 1.5} fill="var(--lilac)" />
                  <rect x={p.x} y={p.y} width={n.w} height={n.h} rx={r * 1.5} fill={floorFor(depth + 1)} stroke="var(--surface-side)" strokeWidth={n.w * 0.02} />
                </g>
              )
            if (n.type === "image")
              return <image key={n.id} href={n.content.src} x={p.x} y={p.y} width={n.w} height={n.h} preserveAspectRatio="xMidYMid slice" />
            if (n.type === "note") return <rect key={n.id} x={p.x} y={p.y} width={n.w} height={n.h} rx={r} fill="var(--lemon)" />
            if (n.type === "link") return <rect key={n.id} x={p.x} y={p.y} width={n.w} height={n.h} rx={r} fill="var(--cobalt)" />
            if (n.type === "arrow") {
              const [a, b] = arrowEnds(n, p, (id) => {
                const t = space.node(id)
                if (!t || t.parentId !== n.parentId) return null
                const tp = space.at(t)
                return { x: tp.x, y: tp.y, w: t.w, h: t.h }
              })
              const st = styleOf(n)
              const c = st.shape === "curved" ? curveControl(a, b) : null
              const sw = Math.max(bw, bh) * 0.006
              return (
                <path
                  key={n.id}
                  d={c ? `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                  fill="none"
                  stroke="var(--ink)"
                  strokeOpacity={0.55}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  strokeDasharray={st.line === "dotted" ? `0 ${sw * 2.4}` : undefined}
                />
              )
            }
            return <rect key={n.id} x={p.x} y={p.y} width={n.w} height={n.h} rx={r} fill={TONE[fileKind(n.content.mime ?? "", n.content.title).tone] ?? "var(--lemon)"} />
          })}
          <g clipPath={`url(#mm-${focus})`}>
            <rect className="zb-minimap-view" x={view.x} y={view.y} width={view.w} height={view.h} rx={Math.min(view.w, view.h) * 0.04} vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
      </div>
    </div>
  )
}
