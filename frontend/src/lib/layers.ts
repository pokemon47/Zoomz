// Stacking order, like a design tool: bring to front, bring forward, send backward, send to back.
// Only an item's order among its siblings (the things on the same board) changes.

import { layerOf, sortByLayer, type Space } from "./space"
import type { Op } from "./store"

export type LayerMove = "front" | "forward" | "backward" | "back"

/** A rank above everything else on the board (what new and dragged items get). */
export function topRank(space: Space, boardId: string, except: string[] = []): number {
  const kids = (space.index.children.get(boardId) ?? []).filter((n) => !except.includes(n.id))
  return kids.length ? Math.max(...kids.map(layerOf)) + 1 : 1
}

/**
 * The operations that move one item in its board's stack. Usually a single rank update;
 * when neighbours share a rank there is no gap to slot into, so the board's stack is
 * renumbered in one batch.
 */
export function layerOps(space: Space, id: string, move: LayerMove): Op | null {
  const n = space.node(id)
  if (!n?.parentId) return null
  const stack = sortByLayer(space.index.children.get(n.parentId) ?? [])
  const i = stack.findIndex((x) => x.id === id)
  if (stack.length < 2) return null
  const order = stack.filter((x) => x.id !== id)
  const to = move === "front" ? order.length : move === "back" ? 0 : move === "forward" ? Math.min(order.length, i + 1) : Math.max(0, i - 1)
  if (to === i) return null
  order.splice(to, 0, n)
  const below = order[to - 1], above = order[to + 1]
  const lo = below ? layerOf(below) : undefined
  const hi = above ? layerOf(above) : undefined
  let rank: number | null = null
  if (lo === undefined && hi !== undefined) rank = hi - 1
  else if (hi === undefined && lo !== undefined) rank = lo + 1
  else if (lo !== undefined && hi !== undefined && hi - lo > 1e-6) rank = (lo + hi) / 2
  if (rank !== null) return { type: "update", id, patch: { rank } }
  // No room between neighbours: renumber the whole stack in its new order.
  return { type: "batch", ops: order.map((x, k) => ({ type: "update", id: x.id, patch: { rank: k } }) as Op) }
}
