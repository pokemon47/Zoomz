import type { BoardNode, Point, Rect } from '../../shared/scene'
export type Camera = { x: number; y: number; scale: number }
export type Size = { width: number; height: number }
export type Frame = { x: number; y: number; scale: number }
export type NavGuard = { lastTransitionAt: number; lastWheelAt: number; consumedDirection: number }
export const frameElement = (bounds: Rect, viewport: Size, maxScale = 12): Camera => {
  const margin = Math.min(viewport.width, viewport.height) * 0.05
  const scale = Math.max(0.035, Math.min(maxScale, Math.max(1, viewport.width - margin * 2) / Math.max(1, bounds.width), Math.max(1, viewport.height - margin * 2) / Math.max(1, bounds.height)))
  return { x: viewport.width / 2 - (bounds.x + bounds.width / 2) * scale, y: viewport.height / 2 - (bounds.y + bounds.height / 2) * scale, scale }
}
export const recordWheel = (guard: NavGuard, now: number, direction: number): NavGuard => ({ ...guard, lastWheelAt: now, consumedDirection: now - guard.lastWheelAt > 200 || guard.consumedDirection !== direction ? 0 : guard.consumedDirection })
export const worldToScreen = (point: Point, camera: Camera): Point => ({ x: camera.x + point.x * camera.scale, y: camera.y + point.y * camera.scale })
export const screenToWorld = (point: Point, camera: Camera): Point => ({ x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale })
export const zoomAt = (camera: Camera, pointer: Point, factor: number): Camera => {
  const scale = Math.max(Math.min(0.035, camera.scale), Math.min(Math.max(12, camera.scale), camera.scale * factor))
  const ratio = scale / camera.scale
  return { x: pointer.x - (pointer.x - camera.x) * ratio, y: pointer.y - (pointer.y - camera.y) * ratio, scale }
}
export const childFrame = (node: BoardNode): Frame => ({ x: node.x + 18, y: node.y + 60, scale: (node.width - 36) / 1200 })
export const intoChild = (camera: Camera, frame: Frame): Camera => ({ x: camera.x + frame.x * camera.scale, y: camera.y + frame.y * camera.scale, scale: camera.scale * frame.scale })
export const intoParent = (camera: Camera, frame: Frame): Camera => {
  const scale = camera.scale / frame.scale
  return { x: camera.x - frame.x * scale, y: camera.y - frame.y * scale, scale }
}
export const fitContent = (bounds: Rect, size: Size, padding = 72): Camera => {
  const scale = Math.max(0.035, Math.min(3, Math.max(1, size.width - padding * 2) / Math.max(1, bounds.width), Math.max(1, size.height - padding * 2) / Math.max(1, bounds.height)))
  return { x: size.width / 2 - (bounds.x + bounds.width / 2) * scale, y: size.height / 2 - (bounds.y + bounds.height / 2) * scale, scale }
}
export const contentBounds = (nodes: Rect[]): Rect => {
  if (!nodes.length) return { x: 0, y: 0, width: 1200, height: 850 }
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const node of nodes) { x = Math.min(x, node.x); y = Math.min(y, node.y); right = Math.max(right, node.x + node.width); bottom = Math.max(bottom, node.y + node.height) }
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}
export const navigationAllowed = (guard: NavGuard, now: number, direction: number): boolean => now - guard.lastTransitionAt >= 360 && (now - guard.lastWheelAt > 200 || guard.consumedDirection !== direction)
export const entryReady = (rect: Rect, camera: Camera, size: Size, pointer: Point, direction: number): boolean => {
  if (direction !== 1 || pointer.x < 32 || pointer.y < 32 || pointer.x > size.width - 32 || pointer.y > size.height - 32) return false
  const p = screenToWorld(pointer, camera)
  const inset = 12 / camera.scale
  return p.x > rect.x + inset && p.x < rect.x + rect.width - inset && p.y > rect.y + inset && p.y < rect.y + rect.height - inset && Math.min(rect.width * camera.scale / size.width, rect.height * camera.scale / size.height) >= 0.72
}
export const exitReady = (scale: number, fitScale: number, direction: number): boolean => direction === -1 && scale < fitScale * 0.62
