import { describe, expect, it } from 'vitest'
import { childFrame, contentBounds, entryReady, exitReady, fitContent, intoChild, intoParent, navigationAllowed, recordWheel, screenToWorld, worldToScreen, zoomAt } from '../src/lib/camera'
import { emptyState, restoreState } from '../src/lib/storage'
import { demoScene } from '../server/scene'
import type { BoardNode } from '../shared/scene'

const camera = { x: 125, y: -84, scale: 1.7 }
const board: BoardNode = { kind: 'board', id: 'frame', boardId: 'child', title: 'Child', subtitle: '', x: 320, y: 180, width: 636, height: 503 }
describe('spatial continuity', () => {
  it('keeps the world point under the pointer invariant during zoom', () => {
    const pointer = { x: 451, y: 329 }
    const before = screenToWorld(pointer, camera)
    const after = screenToWorld(pointer, zoomAt(camera, pointer, 2.3))
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(zoomAt(camera, pointer, 2.3).scale).toBeCloseTo(3.91)
  })
  it('converts board coordinates to screen and back', () => {
    const point = { x: 83, y: -27 }
    const screen = worldToScreen(point, camera)
    expect(screen).toEqual({ x: 266.1, y: -129.9 })
    expect(screenToWorld(screen, camera).x).toBeCloseTo(point.x)
    expect(screenToWorld(screen, camera).y).toBeCloseTo(point.y)
  })
  it('preserves every child point at frame changes and round trips', () => {
    const frame = childFrame(board)
    expect(frame).toEqual({ x: 338, y: 240, scale: 0.5 })
    const point = { x: 430, y: 310 }
    const previewPoint = { x: frame.x + point.x * frame.scale, y: frame.y + point.y * frame.scale }
    expect(worldToScreen(point, intoChild(camera, frame))).toEqual(worldToScreen(previewPoint, camera))
    const restored = intoParent(intoChild(camera, frame), frame)
    expect(restored.x).toBeCloseTo(camera.x)
    expect(restored.y).toBeCloseTo(camera.y)
    expect(restored.scale).toBeCloseTo(camera.scale)
  })
  it('fits arbitrary bounds with padding and survives empty/tiny content', () => {
    const fit = fitContent({ x: -100, y: 200, width: 1000, height: 500 }, { width: 1200, height: 800 }, 100)
    expect(fit).toEqual({ x: 200, y: -50, scale: 1 })
    const empty = fitContent(contentBounds([]), { width: 1, height: 1 })
    expect(empty.scale).toBeGreaterThan(0)
    expect(Number.isFinite(empty.x)).toBe(true)
    expect(fitContent({ x: 0, y: 0, width: 0, height: 0 }, { width: 800, height: 600 }).scale).toBeLessThanOrEqual(3)
  })
})
describe('navigation boundaries', () => {
  const rect = { x: 100, y: 100, width: 800, height: 700 }
  const viewport = { width: 1000, height: 800 }
  it('requires inward intent, target containment and sufficient size', () => {
    expect(entryReady(rect, { x: 0, y: 0, scale: 1 }, viewport, { x: 400, y: 400 }, 1)).toBe(true)
    expect(entryReady(rect, { x: 0, y: 0, scale: 1 }, viewport, { x: 40, y: 400 }, 1)).toBe(false)
    expect(entryReady(rect, { x: 0, y: 0, scale: 0.5 }, viewport, { x: 250, y: 250 }, 1)).toBe(false)
    expect(entryReady(rect, { x: 0, y: 0, scale: 1 }, viewport, { x: 400, y: 400 }, -1)).toBe(false)
  })
  it('uses distinct exit hysteresis and outward intent', () => {
    expect(exitReady(0.61, 1, -1)).toBe(true)
    expect(exitReady(0.8, 1, -1)).toBe(false)
    expect(exitReady(0.5, 1, 1)).toBe(false)
  })
  it('blocks cooldown and continuing wheel momentum, permits a fresh burst or reversal', () => {
    const guard = { lastTransitionAt: 1000, lastWheelAt: 1500, consumedDirection: 1 }
    expect(navigationAllowed(guard, 1200, -1)).toBe(false)
    expect(navigationAllowed(guard, 1550, 1)).toBe(false)
    expect(navigationAllowed(guard, 1750, 1)).toBe(true)
    expect(navigationAllowed(guard, 1550, -1)).toBe(true)
  })
  it('keeps a fresh wheel burst armed until the board reaches entry size', () => {
    const consumed = { lastTransitionAt: 1000, lastWheelAt: 1500, consumedDirection: 1 }
    const first = recordWheel(consumed, 1800, 1)
    const second = recordWheel(first, 1900, 1)
    expect(navigationAllowed(second, 1900, 1)).toBe(true)
    const locked = recordWheel({ ...second, consumedDirection: 1, lastTransitionAt: 1900 }, 2000, 1)
    expect(navigationAllowed(locked, 2000, 1)).toBe(false)
  })
})
describe('versioned layout restoration', () => {
  it('restores stable known positions and preferences', () => {
    expect(restoreState(JSON.stringify({ version: 1, positions: { 'image-1': { x: 42, y: -5 }, unknown: { x: 0, y: 0 } }, reduceMotion: true }), demoScene)).toEqual({ ...emptyState(), layout: { placements: { 'image-1': { parentId: 'home', x: 42, y: -5, width: 290, height: 220 } }, order: {} }, reduceMotion: true })
  })
  it('recovers invalid JSON, versions, malformed values and invalid coordinates', () => {
    for (const value of [null, '{bad', 'null', '{"version":2}', '{"version":1,"positions":[]}']) expect(restoreState(value, demoScene)).toEqual(emptyState())
    const restored = restoreState(JSON.stringify({ version: 1, positions: { 'image-1': { x: 'bad', y: 0 }, 'frame-materials': { x: 99999999, y: 0 } }, reduceMotion: 'yes' }), demoScene)
    expect(restored.layout.placements).toEqual({})
    expect(restored.reduceMotion).toBe(null)
  })
})
