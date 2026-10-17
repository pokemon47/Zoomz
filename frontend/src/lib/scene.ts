import type { BoardNode, ImageNode, Scene, SceneNode } from "./types"

export type SceneIndex = {
  byId: Map<string, SceneNode>
  children: Map<string, SceneNode[]>
}

export function indexScene(scene: Scene): SceneIndex {
  const byId = new Map<string, SceneNode>()
  const children = new Map<string, SceneNode[]>()
  for (const node of scene.nodes) {
    byId.set(node.id, node)
    if (node.parentId) {
      const list = children.get(node.parentId) ?? []
      list.push(node)
      children.set(node.parentId, list)
    }
  }
  return { byId, children }
}

/** Root → board ids. */
export function pathTo(index: SceneIndex, boardId: string): BoardNode[] {
  const path: BoardNode[] = []
  let cur = index.byId.get(boardId)
  while (cur && cur.type === "board") {
    path.unshift(cur)
    cur = cur.parentId ? index.byId.get(cur.parentId) : undefined
  }
  return path
}

/** Up to four images for a board's preview mosaic, searching into its descendants. */
export function previewImages(index: SceneIndex, boardId: string, limit = 4): ImageNode[] {
  const out: ImageNode[] = []
  const queue = [boardId]
  while (queue.length && out.length < limit) {
    const id = queue.shift()!
    for (const child of index.children.get(id) ?? []) {
      if (child.type === "image" && out.length < limit) out.push(child)
      else if (child.type === "board") queue.push(child.id)
    }
  }
  return out
}

export type Rect = { x: number; y: number; w: number; h: number }

export function boundsOf(nodes: { x: number; y: number; w: number; h: number }[]): Rect {
  if (!nodes.length) return { x: 0, y: 0, w: 800, h: 600 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
