// The scene store: every edit to a board goes through here.
//
// Edits are operations (create / update / delete / batch). `commit()` applies one
// immediately to the local Space (so the UI never waits), records its inverse for your own
// undo, and sends it to the server. The server applies edits in the order it receives them
// and broadcasts the results; we apply other people's results as they arrive and treat our
// own as acknowledgements. If the server rejects something, or we were away too long to
// catch up, we re-sync from a fresh snapshot and re-apply whatever we still hadn't sent.
//
// In local mode (the public demo) there is no server: the same edits just apply locally.

import { api, upload } from "./http"
import { indexScene } from "./scene"
import { Space } from "./space"
import type { Role, SceneNode } from "./types"

export type Op =
  | { type: "create"; node: SceneNode }
  | { type: "update"; id: string; patch: Patch }
  | { type: "delete"; id: string }
  | { type: "batch"; ops: Op[] }

export type Patch = Partial<Pick<SceneNode, "x" | "y" | "z" | "w" | "h" | "parentId" | "rank">> & { content?: Record<string, unknown> }

export type Peer = {
  connId: string
  userId: string | null
  name: string
  color: string
  avatar?: string | null
  role: Role
  focus?: string
  cursor?: { b: string; x: number; y: number } | null
  view?: { b: string; x: number; y: number; w: number; h: number } | null
  path?: string[]
}

export type Status = "local" | "connecting" | "live" | "offline" | "kicked"

type Change = { kind: "upsert"; node: SceneNode } | { kind: "remove"; id: string }
type ServerMsg =
  | { t: "hello"; connId: string; role: Role; seq: number; peers: Peer[] }
  | { t: "op"; seq: number; by: string | null; cid: string | null; changes: Change[] }
  | { t: "reject"; cid: string; error: string; status: number }
  | { t: "resync" }
  | { t: "presence"; peer: Peer }
  | { t: "leave"; connId: string }
  | { t: "drag"; connId: string; id: string; x: number; y: number; parentId: string; done?: boolean }
  | { t: "file"; file: { id: string } & Record<string, unknown> }
  | { t: "space"; title: string; scenery: string }
  | { t: "kicked"; reason: string }
  | { t: "pong" }

export type SceneSnapshot = {
  space: { id: string; title: string; role: Role; scenery: string; workspaceId: string }
  rootBoardId: string
  seq: number
  nodes: SceneNode[]
  boardRoles: Record<string, Role>
}

type Pending = { cid: string; op: Op; sent: boolean; ids: string[] }

let counter = 0
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${(counter++).toString(36)}`

const DERIVED = ["src", "thumb_256", "thumb_1024", "poster", "preview", "status", "mime", "size", "kind", "width", "height"]

export class SceneStore {
  readonly space: Space
  readonly local: boolean
  spaceId: string | null
  publicToken: string | null
  title: string
  scenery: string
  role: Role
  boardRoles: Record<string, Role>
  seq: number
  status: Status
  kickedReason = ""
  me: string | null = null
  peers = new Map<string, Peer>()
  private pending: Pending[] = []
  private undoStack: { op: Op; label: string }[] = []
  private redoStack: { op: Op; label: string }[] = []
  private listeners = new Set<() => void>()
  private ws: WebSocket | null = null
  private retry = 0
  private closed = false
  private presenceTimer = 0
  private nextPresence: Record<string, unknown> | null = null
  private lastDrag = 0
  onError: (message: string) => void = () => {}
  onRemote: () => void = () => {}

  constructor(snapshot: SceneSnapshot, opts: { local?: boolean; publicToken?: string | null } = {}) {
    this.space = new Space(indexScene({ rootBoardId: snapshot.rootBoardId, nodes: snapshot.nodes }), snapshot.rootBoardId)
    this.local = !!opts.local
    this.spaceId = this.local ? null : snapshot.space.id
    this.publicToken = opts.publicToken ?? null
    this.title = snapshot.space.title
    this.scenery = snapshot.space.scenery
    this.role = snapshot.space.role
    this.boardRoles = snapshot.boardRoles
    this.seq = snapshot.seq
    this.status = this.local ? "local" : "connecting"
  }

  // ---------------------------------------------------------------- subscriptions

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  // ---------------------------------------------------------------- permissions

  canEdit(boardId: string | null | undefined): boolean {
    if (this.local) return true
    const role = (boardId && this.boardRoles[boardId]) || this.role
    return role === "owner" || role === "editor"
  }

  get readOnly(): boolean {
    return !this.local && this.role === "viewer" && !Object.values(this.boardRoles).some((r) => r !== "viewer")
  }

  // ---------------------------------------------------------------- editing

  /** Apply an edit now, remember how to undo it, and send it. Returns false if not allowed. */
  commit(op: Op, label = "change", opts: { undoable?: boolean } = {}): boolean {
    if (!this.allowed(op)) {
      this.onError("You can only view this board.")
      return false
    }
    const inverse = this.inverseOf(op)
    this.applyLocal(op)
    if (opts.undoable !== false) {
      this.undoStack.push({ op: inverse, label })
      if (this.undoStack.length > 100) this.undoStack.shift()
      this.redoStack = []
    }
    this.send(op)
    this.emit()
    return true
  }

  undo(): string | null {
    const entry = this.undoStack.pop()
    if (!entry) return null
    const inverse = this.inverseOf(entry.op)
    this.applyLocal(entry.op)
    this.redoStack.push({ op: inverse, label: entry.label })
    this.send(entry.op)
    this.emit()
    return entry.label
  }

  redo(): string | null {
    const entry = this.redoStack.pop()
    if (!entry) return null
    const inverse = this.inverseOf(entry.op)
    this.applyLocal(entry.op)
    this.undoStack.push({ op: inverse, label: entry.label })
    this.send(entry.op)
    this.emit()
    return entry.label
  }

  private allowed(op: Op): boolean {
    if (this.local) return true
    switch (op.type) {
      case "batch":
        return op.ops.every((o) => this.allowed(o))
      case "create":
        return this.canEdit(op.node.parentId)
      case "delete":
      case "update": {
        const n = this.space.node(op.id)
        if (!n) return true // the server will tell us
        if (op.type === "update" && op.patch.parentId && !this.canEdit(op.patch.parentId)) return false
        return this.canEdit(n.parentId ?? n.id)
      }
    }
  }

  /** The operation that puts things back the way they are right now. */
  inverseOf(op: Op): Op {
    switch (op.type) {
      case "batch":
        return { type: "batch", ops: op.ops.map((o) => this.inverseOf(o)).reverse() }
      case "create":
        return { type: "delete", id: op.node.id }
      case "delete": {
        const n = this.space.node(op.id)
        if (!n) return { type: "batch", ops: [] }
        const ops: Op[] = []
        const walk = (node: SceneNode) => {
          ops.push({ type: "create", node: this.snapshotNode(node) })
          for (const kid of this.space.index.children.get(node.id) ?? []) walk(kid)
        }
        walk(n)
        return { type: "batch", ops }
      }
      case "update": {
        const n = this.space.node(op.id)
        if (!n) return { type: "batch", ops: [] }
        const back: Patch = {}
        for (const k of ["x", "y", "z", "w", "h", "parentId", "rank"] as const) if (k in op.patch) (back as Record<string, unknown>)[k] = n[k] ?? null
        if (op.patch.content) {
          const prev: Record<string, unknown> = {}
          const content = n.content as Record<string, unknown>
          for (const k of Object.keys(op.patch.content)) prev[k] = k in content ? content[k] : null
          back.content = prev
        }
        return { type: "update", id: op.id, patch: back }
      }
    }
  }

  /** A node as it should be re-created (derived URLs stay locally, the server re-signs them). */
  private snapshotNode(n: SceneNode): SceneNode {
    const p = this.space.at(n)
    return { ...n, x: p.x, y: p.y, content: { ...n.content } } as SceneNode
  }

  private applyLocal(op: Op) {
    switch (op.type) {
      case "batch":
        for (const o of op.ops) this.applyLocal(o)
        return
      case "create":
        this.space.addNode(op.node)
        this.space.clearPos(op.node.id)
        return
      case "delete":
        this.space.removeNode(op.id)
        return
      case "update": {
        const n = this.space.node(op.id)
        if (!n) return
        const { content, parentId, ...rest } = op.patch
        if (parentId && parentId !== n.parentId) this.space.setParent(n.id, parentId)
        const cur = this.space.node(op.id)!
        const next = { ...cur, ...rest, content: content ? { ...cur.content, ...stripNulls(content) } : cur.content } as SceneNode
        this.space.updateNode(next)
        this.space.clearPos(n.id)
        return
      }
    }
  }

  // ---------------------------------------------------------------- uploads

  /**
   * Put files on a board. Each shows up at once with a local preview, uploads with progress,
   * then becomes a real item pointing at the stored file.
   */
  async addFiles(files: File[], board: string, place: (i: number, file: File, ratio: number) => { x: number; y: number; w: number; h: number; z: number; rank?: number }) {
    if (!this.canEdit(board)) {
      this.onError("You can only view this board.")
      return []
    }
    const ids: string[] = []
    await Promise.all(
      files.map(async (file, i) => {
        const isImage = file.type.startsWith("image/")
        const blob = URL.createObjectURL(file)
        const ratio = isImage ? await imageRatio(blob) : 1.2
        const at = place(i, file, ratio)
        const id = newId(isImage ? "img" : "file")
        ids.push(id)
        const title = isImage ? file.name.replace(/\.[^.]+$/, "") || file.name : file.name
        const base = { id, parentId: board, ...at }
        const node: SceneNode = isImage
          ? { ...base, type: "image", content: { title, alt: `Image: ${file.name}`, src: blob, status: "uploading" } }
          : { ...base, type: "file", content: { title, src: blob, mime: file.type, size: file.size, status: "uploading" } }
        if (this.local) {
          this.commit({ type: "create", node: { ...node, content: { ...node.content, status: "ready" } } as SceneNode }, "add files")
          return
        }
        // Visible right away, but not sent until the file is stored.
        this.space.addNode(node)
        this.emit()
        try {
          const stored = await upload<{ id: string } & Record<string, unknown>>(`/api/spaces/${this.spaceId}/files?board=${encodeURIComponent(board)}`, file, (f) => {
            const cur = this.space.node(id)
            if (cur) {
              this.space.updateNode({ ...cur, content: { ...cur.content, progress: f } } as unknown as SceneNode)
              this.emit()
            }
          })
          const cur = this.space.node(id)
          if (!cur) return // removed while uploading
          this.space.removeNode(id)
          const p = this.space.at(cur)
          const content = { ...cur.content, ...stored, fileId: stored.id, src: (stored.src as string) ?? blob }
          delete (content as Record<string, unknown>).progress
          delete (content as Record<string, unknown>).id
          delete (content as Record<string, unknown>).filename
          this.commit({ type: "create", node: { ...cur, x: p.x, y: p.y, content } as SceneNode }, "add files")
        } catch (e) {
          this.space.removeNode(id)
          this.emit()
          this.onError(`${file.name}: ${(e as Error).message}`)
        }
      }),
    )
    return ids
  }

  // ---------------------------------------------------------------- live connection

  connect() {
    if (this.local || this.closed) return
    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    const params = new URLSearchParams({ since: String(this.seq) })
    if (this.publicToken) params.set("public", this.publicToken)
    const ws = new WebSocket(`${proto}//${location.host}/api/spaces/${this.spaceId}/live?${params}`)
    this.ws = ws
    this.status = "connecting"
    this.emit()
    ws.onmessage = (e) => {
      try {
        this.receive(JSON.parse(e.data) as ServerMsg)
      } catch (err) {
        console.error("bad live message", err)
      }
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.closed) return
      if (e.code === 4403 || e.code === 4404 || this.status === "kicked") {
        this.status = "kicked"
        this.kickedReason ||= "You no longer have access to this board."
        this.emit()
        return
      }
      this.status = "offline"
      for (const p of this.pending) p.sent = false
      this.emit()
      const wait = Math.min(15000, 600 * 2 ** this.retry++)
      setTimeout(() => this.connect(), wait)
    }
  }

  close() {
    this.closed = true
    this.ws?.close()
    this.ws = null
  }

  get unsaved(): number {
    return this.pending.length
  }

  private send(op: Op) {
    if (this.local) return
    const cid = newId("op")
    const ids = opIds(op)
    const entry: Pending = { cid, op: sendable(op), sent: false, ids }
    this.pending.push(entry)
    this.flush()
  }

  private flush() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== "live") return
    for (const p of this.pending) {
      if (p.sent) continue
      this.ws.send(JSON.stringify({ t: "op", cid: p.cid, op: p.op }))
      p.sent = true
    }
  }

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case "hello":
        this.me = msg.connId
        this.role = msg.role
        this.peers = new Map(msg.peers.map((p) => [p.connId, p]))
        this.status = "live"
        this.retry = 0
        this.flush()
        this.emit()
        return
      case "op": {
        const mine = this.pending.findIndex((p) => p.cid === msg.cid)
        if (mine >= 0) this.pending.splice(mine, 1)
        const busy = new Set(this.pending.flatMap((p) => p.ids))
        for (const c of msg.changes) {
          if (c.kind === "upsert") {
            if (busy.has(c.node.id)) continue // our newer edit is still on its way
            this.space.upsert(c.node)
          } else if (!busy.has(c.id)) {
            this.space.removeNode(c.id)
          }
        }
        this.seq = Math.max(this.seq, msg.seq)
        if (mine < 0) this.onRemote()
        this.emit()
        return
      }
      case "reject":
        this.pending = this.pending.filter((p) => p.cid !== msg.cid)
        this.onError(msg.error)
        void this.resync()
        return
      case "resync":
        void this.resync()
        return
      case "presence":
        this.peers.set(msg.peer.connId, msg.peer)
        this.emit()
        return
      case "leave":
        this.peers.delete(msg.connId)
        this.emit()
        return
      case "drag": {
        const n = this.space.node(msg.id)
        if (!n || this.pending.some((p) => p.ids.includes(msg.id))) return
        if (msg.parentId && msg.parentId !== n.parentId && this.space.node(msg.parentId)) this.space.setParent(msg.id, msg.parentId)
        if (msg.done) this.space.clearPos(msg.id)
        else this.space.setPos(msg.id, msg.x, msg.y)
        this.emit()
        return
      }
      case "file": {
        const { id, ...facts } = msg.file
        for (const n of this.space.index.byId.values()) {
          if ((n.content as { fileId?: string }).fileId === id) this.space.updateNode({ ...n, content: { ...n.content, ...facts } } as SceneNode)
        }
        this.emit()
        return
      }
      case "space":
        this.title = msg.title
        this.scenery = msg.scenery
        this.emit()
        return
      case "kicked":
        this.status = "kicked"
        this.kickedReason = msg.reason
        this.emit()
        return
    }
  }

  /** Start over from the server's current state, then re-apply what we still haven't had confirmed. */
  async resync() {
    if (this.local || !this.spaceId) return
    try {
      const q = this.publicToken ? `?public=${encodeURIComponent(this.publicToken)}` : ""
      const snap = await api<SceneSnapshot>(`/api/spaces/${this.spaceId}/scene${q}`)
      this.space.reset(snap.nodes)
      this.seq = snap.seq
      this.role = snap.space.role
      this.boardRoles = snap.boardRoles
      this.title = snap.space.title
      for (const p of this.pending) {
        this.applyLocal(p.op)
        p.sent = false
      }
      this.undoStack = []
      this.redoStack = []
      this.flush()
      this.emit()
    } catch (e) {
      this.onError((e as Error).message)
    }
  }

  // ---------------------------------------------------------------- presence

  /** Where I am and what I'm pointing at (throttled). */
  setPresence(p: { focus?: string; cursor?: Peer["cursor"]; view?: Peer["view"]; path?: string[] }) {
    if (this.local) return
    this.nextPresence = { t: "presence", ...p }
    if (this.presenceTimer) return
    this.presenceTimer = window.setTimeout(() => {
      this.presenceTimer = 0
      if (this.ws?.readyState === WebSocket.OPEN && this.nextPresence) this.ws.send(JSON.stringify(this.nextPresence))
      this.nextPresence = null
    }, 70)
  }

  /** Let others watch a card move while I drag it (not stored). */
  sendDrag(id: string, x: number, y: number, parentId: string, done = false) {
    if (this.local || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const now = performance.now()
    if (!done && now - this.lastDrag < 50) return
    this.lastDrag = now
    this.ws.send(JSON.stringify({ t: "drag", id, x, y, parentId, done }))
  }
}

function stripNulls(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== null) out[k] = v
  return out
}

function opIds(op: Op): string[] {
  if (op.type === "batch") return op.ops.flatMap(opIds)
  return [op.type === "create" ? op.node.id : op.id]
}

/** What goes over the wire: no local blob URLs or derived file facts. */
function sendable(op: Op): Op {
  if (op.type === "batch") return { type: "batch", ops: op.ops.map(sendable) }
  if (op.type !== "create") return op
  const content = { ...(op.node.content as Record<string, unknown>) }
  if (content.fileId || String(content.src ?? "").startsWith("blob:")) for (const k of DERIVED) delete content[k]
  delete content.progress
  return { type: "create", node: { ...op.node, content } as SceneNode }
}

export function imageRatio(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(Math.min(1.8, Math.max(0.5, img.naturalHeight / Math.max(1, img.naturalWidth))))
    img.onerror = () => resolve(1.25)
    img.src = src
  })
}
