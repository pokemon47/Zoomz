// Arrows: straight connectors on a board. Each end is a free point, or attached to another item
// on the same board, in which case it sits on that item's edge, on the line between the two ends.

import type { ArrowNode, ArrowStyle, SceneNode } from "./types"

export const DEFAULT_ARROW: ArrowStyle = { shape: "straight", line: "solid", heads: "end" }

export function styleOf(n: ArrowNode): ArrowStyle {
  const c = n.content
  return { shape: c.shape ?? "straight", line: c.line ?? "solid", heads: c.heads ?? "end" }
}

/** How far a new curved arrow bows out, as a share of its length. */
export const DEFAULT_BEND = 0.28

/** The control point of a curved arrow: off the middle of the line, `bend` lengths to its side. */
export function curveControl(a: Pt, b: Pt, bend = DEFAULT_BEND): Pt {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const dx = b.x - a.x, dy = b.y - a.y
  return { x: mx + dy * bend, y: my - dx * bend }
}

/** The point halfway along a curved arrow (where its bend handle sits). */
export function curveMid(a: Pt, b: Pt, bend = DEFAULT_BEND): Pt {
  const c = curveControl(a, b, bend)
  return { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 }
}

/** The bend that makes a curve between a and b pass through p (its midpoint goes to p). */
export function bendThrough(a: Pt, b: Pt, p: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (!len2) return 0
  // Midpoint of the curve = (a + b) / 4 + c / 2, so c = 2p − (a + b) / 2.
  const cx = 2 * p.x - (a.x + b.x) / 2, cy = 2 * p.y - (a.y + b.y) / 2
  const k = ((cx - (a.x + b.x) / 2) * dy - (cy - (a.y + b.y) / 2) * dx) / len2
  return Math.max(-3, Math.min(3, Math.round(k * 1000) / 1000))
}

/** The corner of a 90° arrow: across first along whichever way it travels further. */
export function elbowCorner(a: Pt, b: Pt): Pt {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
}

/** Points along the arrow (for clicking it): the line, its two legs, or its curve. */
export function arrowPolyline(a: Pt, b: Pt, shape: ArrowStyle["shape"], bend = DEFAULT_BEND): Pt[] {
  if (shape === "elbow") return [a, elbowCorner(a, b), b]
  if (shape !== "curved") return [a, b]
  const c = curveControl(a, b, bend)
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, u = 1 - t
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }
  })
}

/** Distance from p to an arrow drawn between a and b. */
export function distToArrow(p: Pt, a: Pt, b: Pt, shape: ArrowStyle["shape"], bend = DEFAULT_BEND): number {
  const pts = arrowPolyline(a, b, shape, bend)
  let d = Infinity
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i - 1], pts[i]))
  return d
}

export type Pt = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }

/** Room around the line inside the arrow's own box (board units), so it's never thinner than
 *  the server's minimum item size and a click near the line still hits it. */
export const ARROW_PAD = 12

/** Where a line from a box's centre towards `to` leaves the box. */
export function edgePoint(b: Box, to: Pt): Pt {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const dx = to.x - cx, dy = to.y - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const tx = dx ? b.w / 2 / Math.abs(dx) : Infinity
  const ty = dy ? b.h / 2 / Math.abs(dy) : Infinity
  const t = Math.min(tx, ty, 1)
  return { x: cx + dx * t, y: cy + dy * t }
}

/**
 * The two ends of an arrow. `origin` is the arrow's own position (it may be moving), `boxOf`
 * gives an attached item's current box in the same coordinates, or null if it's gone.
 */
export function arrowEnds(n: ArrowNode, origin: Pt, boxOf: (id: string) => Box | null, override?: { end: 1 | 2; at: Pt; snap?: string | null }): [Pt, Pt] {
  const c = n.content
  const free1 = override?.end === 1 ? override.at : { x: origin.x + c.x1, y: origin.y + c.y1 }
  const free2 = override?.end === 2 ? override.at : { x: origin.x + c.x2, y: origin.y + c.y2 }
  const id1 = override?.end === 1 ? (override.snap ?? null) : (c.from ?? null)
  const id2 = override?.end === 2 ? (override.snap ?? null) : (c.to ?? null)
  const b1 = id1 ? boxOf(id1) : null
  const b2 = id2 ? boxOf(id2) : null
  const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
  // Aim at the other end's centre (or its free point), then stop at each box's edge.
  const a = b1 ? centre(b1) : free1
  const z = b2 ? centre(b2) : free2
  return [b1 ? edgePoint(b1, z) : a, b2 ? edgePoint(b2, a) : z]
}

/** The geometry to store for an arrow whose ends are now at p1 and p2 (board units). */
export function arrowPatch(p1: Pt, p2: Pt): { x: number; y: number; w: number; h: number; content: { x1: number; y1: number; x2: number; y2: number } } {
  const x = Math.min(p1.x, p2.x) - ARROW_PAD
  const y = Math.min(p1.y, p2.y) - ARROW_PAD
  const r = (v: number) => Math.round(v * 100) / 100
  return {
    x: r(x),
    y: r(y),
    w: r(Math.max(Math.abs(p2.x - p1.x) + ARROW_PAD * 2, 24)),
    h: r(Math.max(Math.abs(p2.y - p1.y) + ARROW_PAD * 2, 24)),
    content: { x1: r(p1.x - x), y1: r(p1.y - y), x2: r(p2.x - x), y2: r(p2.y - y) },
  }
}

/** Distance from p to the segment a–b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Can an arrow end attach to this item? Other items on the same board, not other arrows. */
export function attachable(arrow: SceneNode, target: SceneNode | undefined): boolean {
  return !!target && target.id !== arrow.id && target.type !== "arrow" && target.parentId === arrow.parentId
}

export const isArrow = (n: SceneNode | undefined): n is ArrowNode => n?.type === "arrow"
