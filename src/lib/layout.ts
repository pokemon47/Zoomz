import type { BoardNode, Point, Rect, Scene, SceneNode } from '../../shared/scene'
import { childFrame, intoChild, intoParent, screenToWorld, type Camera, type Frame } from './camera'

export type Placement = Rect & { parentId: string }
export type LayoutState = { placements: Record<string, Placement>; order: Record<string, string[]> }
export type LayerCommand = 'front' | 'forward' | 'backward' | 'back'
export type Hit = { node: SceneNode; parentId: string; camera: Camera }

export const contains = (rect: Rect, point: Point) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height

export class SceneLayout {
  readonly boards
  private originals = new Map<string, SceneNode>()
  private originalParents = new Map<string, string>()
  private state: LayoutState
  constructor(readonly scene: Scene, state: LayoutState = { placements: {}, order: {} }) {
    this.boards = new Map(scene.boards.map(board => [board.id, board]))
    for (const board of scene.boards) for (const node of board.nodes) { this.originals.set(node.id, node); this.originalParents.set(node.id, board.id) }
    this.state = { placements: { ...state.placements }, order: { ...state.order } }
  }
  node(id: string): SceneNode | undefined { const node = this.originals.get(id); return node ? { ...node, ...this.state.placements[id] } : undefined }
  parentOf(id: string): string { return this.state.placements[id]?.parentId ?? this.originalParents.get(id) ?? this.scene.rootId }
  nodes(boardId: string): SceneNode[] {
    const nodes: SceneNode[] = []
    for (const [id] of this.originals) if (this.parentOf(id) === boardId) { const node = this.node(id); if (node) nodes.push(node) }
    const order = this.state.order[boardId] ?? []
    const index = new Map(order.map((id, i) => [id, i]))
    return nodes.sort((a, b) => (index.get(a.id) ?? -1) - (index.get(b.id) ?? -1))
  }
  frameNode(boardId: string): BoardNode | undefined {
    for (const [id, original] of this.originals) if (original.kind === 'board' && original.boardId === boardId) { const node = this.node(id); if (node?.kind === 'board') return node }
  }
  path(boardId: string): string[] {
    const path = [boardId]
    let current = boardId
    while (current !== this.scene.rootId) { const frame = this.frameNode(current); if (!frame) break; current = this.parentOf(frame.id); path.unshift(current) }
    return path
  }
  rootFrame(boardId: string): Frame {
    let frame: Frame = { x: 0, y: 0, scale: 1 }
    for (const id of this.path(boardId).slice(1)) {
      const node = this.frameNode(id)
      if (!node) continue
      const local = childFrame(node)
      frame = { x: frame.x + local.x * frame.scale, y: frame.y + local.y * frame.scale, scale: frame.scale * local.scale }
    }
    return frame
  }
  cameraIn(camera: Camera, fromId: string, toId: string): Camera { return intoChild(intoParent(camera, this.rootFrame(fromId)), this.rootFrame(toId)) }
  canTransfer(id: string, destination: string): boolean {
    const node = this.node(id)
    return !!node && this.boards.has(destination) && (node.kind !== 'board' || !this.path(destination).includes(node.boardId))
  }
  placement(id: string): Placement | undefined { const node = this.node(id); return node ? { parentId: this.parentOf(id), x: node.x, y: node.y, width: node.width, height: node.height } : undefined }
  setPlacement(id: string, placement: Placement) { if (this.canTransfer(id, placement.parentId)) this.state.placements[id] = placement }
  layer(id: string, command: LayerCommand) {
    const parent = this.parentOf(id), ids = this.nodes(parent).map(node => node.id), current = ids.indexOf(id)
    if (current < 0) return
    ids.splice(current, 1)
    const index = command === 'front' ? ids.length : command === 'back' ? 0 : command === 'forward' ? Math.min(ids.length, current + 1) : Math.max(0, current - 1)
    ids.splice(index, 0, id); this.state.order[parent] = ids
  }
  transfer(id: string, placement: Placement): boolean {
    if (!this.canTransfer(id, placement.parentId)) return false
    const source = this.parentOf(id)
    this.state.order[source] = this.nodes(source).filter(node => node.id !== id).map(node => node.id)
    this.setPlacement(id, placement); this.layer(id, 'front'); return true
  }
  snapshot(): LayoutState { return { placements: structuredClone(this.state.placements), order: structuredClone(this.state.order) } }
  restore(state: LayoutState) { this.state = structuredClone(state) }
  hit(boardId: string, point: Point, camera: Camera, activeId: string, skip?: string): Hit | null {
    const local = screenToWorld(point, camera), nodes = this.nodes(boardId)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]
      if (node.id === skip || !contains(node, local)) continue
      const onActivePath = node.kind === 'board' && this.path(activeId).includes(node.boardId)
      if (node.kind === 'board' && (onActivePath || node.width * camera.scale > 600)) {
        const childCamera = intoChild(camera, childFrame(node)), inner = screenToWorld(point, childCamera)
        if (contains({ x: 0, y: 0, width: 1200, height: 850 }, inner)) {
          const nested = this.hit(node.boardId, point, childCamera, activeId, skip)
          if (nested) return nested
          if (onActivePath) return null
        }
      }
      return { node, parentId: boardId, camera }
    }
    return null
  }
  boardAt(point: Point, camera: Camera, dragged?: string, boardId = this.scene.rootId): { boardId: string; camera: Camera; valid: boolean } {
    const local = screenToWorld(point, camera), nodes = this.nodes(boardId)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]
      if (node.id === dragged || !contains(node, local)) continue
      if (node.kind === 'board') {
        const childCamera = intoChild(camera, childFrame(node)), inner = screenToWorld(point, childCamera)
        if (contains({ x: 0, y: 0, width: 1200, height: 850 }, inner)) {
          if (dragged && !this.canTransfer(dragged, node.boardId)) return { boardId: node.boardId, camera: childCamera, valid: false }
          return this.boardAt(point, childCamera, dragged, node.boardId)
        }
      }
      break
    }
    return { boardId, camera, valid: !dragged || this.canTransfer(dragged, boardId) }
  }
}

export function transferPlacement(node: SceneNode, screen: Rect, camera: Camera, destination: string, root: boolean): Placement {
  const area = root ? { width: 2300, height: 1400 } : { width: 1200, height: 850 }
  const centre = screenToWorld({ x: screen.x + screen.width / 2, y: screen.y + screen.height / 2 }, camera)
  const visualWidth = screen.width / camera.scale, visualHeight = screen.height / camera.scale
  const ratio = node.width / node.height
  let width: number, height: number
  if (node.kind === 'board') {
    const limit = Math.min(area.width * 0.55, (area.height * 0.65 - 78) * 1200 / 850 + 36)
    width = Math.max(180, Math.min(visualWidth, limit)); height = 78 + (width - 36) * 850 / 1200
  } else {
    const normalise = Math.max(1, Math.min(area.width * 0.12 / visualWidth, area.height * 0.12 / visualHeight))
    const factor = Math.min(normalise, area.width * 0.38 / visualWidth, area.height * 0.38 / visualHeight)
    width = visualWidth * factor; height = width / ratio
  }
  return { parentId: destination, x: Math.max(24, Math.min(area.width - width - 24, centre.x - width / 2)), y: Math.max(24, Math.min(area.height - height - 24, centre.y - height / 2)), width, height }
}
