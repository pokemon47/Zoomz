// The infinite nested space.
//
// Every board's contents live in that board's own local coordinates and are drawn
// *on the board card's face*, scaled by k. The camera is always expressed in the frame
// of one board (`cam.b`): screen = local * s + (x, y). Whenever a child board's card
// covers the whole viewport we re-anchor the camera into that child; when the current
// board stops covering the viewport we re-anchor into its parent. Rendering is identical
// either side of a re-anchor, so zoom is seamless and never runs out of precision.
//
// Depth: each node has a height `z` above its board's floor. A camera "height" of
// SPACE.eye screen px gives raised things a perspective boost g = 1 / (1 − z·s / eye):
// as you approach, taller things grow faster and drift with the pointer, and things that
// get too close fly past and fade, like walking through a room rather than scaling a picture.

import { lodFor, SPACE } from "./constants"
import type { BoardNode, LOD, SceneNode } from "./types"
import type { SceneIndex } from "./scene"

export type Cam = { b: string; x: number; y: number; s: number }
export type Viewport = { w: number; h: number }
export type Pointer = { x: number; y: number } // smoothed, −1…1 from viewport centre

export type Frame = {
  /** Uniform scale from the child board's local units onto its card face. */
  k: number
  /** Translation: parentLocal = a + childLocal * k. */
  ax: number
  ay: number
}

export type Rect = { x: number; y: number; w: number; h: number }

/** Content bounds of a board, padded so content never touches the card edge. */
export function contentBounds(index: SceneIndex, boardId: string, override?: Map<string, { x: number; y: number }>): Rect {
  const kids = index.children.get(boardId) ?? []
  if (!kids.length) return { x: 0, y: 0, w: 800, h: 600 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of kids) {
    const p = override?.get(n.id) ?? n
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + n.w)
    maxY = Math.max(maxY, p.y + n.h)
  }
  const pad = SPACE.contentPad
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

export class Space {
  private frames = new Map<string, Frame>()
  private bounds = new Map<string, Rect>()
  readonly index: SceneIndex
  readonly rootId: string
  private readonly pos: Map<string, { x: number; y: number }>

  constructor(index: SceneIndex, rootId: string, pos: Map<string, { x: number; y: number }> = new Map()) {
    this.index = index
    this.rootId = rootId
    this.pos = pos
  }

  /** Node position, honouring in-session moves. */
  at(n: SceneNode): { x: number; y: number } {
    return this.pos.get(n.id) ?? n
  }

  node(id: string): SceneNode | undefined {
    return this.index.byId.get(id)
  }

  parentOf(id: string): string | null {
    return this.index.byId.get(id)?.parentId ?? null
  }

  // ---------- session edits (the index is mutated in place) ----------

  /** Move a node under another board, keeping everything else where it is. */
  setParent(id: string, parentId: string) {
    const n = this.index.byId.get(id)
    if (!n || n.parentId === parentId) return
    if (n.parentId) {
      const list = this.index.children.get(n.parentId)
      const i = list ? list.indexOf(n) : -1
      if (list && i >= 0) list.splice(i, 1)
    }
    const moved = { ...n, parentId } as SceneNode
    this.index.byId.set(id, moved)
    const list = this.index.children.get(parentId) ?? []
    list.push(moved)
    this.index.children.set(parentId, list)
  }

  addNode(n: SceneNode): void {
    if (this.index.byId.has(n.id)) {
      this.upsert(n)
      return
    }
    this.index.byId.set(n.id, n)
    if (n.parentId) {
      const list = this.index.children.get(n.parentId) ?? []
      list.push(n)
      this.index.children.set(n.parentId, list)
    }
  }

  /** Remove a node (and, for boards, everything inside). Returns removed nodes. */
  removeNode(id: string): SceneNode[] {
    const n = this.index.byId.get(id)
    if (!n || !n.parentId) return []
    const removed: SceneNode[] = []
    const drop = (node: SceneNode) => {
      removed.push(node)
      for (const kid of [...(this.index.children.get(node.id) ?? [])]) drop(kid)
      this.index.children.delete(node.id)
      this.index.byId.delete(node.id)
      this.pos.delete(node.id)
    }
    const list = this.index.children.get(n.parentId)
    const i = list ? list.indexOf(n) : -1
    if (list && i >= 0) list.splice(i, 1)
    drop(n)
    return removed
  }

  /** Replace a node's data (e.g. edited text), keeping its place in the tree. */
  updateNode(n: SceneNode) {
    const old = this.index.byId.get(n.id)
    if (!old) return
    this.index.byId.set(n.id, n)
    const list = old.parentId ? this.index.children.get(old.parentId) : undefined
    if (list) {
      const i = list.indexOf(old)
      if (i >= 0) list[i] = n
    }
    if (n.type === "board" && (old.w !== n.w || old.h !== n.h)) this.invalidate(n.id)
  }

  setPos(id: string, x: number, y: number) {
    this.pos.set(id, { x, y })
  }

  /** Where a child board's local origin sits on its own card, in card-local px. */
  innerOrigin(boardId: string): { k: number; ox: number; oy: number } {
    const f = this.frameOf(boardId)
    const p = this.at(this.index.byId.get(boardId)!)
    return { k: f.k, ox: f.ax - p.x, oy: f.ay - p.y }
  }

  boundsOf(boardId: string): Rect {
    let b = this.bounds.get(boardId)
    if (!b) {
      // A board's content window is stored on the board (`content.frame`), so adding or moving
      // cards never rescales it. Older data without a frame falls back to its children's bounds.
      const node = this.index.byId.get(boardId)
      const frame = node?.type === "board" ? node.content.frame : undefined
      b = frame ? { ...frame } : contentBounds(this.index, boardId)
      this.bounds.set(boardId, b)
    }
    return b
  }

  /** Insert or replace a node from the server (or an undo), keeping the tree consistent. */
  upsert(n: SceneNode): void {
    const old = this.index.byId.get(n.id)
    if (!old) {
      this.addNode(n)
      return
    }
    if (old.parentId !== n.parentId) {
      this.setParent(n.id, n.parentId!)
    }
    this.updateNode(n)
    this.pos.delete(n.id)
    if (n.type === "board") this.invalidate(n.id)
  }

  /** Drop cached frames for a board (its size or frame changed). */
  invalidate(boardId: string) {
    this.frames.delete(boardId)
    this.bounds.delete(boardId)
  }

  /** Replace everything (after a resync), keeping this object so the camera's references hold. */
  reset(nodes: SceneNode[]) {
    this.index.byId.clear()
    this.index.children.clear()
    for (const n of nodes) {
      this.index.byId.set(n.id, n)
      if (n.parentId) {
        const list = this.index.children.get(n.parentId) ?? []
        list.push(n)
        this.index.children.set(n.parentId, list)
      }
    }
    this.frames.clear()
    this.bounds.clear()
    this.pos.clear()
  }

  /** Clear an in-progress drag position. */
  clearPos(id: string) {
    this.pos.delete(id)
  }

  hasPos(id: string): boolean {
    return this.pos.has(id)
  }

  /** Mapping from a (non-root) board's local space onto its card face in the parent. */
  frameOf(boardId: string): Frame {
    const card = this.index.byId.get(boardId)!
    const p = this.at(card)
    let f = this.frames.get(boardId)
    if (!f) {
      const cb = this.boundsOf(boardId)
      const innerW = card.w - SPACE.facePad * 2
      const innerH = card.h - SPACE.faceHeader - SPACE.facePad
      const k = Math.min(innerW / cb.w, innerH / cb.h)
      // Offsets relative to the card origin; the card's live position is added below.
      f = {
        k,
        ax: SPACE.facePad + (innerW - cb.w * k) / 2 - cb.x * k,
        ay: SPACE.faceHeader + (innerH - cb.h * k) / 2 - cb.y * k,
      }
      this.frames.set(boardId, f)
    }
    return { k: f.k, ax: p.x + f.ax, ay: p.y + f.ay }
  }

  toParent(cam: Cam): Cam {
    const parent = this.parentOf(cam.b)
    if (!parent) return cam
    const f = this.frameOf(cam.b)
    // parent = a + child·k, so screen = parent·(s/k) + (t − a·s/k)
    const s = cam.s / f.k
    return { b: parent, s, x: cam.x - f.ax * s, y: cam.y - f.ay * s }
  }

  toChild(cam: Cam, childId: string): Cam {
    const f = this.frameOf(childId)
    return { b: childId, s: cam.s * f.k, x: cam.x + f.ax * cam.s, y: cam.y + f.ay * cam.s }
  }

  /** Express a camera in the frame of `target` (any board), via the root. */
  toFrame(cam: Cam, target: string): Cam {
    let c = cam
    while (c.b !== this.rootId && !this.isAncestor(c.b, target)) c = this.toParent(c)
    const chain: string[] = []
    for (let id: string | null = target; id && id !== c.b; id = this.parentOf(id)) chain.unshift(id)
    for (const id of chain) c = this.toChild(c, id)
    return c
  }

  isAncestor(a: string, b: string): boolean {
    for (let id: string | null = b; id; id = this.parentOf(id)) if (id === a) return true
    return false
  }

  depthOf(boardId: string): number {
    let d = 0
    for (let id = this.parentOf(boardId); id; id = this.parentOf(id)) d++
    return d
  }

  /** Total magnification relative to the root frame (for the zoom readout). */
  globalScale(cam: Cam): number {
    let s = cam.s
    for (let id: string | null = cam.b; id && id !== this.rootId; id = this.parentOf(id)) s /= this.frameOf(id).k
    return s
  }

  cardRect(cam: Cam, n: SceneNode): Rect {
    const p = this.at(n)
    return { x: p.x * cam.s + cam.x, y: p.y * cam.s + cam.y, w: n.w * cam.s, h: n.h * cam.s }
  }

  /** Re-anchor the camera to the deepest board whose card fills the viewport. */
  normalize(cam: Cam, vp: Viewport): Cam {
    let c = cam
    for (let guard = 0; guard < 32; guard++) {
      if (c.b !== this.rootId) {
        const up = this.toParent(c)
        if (!covers(this.cardRect(up, this.node(c.b)!), vp)) {
          c = up
          continue
        }
      }
      let moved = false
      for (const kid of this.index.children.get(c.b) ?? []) {
        if (kid.type !== "board") continue
        if (covers(this.cardRect(c, kid), vp)) {
          c = this.toChild(c, kid.id)
          moved = true
          break
        }
      }
      if (!moved) break
    }
    return c
  }

  /** Camera that frames a board's whole content in the viewport, in that board's frame. */
  fit(boardId: string, vp: Viewport, pad = SPACE.fitPad): Cam {
    const cb = this.boundsOf(boardId)
    const aw = Math.max(80, vp.w - pad.left - pad.right)
    const ah = Math.max(80, vp.h - pad.top - pad.bottom)
    const s = Math.min(aw / cb.w, ah / cb.h)
    return {
      b: boardId,
      s,
      x: pad.left + aw / 2 - (cb.x + cb.w / 2) * s,
      y: pad.top + ah / 2 - (cb.y + cb.h / 2) * s,
    }
  }

  /** Smallest/largest camera scale allowed in a frame. */
  clampScale(cam: Cam, vp: Viewport): Cam {
    let s = cam.s
    if (cam.b === this.rootId) s = Math.max(s, this.fit(this.rootId, vp).s * SPACE.minZoomOfFit)
    s = Math.min(s, SPACE.maxLocalScale)
    if (s === cam.s) return cam
    const k = s / cam.s
    const cx = vp.w / 2, cy = vp.h / 2
    return { b: cam.b, s, x: cx - (cx - cam.x) * k, y: cy - (cy - cam.y) * k }
  }
}

export function covers(r: Rect, vp: Viewport): boolean {
  return r.x <= 0 && r.y <= 0 && r.x + r.w >= vp.w && r.y + r.h >= vp.h
}

// ---------------------------------------------------------------- layout

export type Placed = {
  node: SceneNode
  /** Nesting depth relative to the root board. */
  level: number
  /** Screen position of the node's top-left, and screen px per local unit. */
  x: number
  y: number
  scale: number
  /** Perspective boost from height (1 = on the floor). */
  g: number
  opacity: number
  lod: LOD
  /** Boards: how visible its contents are on the face (0 = too small to draw). */
  reveal: number
  /** Paint order. */
  order: number
}

export type Layout = {
  items: Placed[]
  /** Board whose floor shows behind everything. */
  floorBoard: string
  /** Screen scale of the floor board (for the dot grid). */
  floorCam: Cam
  /**
   * The board you're standing in, when its card covers the whole screen. It is drawn as a
   * screen-sized floor layer instead of a card scaled up 50×+ (which overflows GPU textures
   * and flickers). Looks identical: same tint, same alpha, same dot grid.
   */
  room: { board: string; cam: Cam } | null
  /** Deepest board the viewer is "in" — drives breadcrumbs. */
  focus: string
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function layout(space: Space, cam: Cam, vp: Viewport, pointer: Pointer, parallax: boolean): Layout {
  // Draw from one level above the camera board, so things in the room you just
  // walked out of can still drift past the edges as you go deeper.
  const startCam = cam.b !== space.rootId ? space.toParent(cam) : cam
  const items: Placed[] = []
  const cx = vp.w / 2, cy = vp.h / 2
  const margin = SPACE.cullMargin
  let order = 0
  let focus = cam.b
  let focusLevel = space.depthOf(cam.b)
  let room: Layout["room"] = null

  const visit = (boardId: string, c: Cam, level: number, inherited: number) => {
    const kids = space.index.children.get(boardId) ?? []
    // Boards first (they are the floor), then prints, then notes on top.
    const sorted = [...kids].sort((a, b) => rank(a) - rank(b))
    for (const n of sorted) {
      const p = space.at(n)
      const baseX = p.x * c.s + c.x
      const baseY = p.y * c.s + c.y
      if (n.type === "board") {
        const w = n.w * c.s, h = n.h * c.s
        if (baseX > vp.w + margin || baseY > vp.h + margin || baseX + w < -margin || baseY + h < -margin) continue
        if (covers({ x: baseX, y: baseY, w, h }, vp)) {
          // Standing in it: it's a floor now, not an object.
          const inner = space.toChild(c, n.id)
          room = { board: n.id, cam: inner }
          if (level + 1 > focusLevel) {
            focus = n.id
            focusLevel = level + 1
          }
          visit(n.id, inner, level + 1, inherited)
          continue
        }
        const span = Math.min(w / vp.w, h / vp.h)
        // No covers: a board always shows what's inside; only tiny far-away cards skip it.
        const reveal = smooth(SPACE.contentsFrom, SPACE.contentsFull, Math.min(w, h))
        items.push({ node: n, level, x: baseX, y: baseY, scale: c.s, g: 1, opacity: inherited, lod: lodFor("board", w), reveal, order: order++ })
        if (span >= SPACE.focusSpan && level + 1 > focusLevel && baseX < cx && baseY < cy && baseX + w > cx && baseY + h > cy) {
          focus = n.id
          focusLevel = level + 1
        }
        if (reveal > 0) visit(n.id, space.toChild(c, n.id), level + 1, inherited * reveal)
        continue
      }
      // Raised things: perspective about the viewport centre plus pointer parallax.
      if (1 - ((n.z ?? 0) * c.s) / SPACE.eye <= SPACE.passDenom) continue // already behind the camera
      const { g, dx, dy } = lift(n.z ?? 0, c.s, pointer, parallax)
      const x = cx + (baseX - cx) * g + dx
      const y = cy + (baseY - cy) * g + dy
      const s = c.s * g
      const w = n.w * s, h = n.h * s
      if (x > vp.w + margin || y > vp.h + margin || x + w < -margin || y + h < -margin) continue
      const pass = 1 - smooth(SPACE.passFadeStart, SPACE.passFadeEnd, g)
      if (pass <= 0.01) continue
      items.push({ node: n, level, x, y, scale: s, g, opacity: inherited * pass, lod: lodFor(n.type, w), reveal: 0, order: order++ })
    }
  }

  visit(startCam.b, startCam, space.depthOf(startCam.b), 1)
  // Things flying past the camera paint over everything else.
  for (const it of items) if (it.g > 1.6) it.order += 10_000
  return { items, floorBoard: startCam.b, floorCam: startCam, room, focus }
}

function rank(n: SceneNode): number {
  return n.type === "board" ? 0 : n.type === "note" ? 2 : 1
}

/** Perspective boost and pointer drift for something `z` high in a frame of scale s. */
export function lift(z: number, s: number, pointer: Pointer, parallax: boolean) {
  const height = z * s
  const denom = Math.max(SPACE.passDenom, 1 - height / SPACE.eye)
  const shift = parallax ? height * SPACE.pointerParallax : 0
  return { g: 1 / denom, dx: -pointer.x * shift, dy: -pointer.y * shift * 0.7 }
}

/** Inverse of layout's projection: which local top-left puts a raised node's top-left at (sx, sy). */
export function localFromScreen(c: Cam, vp: Viewport, z: number, sx: number, sy: number, pointer: Pointer, parallax: boolean) {
  const { g, dx, dy } = lift(z, c.s, pointer, parallax)
  const cx = vp.w / 2, cy = vp.h / 2
  const baseX = cx + (sx - dx - cx) / g
  const baseY = cy + (sy - dy - cy) / g
  return { x: (baseX - c.x) / c.s, y: (baseY - c.y) / c.s, screenScale: c.s * g }
}

export function isBoard(n: SceneNode): n is BoardNode {
  return n.type === "board"
}
