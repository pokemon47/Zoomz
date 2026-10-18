import { DEFAULT_BEND, curveControl, elbowCorner, type Pt } from "@/lib/arrows"
import type { ArrowStyle } from "@/lib/types"

type Props = {
  id: string
  /** Ends in screen px. */
  a: Pt
  b: Pt
  style: ArrowStyle
  /** How far a curved arrow bows out (share of its length). */
  bend?: number
  /** Screen px per board unit, so the line thickens as you get closer. */
  scale: number
  order: number
  opacity: number
  selected: boolean
  hidden?: boolean
}

/**
 * An arrow drawn in screen space between its two ends: straight or curved, solid or dotted,
 * with a head at either end, both or neither. Only the line itself (plus a little slack)
 * catches the pointer, so whatever is under the rest of its box stays clickable.
 */
export function ArrowItem({ id, a, b, style, bend = DEFAULT_BEND, scale, order, opacity, selected, hidden }: Props) {
  const sw = Math.min(8, Math.max(1.5, 3 * scale))
  const pad = Math.max(9, sw * 3.6) + 8
  const mid = midOf(a, b, style, bend)
  const c = mid?.p ?? null
  const xs = [a.x, b.x, ...(c ? [c.x] : [])], ys = [a.y, b.y, ...(c ? [c.y] : [])]
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2, h = Math.max(...ys) - Math.min(...ys) + pad * 2
  const P = (p: Pt) => ({ x: p.x - x0, y: p.y - y0 })
  const g = arrowGeometry(P(a), P(b), mid && { kind: mid.kind, p: P(mid.p) }, style, sw)
  return (
    <svg
      className={`zb-arrow${selected ? " is-selected" : ""}`}
      data-item={id}
      width={w}
      height={h}
      style={{ transform: `translate(${x0}px, ${y0}px)`, zIndex: order, opacity: hidden ? 0 : opacity }}
      role="img"
      aria-label="Arrow"
    >
      <path className="zb-arrow-hit" d={g.full} strokeWidth={Math.max(14, sw * 4)} fill="none" />
      {selected && <path className="zb-arrow-glow" d={g.line} strokeWidth={sw + 8} fill="none" />}
      {/* A thin outline in the opposite tone keeps it readable on any scenery. */}
      <path className="zb-arrow-casing" d={g.line} strokeWidth={sw + 2.5} fill="none" strokeDasharray={g.dash ? `0 ${sw * 2.4}` : undefined} />
      {g.heads.map((d, i) => (
        <path key={i} className="zb-arrow-casing is-head" d={d} strokeWidth={2.5} />
      ))}
      <path className="zb-arrow-line" d={g.line} strokeWidth={sw} fill="none" strokeLinejoin="round" strokeDasharray={g.dash ? `0 ${sw * 2.4}` : undefined} />
      {g.heads.map((d, i) => (
        <path key={i} className="zb-arrow-head" d={d} />
      ))}
    </svg>
  )
}

/** The middle of an arrow's path: a curve's control point, or a 90° arrow's corner. */
export function midOf(a: Pt, b: Pt, style: ArrowStyle, bend = DEFAULT_BEND): { kind: "q" | "l"; p: Pt } | null {
  if (style.shape === "curved") return { kind: "q", p: curveControl(a, b, bend) }
  if (style.shape === "elbow") return { kind: "l", p: elbowCorner(a, b) }
  return null
}

/** The line (shortened where heads sit, so their tips stay sharp) and the head triangles. */
export function arrowGeometry(a: Pt, b: Pt, mid: { kind: "q" | "l"; p: Pt } | null, style: ArrowStyle, sw: number, headFactor = 3.6) {
  const c = mid?.p ?? null
  const head = Math.max(headFactor * 2.4, sw * headFactor)
  const wantStart = style.heads === "start" || style.heads === "both"
  const wantEnd = style.heads === "end" || style.heads === "both"
  // Each head points along the line's direction at its end (the curve's tangent).
  const tip = (at: Pt, from: Pt) => {
    const len = Math.hypot(at.x - from.x, at.y - from.y) || 1
    const ux = (at.x - from.x) / len, uy = (at.y - from.y) / len
    const back = { x: at.x - ux * head * 0.9, y: at.y - uy * head * 0.9 }
    const wing = head * 0.55
    return { back, d: `M ${at.x} ${at.y} L ${back.x - uy * wing} ${back.y + ux * wing} L ${back.x + uy * wing} ${back.y - ux * wing} Z` }
  }
  const towardsA = c ?? b, towardsB = c ?? a
  const s = wantStart ? tip(a, towardsA) : null
  const e = wantEnd ? tip(b, towardsB) : null
  const p0 = s?.back ?? a, p1 = e?.back ?? b
  const via = (from: Pt, to: Pt) => (!c ? `M ${from.x} ${from.y} L ${to.x} ${to.y}` : mid!.kind === "q" ? `M ${from.x} ${from.y} Q ${c.x} ${c.y} ${to.x} ${to.y}` : `M ${from.x} ${from.y} L ${c.x} ${c.y} L ${to.x} ${to.y}`)
  const line = via(p0, p1)
  const full = via(a, b)
  return { line, full, heads: [s?.d, e?.d].filter(Boolean) as string[], dash: style.line === "dotted" }
}
