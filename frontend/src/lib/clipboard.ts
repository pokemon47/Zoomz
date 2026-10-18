// Copy, cut, paste and duplicate — whole subtrees, across boards and across spaces.

import { api } from "./http"
import { newId, type Op } from "./store"
import type { Space } from "./space"
import type { SceneNode } from "./types"

export const CLIP_PREFIX = "zoomz-clip:v1:"

export type Clip = {
  spaceId: string | null
  /** Top-level items with positions relative to the group's top-left; descendants as-is. */
  nodes: SceneNode[]
  roots: string[]
  w: number
  h: number
}

let memory: Clip | null = null

/** The selected items (and everything inside selected boards), ready to paste elsewhere. */
export function copyNodes(space: Space, ids: string[], spaceId: string | null): Clip | null {
  // Drop anything already inside another selected board.
  const roots = ids.filter((id) => !ids.some((other) => other !== id && space.isAncestor(other, id)))
  const items = roots.map((id) => space.node(id)).filter((n): n is SceneNode => !!n && !!n.parentId)
  if (!items.length) return null
  const pos = items.map((n) => space.at(n))
  const x0 = Math.min(...pos.map((p) => p.x)), y0 = Math.min(...pos.map((p) => p.y))
  const x1 = Math.max(...items.map((n, i) => pos[i].x + n.w)), y1 = Math.max(...items.map((n, i) => pos[i].y + n.h))
  const nodes: SceneNode[] = []
  const walk = (n: SceneNode, top: boolean, p?: { x: number; y: number }) => {
    nodes.push({ ...n, ...(top && p ? { x: p.x - x0, y: p.y - y0 } : {}), content: { ...n.content } } as SceneNode)
    for (const kid of space.index.children.get(n.id) ?? []) walk(kid, false)
  }
  items.forEach((n, i) => walk(n, true, pos[i]))
  const clip = { spaceId, nodes, roots: items.map((n) => n.id), w: x1 - x0, h: y1 - y0 }
  memory = clip
  // Clipboard permission can be denied (it rejects asynchronously); the in-memory copy still
  // works in this tab either way.
  navigator.clipboard?.writeText(CLIP_PREFIX + JSON.stringify(clip)).catch(() => {})
  return clip
}

export function parseClip(text: string | undefined | null): Clip | null {
  if (text?.startsWith(CLIP_PREFIX)) {
    try {
      return JSON.parse(text.slice(CLIP_PREFIX.length)) as Clip
    } catch {
      return null
    }
  }
  return null
}

export function lastClip(): Clip | null {
  return memory
}

/**
 * Operations that recreate a clip inside `board`, centred on (cx, cy) in its local units.
 * Files from another space are copied into this one first (live mode).
 */
export async function pasteOps(clip: Clip, board: string, cx: number, cy: number, spaceId: string | null): Promise<{ op: Op; roots: string[] }> {
  const ids = new Map(clip.nodes.map((n) => [n.id, newId(n.type)]))
  const fileMap = new Map<string, Record<string, unknown>>()
  if (spaceId && clip.spaceId !== spaceId) {
    const fileIds = [...new Set(clip.nodes.map((n) => (n.content as { fileId?: string }).fileId).filter(Boolean) as string[])]
    await Promise.all(
      fileIds.map(async (fid) => {
        const copied = await api<{ id: string } & Record<string, unknown>>(`/api/files/${fid}/copy?space=${encodeURIComponent(spaceId)}`, { method: "POST" })
        fileMap.set(fid, copied)
      }),
    )
  }
  const rootSet = new Set(clip.roots)
  const ops: Op[] = clip.nodes.map((n) => {
    const fid = (n.content as { fileId?: string }).fileId
    const copied = fid ? fileMap.get(fid) : undefined
    const content: Record<string, unknown> = copied ? { ...n.content, ...copied, fileId: copied.id } : { ...n.content }
    if (n.type === "arrow") {
      // Ends stay attached only to items that were copied along; others let go where they were.
      content.from = n.content.from ? (ids.get(n.content.from) ?? null) : null
      content.to = n.content.to ? (ids.get(n.content.to) ?? null) : null
    }
    delete (content as Record<string, unknown>).id
    delete (content as Record<string, unknown>).filename
    const top = rootSet.has(n.id)
    return {
      type: "create",
      node: {
        ...n,
        id: ids.get(n.id)!,
        parentId: top ? board : ids.get(n.parentId!)!,
        x: top ? cx - clip.w / 2 + n.x : n.x,
        y: top ? cy - clip.h / 2 + n.y : n.y,
        content,
      } as SceneNode,
    }
  })
  return { op: { type: "batch", ops }, roots: clip.roots.map((r) => ids.get(r)!) }
}
