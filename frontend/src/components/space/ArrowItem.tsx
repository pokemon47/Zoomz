import type { Pt } from "@/lib/arrows"

type Props = {
  id: string
  /** Ends in screen px. */
  a: Pt
  b: Pt
  /** Screen px per board unit, so the line thickens as you get closer. */
  scale: number
  order: number
  opacity: number
  selected: boolean
  hidden?: boolean
}

/**
 * An arrow drawn in screen space between its two ends. Only the line itself (plus a little
 * slack) catches the pointer, so whatever is under the rest of its box stays clickable.
 */
export function ArrowItem({ id, a, b, scale, order, opacity, selected, hidden }: Props) {
  const sw = Math.min(8, Math.max(1.5, 3 * scale))
  const head = Math.max(9, sw * 3.6)
  const pad = head + 8
  const x0 = Math.min(a.x, b.x) - pad, y0 = Math.min(a.y, b.y) - pad
  const w = Math.abs(a.x - b.x) + pad * 2, h = Math.abs(a.y - b.y) + pad * 2
  const ax = a.x - x0, ay = a.y - y0, bx = b.x - x0, by = b.y - y0
  const len = Math.hypot(bx - ax, by - ay) || 1
  const ux = (bx - ax) / len, uy = (by - ay) / len
  // Stop the line where the head starts so its tip stays sharp.
  const tail = Math.min(head * 0.9, len)
  const lx = bx - ux * tail, ly = by - uy * tail
  const wing = head * 0.55
  const headPath = `M ${bx} ${by} L ${lx - uy * wing} ${ly + ux * wing} L ${lx + uy * wing} ${ly - ux * wing} Z`
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
      <line className="zb-arrow-hit" x1={ax} y1={ay} x2={bx} y2={by} strokeWidth={Math.max(14, sw * 4)} />
      {selected && <line className="zb-arrow-glow" x1={ax} y1={ay} x2={lx} y2={ly} strokeWidth={sw + 8} />}
      {/* A thin outline in the opposite tone keeps it readable on any scenery. */}
      <line className="zb-arrow-casing" x1={ax} y1={ay} x2={lx} y2={ly} strokeWidth={sw + 2.5} />
      <path className="zb-arrow-casing" d={headPath} strokeWidth={2.5} />
      <line className="zb-arrow-line" x1={ax} y1={ay} x2={lx} y2={ly} strokeWidth={sw} />
      <path className="zb-arrow-head" d={headPath} />
    </svg>
  )
}
