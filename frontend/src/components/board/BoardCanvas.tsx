import { animate, motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { BoardCard } from "@/components/zoomboard/BoardCard"
import { Breadcrumbs } from "@/components/zoomboard/Breadcrumbs"
import { ImageCard } from "@/components/zoomboard/ImageCard"
import { NoteCard } from "@/components/zoomboard/NoteCard"
import { ZoomBadge } from "@/components/zoomboard/ZoomBadge"
import { ZoomControls } from "@/components/zoomboard/ZoomControls"
import { useCamera, type CameraState } from "@/hooks/useCamera"
import { DEPTH_FLOOR, MOTION, ZOOM, lodForScale } from "@/lib/constants"
import { boundsOf, indexScene, pathTo, previewImages, type Rect } from "@/lib/scene"
import type { BoardNode, LOD, Scene, SceneNode } from "@/lib/types"
import { SpatialNode } from "./SpatialNode"

type Props = {
  scene: Scene
  onMoveNode(id: string, x: number, y: number): void
}

type Phase = "idle" | "entering" | "leaving"

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Next paint, but never hang if the page isn't painting (background tab). */
const nextFrame = () => Promise.race([new Promise<void>((r) => requestAnimationFrame(() => r())), wait(50)])
const floorFor = (depth: number) => DEPTH_FLOOR[Math.min(depth, DEPTH_FLOOR.length - 1)]

export function BoardCanvas({ scene, onMoveNode }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const camera = useCamera(viewportRef)
  const reduced = useReducedMotion() ?? false
  const index = useMemo(() => indexScene(scene), [scene])

  const [boardId, setBoardId] = useState(scene.rootBoardId)
  const [floorDepth, setFloorDepth] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  const [panning, setPanning] = useState(false)
  const [lod, setLod] = useState<LOD>("medium")
  const [diveTarget, setDiveTarget] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")

  const phaseRef = useRef<Phase>("idle")
  const savedCameras = useRef(new Map<string, CameraState>())

  /** Dive progress (0 → 1) for the board card being entered or emerged from. */
  const dive = useMotionValue(0)
  const siblingOpacity = useTransform(dive, [0, 0.6], [1, 0])
  const worldOpacity = useMotionValue(0)

  const path = useMemo(() => pathTo(index, boardId), [index, boardId])
  const children = useMemo(() => index.children.get(boardId) ?? [], [index, boardId])
  const currentBoard = path[path.length - 1]

  // LOD follows the camera, but freezes during flights so cards don't re-layout mid-dive.
  useMotionValueEvent(camera.scale, "change", (s) => {
    if (phaseRef.current === "idle") setLod(lodForScale(s))
  })

  // Floor dot grid moves with the camera; pitch doubles when it gets too dense.
  const dotPitch = useTransform(camera.scale, (s) => {
    if (!Number.isFinite(s) || s <= 0) return 24
    let p = 24 * s
    for (let i = 0; i < 12 && p < 14; i++) p *= 2
    for (let i = 0; i < 12 && p > 56; i++) p /= 2
    return p
  })
  const bgSize = useMotionTemplate`${dotPitch}px ${dotPitch}px`
  const bgPos = useMotionTemplate`${camera.x}px ${camera.y}px`

  const contentBounds = useCallback(
    (id: string): Rect => boundsOf(index.children.get(id) ?? []),
    [index],
  )

  const fitCamera = useCallback((id: string) => camera.fitFor(contentBounds(id)), [camera, contentBounds])

  /** Camera at which a board card covers the whole viewport. */
  const coverCamera = useCallback(
    (node: SceneNode): CameraState => {
      const { width, height } = camera.viewportSize()
      const s = Math.max(1, width / node.w, height / node.h) * 1.04
      return { scale: s, x: width / 2 - (node.x + node.w / 2) * s, y: height / 2 - (node.y + node.h / 2) * s }
    },
    [camera],
  )

  // ---------- initial layout ----------
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    const fit = fitCamera(scene.rootBoardId)
    setLod(lodForScale(fit.scale))
    if (reduced) {
      camera.set(fit)
      worldOpacity.jump(1)
      return
    }
    camera.set({ ...fit, scale: fit.scale * 0.8, x: fit.x + (camera.viewportSize().width * 0.1), y: fit.y + camera.viewportSize().height * 0.1 })
    void camera.animateTo(fit, MOTION.arrive)
    animate(worldOpacity, 1, { duration: 0.3 })
  }, [camera, fitCamera, reduced, scene.rootBoardId, worldOpacity])

  // ---------- navigation ----------
  const enterBoard = useCallback(
    async (childId: string) => {
      if (phaseRef.current !== "idle") return
      const child = index.byId.get(childId)
      if (!child || child.type !== "board" || child.parentId !== boardId) return
      phaseRef.current = "entering"
      setPhase("entering")
      setSelectedId(null)
      savedCameras.current.set(boardId, camera.get())
      const depth = path.length

      if (reduced) {
        await Promise.race([animate(worldOpacity, 0, { duration: MOTION.reducedFade / 2 }).finished, wait(100)])
        setFloorDepth(depth)
        setBoardId(childId)
        const fit = fitCamera(childId)
        camera.set(fit)
        setLod(lodForScale(fit.scale))
        await Promise.race([animate(worldOpacity, 1, { duration: MOTION.reducedFade }).finished, wait(180)])
      } else {
        // 1. Dive: camera flies into the card; its stack layers slide away and the
        //    face fades to the floor colour of the level inside.
        setDiveTarget(childId)
        setFloorDepth(depth)
        dive.jump(0)
        const cover = coverCamera(child)
        await Promise.race([
          Promise.all([camera.animateTo(cover, MOTION.camera), animate(dive, 1, MOTION.camera).finished]),
          wait(720),
        ])
        // 2. Swap coordinate systems while the screen is the inner floor.
        worldOpacity.jump(0)
        setBoardId(childId)
        setDiveTarget(null)
        dive.jump(0)
        const fit = fitCamera(childId)
        const { width, height } = camera.viewportSize()
        const k = 0.72
        camera.set({ scale: fit.scale * k, x: width / 2 - (width / 2 - fit.x) * k, y: height / 2 - (height / 2 - fit.y) * k })
        setLod(lodForScale(fit.scale))
        // 3. Arrive: the new board's content rushes up toward you.
        await nextFrame()
        animate(worldOpacity, 1, { duration: 0.22, ease: "easeOut" })
        await Promise.race([camera.animateTo(fit, MOTION.arrive), wait(650)])
      }
      setAnnouncement(`Opened ${child.content.title}`)
      phaseRef.current = "idle"
      setPhase("idle")
      setLod(lodForScale(camera.scale.get()))
    },
    [boardId, camera, coverCamera, dive, fitCamera, index, path.length, reduced, worldOpacity],
  )

  const leaveTo = useCallback(
    async (depth: number) => {
      if (phaseRef.current !== "idle" || depth >= path.length - 1 || depth < 0) return
      const ancestor = path[depth]
      const via = path[depth + 1] // the board card in `ancestor` we climb back out of
      phaseRef.current = "leaving"
      setPhase("leaving")
      setSelectedId(null)
      const target = savedCameras.current.get(ancestor.id) ?? fitCamera(ancestor.id)

      if (reduced) {
        await Promise.race([animate(worldOpacity, 0, { duration: MOTION.reducedFade / 2 }).finished, wait(100)])
        setFloorDepth(depth)
        setBoardId(ancestor.id)
        camera.set(target)
        setLod(lodForScale(target.scale))
        await Promise.race([animate(worldOpacity, 1, { duration: MOTION.reducedFade }).finished, wait(180)])
      } else {
        // 1. The current board's content recedes away from you.
        const cur = camera.get()
        const { width, height } = camera.viewportSize()
        const k = 0.72
        await Promise.race([
          Promise.all([
            camera.animateTo({ scale: cur.scale * k, x: width / 2 - (width / 2 - cur.x) * k, y: height / 2 - (height / 2 - cur.y) * k }, { type: "tween", duration: 0.22, ease: "easeIn" }),
            animate(worldOpacity, 0, { duration: 0.2, ease: "easeIn" }).finished,
          ]),
          wait(260),
        ])
        // 2. Swap to the ancestor with the card we came out of filling the screen.
        setBoardId(ancestor.id)
        setDiveTarget(via.id)
        dive.jump(1)
        camera.set(coverCamera(via))
        await nextFrame()
        worldOpacity.jump(1)
        setFloorDepth(depth)
        // 3. Fly back out: the stack layers slide back under the card.
        await Promise.race([
          Promise.all([camera.animateTo(target, MOTION.camera), animate(dive, 0, MOTION.camera).finished]),
          wait(760),
        ])
        dive.jump(0)
        setDiveTarget(null)
      }
      setSelectedId(via.id)
      setAnnouncement(`Back to ${ancestor.content.title}`)
      phaseRef.current = "idle"
      setPhase("idle")
      setLod(lodForScale(camera.scale.get()))
    },
    [camera, coverCamera, dive, fitCamera, path, reduced, worldOpacity],
  )

  const goBack = useCallback(() => void leaveTo(path.length - 2), [leaveTo, path.length])

  // ---------- zoom controls ----------
  const zoomBy = useCallback(
    (factor: number) => {
      if (phaseRef.current !== "idle") return
      const { width, height } = camera.viewportSize()
      camera.zoomAt(width / 2, height / 2, factor, reduced ? undefined : MOTION.zoom)
    },
    [camera, reduced],
  )
  const fitBoard = useCallback(() => {
    if (phaseRef.current !== "idle") return
    const fit = fitCamera(boardId)
    if (reduced) camera.set(fit)
    else void camera.animateTo(fit, MOTION.zoom)
  }, [boardId, camera, fitCamera, reduced])

  // ---------- wheel: scroll pans, Ctrl/Cmd + wheel (and pinch) zooms at the pointer ----------
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (phaseRef.current !== "idle") return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const factor = Math.exp(-e.deltaY * unit * ZOOM.wheelSensitivity)
        camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        camera.panBy(-dx * unit, -dy * unit)
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [camera])

  // Safari trackpad pinch arrives as gesture events; keep the page from zooming.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener("gesturestart", stop)
    document.addEventListener("gesturechange", stop)
    return () => {
      document.removeEventListener("gesturestart", stop)
      document.removeEventListener("gesturechange", stop)
    }
  }, [])

  // ---------- pan by dragging the empty floor ----------
  const panRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const onFloorPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    if (phaseRef.current !== "idle") return
    camera.stop()
    e.currentTarget.setPointerCapture(e.pointerId)
    panRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    setPanning(true)
    setSelectedId(null)
    viewportRef.current?.focus({ preventScroll: true })
  }
  const onFloorPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = panRef.current
    if (!p || p.id !== e.pointerId) return
    camera.panBy(e.clientX - p.x, e.clientY - p.y)
    p.x = e.clientX
    p.y = e.clientY
  }
  const onFloorPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.id !== e.pointerId) return
    panRef.current = null
    setPanning(false)
  }

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if (e.key === "Escape") {
        if (path.length > 1) {
          e.preventDefault()
          goBack()
        } else setSelectedId(null)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "+" || e.key === "=") zoomBy(ZOOM.step)
      else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM.step)
      else if (e.key === "0") fitBoard()
      else if (t?.closest(".zb-node, button, nav")) return
      else if (e.key === "ArrowLeft") camera.panBy(ZOOM.keyPan, 0)
      else if (e.key === "ArrowRight") camera.panBy(-ZOOM.keyPan, 0)
      else if (e.key === "ArrowUp") camera.panBy(0, ZOOM.keyPan)
      else if (e.key === "ArrowDown") camera.panBy(0, -ZOOM.keyPan)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [camera, fitBoard, goBack, path.length, zoomBy])

  /** Keep a keyboard-focused card on screen. */
  const ensureVisible = useCallback(
    (id: string) => {
      const n = index.byId.get(id)
      if (!n || phaseRef.current !== "idle") return
      setSelectedId(id)
      const { scale, x, y } = camera.get()
      const { width, height } = camera.viewportSize()
      const sx = n.x * scale + x, sy = n.y * scale + y
      const pad = 80
      if (sx > pad && sy > pad && sx + n.w * scale < width - pad && sy + n.h * scale < height - pad) return
      const target = { scale, x: width / 2 - (n.x + n.w / 2) * scale, y: height / 2 - (n.y + n.h / 2) * scale }
      if (reduced) camera.set(target)
      else void camera.animateTo(target, MOTION.zoom)
    },
    [camera, index, reduced],
  )

  const moveNode = useCallback((id: string, x: number, y: number) => onMoveNode(id, x, y), [onMoveNode])
  const busy = phase !== "idle"

  // Paint order: boards first so prints and notes can overlap them; the dive target goes on top.
  const ordered = useMemo(() => {
    const rank = (n: SceneNode) => (n.id === diveTarget ? 3 : n.type === "board" ? 0 : n.type === "image" ? 1 : 2)
    return [...children].sort((a, b) => rank(a) - rank(b))
  }, [children, diveTarget])

  return (
    <div className="absolute inset-0">
      <motion.div
        ref={viewportRef}
        className={`zb-viewport${panning ? " is-panning" : ""}`}
        style={{ ["--floor" as string]: floorFor(floorDepth), backgroundSize: bgSize, backgroundPosition: bgPos }}
        tabIndex={-1}
        role="region"
        aria-roledescription="zoomable board"
        aria-label={`${currentBoard?.content.title ?? "Board"} — drag to pan, Ctrl or Cmd and scroll to zoom`}
        onPointerDown={onFloorPointerDown}
        onPointerMove={onFloorPointerMove}
        onPointerUp={onFloorPointerUp}
        onPointerCancel={onFloorPointerUp}
      >
        <motion.div
          className="zb-world"
          style={{
            x: camera.x,
            y: camera.y,
            scale: camera.scale,
            opacity: worldOpacity,
            ["--zb-scale" as string]: camera.scale,
            willChange: busy ? "transform" : undefined,
          }}
        >
          {ordered.map((node) => (
            <SpatialNode
              key={node.id}
              node={node}
              scale={camera.scale}
              opacity={diveTarget && node.id !== diveTarget ? siblingOpacity : undefined}
              label={labelFor(node)}
              disabled={busy}
              onSelect={setSelectedId}
              onMove={moveNode}
              onOpen={enterBoard}
              onKeyboardFocus={ensureVisible}
            >
              {(tactile) => renderCard(node, tactile)}
            </SpatialNode>
          ))}
        </motion.div>
      </motion.div>

      <div className="zb-chrome-tl">
        <Breadcrumbs
          path={path.map((b) => ({ id: b.id, title: b.content.title }))}
          onNavigate={(_, depth) => void leaveTo(depth)}
          onBack={path.length > 1 ? goBack : undefined}
        />
      </div>
      <div className="zb-chrome-br">
        <ZoomBadge level={lod} />
        <ZoomControls scale={camera.scale} onZoomIn={() => zoomBy(ZOOM.step)} onZoomOut={() => zoomBy(1 / ZOOM.step)} onFit={fitBoard} />
      </div>
      <div className="zb-chrome-bl" aria-hidden>
        <div className="zb-hint">
          Drag to pan · <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + scroll to zoom · double-click a board to open
        </div>
      </div>
      <div className="sr-only-zb" aria-live="polite">
        {announcement}
      </div>
    </div>
  )

  function labelFor(node: SceneNode): string {
    if (node.type === "board") return `Board: ${node.content.title}. Press Enter to open.`
    if (node.type === "image") return `Image: ${node.content.title}`
    return `Note: ${node.content.title}`
  }

  function renderCard(node: SceneNode, tactile: Parameters<typeof BoardCard>[0]["tactile"]) {
    const selected = selectedId === node.id
    if (node.type === "image")
      return <ImageCard title={node.content.title} alt={node.content.alt} src={node.content.src} lod={lod} selected={selected} tactile={tactile} reduced={reduced} />
    if (node.type === "note")
      return <NoteCard title={node.content.title} body={node.content.body} lod={lod} selected={selected} tactile={tactile} reduced={reduced} />
    const b = node as BoardNode
    return (
      <BoardCard
        title={b.content.title}
        description={b.content.description}
        count={index.children.get(b.id)?.length ?? 0}
        preview={previewImages(index, b.id).map((i) => ({ src: i.content.src, alt: i.content.alt }))}
        lod={lod}
        selected={selected}
        tactile={tactile}
        reduced={reduced}
        dive={node.id === diveTarget ? dive : undefined}
        innerFloor={floorFor(path.length)}
        onOpen={() => void enterBoard(b.id)}
      />
    )
  }
}
