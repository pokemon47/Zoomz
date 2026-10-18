import { curveControl, type Pt } from "@/lib/arrows"
import type { ArrowStyle } from "@/lib/types"

type Props = {
  id: string
  /** Ends in screen px. */
  a: Pt
  b: Pt
  style: ArrowStyle
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
export function ArrowItem({ id, a, b, style, scale, order, opacity, selected, hidden }: Props) {
  const sw = Math.min(8, Math.max(1.5, 3 * scale))
  const pad = Math.max(9, sw * 3.6) + 8
  const c = style.shape === "curved" ? curveControl(a, b) : null
  const xs = [a.x, b.x, ...(c ? [c.x] : [])], ys = [a.y, b.y, ...(c ? [c.y] : [])]
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2, h = Math.max(...ys) - Math.min(...ys) + pad * 2
  const P = (p: Pt) => ({ x: p.x - x0, y: p.y - y0 })
  const g = arrowGeometry(P(a), P(b), c && P(c), style, sw)
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
      <path className="zb-arrow-line" d={g.line} strokeWidth={sw} fill="none" strokeDasharray={g.dash ? `0 ${sw * 2.4}` : undefined} />
      {g.heads.map((d, i) => (
        <path key={i} className="zb-arrow-head" d={d} />
      ))}
    </svg>
  )
}

/** The line (shortened where heads sit, so their tips stay sharp) and the head triangles. */
export function arrowGeometry(a: Pt, b: Pt, c: Pt | null, style: ArrowStyle, sw: number, headFactor = 3.6) {
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
  const line = c ? `M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}` : `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`
  const full = c ? `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  return { line, full, heads: [s?.d, e?.d].filter(Boolean) as string[], dash: style.line === "dotted" }
}
