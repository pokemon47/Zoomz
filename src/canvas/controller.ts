import { animate, type AnimationPlaybackControls } from 'motion'
import type { ImageNode, Point, Rect, Scene, SceneNode } from '../../shared/scene'
import { contentBounds, entryReady, exitReady, fitContent, frameElement, navigationAllowed, recordWheel, screenToWorld, worldToScreen, zoomAt, type Camera, type NavGuard, type Size } from '../lib/camera'
import { contains, SceneLayout, transferPlacement, type LayerCommand, type LayoutState } from '../lib/layout'
import type { DisplayPreferences, SavedState } from '../lib/storage'
import { SceneRenderer, type RenderState } from './renderer'

type PanGesture = { kind: 'pan'; pointerId: number; start: Point; camera: Camera; moved: boolean }
type NodeGesture = { kind: 'node'; pointerId: number; start: Point; pointer: Point; node: SceneNode; parentId: string; rect: Rect; scale: number; grab: Point; before: LayoutState; moved: boolean; edgeUsed: boolean }
type Gesture = PanGesture | NodeGesture
type Ghost = NonNullable<RenderState['ghost']>
export type WorkspaceInfo = { boardId: string; path: { id: string; title: string }[]; nodes: SceneNode[]; selected: SceneNode | null; zoom: number; dragHint: string }
export type WorkspaceCallbacks = { change: (info: WorkspaceInfo) => void; save: (layout: LayoutState) => void; openImage: (image: ImageNode) => void }

export class WorkspaceController {
  readonly layout: SceneLayout
  readonly renderer: SceneRenderer
  private camera: Camera = { x: 0, y: 0, scale: 1 }
  private target = this.camera
  private size: Size = { width: 1, height: 1 }
  private origin = { x: 0, y: 0 }
  private boardId: string
  private returns = new Map<string, Camera>()
  private selected: string | null = null
  private hovered: string | null = null
  private gesture: Gesture | null = null
  private ghost: Ghost | null = null
  private destination: RenderState['destination'] = null
  private edgeTimer: ReturnType<typeof setTimeout> | null = null
  private dragHint = ''
  private space = false
  private animation: AnimationPlaybackControls | null = null
  private settling: AnimationPlaybackControls | null = null
  private raf = 0
  private lastNotify = 0
  private guard: NavGuard = { lastTransitionAt: -Infinity, lastWheelAt: -Infinity, consumedDirection: 0 }
  private wheelPermit = false
  private wheelDirection = 0
  private pointer: Point = { x: 0, y: 0 }
  private resizeObserver: ResizeObserver
  private mapCamera: Camera = { x: 0, y: 0, scale: 1 }
  private disposed = false
  private lastReleaseWasDrag = false
  private burstCamera = this.camera
  private display: DisplayPreferences

  constructor(private canvas: HTMLCanvasElement, private minimap: HTMLCanvasElement, private scene: Scene, saved: SavedState, private reduced: boolean, private callbacks: WorkspaceCallbacks) {
    this.boardId = scene.rootId
    this.layout = new SceneLayout(scene, saved.layout)
    this.renderer = new SceneRenderer(this.layout, this.invalidate)
    this.display = { showCaptions: saved.showCaptions, showImageBorders: saved.showImageBorders }
    canvas.addEventListener('wheel', this.wheel, { passive: false })
    canvas.addEventListener('pointerdown', this.pointerDown)
    canvas.addEventListener('pointermove', this.pointerMove)
    canvas.addEventListener('pointerup', this.pointerUp)
    canvas.addEventListener('pointercancel', this.pointerCancel)
    canvas.addEventListener('dblclick', this.doubleClick)
    canvas.addEventListener('pointerleave', this.pointerLeave)
    window.addEventListener('keydown', this.keyDown)
    window.addEventListener('keyup', this.keyUp)
    window.addEventListener('blur', this.blur)
    minimap.addEventListener('pointerdown', this.mapClick)
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize(); this.fit(false)
  }

  get nodes() { return this.layout.nodes(this.boardId) }
  private get bounds() { return contentBounds(this.nodes) }
  private get fitCamera() { return fitContent(this.bounds, this.size, Math.max(80, Math.min(this.size.width, this.size.height) * 0.055)) }
  private get rootCamera() { return this.layout.cameraIn(this.camera, this.boardId, this.scene.rootId) }
  private point(event: MouseEvent): Point { return { x: event.clientX - this.origin.x, y: event.clientY - this.origin.y } }
  private hit(point: Point, skip?: string) { return this.layout.hit(this.scene.rootId, point, this.rootCamera, this.boardId, skip) }
  private stop() { this.animation?.stop(); this.animation = null; this.target = { ...this.camera }; this.wheelPermit = false }
  private save() { this.callbacks.save(this.layout.snapshot()) }
  private rebase(id: string) {
    if (id === this.boardId) return
    const from = this.boardId
    this.camera = this.layout.cameraIn(this.camera, from, id)
    this.target = this.layout.cameraIn(this.target, from, id)
    this.burstCamera = this.layout.cameraIn(this.burstCamera, from, id)
    this.boardId = id
    this.notify(true); this.invalidate()
  }
  private notify(force = false) {
    const now = performance.now()
    if (!force && now - this.lastNotify < 100) return
    this.lastNotify = now
    const path = this.layout.path(this.boardId).map(id => ({ id, title: this.layout.boards.get(id)?.title ?? id }))
    this.callbacks.change({ boardId: this.boardId, path, nodes: this.nodes, selected: this.selected ? this.layout.node(this.selected) ?? null : null, zoom: this.camera.scale, dragHint: this.dragHint })
  }
  invalidate = () => {
    if (this.raf || this.disposed) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); if (this.renderer.needsFrame) this.invalidate() })
  }
  private draw() {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const state: RenderState = { ...this.display, boardId: this.boardId, camera: this.camera, selected: this.selected, hovered: this.hovered, reduced: this.reduced, ghost: this.ghost, destination: this.destination }
    this.canvas.dataset.boardId = this.boardId
    this.canvas.dataset.camera = JSON.stringify(this.camera)
    this.canvas.dataset.dragging = this.gesture?.kind === 'node' && this.gesture.moved ? this.gesture.node.id : ''
    this.canvas.dataset.dragRect = this.ghost ? JSON.stringify(this.ghost.rect) : ''
    this.renderer.draw(ctx, this.size, Math.min(devicePixelRatio || 1, 2), state)
    this.drawMap(); this.notify()
  }
  private resize = () => {
    const rect = this.canvas.getBoundingClientRect(), previous = this.size
    this.origin = { x: rect.left, y: rect.top }
    this.size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
    const dpr = Math.min(devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(this.size.width * dpr); this.canvas.height = Math.round(this.size.height * dpr)
    this.minimap.width = Math.round(212 * dpr); this.minimap.height = Math.round(132 * dpr)
    if (previous.width > 1) {
      this.pointerCancel(); this.stop()
      this.camera = { ...this.camera, x: this.camera.x + (this.size.width - previous.width) / 2, y: this.camera.y + (this.size.height - previous.height) / 2 }
      this.target = this.camera
    }
    this.invalidate()
  }
  private travel(target: Camera, wheel = false) {
    this.animation?.stop(); this.target = target
    const from = { ...this.camera }
    const distance = Math.hypot(target.x - from.x, target.y - from.y)
    if (distance < 0.3 && Math.abs(target.scale - from.scale) < 0.0001) { this.camera = target; this.invalidate(); if (wheel && this.wheelPermit) this.checkNavigation(); return }
    const duration = this.reduced ? 0.065 : wheel ? 0.115 : Math.min(0.46, 0.22 + Math.abs(Math.log(target.scale / from.scale)) * 0.06 + distance / 16000)
    this.animation = animate(0, 1, {
      duration, ease: wheel ? [0.15, 0.7, 0.25, 1] : [0.22, 0.68, 0.18, 1],
      onUpdate: progress => {
        const scale = from.scale * Math.pow(target.scale / from.scale, progress)
        const mix = Math.abs(target.scale - from.scale) < 1e-8 ? progress : (scale - from.scale) / (target.scale - from.scale)
        this.camera = { x: from.x + (target.x - from.x) * mix, y: from.y + (target.y - from.y) * mix, scale }
        if (this.gesture?.kind === 'node' && this.gesture.moved) this.updateDestination(this.gesture)
        this.invalidate()
        if (wheel && this.wheelPermit) this.checkNavigation()
      },
      onComplete: () => this.notify(true),
    })
  }
  fit(animated = true) { this.stop(); if (animated) this.travel(this.fitCamera); else { this.camera = this.fitCamera; this.target = this.camera; this.invalidate(); this.notify(true) } }
  zoom(direction: number) { this.stop(); this.travel(zoomAt(this.camera, { x: this.size.width / 2, y: this.size.height / 2 }, Math.pow(1.32, direction))) }
  setReduced(value: boolean) { this.reduced = value; this.stop(); this.invalidate() }
  setDisplay(display: DisplayPreferences) { this.display = display; this.invalidate() }
  clearSelection() { this.selected = null; this.notify(true); this.invalidate() }
  private wheel = (event: WheelEvent) => {
    event.preventDefault()
    if (this.gesture) return
    const now = performance.now(), direction = Math.sign(-event.deltaY)
    if (!direction) return
    const pointer = this.point(event), hit = this.hit(pointer)
    const insideActive = contains({ x: 0, y: 0, width: 1200, height: 850 }, screenToWorld(pointer, this.camera))
    if (hit && !insideActive && !this.layout.path(hit.parentId).includes(this.boardId)) { this.stop(); this.rebase(hit.parentId) }
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.size.height : 1
    const delta = Math.max(-160, Math.min(160, event.deltaY * factor))
    const sameAnchor = Math.hypot(pointer.x - this.pointer.x, pointer.y - this.pointer.y) < 2
    const continuing = this.wheelDirection === direction && now - this.guard.lastWheelAt < 200
    if (!continuing) this.burstCamera = { ...this.camera }
    const base = continuing && sameAnchor ? this.target : this.camera
    this.pointer = pointer; this.guard = recordWheel(this.guard, now, direction)
    this.wheelPermit = navigationAllowed(this.guard, now, direction); this.wheelDirection = direction
    const next = zoomAt(base, pointer, Math.exp(-delta * 0.0025))
    if (this.boardId === this.scene.rootId && next.scale < this.fitCamera.scale * 0.35) return
    this.travel(next, true)
  }
  private checkNavigation() {
    const hit = this.hit(this.pointer)
    const destination = this.layout.boardAt(this.pointer, this.rootCamera)
    const targetId = hit?.node.kind === 'board' ? hit.node.boardId : destination.boardId
    const path = this.layout.path(targetId), index = path.indexOf(this.boardId)
    const nextId = index >= 0 ? path[index + 1] : undefined
    const frame = nextId ? this.layout.frameNode(nextId) : undefined
    if (frame && entryReady(frame, this.camera, this.size, this.pointer, this.wheelDirection)) {
      const target = this.layout.cameraIn(this.target, this.boardId, frame.boardId)
      this.enter(frame.boardId, false); this.travel(target, true)
    } else if (this.boardId !== this.scene.rootId && exitReady(this.camera.scale, this.fitCamera.scale, this.wheelDirection)) {
      const node = this.layout.frameNode(this.boardId)
      if (node) {
        const parent = this.layout.parentOf(node.id), target = this.layout.cameraIn(this.target, this.boardId, parent)
        this.stop(); this.rebase(parent); this.lockNavigation(); this.travel(target, true)
      }
    }
  }
  private lockNavigation() { this.guard.lastTransitionAt = performance.now(); this.guard.consumedDirection = this.wheelDirection; this.wheelPermit = false; this.hovered = null; this.selected = null; this.notify(true); this.invalidate() }
  private enter(id: string, animated = true) {
    this.returns.set(id, animated ? { ...this.camera } : { ...this.burstCamera })
    this.stop(); this.rebase(id); this.lockNavigation()
    if (animated) this.travel(this.fitCamera)
  }
  back() {
    const node = this.layout.frameNode(this.boardId)
    if (!node) return
    const previous = this.returns.get(this.boardId), parent = this.layout.parentOf(node.id)
    this.stop(); this.rebase(parent); this.lockNavigation(); this.travel(previous ?? this.fitCamera)
  }
  goTo(id: string) { if (!this.layout.boards.has(id)) return; this.stop(); this.rebase(id); this.travel(this.fitCamera) }
  home() { this.goTo(this.scene.rootId) }
  activate(id: string) {
    const node = this.layout.node(id)
    if (!node) return
    this.stop(); this.rebase(this.layout.parentOf(id)); this.selected = id
    if (node.kind === 'board') this.enter(node.boardId)
    else this.travel(frameElement(node.kind === 'image' ? this.renderer.imageBounds(node) : node, this.size, node.kind === 'note' ? 2.1 : 12))
    this.notify(true)
  }
  viewImage(id: string) { const node = this.layout.node(id); if (node?.kind === 'image') { this.stop(); this.callbacks.openImage(node) } }
  contextAt(clientX: number, clientY: number): string | null {
    const hit = this.hit({ x: clientX - this.origin.x, y: clientY - this.origin.y })
    if (hit) { this.stop(); this.selected = hit.node.id; this.notify(true); this.invalidate(); return hit.node.id }
    return clientX === 0 && clientY === 0 ? this.selected : null
  }
  layer(id: string, command: LayerCommand) { this.layout.layer(id, command); this.save(); this.notify(true); this.invalidate() }
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault(); this.canvas.dataset.input = 'pointer'; this.canvas.focus({ preventScroll: true }); this.stop()
    this.settling?.stop(); this.ghost = null
    const point = this.point(event), hit = this.space ? null : this.hit(point)
    if (hit) {
      this.rebase(hit.parentId)
      const top = worldToScreen(hit.node, hit.camera)
      this.gesture = { kind: 'node', pointerId: event.pointerId, start: point, pointer: point, node: hit.node, parentId: hit.parentId, rect: { ...top, width: hit.node.width * hit.camera.scale, height: hit.node.height * hit.camera.scale }, scale: hit.camera.scale, grab: { x: point.x - top.x, y: point.y - top.y }, before: this.layout.snapshot(), moved: false, edgeUsed: false }
    } else this.gesture = { kind: 'pan', pointerId: event.pointerId, start: point, camera: { ...this.camera }, moved: false }
    this.canvas.setPointerCapture(event.pointerId); this.canvas.style.cursor = 'grabbing'
  }
  private pointerMove = (event: PointerEvent) => {
    const point = this.point(event), gesture = this.gesture
    if (!gesture) { const hit = this.hit(point); if (this.hovered !== hit?.node.id) { this.hovered = hit?.node.id ?? null; this.invalidate() }; this.canvas.style.cursor = this.space ? 'grab' : hit ? 'pointer' : 'grab'; return }
    const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y
    if (!gesture.moved && Math.hypot(dx, dy) < 5) return
    if (gesture.kind === 'pan') {
      gesture.moved = true; this.camera = { ...gesture.camera, x: gesture.camera.x + dx, y: gesture.camera.y + dy }; this.target = this.camera
    } else {
      const previousHint = this.dragHint
      if (!gesture.moved) { gesture.moved = true; this.layout.layer(gesture.node.id, 'front'); this.selected = gesture.node.id }
      gesture.pointer = point; gesture.rect.x = point.x - gesture.grab.x; gesture.rect.y = point.y - gesture.grab.y
      this.ghost = { node: gesture.node, rect: gesture.rect, scale: gesture.scale }
      this.updateDestination(gesture); this.edgeAssist(gesture)
      if (previousHint !== this.dragHint) this.notify(true)
    }
    this.invalidate()
  }
  private updateDestination(gesture: NodeGesture) {
    this.destination = this.layout.boardAt(gesture.pointer, this.rootCamera, gesture.node.id)
    this.dragHint = this.destination.valid ? this.destination.boardId === gesture.parentId ? '' : `Move to ${this.layout.boards.get(this.destination.boardId)?.title ?? 'board'}` : 'This board cannot contain itself or its parent'
  }
  private clearEdge() { if (this.edgeTimer) clearTimeout(this.edgeTimer); this.edgeTimer = null }
  private edgeAssist(gesture: NodeGesture) {
    const edge = gesture.pointer.x < 32 || gesture.pointer.y < 32 || gesture.pointer.x > this.size.width - 32 || gesture.pointer.y > this.size.height - 32
    const frame = this.layout.frameNode(this.boardId)
    if (!edge || !frame || gesture.edgeUsed) { this.clearEdge(); return }
    this.dragHint = `Hold at edge to reveal ${this.layout.boards.get(this.layout.parentOf(frame.id))?.title ?? 'parent board'}`
    if (this.edgeTimer) return
    this.edgeTimer = setTimeout(() => {
      this.edgeTimer = null
      if (this.gesture !== gesture) return
      gesture.edgeUsed = true; this.stop(); this.rebase(this.layout.parentOf(frame.id)); this.travel(this.fitCamera)
      this.dragHint = 'Parent revealed. Continue dragging to place the item.'; this.notify(true)
    }, 650)
  }
  private pointerUp = (event: PointerEvent) => {
    const gesture = this.gesture
    if (!gesture || gesture.pointerId !== event.pointerId) return
    this.clearEdge()
    if (!gesture.moved) this.selected = gesture.kind === 'node' ? gesture.node.id : null
    else if (gesture.kind === 'node') this.drop(gesture)
    else this.leaveBoundary()
    this.lastReleaseWasDrag = gesture.moved
    this.gesture = null; this.destination = null; this.dragHint = ''
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    this.canvas.style.cursor = 'grab'; this.notify(true); this.invalidate()
  }
  private drop(gesture: NodeGesture) {
    this.stop()
    const destination = this.layout.boardAt(gesture.pointer, this.rootCamera, gesture.node.id)
    if (!destination.valid) { this.layout.restore(gesture.before); this.ghost = null; return }
    const local = screenToWorld(gesture.rect, destination.camera)
    const placement = destination.boardId === gesture.parentId ? { width: gesture.node.width, height: gesture.node.height, x: local.x, y: local.y, parentId: gesture.parentId } : transferPlacement(gesture.node, gesture.rect, destination.camera, destination.boardId, destination.boardId === this.scene.rootId)
    this.layout.transfer(gesture.node.id, placement); this.save()
    const start = { ...gesture.rect }, end = { ...worldToScreen(placement, destination.camera), width: placement.width * destination.camera.scale, height: placement.height * destination.camera.scale }
    if (Math.hypot(start.x - end.x, start.y - end.y, start.width - end.width, start.height - end.height) < 0.3) { this.ghost = null; return }
    const startLocal = screenToWorld(start, destination.camera), startWidth = start.width / destination.camera.scale, startHeight = start.height / destination.camera.scale
    const startScale = gesture.scale / destination.camera.scale
    this.settling = animate(0, 1, { duration: this.reduced ? 0.04 : 0.18, ease: [0.2, 0.75, 0.25, 1], onUpdate: mix => {
      const camera = this.layout.cameraIn(this.camera, this.boardId, destination.boardId)
      const position = worldToScreen({ x: startLocal.x + (placement.x - startLocal.x) * mix, y: startLocal.y + (placement.y - startLocal.y) * mix }, camera)
      this.ghost = { node: gesture.node, rect: { ...position, width: (startWidth + (placement.width - startWidth) * mix) * camera.scale, height: (startHeight + (placement.height - startHeight) * mix) * camera.scale }, scale: (startScale + (1 - startScale) * mix) * camera.scale }; this.invalidate()
    }, onComplete: () => { this.ghost = null; this.invalidate() } })
  }
  private leaveBoundary() {
    if (this.boardId === this.scene.rootId) return
    const centre = { x: this.size.width / 2, y: this.size.height / 2 }
    if (!contains({ x: 0, y: 0, width: 1200, height: 850 }, screenToWorld(centre, this.camera))) {
      const current = this.layout.path(this.boardId), destination = this.layout.path(this.layout.boardAt(centre, this.rootCamera).boardId)
      let ancestor = this.scene.rootId
      for (let i = 0; i < Math.min(current.length, destination.length) && current[i] === destination[i]; i++) ancestor = current[i]
      this.rebase(ancestor)
    }
  }
  private pointerCancel = () => {
    const gesture = this.gesture
    this.clearEdge(); this.settling?.stop(); this.settling = null
    if (gesture?.kind === 'node') this.layout.restore(gesture.before)
    if (gesture && this.canvas.hasPointerCapture(gesture.pointerId)) this.canvas.releasePointerCapture(gesture.pointerId)
    this.gesture = null; this.ghost = null; this.destination = null; this.dragHint = ''; this.canvas.style.cursor = 'grab'; this.invalidate(); this.notify(true)
  }
  private doubleClick = (event: MouseEvent) => { event.preventDefault(); if (this.space || this.lastReleaseWasDrag) return; const hit = this.hit(this.point(event)); if (hit) this.activate(hit.node.id) }
  private pointerLeave = () => { this.hovered = null; this.invalidate() }
  private keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab' || event.target === this.canvas) this.canvas.dataset.input = 'keyboard'
    if (event.key === 'Escape') {
      if (this.gesture) { this.stop(); this.pointerCancel(); return }
      if (!(event.target instanceof Element) || !event.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) this.clearSelection()
      return
    }
    if (event.code === 'Space' && (!(event.target instanceof Element) || !event.target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"]'))) {
      this.space = true
      if (event.target === this.canvas || event.target === document.body) event.preventDefault()
      return
    }
    if (event.target !== this.canvas) return
    if (event.key === '+' || event.key === '=') this.zoom(1)
    if (event.key === '-') this.zoom(-1)
    if (event.key === '0') this.fit()
  }
  private keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') this.space = false }
  private blur = () => { this.space = false; this.pointerCancel(); this.stop() }
  private drawMap() {
    const ctx = this.minimap.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(devicePixelRatio || 1, 2)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, 212, 132)
    const overview = this.fitCamera, corner = screenToWorld({ x: 0, y: 0 }, overview), bounds = this.bounds
    const left = Math.min(bounds.x, corner.x), topEdge = Math.min(bounds.y, corner.y)
    const right = Math.max(bounds.x + bounds.width, corner.x + this.size.width / overview.scale), bottom = Math.max(bounds.y + bounds.height, corner.y + this.size.height / overview.scale)
    this.mapCamera = fitContent({ x: left, y: topEdge, width: right - left, height: bottom - topEdge }, { width: 212, height: 132 }, 13)
    for (const node of this.nodes) {
      if (node.id === this.ghost?.node.id) continue
      const p = worldToScreen(node, this.mapCamera)
      ctx.fillStyle = node.id === this.selected ? '#829170' : node.kind === 'board' ? '#c1c8b4' : node.kind === 'note' ? '#dfd2b9' : '#d7d4ca'
      ctx.beginPath(); ctx.roundRect(p.x, p.y, Math.max(1, node.width * this.mapCamera.scale), Math.max(1, node.height * this.mapCamera.scale), 2); ctx.fill()
    }
    if (this.ghost) {
      const point = worldToScreen(screenToWorld(this.ghost.rect, this.camera), this.mapCamera)
      ctx.fillStyle = '#829170'
      ctx.fillRect(point.x, point.y, this.ghost.rect.width / this.camera.scale * this.mapCamera.scale, this.ghost.rect.height / this.camera.scale * this.mapCamera.scale)
    }
    const top = worldToScreen(screenToWorld({ x: 0, y: 0 }, this.camera), this.mapCamera), width = this.size.width / this.camera.scale * this.mapCamera.scale, height = this.size.height / this.camera.scale * this.mapCamera.scale
    ctx.fillStyle = '#7e8e6820'; ctx.fillRect(top.x, top.y, width, height)
    ctx.strokeStyle = '#6f8159'; ctx.lineWidth = 1.5; ctx.strokeRect(top.x + 0.75, top.y + 0.75, width - 1.5, height - 1.5)
  }
  private mapClick = (event: PointerEvent) => {
    event.preventDefault(); this.stop()
    const rect = this.minimap.getBoundingClientRect(), point = screenToWorld({ x: (event.clientX - rect.left) * 212 / rect.width, y: (event.clientY - rect.top) * 132 / rect.height }, this.mapCamera)
    this.travel({ ...this.camera, x: this.size.width / 2 - point.x * this.camera.scale, y: this.size.height / 2 - point.y * this.camera.scale })
  }
  reset() { this.pointerCancel(); this.settling?.stop(); this.layout.restore({ placements: {}, order: {} }); this.selected = null; this.returns.clear(); this.boardId = this.scene.rootId; this.stop(); this.fit(false) }
  dispose() {
    this.disposed = true; this.clearEdge(); this.stop(); this.settling?.stop(); cancelAnimationFrame(this.raf); this.resizeObserver.disconnect(); this.renderer.dispose()
    this.canvas.removeEventListener('wheel', this.wheel); this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('pointerup', this.pointerUp); this.canvas.removeEventListener('pointercancel', this.pointerCancel); this.canvas.removeEventListener('dblclick', this.doubleClick); this.canvas.removeEventListener('pointerleave', this.pointerLeave)
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.blur); this.minimap.removeEventListener('pointerdown', this.mapClick)
  }
}
