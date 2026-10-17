/* oxlint-disable react/refs -- the camera engine and session positions are an external,
   mutable store advanced by requestAnimationFrame; each frame re-renders and reads them. */
import { useReducedMotion } from "motion/react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { BoardCard } from "@/components/zoomboard/BoardCard"
import { Breadcrumbs } from "@/components/zoomboard/Breadcrumbs"
import { ImageCard } from "@/components/zoomboard/ImageCard"
import { LevelBadge } from "@/components/zoomboard/LevelBadge"
import { NoteCard } from "@/components/zoomboard/NoteCard"
import type { Tactile } from "@/components/zoomboard/TactileSlab"
import { ZoomControls } from "@/components/zoomboard/ZoomControls"
import { CameraEngine } from "@/lib/cameraEngine"
import { MOTION, ZOOM, floorFor } from "@/lib/constants"
import { indexScene, pathTo, previewImages } from "@/lib/scene"
import { Space, layout, type Cam, type Placed, type Viewport } from "@/lib/space"
import type { Scene, SceneNode } from "@/lib/types"

type Props = {
  scene: Scene
  onMoveNode(id: string, x: number, y: number): void
}

type Press = {
  pointer: number
  id: string | null // null = panning the floor
  sx: number
  sy: number
  lx: number
  ly: number
  nx: number
  ny: number
  scale: number
  moved: boolean
}

export function SpaceCanvas({ scene, onMoveNode }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion() ?? false

  // The space is built once from the loaded scene; session moves live in `positions`
  // so a moved card never rescales its board or shifts the camera's frame.
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

  // ---------- frame loop: runs only while something is moving ----------
  const raf = useRef(0)
  const kick = useCallback(() => {
    if (raf.current) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const moving = engine.tick(now, dt)
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

  // ---------- layout for this frame ----------
  const lay = layout(space, engine.display, vp, engine.pointer, !reduced)
  const path = pathTo(space.index, lay.focus)
  const focusDepth = path.length - 1
  const readout = formatZoom(space.globalScale(engine.display))

  // Floor dot grid in the floor board's coordinates; fades out when too dense.
  const pitch = 24 * lay.floorCam.s
  const floorStyle: CSSProperties = {
    ["--floor" as string]: floorFor(space.depthOf(lay.floorBoard)),
  }
  const dotsStyle: CSSProperties = {
    backgroundSize: `${pitch}px ${pitch}px`,
    ["--pitch" as string]: `${pitch}px`,
    backgroundPosition: `${lay.floorCam.x}px ${lay.floorCam.y}px`,
    opacity: Math.min(1, Math.max(0, (pitch - 6) / 8)),
  }

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

  // ---------- pointer: pan the floor, or press / drag a card ----------
  const placedById = useMemo(() => new Map(lay.items.map((p) => [p.node.id, p])), [lay.items])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-item]")
    const placed = el ? placedById.get(el.dataset.item!) : undefined
    // A board you are standing in is floor, not an object: pressing it pans.
    const grab = placed && !(placed.node.type === "board" && placed.reveal > 0.3) && e.button === 0 ? placed : undefined
    e.currentTarget.setPointerCapture(e.pointerId)
    engine.stop()
    const p0 = grab ? space.at(grab.node) : { x: 0, y: 0 }
    const next: Press = {
      pointer: e.pointerId,
      id: grab ? grab.node.id : null,
      sx: e.clientX,
      sy: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      nx: p0.x,
      ny: p0.y,
      scale: grab ? grab.scale : 1,
      moved: false,
    }
    pressRef.current = next
    setPress(next)
    if (!grab) setSelected(null)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    engine.setPointer({ x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 })
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
    const dx = e.clientX - p.sx, dy = e.clientY - p.sy
    if (!p.moved && Math.hypot(dx, dy) < MOTION.dragThreshold) return
    if (!p.moved) {
      p.moved = true
      setPress({ ...p })
      setSelected(p.id)
    }
    // 1:1 with the pointer in screen space.
    positions.current.set(p.id, { x: p.nx + dx / p.scale, y: p.ny + dy / p.scale })
    kick()
  }

  const endPress = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const p = pressRef.current
    if (!p || p.pointer !== e.pointerId) return
    pressRef.current = null
    setPress(null)
    if (p.id) {
      if (p.moved && !cancelled) {
        const at = positions.current.get(p.id)!
        onMoveNode(p.id, Math.round(at.x), Math.round(at.y))
      } else if (p.moved) {
        positions.current.set(p.id, { x: p.nx, y: p.ny })
      } else setSelected(p.id)
    }
    kick()
  }

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if (e.key === "Escape") {
        e.preventDefault()
        goUp()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "+" || e.key === "=") zoomCentre(ZOOM.step)
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
  }, [engine, flyToBoard, goUp, kick, lay.focus, zoomCentre])

  const onItemKey = (e: ReactKeyboardEvent<HTMLDivElement>, n: SceneNode) => {
    if (e.target !== e.currentTarget) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setSelected(n.id)
      flyToNode(n)
    }
  }

  // Announced politely whenever the level you are in changes.
  const announcement = `Now in ${space.node(lay.focus)?.content.title ?? "the board"}`

  const tactileFor = (id: string): Tactile => {
    if (press?.id === id) return press.moved ? "drag" : "press"
    return hovered === id && !press ? "hover" : "rest"
  }

  const ordered = [...lay.items].sort((a, b) => a.order - b.order)

  return (
    <div className="absolute inset-0">
      <div
        ref={viewportRef}
        className={`zb-viewport zb-space${press && press.id === null && press.moved ? " is-panning" : ""}`}
        style={floorStyle}
        tabIndex={-1}
        role="region"
        aria-roledescription="zoomable space"
        aria-label={`${space.node(lay.focus)?.content.title ?? "Board"}. Scroll to move closer or further; drag to pan.`}
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
          if (placed && !(placed.node.type === "board" && placed.reveal > 0.6)) flyToNode(placed.node)
        }}
      >
        <div className="zb-dots" style={dotsStyle} aria-hidden />
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
            onKeyDown={onItemKey}
            onFocusItem={(id) => setSelected(id)}
          />
        ))}
      </div>

      <div className="zb-chrome-tl">
        <Breadcrumbs
          path={path.map((b) => ({ id: b.id, title: b.content.title }))}
          onNavigate={(c) => flyToBoard(c.id)}
          onBack={path.length > 1 ? goUp : undefined}
        />
      </div>
      <div className="zb-chrome-br">
        <LevelBadge depth={focusDepth} />
        <ZoomControls readout={readout} onZoomIn={() => zoomCentre(ZOOM.step)} onZoomOut={() => zoomCentre(1 / ZOOM.step)} onFit={() => flyToBoard(lay.focus)} />
      </div>
      <div className="zb-chrome-bl" aria-hidden>
        <div className="zb-hint">
          Scroll to move through the space · drag to pan · keep going to step inside a board
        </div>
      </div>
      <div className="sr-only-zb" aria-live="polite">
        {announcement}
      </div>
    </div>
  )
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
  onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, n: SceneNode): void
  onFocusItem(id: string): void
}

function Item({ placed, space, tactile, selected, reduced, dragging, onKeyDown, onFocusItem }: ItemProps) {
  const { node: n, x, y, scale, opacity, order, reveal, lod } = placed
  const raised = n.type !== "board"
  const style: CSSProperties = {
    width: n.w,
    height: n.h,
    transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
    opacity,
    zIndex: dragging ? 50_000 : order,
    ["--reveal" as string]: reveal,
    ["--zh" as string]: n.z ?? 0,
    pointerEvents: opacity < 0.2 ? "none" : undefined,
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
      {raised && <div className="zb-hshadow" aria-hidden />}
      {renderCard(n, placed, space, tactile, selected, reduced, lod, reveal)}
    </div>
  )
}

function renderCard(n: SceneNode, placed: Placed, space: Space, tactile: Tactile, selected: boolean, reduced: boolean, lod: Placed["lod"], reveal: number) {
  if (n.type === "image")
    return <ImageCard title={n.content.title} alt={n.content.alt} src={n.content.src} lod={lod} selected={selected} tactile={tactile} reduced={reduced} />
  if (n.type === "note")
    return <NoteCard title={n.content.title} body={n.content.body} lod={lod} selected={selected} tactile={tactile} reduced={reduced} />
  const frame = space.frameOf(n.id)
  return (
    <BoardCard
      title={n.content.title}
      description={n.content.description}
      count={space.index.children.get(n.id)?.length ?? 0}
      preview={previewCache(space, n.id)}
      lod={lod}
      selected={selected}
      tactile={tactile}
      reduced={reduced}
      open={reveal > 0.3}
      innerFloor={floorFor(placed.level + 1)}
      innerDot={24 * frame.k}
    />
  )
}

const previews = new WeakMap<Space, Map<string, { src: string; alt: string }[]>>()
function previewCache(space: Space, id: string) {
  let m = previews.get(space)
  if (!m) previews.set(space, (m = new Map()))
  let p = m.get(id)
  if (!p) m.set(id, (p = previewImages(space.index, id).map((i) => ({ src: i.content.src, alt: i.content.alt }))))
  return p
}

function label(n: SceneNode): string {
  if (n.type === "board") return `Board: ${n.content.title}. Zoom in to step inside, or press Enter.`
  if (n.type === "image") return `Image: ${n.content.title}. ${n.content.alt}`
  return `Note: ${n.content.title}. ${n.content.body}`
}

