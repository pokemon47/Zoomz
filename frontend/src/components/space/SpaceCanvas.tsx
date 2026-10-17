/* oxlint-disable react/refs, react/purity -- the camera engine, session positions and live layout
   are an external, mutable store advanced by requestAnimationFrame; each frame re-renders and reads
   them (and the frame clock, for short morph animations). */
import { useReducedMotion } from "motion/react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { AddMenu } from "@/components/zoomboard/AddMenu"
import { BoardCard } from "@/components/zoomboard/BoardCard"
import { Breadcrumbs } from "@/components/zoomboard/Breadcrumbs"
import { CreateDialog, type CreateKind } from "@/components/zoomboard/CreateDialog"
import { DraggablePanel } from "@/components/zoomboard/DraggablePanel"
import { FileCard } from "@/components/zoomboard/FileCard"
import { ImageCard } from "@/components/zoomboard/ImageCard"
import { LevelBadge } from "@/components/zoomboard/LevelBadge"
import { Minimap } from "@/components/zoomboard/Minimap"
import { NoteCard } from "@/components/zoomboard/NoteCard"
import { SceneryPicker } from "@/components/zoomboard/SceneryPicker"
import type { Tactile } from "@/components/zoomboard/TactileSlab"
import { ZoomControls } from "@/components/zoomboard/ZoomControls"
import { CameraEngine } from "@/lib/cameraEngine"
import { MOTION, SPACE, ZOOM, floorFor } from "@/lib/constants"
import { indexScene, pathTo } from "@/lib/scene"
import { SCENERY, themeById, type SceneryId } from "@/lib/scenery"
import { Space, layout, lift, localFromScreen, type Cam, type Layout, type Placed, type Viewport } from "@/lib/space"
import type { Scene, SceneNode } from "@/lib/types"
import { Scenery } from "./Scenery"

type Props = { scene: Scene }

type Press = {
  pointer: number
  id: string | null // null = panning the floor
  sx: number
  sy: number
  lx: number
  ly: number
  /** Where on the card it was grabbed, as a fraction of its size. */
  fx: number
  fy: number
  /** Original parent and position, to undo a cancelled drag. */
  parent: string | null
  nx: number
  ny: number
  moved: boolean
}

/** A short scale/fade animation on one item: re-parenting (adopt the new level's size) or spawning. */
type Morph = { from: number; start: number; dur: number; fx: number; fy: number; spawn: boolean }

const SCENERY_KEY = "zoomz.scenery"
const loadScenery = (): SceneryId => {
  try {
    return (localStorage.getItem(SCENERY_KEY) as SceneryId | null) ?? "mountains"
  } catch {
    return "mountains"
  }
}

const easeOutBack = (t: number) => {
  const c = 1.4
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

let uid = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(uid++).toString(36)}`

export function SpaceCanvas({ scene }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion() ?? false

  // The space is built once from the loaded scene and then edited in place (moves,
  // re-parenting, additions). Board frames are fixed, so edits never rescale a board.
  const [initial] = useState(scene)
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const space = useMemo(() => new Space(indexScene(initial), initial.rootBoardId, positions.current), [initial])

  const [vp, setVp] = useState<Viewport>({ w: window.innerWidth, h: window.innerHeight })
  const engineRef = useRef<CameraEngine | null>(null)
  if (!engineRef.current) {
    const fit = space.fit(space.rootId, vp)
    const k = reduced ? 1 : 0.55
    // Start a little back from the board and walk in.
    const start: Cam = { ...fit, s: fit.s * k, x: vp.w / 2 - (vp.w / 2 - fit.x) * k, y: vp.h / 2 - (vp.h / 2 - fit.y) * k }
    const e = new CameraEngine(space, vp, start)
    e.target = fit
    engineRef.current = e
  }
  const engine = engineRef.current
  engine.reduced = reduced

  const [, setFrame] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [press, setPress] = useState<Press | null>(null)
  const pressRef = useRef<Press | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [fileDrag, setFileDrag] = useState<string | null>(null) // board files would land in
  const [creating, setCreating] = useState<CreateKind | null>(null)
  const [scenery, setScenery] = useState<SceneryId>(loadScenery)
  const [announcement, setAnnouncement] = useState("")
  const morphs = useRef(new Map<string, Morph>())
  const animUntil = useRef(0)
  const undo = useRef<{ nodes: SceneNode[]; pos: Map<string, { x: number; y: number }> }[]>([])

  // ---------- frame loop: runs only while something is moving ----------
  const raf = useRef(0)
  const kick = useCallback(() => {
    if (raf.current) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const moving = engine.tick(now, dt) || now < animUntil.current
      setFrame((f) => (f + 1) % 1_000_000)
      raf.current = moving ? requestAnimationFrame(step) : 0
    }
    raf.current = requestAnimationFrame(step)
  }, [engine])
  useEffect(() => {
    kick()
    return () => {
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [kick])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const next = { w: el.clientWidth || 1, h: el.clientHeight || 1 }
      engine.setViewport(next)
      setVp(next)
      kick()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [engine, kick])

  const morph = useCallback(
    (id: string, m: Omit<Morph, "start" | "dur"> & { dur?: number }) => {
      if (reduced) return
      const dur = m.dur ?? (m.spawn ? 420 : 320)
      morphs.current.set(id, { ...m, start: performance.now(), dur })
      animUntil.current = Math.max(animUntil.current, performance.now() + dur + 20)
      kick()
    },
    [kick, reduced],
  )

  // ---------- layout for this frame ----------
  const lay = layout(space, engine.display, vp, engine.pointer, !reduced)
  const layRef = useRef<Layout>(lay)
  layRef.current = lay
  const path = pathTo(space.index, lay.focus)
  const focusDepth = path.length - 1
  const readout = formatZoom(space.globalScale(engine.display))
  const theme = themeById(scenery)
  const hasScenery = !!theme.layer

  // The floor of the board you're standing in. With scenery, the outermost floor is open
  // sky and every board floor is frosted, so the world stays visible as you go deeper.
  const pitch = 24 * lay.floorCam.s
  const openSky = hasScenery && lay.floorBoard === space.rootId
  const viewportStyle: CSSProperties = {
    ["--floor" as string]: floorFor(space.depthOf(lay.floorBoard)),
    ["--floor-alpha" as string]: openSky ? 0 : hasScenery ? SPACE.faceAlpha : 1,
    ["--face-alpha" as string]: hasScenery ? SPACE.faceAlpha : 1,
  }
  const dotsStyle: CSSProperties = {
    backgroundSize: `${pitch}px ${pitch}px`,
    ["--pitch" as string]: `${pitch}px`,
    backgroundPosition: `${lay.floorCam.x}px ${lay.floorCam.y}px`,
    opacity: openSky ? 0 : Math.min(1, Math.max(0, (pitch - 6) / 8)),
  }
  // The board you're standing in, drawn screen-sized (see Layout.room) — same look as its card face.
  const roomStyle: CSSProperties | null = lay.room
    ? {
        ["--floor-c" as string]: floorFor(space.depthOf(lay.room.board)),
        ["--dot" as string]: `${24 * lay.room.cam.s}px`,
        backgroundPosition: `${lay.room.cam.x}px ${lay.room.cam.y}px`,
      }
    : null

  const now = performance.now()
  const morphFor = (id: string) => {
    const m = morphs.current.get(id)
    if (!m) return null
    const t = Math.min(1, (now - m.start) / m.dur)
    if (t >= 1) {
      morphs.current.delete(id)
      return null
    }
    return { extra: m.from + (1 - m.from) * easeOutBack(t), fade: m.spawn ? Math.min(1, t * 2.5) : 1, fx: m.fx, fy: m.fy }
  }

  // ---------- hit testing: which board is under a screen point ----------
  const boardAt = useCallback(
    (px: number, py: number, exclude: string | null): string => {
      let best: Placed | null = null
      for (const p of layRef.current.items) {
        if (p.node.type !== "board" || p.reveal < 0.5) continue
        if (exclude && (p.node.id === exclude || space.isAncestor(exclude, p.node.id))) continue
        const w = p.node.w * p.scale, h = p.node.h * p.scale
        if (px < p.x || py < p.y || px > p.x + w || py > p.y + h) continue
        if (!best || p.level > best.level) best = p
      }
      return best?.node.id ?? layRef.current.floorBoard
    },
    [space],
  )

  /** Keep a node inside its board's content window (root is unbounded). */
  const clampIntoBoard = useCallback(
    (n: SceneNode) => {
      if (!n.parentId || n.parentId === space.rootId) return
      const b = space.boundsOf(n.parentId)
      const p = space.at(n)
      const fit = (v: number, lo: number, span: number, size: number) => (span < size ? lo + (span - size) / 2 : Math.min(Math.max(v, lo), lo + span - size))
      space.setPos(n.id, fit(p.x, b.x, b.w, n.w), fit(p.y, b.y, b.h, n.h))
    },
    [space],
  )

  // ---------- navigation ----------
  const flyToBoard = useCallback(
    (id: string) => {
      engine.flyTo(space.fit(id, engine.vp), performance.now())
      kick()
    },
    [engine, kick, space],
  )

  const flyToNode = useCallback(
    (n: SceneNode) => {
      if (n.type === "board") return flyToBoard(n.id)
      const board = n.parentId!
      const p = space.at(n)
      const s = Math.min((engine.vp.w * 0.6) / n.w, (engine.vp.h * 0.6) / n.h)
      engine.flyTo({ b: board, s, x: engine.vp.w / 2 - (p.x + n.w / 2) * s, y: engine.vp.h / 2 - (p.y + n.h / 2) * s }, performance.now())
      kick()
    },
    [engine, flyToBoard, kick, space],
  )

  const goUp = useCallback(() => {
    const parent = space.parentOf(lay.focus)
    if (parent) flyToBoard(parent)
  }, [flyToBoard, lay.focus, space])

  const zoomCentre = useCallback(
    (factor: number) => {
      engine.zoomAt(engine.vp.w / 2, engine.vp.h / 2, factor)
      kick()
    },
    [engine, kick],
  )

  /** Minimap: put a point of the focus board at the centre of the screen. */
  const centerOn = useCallback(
    (lx: number, ly: number, glide: boolean) => {
      const board = layRef.current.focus
      const c = space.toFrame(engine.display, board)
      const cam = { b: board, s: c.s, x: engine.vp.w / 2 - lx * c.s, y: engine.vp.h / 2 - ly * c.s }
      if (glide) engine.flyTo(cam, performance.now())
      else engine.jumpTo(cam)
      kick()
    },
    [engine, kick, space],
  )

  // ---------- adding things ----------
  /** Local point in `board` under a screen point (floor level). */
  const localAt = useCallback(
    (board: string, sx: number, sy: number) => {
      const c = space.toFrame(engine.display, board)
      return { x: (sx - c.x) / c.s, y: (sy - c.y) / c.s }
    },
    [engine, space],
  )

  const placeNew = useCallback(
    (nodes: SceneNode[], board: string) => {
      for (const n of nodes) {
        space.addNode(n)
        clampIntoBoard(n)
        morph(n.id, { from: 1.35, fx: 0.5, fy: 0.5, spawn: true })
      }
      if (nodes.length === 1) setSelected(nodes[0].id)
      const title = space.node(board)?.content.title ?? "the board"
      setAnnouncement(`Added ${nodes.length === 1 ? nodes[0].content.title : `${nodes.length} items`} to ${title}`)
      kick()
    },
    [clampIntoBoard, kick, morph, space],
  )

  const addFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      if (!files.length) return
      const sx = at?.x ?? engine.vp.w / 2
      const sy = at?.y ?? engine.vp.h / 2
      const board = at ? boardAt(sx, sy, null) : lay.focus
      const anchor = localAt(board, sx, sy)
      const cols = Math.ceil(Math.sqrt(files.length))
      const rows = Math.ceil(files.length / cols)
      const cellW = 250, cellH = 330
      const nodes = await Promise.all(
        files.map(async (file, i): Promise<SceneNode> => {
          const src = URL.createObjectURL(file)
          const col = i % cols, row = Math.floor(i / cols)
          const ox = (col - (cols - 1) / 2) * cellW, oy = (row - (rows - 1) / 2) * cellH
          const name = file.name.replace(/\.[^.]+$/, "") || file.name
          if (file.type.startsWith("image/")) {
            const ratio = await imageRatio(src)
            const w = 220, h = Math.round(16 + 204 * ratio + 36)
            return { id: newId("img"), type: "image", parentId: board, x: anchor.x + ox - w / 2, y: anchor.y + oy - h / 2, z: 16 + Math.round(Math.random() * 26), w, h, content: { title: name, src, alt: `Added image: ${file.name}` } }
          }
          const w = 200, h = 240
          return { id: newId("file"), type: "file", parentId: board, x: anchor.x + ox - w / 2, y: anchor.y + oy - h / 2, z: 12 + Math.round(Math.random() * 18), w, h, content: { title: file.name, src, mime: file.type, size: file.size } }
        }),
      )
      placeNew(nodes, board)
    },
    [boardAt, engine, lay.focus, localAt, placeNew],
  )

  const createNode = useCallback(
    (kind: CreateKind, title: string, body: string) => {
      setCreating(null)
      const board = lay.focus
      // Near the centre, nudged so repeated additions don't land exactly on top of each other.
      const c = localAt(board, engine.vp.w / 2 + (Math.random() - 0.5) * 120, engine.vp.h / 2 + (Math.random() - 0.5) * 90)
      const node: SceneNode =
        kind === "note"
          ? { id: newId("note"), type: "note", parentId: board, x: c.x - 110, y: c.y - 95, z: 80 + Math.round(Math.random() * 30), w: 220, h: 190, content: { title, body } }
          : { id: newId("board"), type: "board", parentId: board, x: c.x - 180, y: c.y - 165, z: 0, w: 360, h: 330, content: { title, description: body || null } }
      placeNew([node], board)
    },
    [engine, lay.focus, localAt, placeNew],
  )

  const deleteNode = useCallback(
    (id: string) => {
      const n = space.node(id)
      if (!n || !n.parentId) return
      const pos = new Map(positions.current)
      const removed = space.removeNode(id)
      undo.current.push({ nodes: removed, pos })
      if (undo.current.length > 20) undo.current.shift()
      setSelected(null)
      setAnnouncement(`Removed ${n.content.title}. Press ⌘Z to undo.`)
      kick()
    },
    [kick, space],
  )

  const undoDelete = useCallback(() => {
    const last = undo.current.pop()
    if (!last) return
    for (const n of last.nodes) {
      space.addNode(n)
      const p = last.pos.get(n.id)
      if (p) space.setPos(n.id, p.x, p.y)
    }
    setSelected(last.nodes[0]?.id ?? null)
    setAnnouncement(`Restored ${last.nodes[0]?.content.title ?? "item"}`)
    kick()
  }, [kick, space])

  // ---------- wheel: scrolling moves you through the space ----------
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const gain = e.ctrlKey || e.metaKey ? ZOOM.pinch : ZOOM.wheel
      const dy = Math.max(-240, Math.min(240, e.deltaY * unit))
      const r = el.getBoundingClientRect()
      engine.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * gain))
      kick()
    }
    const stopGesture = (e: Event) => e.preventDefault()
    el.addEventListener("wheel", onWheel, { passive: false })
    document.addEventListener("gesturestart", stopGesture)
    document.addEventListener("gesturechange", stopGesture)
    return () => {
      el.removeEventListener("wheel", onWheel)
      document.removeEventListener("gesturestart", stopGesture)
      document.removeEventListener("gesturechange", stopGesture)
    }
  }, [engine, kick])

  // ---------- paste images or text ----------
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        void addFiles(files)
        return
      }
      const text = e.clipboardData?.getData("text/plain")?.trim()
      if (text) {
        e.preventDefault()
        const [first, ...rest] = text.split(/\n+/)
        createNode("note", first.slice(0, 48), (rest.join(" ") || (first.length > 48 ? first : "")).slice(0, 280))
      }
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [addFiles, createNode])

  // ---------- pointer: pan the floor, or press / drag a card (across levels) ----------
  const placedById = useMemo(() => new Map(lay.items.map((p) => [p.node.id, p])), [lay.items])
  const local = (e: { clientX: number; clientY: number }) => {
    const r = viewportRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-item]")
    const placed = el ? placedById.get(el.dataset.item!) : undefined
    // A board is a place: press its floor to pan, grab its title strip (or a small board) to move it.
    const grab =
      placed && e.button === 0 && (placed.node.type !== "board" || (e.target as HTMLElement).closest("[data-board-handle]") || placed.node.w * placed.scale < 260)
        ? placed
        : undefined
    e.currentTarget.setPointerCapture(e.pointerId)
    engine.stop()
    const pt = local(e)
    const p0 = grab ? space.at(grab.node) : { x: 0, y: 0 }
    const next: Press = {
      pointer: e.pointerId,
      id: grab ? grab.node.id : null,
      sx: e.clientX,
      sy: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      fx: grab ? (pt.x - grab.x) / (grab.node.w * grab.scale) : 0,
      fy: grab ? (pt.y - grab.y) / (grab.node.h * grab.scale) : 0,
      parent: grab ? grab.node.parentId : null,
      nx: p0.x,
      ny: p0.y,
      moved: false,
    }
    pressRef.current = next
    setPress(next)
    if (!grab) setSelected(null)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pt = local(e)
    engine.setPointer({ x: (pt.x / vp.w - 0.5) * 2, y: (pt.y / vp.h - 0.5) * 2 })
    const p = pressRef.current
    if (!p || p.pointer !== e.pointerId) {
      if (e.pointerType === "mouse") {
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-item]")
        setHovered(el?.dataset.item ?? null)
      }
      kick()
      return
    }
    if (p.id === null) {
      engine.panBy(e.clientX - p.lx, e.clientY - p.ly)
      p.lx = e.clientX
      p.ly = e.clientY
      if (!p.moved) {
        p.moved = true
        setPress({ ...p })
      }
      kick()
      return
    }
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < MOTION.dragThreshold) return
    if (!p.moved) {
      p.moved = true
      setPress({ ...p })
      setSelected(p.id)
    }
    let n = space.node(p.id)!
    // Whichever board is under the pointer adopts the card — at that level's size.
    const target = boardAt(pt.x, pt.y, p.id)
    const scaleIn = (board: string) => {
      const c = space.toFrame(engine.display, board)
      return c.s * lift(n.z ?? 0, c.s, engine.pointer, !reduced).g
    }
    if (target !== n.parentId) {
      const before = scaleIn(n.parentId!)
      const current = morphFor(n.id)?.extra ?? 1
      space.setParent(n.id, target)
      n = space.node(p.id)!
      morph(n.id, { from: (current * before) / scaleIn(target), fx: p.fx, fy: p.fy, spawn: false })
    }
    const c = space.toFrame(engine.display, target)
    const ss = scaleIn(target)
    const at = localFromScreen(c, vp, n.z ?? 0, pt.x - p.fx * n.w * ss, pt.y - p.fy * n.h * ss, engine.pointer, !reduced)
    space.setPos(n.id, at.x, at.y)
    const highlight = placedById.has(target) && target !== layRef.current.floorBoard ? target : null
    if (highlight !== dropTarget) setDropTarget(highlight)
    kick()
  }

  const endPress = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const p = pressRef.current
    if (!p || p.pointer !== e.pointerId) return
    pressRef.current = null
    setPress(null)
    setDropTarget(null)
    if (p.id) {
      const n = space.node(p.id)
      if (n && p.moved && !cancelled) {
        clampIntoBoard(n)
        if (n.parentId !== p.parent) setAnnouncement(`Moved ${n.content.title} into ${space.node(n.parentId!)?.content.title}`)
      } else if (n && p.moved) {
        if (p.parent && n.parentId !== p.parent) space.setParent(n.id, p.parent)
        space.setPos(n.id, p.nx, p.ny)
      } else setSelected(p.id)
    }
    kick()
  }

  // ---------- files dragged in from the desktop ----------
  const isFileDrag = (e: ReactDragEvent) => Array.from(e.dataTransfer.types).includes("Files")
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    const pt = local(e)
    const board = boardAt(pt.x, pt.y, null)
    if (board !== fileDrag) setFileDrag(board)
  }
  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!viewportRef.current?.contains(e.relatedTarget as Node | null)) setFileDrag(null)
  }
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    setFileDrag(null)
    void addFiles(Array.from(e.dataTransfer.files), local(e))
  }

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if (creating || e.defaultPrevented || t?.closest("[role=menu], [role=dialog]")) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        undoDelete()
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        goUp()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.key === "Delete" || e.key === "Backspace") && selected) deleteNode(selected)
      else if (e.key === "n" || e.key === "N") setCreating("note")
      else if (e.key === "b" || e.key === "B") setCreating("board")
      else if (e.key === "+" || e.key === "=") zoomCentre(ZOOM.step)
      else if (e.key === "-" || e.key === "_") zoomCentre(1 / ZOOM.step)
      else if (e.key === "0") flyToBoard(lay.focus)
      else if (t?.closest("button, nav")) return
      else if (e.key === "ArrowLeft") engine.panBy(ZOOM.keyPan, 0)
      else if (e.key === "ArrowRight") engine.panBy(-ZOOM.keyPan, 0)
      else if (e.key === "ArrowUp") engine.panBy(0, ZOOM.keyPan)
      else if (e.key === "ArrowDown") engine.panBy(0, -ZOOM.keyPan)
      else return
      e.preventDefault()
      kick()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [creating, deleteNode, engine, flyToBoard, goUp, kick, lay.focus, selected, undoDelete, zoomCentre])

  const onItemKey = (e: ReactKeyboardEvent<HTMLDivElement>, n: SceneNode) => {
    if (e.target !== e.currentTarget) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setSelected(n.id)
      flyToNode(n)
    }
  }

  const pickScenery = (id: SceneryId) => {
    setScenery(id)
    try {
      localStorage.setItem(SCENERY_KEY, id)
    } catch {
      /* private mode: just don't remember */
    }
  }

  const tactileFor = (id: string): Tactile => {
    if (press?.id === id) return press.moved ? "drag" : "press"
    return hovered === id && !press ? "hover" : "rest"
  }

  const ordered = [...lay.items].sort((a, b) => a.order - b.order)
  const focusTitle = space.node(lay.focus)?.content.title ?? "the board"
  const travel = engine.travel

  return (
    <div className="absolute inset-0">
      <div
        ref={viewportRef}
        className={`zb-viewport zb-space${press && press.id === null && press.moved ? " is-panning" : ""}`}
        style={viewportStyle}
        tabIndex={-1}
        role="region"
        aria-roledescription="zoomable space"
        aria-label={`${focusTitle}. Scroll to move closer or further; drag to pan; drop files to add them.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPress(e)}
        onPointerCancel={(e) => endPress(e, true)}
        onPointerLeave={() => {
          engine.setPointer({ x: 0, y: 0 })
          setHovered(null)
          kick()
        }}
        onDoubleClick={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-item]")
          const placed = el ? placedById.get(el.dataset.item!) : undefined
          if (!placed) return
          const span = Math.min((placed.node.w * placed.scale) / vp.w, (placed.node.h * placed.scale) / vp.h)
          if (!(placed.node.type === "board" && span >= SPACE.focusSpan)) flyToNode(placed.node)
        }}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Scenery theme={theme} z={travel.zoom * SCENERY.layersPerEFold + 2} panX={-travel.x} panY={-travel.y} pointer={engine.pointer} vp={vp} parallax={!reduced} />
        <div className="zb-floor" aria-hidden />
        <div className="zb-dots" style={dotsStyle} aria-hidden />
        {roomStyle && <div className="zb-inner-floor zb-room" style={roomStyle} aria-hidden />}
        <div className="zb-vignette" aria-hidden />
        {ordered.map((p) => (
          <Item
            key={p.node.id}
            placed={p}
            space={space}
            tactile={tactileFor(p.node.id)}
            selected={selected === p.node.id}
            reduced={reduced}
            dragging={press?.id === p.node.id && press.moved}
            dropTarget={dropTarget === p.node.id || fileDrag === p.node.id}
            morph={morphFor(p.node.id)}
            onKeyDown={onItemKey}
            onFocusItem={(id) => setSelected(id)}
          />
        ))}
        {fileDrag && (
          <div className="zb-dropzone" aria-hidden>
            <span className="zb-drop-pill zb-cobalt" style={{ background: "var(--cobalt)" }}>
              Drop to add to {space.node(fileDrag)?.content.title}
            </span>
          </div>
        )}
      </div>

      <DraggablePanel id="nav" label="the path" defaultPos={{ corner: "tl", dx: 16, dy: 16 }}>
        <Breadcrumbs path={path.map((b) => ({ id: b.id, title: b.content.title }))} onNavigate={(c) => flyToBoard(c.id)} onBack={path.length > 1 ? goUp : undefined} />
      </DraggablePanel>
      <div className="zb-chrome-tr">
        <SceneryPicker value={scenery} onChange={pickScenery} />
        <AddMenu onFiles={(f) => void addFiles(f)} onNewNote={() => setCreating("note")} onNewBoard={() => setCreating("board")} />
      </div>
      <DraggablePanel id="zoom" label="the zoom controls" defaultPos={{ corner: "br", dx: 16, dy: 16 }}>
        <div className="zb-panel-stack">
          <LevelBadge depth={focusDepth} />
          <ZoomControls readout={readout} onZoomIn={() => zoomCentre(ZOOM.step)} onZoomOut={() => zoomCentre(1 / ZOOM.step)} onFit={() => flyToBoard(lay.focus)} />
        </div>
      </DraggablePanel>
      <DraggablePanel id="minimap" label="the map" defaultPos={{ corner: "bl", dx: 16, dy: 16 }}>
        <Minimap space={space} focus={lay.focus} cam={engine.display} vp={vp} onCenter={centerOn} />
      </DraggablePanel>
      <CreateDialog kind={creating} where={focusTitle} onClose={() => setCreating(null)} onCreate={createNode} />
      <div className="sr-only-zb" aria-live="polite">
        {announcement || `Now in ${focusTitle}`}
      </div>
    </div>
  )
}

function imageRatio(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(Math.min(1.8, Math.max(0.5, img.naturalHeight / Math.max(1, img.naturalWidth))))
    img.onerror = () => resolve(1.25)
    img.src = src
  })
}

function formatZoom(g: number): string {
  if (g < 10) return `${Math.round(g * 100)}%`
  if (g < 1000) return `${g.toFixed(g < 100 ? 1 : 0)}×`
  return `${Math.round(g).toLocaleString()}×`
}

type ItemProps = {
  placed: Placed
  space: Space
  tactile: Tactile
  selected: boolean
  reduced: boolean
  dragging: boolean
  dropTarget: boolean
  morph: { extra: number; fade: number; fx: number; fy: number } | null
  onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, n: SceneNode): void
  onFocusItem(id: string): void
}

function Item({ placed, space, tactile, selected, reduced, dragging, dropTarget, morph, onKeyDown, onFocusItem }: ItemProps) {
  const { node: n, order, reveal, lod } = placed
  let { x, y, scale, opacity } = placed
  if (morph) {
    // Scale about the grab point, so the card stays under the pointer while it resizes.
    x += morph.fx * n.w * scale * (1 - morph.extra)
    y += morph.fy * n.h * scale * (1 - morph.extra)
    scale *= morph.extra
    opacity *= morph.fade
  }
  const style: CSSProperties = {
    width: n.w,
    height: n.h,
    transform: `translate(${x}px, ${y}px) scale(${scale})`,
    opacity,
    zIndex: dragging ? 50_000 : order,
    ["--zh" as string]: n.z ?? 0,
    ["--s" as string]: scale,
    pointerEvents: opacity < 0.2 || dragging ? "none" : undefined,
    willChange: dragging ? "transform" : undefined,
  }
  return (
    <div
      className={`zb-node${dragging ? " is-dragging" : ""}${n.type === "board" && reveal > 0.3 ? " is-open" : ""}`}
      data-item={n.id}
      style={style}
      tabIndex={0}
      role="group"
      aria-roledescription={n.type}
      aria-label={label(n)}
      onKeyDown={(e) => onKeyDown(e, n)}
      onFocus={(e) => e.target === e.currentTarget && onFocusItem(n.id)}
    >
      {n.type !== "board" && n.w * scale < 1600 && <div className="zb-hshadow" aria-hidden />}
      {renderCard(n, placed, space, tactile, selected, reduced, lod, dropTarget)}
    </div>
  )
}

function renderCard(n: SceneNode, placed: Placed, space: Space, tactile: Tactile, selected: boolean, reduced: boolean, lod: Placed["lod"], dropTarget: boolean) {
  if (n.type === "image") return <ImageCard title={n.content.title} alt={n.content.alt} src={n.content.src} lod={lod} selected={selected} tactile={tactile} reduced={reduced} />
  if (n.type === "note") return <NoteCard title={n.content.title} body={n.content.body} lod={lod} selected={selected} tactile={tactile} reduced={reduced} />
  if (n.type === "file") return <FileCard title={n.content.title} src={n.content.src} mime={n.content.mime} size={n.content.size} lod={lod} selected={selected} tactile={tactile} reduced={reduced} />
  const io = space.innerOrigin(n.id)
  return (
    <BoardCard
      title={n.content.title}
      count={space.index.children.get(n.id)?.length ?? 0}
      lod={lod}
      selected={selected}
      tactile={tactile}
      reduced={reduced}
      innerFloor={floorFor(placed.level + 1)}
      innerDot={{ pitch: 24 * io.k, ox: io.ox, oy: io.oy }}
      dropTarget={dropTarget}
    />
  )
}

function label(n: SceneNode): string {
  if (n.type === "board") return `Board: ${n.content.title}. Zoom in to step inside, or press Enter.`
  if (n.type === "image") return `Image: ${n.content.title}. ${n.content.alt}`
  if (n.type === "file") return `File: ${n.content.title}`
  return `Note: ${n.content.title}. ${n.content.body}`
}
