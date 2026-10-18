/* oxlint-disable react/refs, react/purity -- the camera engine, scene store and live layout are an
   external, mutable store advanced by requestAnimationFrame; each frame re-renders and reads
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
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { Eye, EyeOff } from "lucide-react"
import { BoardCard, type BoardField } from "@/components/zoomboard/BoardCard"
import { Breadcrumbs } from "@/components/zoomboard/Breadcrumbs"
import { DraggablePanel } from "@/components/zoomboard/DraggablePanel"
import { FileCard } from "@/components/zoomboard/FileCard"
import { ImageCard } from "@/components/zoomboard/ImageCard"
import { LevelBadge } from "@/components/zoomboard/LevelBadge"
import { LinkCard } from "@/components/zoomboard/LinkCard"
import { Minimap } from "@/components/zoomboard/Minimap"
import { NoteCard, type NoteField } from "@/components/zoomboard/NoteCard"
import type { Tactile } from "@/components/zoomboard/TactileSlab"
import { Toolbar, type ToolKind } from "@/components/zoomboard/Toolbar"
import { ZoomControls } from "@/components/zoomboard/ZoomControls"
import { CameraEngine } from "@/lib/cameraEngine"
import { copyNodes, lastClip, parseClip, pasteOps } from "@/lib/clipboard"
import { MOTION, SPACE, ZOOM, cardBoxFactor, floorFor, perspectiveFor } from "@/lib/constants"
import { IMPORT_GRID, IMPORT_LIMITS, countFiles, fileCard, planFolder, readDrop, type BoardPlan, type FolderTree } from "@/lib/folderImport"
import { api, apiUrl } from "@/lib/http"
import { DEFAULT_ARROW, DEFAULT_BEND, arrowEnds, bendThrough, curveMid, arrowPatch, attachable, distToArrow, isArrow, styleOf, type Box, type Pt } from "@/lib/arrows"
import { getLabels, saveLabels, type Labels } from "@/lib/labels"
import { pathTo, titleOf } from "@/lib/scene"
import { SCENERY, themeById, type SceneryId } from "@/lib/scenery"
import { layout, lift, localFromScreen, sortByLayer, type Cam, type Layout, type Placed, type Space, type Viewport } from "@/lib/space"
import { layerOps, topRank, type LayerMove } from "@/lib/layers"
import { IMAGE_MAT, imageCard, imageCardHeight, newId, type Op, type SceneStore } from "@/lib/store"
import type { ArrowNode, ArrowStyle, SceneNode } from "@/lib/types"
import { ArrowStyleControls } from "@/components/zoomboard/ArrowStyle"
import { ArrowItem } from "./ArrowItem"
import { ContextMenu, type ContextAction } from "./ContextMenu"
import { Lightbox } from "./Lightbox"
import { EditOverlay, Marquee, RemoteCursors, editFields, type EditTarget } from "./Overlays"
import { Scenery } from "./Scenery"

export type CanvasController = {
  flyToNode(id: string): void
  flyToBoard(id: string): void
  /** The board you're standing in right now. */
  currentBoard(): string
}

type Props = {
  store: SceneStore
  scenery: SceneryId
  /** connId of the person whose view you're following, if any. */
  follow?: string | null
  onStopFollow?(): void
  onToast?(message: string): void
  controller?: MutableRefObject<CanvasController | null>
}

type Grab = { id: string; parent: string; x: number; y: number; sx: number; sy: number; ss: number }
type Press =
  | { kind: "pan"; pointer: number; lx: number; ly: number; moved: boolean }
  | { kind: "marquee"; pointer: number; sx: number; sy: number; x: number; y: number }
  | { kind: "items"; pointer: number; sx: number; sy: number; primary: string; fx: number; fy: number; grabs: Grab[]; moved: boolean; additive: boolean; edit: string | null }
  | { kind: "arrowEnd"; pointer: number; id: string; end: 1 | 2; at: Pt; snap: string | null; moved: boolean }
  | { kind: "arrowBend"; pointer: number; id: string; bend: number; moved: boolean }
  | { kind: "resize"; pointer: number; sx: number; sy: number; id: string; w: number; h: number; scale: number; keepAspect: boolean; orig: SceneNode }

/** Text being edited in place on a card. */
type Inline = { id: string; field: NoteField | BoardField }

/** A short scale/fade animation on one item: re-parenting (adopt the new level's size) or spawning. */
type Morph = { from: number; start: number; dur: number; fx: number; fy: number; spawn: boolean }

const easeOutBack = (t: number) => {
  const c = 1.4
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
const capture = (el: Element, id: number) => {
  try {
    el.setPointerCapture(id)
  } catch {
    /* the pointer already went away */
  }
}
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s)
const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
}

export function SpaceCanvas({ store, scenery, follow = null, onStopFollow, onToast, controller }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion() ?? false
  const space = store.space
  const toast = useCallback((m: string) => onToast?.(m), [onToast])
  const [labels, setLabels] = useState<Labels>(getLabels)
  const toggleLabels = useCallback((which: keyof Labels) => {
    setLabels((l) => {
      const next = { ...l, [which]: !l[which] }
      saveLabels(next)
      return next
    })
  }, [])
  const [mapHidden, setMapHidden] = useState(() => {
    try {
      return localStorage.getItem("zoomz.minimap") === "hidden"
    } catch {
      return false
    }
  })
  const toggleMap = useCallback(() => {
    setMapHidden((h) => {
      try {
        if (h) localStorage.removeItem("zoomz.minimap")
        else localStorage.setItem("zoomz.minimap", "hidden")
      } catch {
        /* private mode */
      }
      return !h
    })
  }, [])

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
  const [selection, setSelection] = useState<string[]>([])
  const [press, setPress] = useState<Press | null>(null)
  const pressRef = useRef<Press | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [fileDrag, setFileDrag] = useState<string | null>(null)
  /** Image, file and link titles: edited in a small panel over the card. */
  const [editing, setEditing] = useState<string | null>(null)
  /** Notes and board labels: edited right on the card. */
  const [inline, setInline] = useState<Inline | null>(null)
  /** Right-click menu: where, and for which card. */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** The card held up close in the lightbox (hidden on the board meanwhile). */
  const [held, setHeld] = useState<string | null>(null)
  /** The card a double-click last zoomed to; a second double-click on it picks it up. */
  const zoomedTo = useRef<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const morphs = useRef(new Map<string, Morph>())
  const animUntil = useRef(0)
  const pointerAt = useRef<{ x: number; y: number } | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; mx: number; my: number } | null>(null)

  const select = useCallback((ids: string[]) => setSelection(ids), [])
  const selected = useMemo(() => new Set(selection), [selection])

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
    const off = store.subscribe(kick)
    return () => {
      off()
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [kick, store])

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
  const placedById = useMemo(() => new Map(lay.items.map((p) => [p.node.id, p])), [lay.items])

  // The ground under everything, drawn in screen space. The top board is open sky (scenery) or
  // the studio floor; then one frosted floor for every board you are inside, outermost first.
  // Drawing the whole stack keeps the picture identical on both sides of a camera re-anchor:
  // a board's card face and its full-screen floor layer are the same tint at the same alpha.
  const viewportStyle: CSSProperties = {
    ["--face-alpha" as string]: hasScenery ? SPACE.faceAlpha : 1,
  }
  const rootCam = space.toFrame(engine.display, space.rootId)
  const rootPitch = 24 * rootCam.s
  const groundStyle: CSSProperties | null = hasScenery
    ? null
    : {
        ["--floor-c" as string]: floorFor(0),
        ["--dot" as string]: `${rootPitch}px`,
        ["--dot-o" as string]: Math.min(1, Math.max(0, (rootPitch - 6) / 8)),
        backgroundPosition: `${rootCam.x}px ${rootCam.y}px`,
      }
  const inside = lay.room ? pathTo(space.index, lay.room.board).slice(1) : []
  // Three frosted floors are already ~99.6% opaque; deeper ones can't be seen, so skip them.
  const floors = inside.slice(-SPACE.maxFloorLayers).map((b) => {
    const c = space.toFrame(engine.display, b.id)
    return {
      id: b.id,
      style: {
        ["--floor-c" as string]: floorFor(space.depthOf(b.id)),
        ["--dot" as string]: `${24 * c.s}px`,
        backgroundPosition: `${c.x}px ${c.y}px`,
      } as CSSProperties,
    }
  })

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

  // ---------- hit testing ----------
  /** Deepest visible board under a screen point that you may edit (excluding boards being moved). */
  const boardAt = useCallback(
    (px: number, py: number, exclude: string[] = [], editableOnly = false): string => {
      let best: Placed | null = null
      for (const p of layRef.current.items) {
        if (p.node.type !== "board" || p.reveal < 0.5) continue
        if (exclude.some((x) => p.node.id === x || space.isAncestor(x, p.node.id))) continue
        if (editableOnly && !store.canEdit(p.node.id)) continue
        const w = p.node.w * p.scale, h = p.node.h * p.scale
        if (px < p.x || py < p.y || px > p.x + w || py > p.y + h) continue
        if (!best || p.level > best.level) best = p
      }
      if (best) return best.node.id
      const room = layRef.current.room?.board
      return room && !exclude.includes(room) ? room : layRef.current.floorBoard
    },
    [space, store],
  )

  /** Topmost visible card under a screen point, by paint order (independent of pointer capture). */
  const itemAt = useCallback((px: number, py: number, exclude?: string): Placed | undefined => {
    let best: Placed | undefined
    for (const p of layRef.current.items) {
      if (p.opacity < 0.2 || p.node.id === exclude) continue
      if (isArrow(p.node)) {
        const [a, b] = arrowScreenEnds(p)
        if (distToArrow({ x: px, y: py }, a, b, styleOf(p.node).shape, p.node.content.bend ?? undefined) > 8) continue
      } else if (px < p.x || py < p.y || px > p.x + p.node.w * p.scale || py > p.y + p.node.h * p.scale) continue
      if (!best || p.order > best.order) best = p
    }
    return best
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Where an arrow's ends are on screen right now: attached ends follow their items, wherever
   *  those are drawn (raised cards included); `override` is an end being dragged. */
  function arrowScreenEnds(p: Placed, override?: { end: 1 | 2; at: Pt; snap: string | null }): [Pt, Pt] {
    const n = p.node as ArrowNode
    const s = p.scale
    const at = space.at(n)
    const c = n.content
    const scaled = { ...n, content: { ...c, x1: c.x1 * s, y1: c.y1 * s, x2: c.x2 * s, y2: c.y2 * s } }
    const boxOf = (id: string): Box | null => {
      const t = space.node(id)
      if (!attachable(n, t)) return null
      const tp = layRef.current.items.find((it) => it.node.id === id)
      if (tp) return { x: tp.x, y: tp.y, w: t!.w * tp.scale, h: t!.h * tp.scale }
      const ta = space.at(t!)
      return { x: p.x + (ta.x - at.x) * s, y: p.y + (ta.y - at.y) * s, w: t!.w * s, h: t!.h * s }
    }
    return arrowEnds(scaled, { x: p.x, y: p.y }, boxOf, override)
  }

  const localAt = useCallback(
    (board: string, sx: number, sy: number) => {
      const c = space.toFrame(engine.display, board)
      return { x: (sx - c.x) / c.s, y: (sy - c.y) / c.s }
    },
    [engine, space],
  )

  /** Keep a position inside a board's content window (the top board is unbounded). */
  const clampInto = useCallback(
    (board: string, n: { w: number; h: number }, x: number, y: number) => {
      if (board === space.rootId) return { x, y }
      const b = space.boundsOf(board)
      const fit = (v: number, lo: number, span: number, size: number) => (span < size ? lo + (span - size) / 2 : Math.min(Math.max(v, lo), lo + span - size))
      return { x: fit(x, b.x, b.w, n.w), y: fit(y, b.y, b.h, n.h) }
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

  const fitBoard = useCallback(
    (id: string) => {
      engine.flyTo(space.fitContent(id, engine.vp), performance.now())
      kick()
    },
    [engine, kick, space],
  )

  const flyToNode = useCallback(
    (n: SceneNode) => {
      if (n.type === "board") return flyToBoard(n.id)
      const p = space.at(n)
      // On-screen scale we want, then the camera scale that gives it once the card's height
      // boost is applied (g = 1 / (1 − z·s/eye) ⇒ s = T / (1 + z·T/eye)), so raised cards
      // land exactly centred and at the intended size.
      const T = Math.min((engine.vp.w * 0.62) / n.w, (engine.vp.h * 0.62) / n.h)
      const s = T / (1 + ((n.z ?? 0) * T) / SPACE.eye)
      engine.flyTo({ b: n.parentId!, s, x: engine.vp.w / 2 - (p.x + n.w / 2) * s, y: engine.vp.h / 2 - (p.y + n.h / 2) * s }, performance.now())
      kick()
    },
    [engine, flyToBoard, kick, space],
  )

  useEffect(() => {
    if (!controller) return
    controller.current = {
      flyToNode: (id) => {
        const n = space.node(id)
        if (n) {
          flyToNode(n)
          setSelection([id])
        }
      },
      flyToBoard,
      currentBoard: () => focusRef.current,
    }
  }, [controller, flyToBoard, flyToNode, space])

  const focusRef = useRef(lay.focus)
  focusRef.current = lay.focus

  const goUp = useCallback(() => {
    const parent = space.parentOf(lay.focus)
    if (parent) flyToBoard(parent)
  }, [flyToBoard, lay.focus, space])

  const zoomCentre = useCallback(
    (factor: number) => {
      onStopFollow?.()
      zoomedTo.current = null
      engine.zoomAt(engine.vp.w / 2, engine.vp.h / 2, factor)
      kick()
    },
    [engine, kick, onStopFollow],
  )

  const centerOn = useCallback(
    (lx: number, ly: number, glide: boolean) => {
      onStopFollow?.()
      zoomedTo.current = null
      const board = layRef.current.focus
      const c = space.toFrame(engine.display, board)
      const cam = { b: board, s: c.s, x: engine.vp.w / 2 - lx * c.s, y: engine.vp.h / 2 - ly * c.s }
      if (glide) engine.flyTo(cam, performance.now())
      else engine.jumpTo(cam)
      kick()
    },
    [engine, kick, onStopFollow, space],
  )

  // ---------- following someone ----------
  const followed = follow ? store.peers.get(follow) : undefined
  const followKey = followed?.view ? JSON.stringify(followed.view) : ""
  useEffect(() => {
    const v = followed?.view
    if (!v || !space.node(v.b)) return
    const s = Math.min(engine.vp.w / v.w, engine.vp.h / v.h)
    engine.glideTo({ b: v.b, s, x: engine.vp.w / 2 - (v.x + v.w / 2) * s, y: engine.vp.h / 2 - (v.y + v.h / 2) * s })
    kick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey])

  // ---------- telling others where I am ----------
  const focusCam = space.toFrame(engine.display, lay.focus)
  const viewRect = { b: lay.focus, x: -focusCam.x / focusCam.s, y: -focusCam.y / focusCam.s, w: vp.w / focusCam.s, h: vp.h / focusCam.s }
  const presenceKey = `${lay.focus}|${viewRect.x.toFixed(1)}|${viewRect.y.toFixed(1)}|${viewRect.w.toFixed(1)}`
  useEffect(() => {
    const pt = pointerAt.current
    let cursor = null
    if (pt) {
      const b = boardAt(pt.x, pt.y)
      cursor = { b, ...localAt(b, pt.x, pt.y) }
    }
    store.setPresence({ focus: lay.focus, view: viewRect, cursor, path: path.map((p) => p.id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceKey])

  // ---------- pictures keep their true shape ----------
  // Cards made before the shape was exact (or sized before the file could be read) are
  // corrected the first time their picture loads, for everyone, by whoever can edit them.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onLoad = (e: Event) => {
      const img = e.target
      if (!(img instanceof HTMLImageElement) || !img.classList.contains("zb-ph") || !img.naturalWidth) return
      const id = img.closest("[data-item]")?.getAttribute("data-item")
      const n = id ? space.node(id) : undefined
      if (!n || n.type !== "image" || (n.content as { status?: string }).status === "uploading") return
      if (store.readOnly || !store.canEdit(n.parentId!)) return
      const h = imageCardHeight(n.w, img.naturalHeight / img.naturalWidth)
      if (Math.abs(h - n.h) > 2) store.commit({ type: "update", id: n.id, patch: { h } }, "fit picture", { undoable: false })
    }
    el.addEventListener("load", onLoad, true)
    return () => el.removeEventListener("load", onLoad, true)
  }, [space, store])

  // ---------- adding things ----------
  const spawn = useCallback(
    (ids: string[]) => {
      for (const id of ids) morph(id, { from: 1.35, fx: 0.5, fy: 0.5, spawn: true })
      if (ids.length) setSelection(ids)
    },
    [morph],
  )

  const addFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      if (!files.length) return
      const sx = at?.x ?? engine.vp.w / 2
      const sy = at?.y ?? engine.vp.h / 2
      const board = at ? boardAt(sx, sy, [], true) : lay.focus
      if (!store.canEdit(board)) return toast("You can only view this board.")
      const anchor = localAt(board, sx, sy)
      const top = topRank(space, board)
      const cols = Math.ceil(Math.sqrt(files.length))
      const rows = Math.ceil(files.length / cols)
      const cellW = 250, cellH = 330
      const ids = await store.addFiles(files, board, (i, file, ratio) => {
        const col = i % cols, row = Math.floor(i / cols)
        const ox = (col - (cols - 1) / 2) * cellW, oy = (row - (rows - 1) / 2) * cellH
        const isImage = file.type.startsWith("image/")
        const { w, h } = isImage ? imageCard(ratio) : { w: 200, h: 240 }
        const p = clampInto(board, { w, h }, anchor.x + ox - w / 2, anchor.y + oy - h / 2)
        return { ...p, w, h, z: isImage ? 16 + Math.round(Math.random() * 26) : 12 + Math.round(Math.random() * 18), rank: top + i }
      })
      spawn(ids.filter((id) => space.node(id)))
      setAnnouncement(`Added ${files.length === 1 ? files[0].name : `${files.length} files`} to ${titleOf(space.node(board)!)}`)
    },
    [boardAt, clampInto, engine, lay.focus, localAt, space, spawn, store, toast],
  )

  const importFolders = useCallback(
    async (folders: FolderTree[], at: { x: number; y: number }) => {
      const target = boardAt(at.x, at.y, [], true)
      if (!store.canEdit(target)) return toast("You can only view this board.")
      const total = folders.reduce((n, f) => n + countFiles(f), 0)
      if (total >= IMPORT_LIMITS.files) toast(`Only the first ${IMPORT_LIMITS.files} files are imported.`)
      const anchor = localAt(target, at.x, at.y)
      const top = topRank(space, target)
      // Every board first, in one undoable edit, then each board's files.
      const ops: Op[] = []
      const uploads: { board: string; plan: BoardPlan }[] = []
      const roots: string[] = []
      const make = (plan: BoardPlan, parentId: string, x: number, y: number, rank: number) => {
        const id = newId("board")
        ops.push({ type: "create", node: { id, type: "board", parentId, x, y, z: 0, w: plan.w, h: plan.h, rank, content: { title: plan.name.slice(0, 200), description: null, frame: plan.frame } } })
        if (plan.files.length) uploads.push({ board: id, plan })
        plan.folders.forEach((f, i) => make(f.plan, id, f.x, f.y, i))
        return id
      }
      const plans = folders.map(planFolder)
      const span = plans.reduce((w, p) => w + p.w, 0) + (plans.length - 1) * IMPORT_GRID.gap
      let x = anchor.x - span / 2
      plans.forEach((plan, i) => {
        const p = clampInto(target, plan, x, anchor.y - plan.h / 2)
        roots.push(make(plan, target, p.x, p.y, top + i))
        x += plan.w + IMPORT_GRID.gap
      })
      // The server takes at most 500 edits at once.
      for (let i = 0; i < ops.length; i += 500) {
        const chunk = ops.slice(i, i + 500)
        if (!store.commit(chunk.length === 1 ? chunk[0] : { type: "batch", ops: chunk }, "import folder")) return
      }
      spawn(roots)
      setAnnouncement(`Importing ${folders.length === 1 ? folders[0].name : `${folders.length} folders`}: ${total} files`)
      for (const { board, plan } of uploads) {
        await store.addFiles(plan.files, board, (i, file, ratio) => {
          const { w, h } = fileCard(file, ratio)
          const cell = plan.fileCells[i]
          return { x: cell.x + (IMPORT_GRID.fileCellW - w) / 2, y: cell.y + (IMPORT_GRID.fileCellH - h) / 2, w, h, z: 12 + Math.round(Math.random() * 26), rank: i }
        })
      }
    },
    [boardAt, clampInto, localAt, space, spawn, store, toast],
  )

  const nearCentre = useCallback(
    (board: string, w: number, h: number) => {
      // Near the centre, nudged so repeated additions don't land exactly on top of each other.
      const c = localAt(board, engine.vp.w / 2 + (Math.random() - 0.5) * 120, engine.vp.h / 2 + (Math.random() - 0.5) * 90)
      return clampInto(board, { w, h }, c.x - w / 2, c.y - h / 2)
    },
    [clampInto, engine, localAt],
  )

  /** A pasted bit of text becomes a note in the middle of the view. */
  const createNote = useCallback(
    (title: string, body: string) => {
      const board = lay.focus
      if (!store.canEdit(board)) return toast("You can only view this board.")
      const node: SceneNode = { id: newId("note"), type: "note", parentId: board, ...nearCentre(board, 220, 190), z: 80 + Math.round(Math.random() * 30), w: 220, h: 190, rank: topRank(space, board), content: { title, body } }
      if (store.commit({ type: "create", node }, "add note")) spawn([node.id])
    },
    [lay.focus, nearCentre, space, spawn, store, toast],
  )

  /**
   * Put a new, blank item on the canvas: centred exactly where it was dropped (screen px, or the
   * middle of the view), on whichever board is there. Notes and boards open for typing at once.
   */
  const place = useCallback(
    (kind: ToolKind, client: { x: number; y: number } | null, arrowStyle?: ArrowStyle) => {
      const r = viewportRef.current?.getBoundingClientRect()
      const pt = client && r ? { x: client.x - r.left, y: client.y - r.top } : { x: engine.vp.w / 2, y: engine.vp.h / 2 }
      const board = boardAt(pt.x, pt.y, [], true)
      if (!store.canEdit(board)) return toast("You can only view this board.")
      const rank = topRank(space, board)
      const c = space.toFrame(engine.display, board)
      let node: SceneNode
      if (kind === "arrow") {
        // About 180px long on screen, pointing right. Dropped onto something: starts from it.
        const half = 90 / c.s
        const on = itemAt(pt.x, pt.y)
        const from = on && on.node.parentId === board && on.node.type !== "arrow" ? on.node : null
        const mid = localAt(board, pt.x, pt.y)
        const start = from ? { x: space.at(from).x + from.w, y: space.at(from).y + from.h / 2 } : { x: mid.x - half, y: mid.y }
        const g = arrowPatch(start, { x: start.x + half * 2, y: start.y })
        // The style picked in the toolbar (the A key uses the last one picked there too).
        const style = arrowStyle ?? lastArrowStyle()
        node = { id: newId("arrow"), type: "arrow", parentId: board, x: g.x, y: g.y, z: 0, w: g.w, h: g.h, rank, content: { ...g.content, from: from?.id ?? null, to: null, ...style } }
      } else if (kind === "note") {
        const w = 220, h = 190, z = 80 + Math.round(Math.random() * 30)
        const ss = screenScaleIn(board, z)
        const at = localFromScreen(c, vp, z, pt.x - (w * ss) / 2, pt.y - (h * ss) / 2, engine.pointer, !reduced)
        node = { id: newId("note"), type: "note", parentId: board, ...clampInto(board, { w, h }, at.x, at.y), z, w, h, rank, content: { title: "", body: "" } }
      } else {
        const w = 360, h = 330
        const at = localAt(board, pt.x, pt.y)
        node = { id: newId("board"), type: "board", parentId: board, ...clampInto(board, { w, h }, at.x - w / 2, at.y - h / 2), z: 0, w, h, rank, content: { title: "", description: null, frame: { x: 0, y: 0, w: 1300, h: 1100 } } }
      }
      if (!store.commit({ type: "create", node }, `add ${kind}`)) return
      spawn([node.id])
      if (kind === "note") setInline({ id: node.id, field: "body" })
      else if (kind === "board") setInline({ id: node.id, field: "title" })
      setAnnouncement(`Added ${kind === "arrow" ? "an arrow" : `a ${kind}`} to ${titleOf(space.node(board)!)}`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardAt, clampInto, engine, itemAt, localAt, reduced, space, spawn, store, toast, vp],
  )

  const addLink = useCallback(
    async (url: string) => {
      const board = lay.focus
      if (!store.canEdit(board)) return toast("You can only view this board.")
      const node: SceneNode = { id: newId("link"), type: "link", parentId: board, ...nearCentre(board, 240, 230), z: 22, w: 240, h: 230, rank: topRank(space, board), content: { url, title: url } }
      if (!store.commit({ type: "create", node }, "add link")) return
      spawn([node.id])
      if (store.local) return
      try {
        const meta = await api<Record<string, unknown>>(`/api/unfurl?url=${encodeURIComponent(url)}`)
        if (store.space.node(node.id)) {
          const { url: _u, ...content } = meta
          void _u
          store.commit({ type: "update", id: node.id, patch: { content } }, "link preview", { undoable: false })
        }
      } catch {
        /* the bare link still works */
      }
    },
    [lay.focus, nearCentre, space, spawn, store, toast],
  )

  const copySelection = useCallback(() => copyNodes(space, selection, store.spaceId), [selection, space, store])

  const paste = useCallback(
    async (clip = lastClip(), at?: { x: number; y: number }) => {
      if (!clip) return
      const pt = at ?? pointerAt.current ?? { x: engine.vp.w / 2, y: engine.vp.h / 2 }
      const board = boardAt(pt.x, pt.y, [], true)
      if (!store.canEdit(board)) return toast("You can only view this board.")
      const c = localAt(board, pt.x, pt.y)
      try {
        const { op, roots } = await pasteOps(clip, board, c.x, c.y, store.spaceId)
        const top = topRank(space, board)
        if (op.type === "batch")
          for (const o of op.ops) if (o.type === "create" && roots.includes(o.node.id)) o.node.rank = top + roots.indexOf(o.node.id)
        if (store.commit(op, "paste")) spawn(roots)
      } catch (e) {
        toast((e as Error).message)
      }
    },
    [boardAt, engine, localAt, space, spawn, store, toast],
  )

  const duplicate = useCallback(() => {
    const clip = copySelection()
    if (!clip) return
    const first = space.node(clip.roots[0])!
    const p = placedById.get(first.id)
    void paste(clip, p ? { x: p.x + (first.w * p.scale) / 2 + 28, y: p.y + (first.h * p.scale) / 2 + 28 } : undefined)
  }, [copySelection, paste, placedById, space])

  const undo = useCallback(
    (redo = false) => {
      const label = redo ? store.redo() : store.undo()
      if (label) setAnnouncement(`${redo ? "Redid" : "Undid"} ${label}`)
    },
    [store],
  )

  // ---------- editing titles, captions and notes in place ----------
  const editTarget: EditTarget | null = (() => {
    if (!editing) return null
    const n = space.node(editing)
    if (!n || n.type === "note" || n.type === "board" || n.type === "arrow") return null
    const p = placedById.get(editing)
    const rect = p ? { x: p.x, y: p.y, w: n.w * p.scale, h: n.h * p.scale } : { x: vp.w / 2 - 160, y: vp.h / 3, w: 320, h: 200 }
    const heading = { image: "Edit image", file: "Rename file", link: "Edit link" }[n.type]
    return { id: n.id, tone: "surface", heading, fields: editFields(n), rect }
  })()

  const startEdit = useCallback(
    (n: SceneNode, field?: string) => {
      if (n.type === "arrow") return
      if (!store.canEdit(n.parentId ?? n.id)) return toast("You can only view this board.")
      setSelection([n.id])
      if (n.type === "note") setInline({ id: n.id, field: field === "title" ? "title" : "body" })
      else if (n.type === "board") setInline({ id: n.id, field: field === "description" ? "description" : "title" })
      else setEditing(n.id)
    },
    [store, toast],
  )

  /** Inline editing finished: save whatever changed, as one undoable edit. */
  const finishInline = useCallback(
    (id: string, next: Record<string, string | null>) => {
      setInline((cur) => (cur?.id === id ? null : cur))
      const n = space.node(id)
      if (!n) return
      const cur = n.content as Record<string, unknown>
      const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => (cur[k] ?? "") !== (v ?? "")))
      if (Object.keys(changed).length) store.commit({ type: "update", id, patch: { content: changed } }, "edit")
      viewportRef.current?.focus({ preventScroll: true })
    },
    [space, store],
  )

  // ---------- stacking order ----------
  const layerable = useCallback(
    (id: string): Record<LayerMove, boolean> => {
      const moves: LayerMove[] = ["front", "forward", "backward", "back"]
      return Object.fromEntries(moves.map((m) => [m, !!layerOps(space, id, m)])) as Record<LayerMove, boolean>
    },
    [space],
  )

  const moveLayer = useCallback(
    (ids: string[], move: LayerMove) => {
      // Several selected: move each in turn — the top one first when raising, the bottom one
      // first when lowering — so the group keeps its own order.
      const up = move === "front" || move === "forward"
      const order = sortByLayer(ids.map((id) => space.node(id)).filter(Boolean) as SceneNode[])
      if (up) order.reverse()
      const label = { front: "bring to front", forward: "bring forward", backward: "send backward", back: "send to back" }[move]
      let moved = false
      store.group(label, () => {
        for (const n of order) {
          const op = layerOps(space, n.id, move)
          if (op && store.commit(op, label)) moved = true
        }
      })
      if (moved) setAnnouncement(`${label[0].toUpperCase()}${label.slice(1)}`)
    },
    [space, store],
  )

  const deleteIds = useCallback(
    (ids: string[]) => {
      const roots = ids.filter((id) => !ids.some((o) => o !== id && space.isAncestor(o, id)) && space.node(id)?.parentId)
      if (!roots.length) return
      const titles = roots.map((id) => titleOf(space.node(id)!))
      if (store.commit({ type: "batch", ops: roots.map((id) => ({ type: "delete", id }) as Op) }, "delete")) {
        setSelection([])
        setAnnouncement(`Removed ${titles.length === 1 ? titles[0] : `${titles.length} items`}. Press ⌘Z to undo.`)
        toast(`Removed ${titles.length === 1 ? `“${titles[0]}”` : `${titles.length} items`} · ⌘Z to undo`)
      }
    },
    [space, store, toast],
  )

  const deleteSelection = useCallback(() => deleteIds(selection), [deleteIds, selection])

  const onMenuAction = useCallback(
    (id: string, a: ContextAction) => {
      const n = space.node(id)
      if (!n) return
      const targets = selection.includes(id) ? selection : [id]
      if (a.kind === "edit") startEdit(n)
      else if (a.kind === "delete") deleteIds(targets)
      else if (a.kind === "export") {
        if (store.spaceId) window.location.assign(apiUrl(`/api/spaces/${store.spaceId}/export?board=${encodeURIComponent(id)}`))
      } else moveLayer(targets, a.move)
    },
    [deleteIds, moveLayer, selection, space, startEdit, store],
  )

  /** Screen rect of a card on the board right now (for the lightbox to fly from and back to). */
  const rectOf = useCallback((id: string) => {
    const p = layRef.current.items.find((it) => it.node.id === id)
    if (!p) return null
    return { x: p.x, y: p.y, w: p.node.w * p.scale, h: p.node.h * p.scale }
  }, [])

  // ---------- wheel: scrolling moves you through the space ----------
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      onStopFollow?.()
      zoomedTo.current = null
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
  }, [engine, kick, onStopFollow])

  // ---------- paste: files, our own clips, links, or text as a note ----------
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || editing || inline) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        void addFiles(files)
        return
      }
      const text = e.clipboardData?.getData("text/plain")?.trim()
      if (!text) return
      e.preventDefault()
      const clip = parseClip(text)
      if (clip) return void paste(clip)
      if (isUrl(text)) return void addLink(text)
      const [first, ...rest] = text.split(/\n+/)
      createNote(first.slice(0, 60), rest.join("\n") || (first.length > 60 ? first : ""))
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [addFiles, addLink, createNote, editing, inline, paste])

  // ---------- pointer: pan, marquee, drag cards (across levels), resize ----------
  const local = (e: { clientX: number; clientY: number }) => {
    const r = viewportRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const screenScaleIn = (board: string, z: number) => {
    const c = space.toFrame(engine.display, board)
    return c.s * lift(z, c.s, engine.pointer, !reduced).g
  }

  const cancelPress = () => {
    const p = pressRef.current
    if (p?.kind === "items" && p.moved) {
      for (const g of p.grabs) {
        const n = space.node(g.id)
        if (n && n.parentId !== g.parent) space.setParent(g.id, g.parent)
        space.clearPos(g.id)
        store.sendDrag(g.id, g.x, g.y, g.parent, true)
      }
    }
    if (p?.kind === "resize") space.updateNode(p.orig)
    if (p?.kind === "arrowEnd") setDropTarget(null)
    pressRef.current = null
    setPress(null)
    setDropTarget(null)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, local(e))
      if (touches.current.size === 2) {
        cancelPress()
        const [a, b] = [...touches.current.values()]
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
        capture(e.currentTarget, e.pointerId)
        return
      }
    }
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as HTMLElement
    if (target.closest("[data-no-drag]")) return
    onStopFollow?.()
    capture(e.currentTarget, e.pointerId)
    engine.stop()
    const pt = local(e)

    const bendHandle = target.closest<HTMLElement>("[data-arrow-bend]")
    if (bendHandle) {
      const n = space.node(bendHandle.dataset.arrowBend!)
      if (n && isArrow(n)) {
        const next: Press = { kind: "arrowBend", pointer: e.pointerId, id: n.id, bend: n.content.bend ?? DEFAULT_BEND, moved: false }
        pressRef.current = next
        setPress(next)
        return
      }
    }

    const endHandle = target.closest<HTMLElement>("[data-arrow-end]")
    if (endHandle) {
      const [id, end] = endHandle.dataset.arrowEnd!.split(":")
      const next: Press = { kind: "arrowEnd", pointer: e.pointerId, id, end: end === "1" ? 1 : 2, at: pt, snap: null, moved: false }
      pressRef.current = next
      setPress(next)
      return
    }

    const handle = target.closest<HTMLElement>("[data-resize]")
    if (handle) {
      const n = space.node(handle.dataset.resize!)
      const p = n && placedById.get(n.id)
      if (n && p) {
        const next: Press = { kind: "resize", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, id: n.id, w: n.w, h: n.h, scale: p.scale, keepAspect: n.type === "image", orig: n }
        pressRef.current = next
        setPress(next)
        return
      }
    }

    const el = target.closest<HTMLElement>("[data-item]")
    const placed = el ? placedById.get(el.dataset.item!) : undefined
    // A board is a place: press its floor to pan, grab its title strip (or a small board) to move it.
    const grabbable =
      placed && e.button === 0 && (placed.node.type !== "board" || target.closest("[data-board-handle]") || placed.node.w * placed.scale < 260)

    if (!grabbable) {
      if (e.shiftKey && e.button === 0) {
        const next: Press = { kind: "marquee", pointer: e.pointerId, sx: pt.x, sy: pt.y, x: pt.x, y: pt.y }
        pressRef.current = next
        setPress(next)
        return
      }
      const next: Press = { kind: "pan", pointer: e.pointerId, lx: e.clientX, ly: e.clientY, moved: false }
      pressRef.current = next
      setPress(next)
      return
    }

    const id = placed!.node.id
    const additive = e.shiftKey || e.metaKey
    const ids = selected.has(id) && !additive ? selection : [id]
    const grabs: Grab[] = []
    for (const gid of ids) {
      const n = space.node(gid)
      const gp = placedById.get(gid)
      if (!n || !gp || !n.parentId) continue
      // An arrow attached to something follows it; move it by its ends instead.
      if (isArrow(n) && (n.content.from || n.content.to)) continue
      const at = space.at(n)
      grabs.push({ id: gid, parent: n.parentId, x: at.x, y: at.y, sx: gp.x, sy: gp.y, ss: gp.scale })
    }
    const next: Press = {
      kind: "items",
      pointer: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      primary: id,
      fx: (pt.x - placed!.x) / (placed!.node.w * placed!.scale),
      fy: (pt.y - placed!.y) / (placed!.node.h * placed!.scale),
      grabs,
      moved: false,
      additive,
      // Pressed on a note's text or a board's title / description: a click edits it.
      edit: target.closest<HTMLElement>("[data-edit]")?.dataset.edit ?? null,
    }
    pressRef.current = next
    setPress(next)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pt = local(e)
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, pt)
      if (pinch.current && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        engine.panBy(mx - pinch.current.mx, my - pinch.current.my)
        if (pinch.current.d > 0) engine.zoomNow(mx, my, d / pinch.current.d)
        pinch.current = { d, mx, my }
        kick()
        return
      }
    }
    pointerAt.current = pt
    engine.setPointer({ x: (pt.x / vp.w - 0.5) * 2, y: (pt.y / vp.h - 0.5) * 2 })
    const p = pressRef.current
    if (!p || p.pointer !== e.pointerId) {
      if (e.pointerType === "mouse") {
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-item]")
        setHovered(el?.dataset.item ?? null)
        const b = boardAt(pt.x, pt.y)
        store.setPresence({ cursor: { b, ...localAt(b, pt.x, pt.y) }, focus: layRef.current.focus, view: viewRect, path: path.map((x) => x.id) })
      }
      kick()
      return
    }
    if (p.kind === "pan") {
      zoomedTo.current = null
      engine.panBy(e.clientX - p.lx, e.clientY - p.ly)
      p.lx = e.clientX
      p.ly = e.clientY
      if (!p.moved) setPress({ ...(p as Press), moved: true } as Press)
      p.moved = true
      kick()
      return
    }
    if (p.kind === "marquee") {
      p.x = pt.x
      p.y = pt.y
      setPress({ ...p })
      return
    }
    if (p.kind === "arrowBend") {
      const placed = placedById.get(p.id)
      const n = space.node(p.id)
      if (!placed || !n || !store.canEdit(n.parentId)) return
      // The curve follows the handle: its middle goes where you drag it.
      const [a, b] = arrowScreenEnds(placed)
      pressRef.current = { ...p, bend: bendThrough(a, b, pt), moved: true }
      setPress(pressRef.current)
      kick()
      return
    }
    if (p.kind === "arrowEnd") {
      const n = space.node(p.id)
      if (!n || !store.canEdit(n.parentId)) return
      const over = itemAt(pt.x, pt.y, p.id)
      const snap = over && attachable(n, over.node) ? over.node.id : null
      pressRef.current = { ...p, at: pt, snap, moved: true }
      setPress(pressRef.current)
      if (snap !== dropTarget) setDropTarget(snap)
      kick()
      return
    }
    if (p.kind === "resize") {
      if (!store.canEdit(p.orig.parentId)) return
      let w = Math.max(80, p.w + (e.clientX - p.sx) / p.scale)
      let h = Math.max(70, p.h + (e.clientY - p.sy) / p.scale)
      // Pictures always keep their true shape: the mat stays even and nothing is cropped.
      if (p.keepAspect) h = imageCardHeight(w, (p.h - IMAGE_MAT * 2) / Math.max(1, p.w - IMAGE_MAT * 2))
      if (p.orig.type === "board") {
        w = Math.max(220, w)
        h = Math.max(200, h)
      }
      const cur = space.node(p.id)
      if (cur) space.updateNode({ ...cur, w, h } as SceneNode)
      kick()
      return
    }
    // dragging cards
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < MOTION.dragThreshold) return
    if (!p.grabs.length || !p.grabs.every((g) => store.canEdit(g.parent))) return
    if (!p.moved) {
      p.moved = true
      setPress({ ...p })
      if (!p.grabs.some((g) => g.id === p.primary) || p.grabs.length === 1) setSelection(p.grabs.map((g) => g.id))
    }
    const primary = space.node(p.primary)!
    // Whichever board is under the pointer adopts the cards — at that level's size.
    const target = boardAt(pt.x, pt.y, p.grabs.map((g) => g.id), true)
    const ssT = screenScaleIn(target, primary.z ?? 0)
    const pg = p.grabs.find((g) => g.id === p.primary)!
    const ptl = { x: pt.x - p.fx * primary.w * ssT, y: pt.y - p.fy * primary.h * ssT }
    for (const g of p.grabs) {
      let n = space.node(g.id)
      if (!n) continue
      if (target !== n.parentId) {
        const before = screenScaleIn(n.parentId!, n.z ?? 0)
        const current = morphFor(n.id)?.extra ?? 1
        space.setParent(n.id, target)
        n = space.node(g.id)!
        morph(n.id, { from: (current * before) / screenScaleIn(target, n.z ?? 0), fx: g.id === p.primary ? p.fx : 0.5, fy: g.id === p.primary ? p.fy : 0.5, spawn: false })
      }
      // Others keep their offset from the primary card, scaled to the target level.
      const rel = ssT / pg.ss
      const sx = ptl.x + (g.sx - pg.sx) * rel
      const sy = ptl.y + (g.sy - pg.sy) * rel
      const c = space.toFrame(engine.display, target)
      const at = localFromScreen(c, vp, n.z ?? 0, sx, sy, engine.pointer, !reduced)
      space.setPos(n.id, at.x, at.y)
      if (g.id === p.primary) store.sendDrag(n.id, at.x, at.y, target)
    }
    const highlight = placedById.has(target) && target !== layRef.current.floorBoard && target !== layRef.current.room?.board ? target : null
    if (highlight !== dropTarget) setDropTarget(highlight)
    kick()
  }

  const endPress = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId)
      if (touches.current.size < 2) pinch.current = null
    }
    const p = pressRef.current
    if (!p || p.pointer !== e.pointerId) return
    if (cancelled) return cancelPress()
    pressRef.current = null
    setPress(null)
    setDropTarget(null)

    if (p.kind === "pan") {
      if (!p.moved) setSelection([])
    } else if (p.kind === "marquee") {
      const x0 = Math.min(p.sx, p.x), x1 = Math.max(p.sx, p.x), y0 = Math.min(p.sy, p.y), y1 = Math.max(p.sy, p.y)
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        const ids = layRef.current.items
          .filter((it) => {
            const w = it.node.w * it.scale, h = it.node.h * it.scale
            if (it.opacity < 0.5 || (it.node.type === "board" && Math.min(w / vp.w, h / vp.h) > SPACE.focusSpan)) return false
            return it.x < x1 && it.x + w > x0 && it.y < y1 && it.y + h > y0
          })
          .map((it) => it.node.id)
        setSelection(ids)
        setAnnouncement(`${ids.length} selected`)
      }
    } else if (p.kind === "arrowBend") {
      if (p.moved) store.commit({ type: "update", id: p.id, patch: { content: { bend: p.bend } } }, "bend arrow")
    } else if (p.kind === "arrowEnd") {
      const n = space.node(p.id)
      const placed = placedById.get(p.id)
      if (n && isArrow(n) && placed && p.moved) {
        // Work out both ends in board units, with the dragged end either free or on its item.
        const parent = n.parentId!
        const local = localAt(parent, p.at.x, p.at.y)
        const boxOf = (id: string): Box | null => {
          const t = space.node(id)
          if (!attachable(n, t)) return null
          const ta = space.at(t!)
          return { x: ta.x, y: ta.y, w: t!.w, h: t!.h }
        }
        const [a, b] = arrowEnds(n, space.at(n), boxOf, { end: p.end, at: local, snap: p.snap })
        const g = arrowPatch(a, b)
        const from = p.end === 1 ? p.snap : (n.content.from ?? null)
        const to = p.end === 2 ? p.snap : (n.content.to ?? null)
        store.commit({ type: "update", id: n.id, patch: { x: g.x, y: g.y, w: g.w, h: g.h, content: { ...g.content, from, to } } }, p.snap ? "connect arrow" : "move arrow end")
        if (p.snap) setAnnouncement(`Arrow attached to ${titleOf(space.node(p.snap)!)}`)
      }
    } else if (p.kind === "resize") {
      const cur = space.node(p.id)
      if (cur && (cur.w !== p.orig.w || cur.h !== p.orig.h)) {
        const { w, h } = cur
        space.updateNode(p.orig)
        store.commit({ type: "update", id: p.id, patch: { w: Math.round(w), h: Math.round(h) } }, "resize")
      }
    } else if (p.kind === "items") {
      if (!p.moved) {
        const id = p.primary
        setSelection(p.additive ? (selected.has(id) ? selection.filter((x) => x !== id) : [...selection, id]) : [id])
        const n = space.node(id)
        if (p.edit && !p.additive && n && store.canEdit(n.parentId ?? n.id)) startEdit(n, p.edit)
      } else {
        // Put everything back, then commit the move as one undoable edit. Whatever you
        // drag ends up on top of the board it lands on (keeping the group's own order).
        const ops: Op[] = []
        const moving = p.grabs.map((g) => g.id)
        const ordered = sortByLayer(p.grabs.map((g) => space.node(g.id)).filter(Boolean) as SceneNode[]).map((n) => n.id)
        const tops = new Map<string, number>()
        for (const g of p.grabs) {
          const n = space.node(g.id)
          if (!n) continue
          const at = space.at(n)
          const dest = n.parentId!
          const final = clampInto(dest, n, at.x, at.y)
          if (dest !== g.parent) space.setParent(g.id, g.parent)
          space.clearPos(g.id)
          if (!tops.has(dest)) tops.set(dest, topRank(space, dest, moving))
          const rank = tops.get(dest)! + ordered.indexOf(g.id)
          ops.push({ type: "update", id: g.id, patch: { x: Math.round(final.x), y: Math.round(final.y), rank, ...(dest !== g.parent ? { parentId: dest } : {}) } })
          store.sendDrag(g.id, final.x, final.y, dest, true)
        }
        if (ops.length) {
          store.commit(ops.length === 1 ? ops[0] : { type: "batch", ops }, "move")
          const moved = space.node(p.primary)
          if (moved && moved.parentId !== p.grabs[0].parent) setAnnouncement(`Moved into ${titleOf(space.node(moved.parentId!)!)}`)
        }
      }
    }
    kick()
  }

  // ---------- files dragged in from the desktop ----------
  const isFileDrag = (e: ReactDragEvent) => Array.from(e.dataTransfer.types).includes("Files")
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = store.readOnly ? "none" : "copy"
    const pt = local(e)
    const board = boardAt(pt.x, pt.y, [], true)
    if (board !== fileDrag) setFileDrag(board)
  }
  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!viewportRef.current?.contains(e.relatedTarget as Node | null)) setFileDrag(null)
  }
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    setFileDrag(null)
    const at = local(e)
    const drop = readDrop(e.dataTransfer)
    if (!drop) return void addFiles(Array.from(e.dataTransfer.files), at)
    void drop.folders
      .then((folders) => importFolders(folders, at))
      .catch(() => toast("That folder couldn't be read."))
    if (drop.looseFiles.length) void addFiles(drop.looseFiles, at)
  }

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? (e.target as HTMLElement) : null
      if (isTyping(t) || editing || inline || held || menu) return
      if (e.defaultPrevented || t?.closest("[role=menu], [role=dialog]")) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === "z") {
        e.preventDefault()
        undo(e.shiftKey)
        return
      }
      if (mod && k === "y") {
        e.preventDefault()
        undo(true)
        return
      }
      if (mod && (k === "c" || k === "x") && selection.length) {
        e.preventDefault()
        copySelection()
        if (k === "x") deleteSelection()
        else setAnnouncement(`Copied ${selection.length === 1 ? "1 item" : `${selection.length} items`}`)
        return
      }
      if (mod && k === "d" && selection.length) {
        e.preventDefault()
        duplicate()
        return
      }
      if (mod && (e.key === "]" || e.key === "}" || e.key === "[" || e.key === "{") && selection.length) {
        e.preventDefault()
        const raise = e.key === "]" || e.key === "}"
        moveLayer(selection, raise ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward")
        return
      }
      if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && selection.length) {
        e.preventDefault()
        const r = rectOf(selection[0])
        setMenu({ x: r ? r.x + Math.min(r.w, 240) / 2 : vp.w / 2, y: r ? r.y + Math.min(r.h, 160) / 2 : vp.h / 2, id: selection[0] })
        return
      }
      if (mod && k === "a") {
        e.preventDefault()
        setSelection((space.index.children.get(lay.focus) ?? []).map((n) => n.id))
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        if (selection.length) setSelection([])
        else goUp()
        return
      }
      if (mod || e.altKey) return
      if ((e.key === "Delete" || e.key === "Backspace") && selection.length) deleteSelection()
      else if (k === "n" && !store.readOnly) place("note", null)
      else if (k === "b" && !store.readOnly) place("board", null)
      else if (k === "a" && !store.readOnly) place("arrow", null)
      else if (k === "l") toggleLabels(e.shiftKey ? "boards" : "photos")
      else if (e.key === "+" || e.key === "=") zoomCentre(ZOOM.step)
      else if (e.key === "-" || e.key === "_") zoomCentre(1 / ZOOM.step)
      else if (e.code === "Digit0" && e.shiftKey) fitBoard(space.rootId)
      else if (e.key === "0") fitBoard(lay.focus)
      else if (t?.closest("button, nav")) return
      else if (e.key.startsWith("Arrow")) {
        const pan = { ArrowLeft: [ZOOM.keyPan, 0], ArrowRight: [-ZOOM.keyPan, 0], ArrowUp: [0, ZOOM.keyPan], ArrowDown: [0, -ZOOM.keyPan] }[e.key]
        if (!pan) return
        zoomedTo.current = null
        engine.panBy(pan[0], pan[1])
      } else return
      e.preventDefault()
      kick()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [copySelection, deleteSelection, duplicate, editing, engine, fitBoard, flyToBoard, goUp, held, inline, kick, lay.focus, menu, moveLayer, place, rectOf, selection, space, store, toggleLabels, undo, vp, zoomCentre])

  const onItemKey = (e: ReactKeyboardEvent<HTMLDivElement>, n: SceneNode) => {
    if (e.target !== e.currentTarget) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setSelection([n.id])
      if (e.key === "Enter" && n.type === "note" && store.canEdit(n.parentId)) startEdit(n)
      else flyToNode(n)
    }
  }

  const tactileFor = (id: string): Tactile => {
    if (press?.kind === "items" && press.grabs.some((g) => g.id === id)) return press.moved ? "drag" : id === press.primary ? "press" : "rest"
    return hovered === id && !press ? "hover" : "rest"
  }

  const ordered = [...lay.items].sort((a, b) => a.order - b.order)
  const focusTitle = space.node(lay.focus) ? titleOf(space.node(lay.focus)!) : "the board"
  const travel = engine.travel
  const dragging = press?.kind === "items" && press.moved ? new Set(press.grabs.map((g) => g.id)) : null
  const single = selection.length === 1 && !dragging ? placedById.get(selection[0]) : undefined
  const canResize = !!single && !isArrow(single.node) && store.canEdit(single.node.parentId) && single.node.w * single.scale < vp.w * 1.5 && single.node.w * single.scale > 40
  const peers = [...store.peers.values()]
  // The selected arrow shows a handle on each end, to drag it free or onto another item.
  const arrowSel = single && isArrow(single.node) && store.canEdit(single.node.parentId) ? single : undefined
  const endDrag = press?.kind === "arrowEnd" && press.moved ? press : null
  const bendDrag = press?.kind === "arrowBend" ? press : null
  const arrowEndsFor = (p: Placed) => (endDrag?.id === p.node.id ? arrowScreenEnds(p, { end: endDrag.end, at: endDrag.at, snap: endDrag.snap }) : arrowScreenEnds(p))
  const rootClass = ["absolute inset-0", !labels.boards && "zb-hide-board-labels", !labels.photos && "zb-hide-photo-labels"].filter(Boolean).join(" ")

  return (
    <div className={rootClass}>
      <div
        ref={viewportRef}
        className={`zb-viewport zb-space${press?.kind === "pan" && press.moved ? " is-panning" : ""}`}
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
          pointerAt.current = null
          setHovered(null)
          kick()
        }}
        onDoubleClick={(e) => {
          // The press captured the pointer on the viewport, so find the card by position.
          const pt = local(e)
          const placed = itemAt(pt.x, pt.y)
          if (!placed) return
          const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
          const target = (hit?.closest("[data-item]") ? hit : e.target) as HTMLElement
          const n = placed.node
          if (n.type === "arrow") return
          if (n.type === "board") {
            if (target.closest("[data-board-handle]") && store.canEdit(n.parentId ?? n.id)) return startEdit(n, target.closest<HTMLElement>("[data-edit]")?.dataset.edit)
            const span = Math.min((n.w * placed.scale) / vp.w, (n.h * placed.scale) / vp.h)
            if (span < SPACE.focusSpan) flyToBoard(n.id)
            return
          }
          // Two stages: the first double-click brings the card to the middle of your view; once
          // it's there, double-clicking it again picks it up into the lightbox.
          if (zoomedTo.current === n.id || isCentred(rectOf(n.id), vp)) {
            zoomedTo.current = null
            setSelection([n.id])
            setHeld(n.id)
            return
          }
          zoomedTo.current = n.id
          setSelection([n.id])
          flyToNode(n)
        }}
        onContextMenu={(e) => {
          const pt = local(e)
          const placed = itemAt(pt.x, pt.y)
          e.preventDefault()
          if (!placed) return setMenu(null)
          const id = placed.node.id
          if (!selected.has(id)) setSelection([id])
          setMenu({ x: e.clientX, y: e.clientY, id })
        }}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Scenery theme={theme} z={travel.zoom * SCENERY.layersPerEFold + 2} panX={-travel.x} panY={-travel.y} pointer={engine.pointer} vp={vp} parallax={!reduced} />
        {groundStyle && <div className="zb-inner-floor zb-room zb-ground" style={groundStyle} aria-hidden />}
        {floors.map((f) => (
          <div key={f.id} className="zb-inner-floor zb-room" style={f.style} aria-hidden />
        ))}
        <div className="zb-vignette" aria-hidden />
        {ordered.map((p) => {
          if (isArrow(p.node)) {
            const [a, b] = arrowEndsFor(p)
            const bend = bendDrag?.id === p.node.id ? bendDrag.bend : (p.node.content.bend ?? undefined)
            return <ArrowItem key={p.node.id} id={p.node.id} a={a} b={b} style={styleOf(p.node)} bend={bend} scale={p.scale} order={p.order} opacity={p.opacity} selected={selected.has(p.node.id)} hidden={held === p.node.id} />
          }
          return (
          <Item
            key={p.node.id}
            placed={p}
            space={space}
            tactile={tactileFor(p.node.id)}
            selected={selected.has(p.node.id)}
            multi={selection.length > 1 && selected.has(p.node.id)}
            reduced={reduced}
            dragging={!!dragging?.has(p.node.id)}
            dropTarget={dropTarget === p.node.id || fileDrag === p.node.id}
            hidden={held === p.node.id}
            morph={morphFor(p.node.id)}
            onKeyDown={onItemKey}
            onFocusItem={(id) => !selected.has(id) && select([id])}
            editable={store.canEdit(p.node.parentId ?? p.node.id)}
            inline={inline?.id === p.node.id ? inline.field : null}
            onInlineDone={finishInline}
            linkTarget={endDrag?.snap === p.node.id}
          />
          )
        })}
        {arrowSel &&
          !endDrag &&
          styleOf(arrowSel.node as ArrowNode).shape === "curved" &&
          (() => {
            const [a, b] = arrowEndsFor(arrowSel)
            const m = curveMid(a, b, bendDrag?.id === arrowSel.node.id ? bendDrag.bend : ((arrowSel.node as ArrowNode).content.bend ?? DEFAULT_BEND))
            return (
              <button
                type="button"
                className="zb-arrow-bend"
                data-arrow-bend={arrowSel.node.id}
                aria-label="Bend the arrow"
                title="Drag to bend the curve"
                style={{ left: m.x, top: m.y }}
              />
            )
          })()}
        {arrowSel && !endDrag && !bendDrag && (
          <ArrowStyleBar
            at={(() => {
              const [a, b] = arrowEndsFor(arrowSel)
              // Above the arrow, or below it when it's near the top; never off the sides.
              const below = Math.min(a.y, b.y) < (vp.w < 520 ? 240 : 150)
              const half = Math.min(180, (vp.w - 100) / 2)
              return { x: Math.min(Math.max((a.x + b.x) / 2, half + 84), vp.w - half - 8), y: below ? Math.max(a.y, b.y) : Math.min(a.y, b.y), below }
            })()}
            value={styleOf(arrowSel.node as ArrowNode)}
            // Only the setting you changed, so quick clicks never undo each other.
            onChange={(change) => store.commit({ type: "update", id: arrowSel.node.id, patch: { content: change } }, "arrow style")}
          />
        )}
        {arrowSel &&
          !endDrag &&
          arrowEndsFor(arrowSel).map((pt, i) => (
            <button
              key={i}
              type="button"
              className="zb-arrow-end"
              data-arrow-end={`${arrowSel.node.id}:${i + 1}`}
              aria-label={i === 0 ? "Move the arrow's start" : "Move the arrow's end"}
              title="Drag onto an item to attach"
              style={{ left: pt.x, top: pt.y }}
            />
          ))}
        {canResize && single && (
          <button
            type="button"
            className="zb-resize"
            data-resize={single.node.id}
            aria-label={`Resize ${titleOf(single.node)}`}
            style={{ left: single.x + single.node.w * single.scale, top: single.y + single.node.h * single.scale }}
          />
        )}
        {press?.kind === "marquee" && <Marquee rect={{ x: Math.min(press.sx, press.x), y: Math.min(press.sy, press.y), w: Math.abs(press.x - press.sx), h: Math.abs(press.y - press.sy) }} />}
        <RemoteCursors peers={peers} space={space} cam={engine.display} vp={vp} me={store.me} />
        {fileDrag && (
          <div className="zb-dropzone" aria-hidden>
            <span className="zb-drop-pill zb-cobalt" style={{ background: "var(--cobalt)" }}>
              {store.canEdit(fileDrag) ? `Drop to add to ${titleOf(space.node(fileDrag)!)}` : "You can only view this board"}
            </span>
          </div>
        )}
        {editTarget && (
          <EditOverlay
            key={editTarget.id}
            target={editTarget}
            onCancel={() => setEditing(null)}
            onSave={(values) => {
              setEditing(null)
              const n = space.node(editTarget.id)
              if (!n) return
              const cur = n.content as Record<string, unknown>
              const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => (cur[k] ?? "") !== v))
              if (Object.keys(changed).length) store.commit({ type: "update", id: n.id, patch: { content: changed } }, "edit")
            }}
          />
        )}
      </div>

      <DraggablePanel id="nav" label="the path" defaultPos={{ corner: "tl", dx: 16, dy: 72 }}>
        <Breadcrumbs path={path.map((b) => ({ id: b.id, title: titleOf(b) }))} onNavigate={(c) => flyToBoard(c.id)} onBack={path.length > 1 ? goUp : undefined} />
      </DraggablePanel>
      {!store.readOnly && <Toolbar onPlace={place} onFiles={(f) => void addFiles(f)} />}
      <DraggablePanel id="zoom" label="the zoom controls" defaultPos={{ corner: "br", dx: 16, dy: 16 }}>
        <div className="zb-panel-stack">
          <LevelBadge depth={focusDepth} />
          <ZoomControls readout={readout} onZoomIn={() => zoomCentre(ZOOM.step)} onZoomOut={() => zoomCentre(1 / ZOOM.step)} onFit={() => fitBoard(lay.focus)} onWhole={() => fitBoard(space.rootId)} labels={labels} onToggleLabels={toggleLabels} />
        </div>
      </DraggablePanel>
      <DraggablePanel id="minimap" label="the map" defaultPos={{ corner: "bl", dx: 16, dy: 16 }} className={`zb-minimap-panel${mapHidden ? " is-collapsed" : ""}`}>
        <Minimap space={space} focus={lay.focus} cam={engine.display} vp={vp} onCenter={centerOn} onHide={toggleMap} />
      </DraggablePanel>
      <button
        type="button"
        className={`zb-map-tab${mapHidden ? " is-shown" : ""}`}
        onClick={toggleMap}
        aria-label="Show the map"
        title="Show the map"
        tabIndex={mapHidden ? 0 : -1}
        aria-hidden={!mapHidden}
      >
        <EyeOff size={15} strokeWidth={2.25} aria-hidden className="zb-map-tab-off" />
        <Eye size={15} strokeWidth={2.25} aria-hidden className="zb-map-tab-on" />
      </button>
      {menu && space.node(menu.id) && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={selection.length > 1 && selection.includes(menu.id) ? `${selection.length} items` : titleOf(space.node(menu.id)!)}
          canEdit={store.canEdit(space.node(menu.id)!.parentId ?? menu.id)}
          canRename={space.node(menu.id)!.type !== "arrow"}
          layerable={layerable(menu.id)}
          exportable={!!store.spaceId && !store.publicToken && space.node(menu.id)!.type === "board" && !(selection.length > 1 && selection.includes(menu.id))}
          onAction={(a) => onMenuAction(menu.id, a)}
          onClose={() => setMenu(null)}
        />
      )}
      {held && space.node(held) && (
        <Lightbox
          key={held}
          node={space.node(held)!}
          getRect={() => rectOf(held)}
          canEdit={store.canEdit(space.node(held)!.parentId)}
          onClosed={() => setHeld(null)}
          onEdit={() => {
            const n = space.node(held)
            setHeld(null)
            if (n) startEdit(n)
          }}
        />
      )}
      <div className="sr-only-zb" aria-live="polite">
        {announcement || `Now in ${focusTitle}`}
      </div>
    </div>
  )
}

function lastArrowStyle(): ArrowStyle {
  try {
    return { ...DEFAULT_ARROW, ...(JSON.parse(localStorage.getItem("zoomz.arrowStyle") ?? "{}") as Partial<ArrowStyle>) }
  } catch {
    return DEFAULT_ARROW
  }
}

/** A small bar above a selected arrow to change its shape, line and direction. */
function ArrowStyleBar({ at, value, onChange }: { at: { x: number; y: number; below: boolean }; value: ArrowStyle; onChange(change: Partial<ArrowStyle>): void }) {
  return (
    <div className={`zb-arrow-bar${at.below ? " is-below" : ""}`} style={{ left: at.x, top: at.y }} data-no-drag onPointerDown={(e) => e.stopPropagation()}>
      <ArrowStyleControls value={value} onChange={(_, change) => onChange(change)} compact />
    </div>
  )
}

/** Is a card's on-screen rect already in the middle of the view and reasonably big? */
function isCentred(r: { x: number; y: number; w: number; h: number } | null, vp: Viewport): boolean {
  if (!r) return false
  const dx = Math.abs(r.x + r.w / 2 - vp.w / 2) / vp.w
  const dy = Math.abs(r.y + r.h / 2 - vp.h / 2) / vp.h
  return dx < 0.06 && dy < 0.06 && Math.max(r.w / vp.w, r.h / vp.h) > 0.45
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
  multi: boolean
  reduced: boolean
  dragging: boolean
  dropTarget: boolean
  /** Picked up into the lightbox: the card's spot on the board is empty meanwhile. */
  hidden: boolean
  morph: { extra: number; fade: number; fx: number; fy: number } | null
  onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, n: SceneNode): void
  onFocusItem(id: string): void
  editable: boolean
  /** The field being edited in place on this card, if any. */
  inline: NoteField | BoardField | null
  onInlineDone(id: string, next: Record<string, string | null>): void
  /** An arrow end being dragged would attach here. */
  linkTarget: boolean
}

type CardEdit = { editable: boolean; inline: NoteField | BoardField | null; onDone(next: Record<string, string | null>): void }

function Item({ placed, space, tactile, selected, multi, reduced, dragging, dropTarget, hidden, morph, onKeyDown, onFocusItem, editable, inline, onInlineDone, linkTarget }: ItemProps) {
  const { node: n, order, reveal, lod } = placed
  let { x, y, scale, opacity } = placed
  if (morph) {
    // Scale about the grab point, so the card stays under the pointer while it resizes.
    x += morph.fx * n.w * scale * (1 - morph.extra)
    y += morph.fy * n.h * scale * (1 - morph.extra)
    scale *= morph.extra
    opacity *= morph.fade
  }
  // Lay big cards out at a capped size and make up for it in the scale: same place and same
  // size on screen, but the card's own box (what the GPU rasterises once hover or drag gives it
  // a 3D tilt) never exceeds CARD_BOX px. A card resized to 9000×12000 used to become a ~100
  // megapixel layer, over the GPU budget, so its tiles were dropped (black blocks).
  const f = cardBoxFactor(n)
  const style: CSSProperties = {
    width: n.w / f,
    height: n.h / f,
    transform: `translate(${x}px, ${y}px) scale(${scale * f})`,
    opacity: hidden ? 0 : opacity,
    zIndex: dragging ? 50_000 : order,
    ["--zh" as string]: (n.z ?? 0) / f,
    ["--s" as string]: scale * f,
    // The tilt's perspective scales with the card, so every card tilts the same and no corner
    // can swing past the eye point (which can't be projected).
    perspective: perspectiveFor(n.w / f, n.h / f),
    pointerEvents: opacity < 0.2 || dragging || hidden ? "none" : undefined,
    willChange: dragging ? "transform" : undefined,
  }
  return (
    <div
      className={`zb-node${dragging ? " is-dragging" : ""}${multi ? " is-multi" : ""}${n.type === "board" && reveal > 0.3 ? " is-open" : ""}${linkTarget ? " is-link-target" : ""}${inline ? " is-editing" : ""}`}
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
      {renderCard(n, placed, space, tactile, selected && !multi, reduced, lod, dropTarget, n.w * scale, f, { editable, inline, onDone: (next) => onInlineDone(n.id, next) })}
    </div>
  )
}

/** The smallest file that still looks sharp at this on-screen size. */
function pick(c: { src: string; thumb_256?: string; thumb_1024?: string }, screenW: number): string {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  const need = screenW * dpr
  if (need <= 256 && c.thumb_256) return c.thumb_256
  if (need <= 1024 && c.thumb_1024) return c.thumb_1024
  return c.src
}

function renderCard(n: SceneNode, placed: Placed, space: Space, tactile: Tactile, selected: boolean, reduced: boolean, lod: Placed["lod"], dropTarget: boolean, screenW: number, f: number, edit: CardEdit) {
  const progress = (n.content as { progress?: number; status?: string }).status === "uploading" ? ((n.content as { progress?: number }).progress ?? 0) : undefined
  if (n.type === "image") return <ImageCard title={n.content.title} alt={n.content.alt} src={pick(n.content, screenW)} lod={lod} selected={selected} tactile={tactile} reduced={reduced} progress={progress} />
  if (n.type === "note")
    return (
      <NoteCard
        title={n.content.title}
        body={n.content.body}
        w={n.w / f}
        h={n.h / f}
        lod={lod}
        selected={selected}
        tactile={tactile}
        reduced={reduced}
        editing={edit.inline === "title" || edit.inline === "body" ? edit.inline : null}
        onDone={edit.onDone}
      />
    )
  if (n.type === "arrow") return null
  if (n.type === "file")
    return (
      <FileCard
        title={n.content.title}
        src={n.content.src}
        mime={n.content.mime ?? ""}
        size={n.content.size ?? 0}
        preview={n.content.poster ?? (screenW > 300 ? n.content.preview : n.content.thumb_256) ?? n.content.thumb_1024}
        status={n.content.status}
        progress={progress}
        lod={lod}
        selected={selected}
        tactile={tactile}
        reduced={reduced}
      />
    )
  if (n.type === "link") return <LinkCard {...n.content} lod={lod} selected={selected} tactile={tactile} reduced={reduced} />
  const io = space.innerOrigin(n.id)
  return (
    <BoardCard
      title={n.content.title}
      description={n.content.description}
      count={space.index.children.get(n.id)?.length ?? 0}
      lod={lod}
      selected={selected}
      tactile={tactile}
      reduced={reduced}
      innerFloor={floorFor(placed.level + 1)}
      innerDot={{ pitch: 24 * io.k, ox: io.ox, oy: io.oy }}
      dropTarget={dropTarget}
      editable={edit.editable}
      editing={edit.inline === "title" || edit.inline === "description" ? edit.inline : null}
      onDone={(next) => edit.onDone({ title: next.title, description: next.description || null })}
    />
  )
}

function label(n: SceneNode): string {
  if (n.type === "board") return `Board: ${n.content.title}. Zoom in to step inside, or press Enter.`
  if (n.type === "image") return `Image: ${n.content.title}. ${n.content.alt}`
  if (n.type === "file") return `File: ${n.content.title}`
  if (n.type === "link") return `Link: ${titleOf(n)}`
  if (n.type === "arrow") return "Arrow"
  return `Note: ${n.content.title}. ${n.content.body}`
}
