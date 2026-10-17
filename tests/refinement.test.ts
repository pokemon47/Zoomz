import { describe, expect, it } from 'vitest'
import { demoScene } from '../server/scene'
import { frameElement, screenToWorld, worldToScreen, zoomAt } from '../src/lib/camera'
import { SceneLayout, transferPlacement } from '../src/lib/layout'
import { emptyState, restoreState } from '../src/lib/storage'
import { nodeSchema } from '../shared/scene'

describe('element framing', () => {
  it('does not snap an equivalent parent camera to the input scale limit after a frame change', () => {
    const camera = { x: -300, y: 150, scale: 32 }, pointer = { x: 450, y: 310 }
    const next = zoomAt(camera, pointer, 0.9)
    expect(next.scale).toBeCloseTo(28.8)
    expect(screenToWorld(pointer, next).x).toBeCloseTo(screenToWorld(pointer, camera).x)
    expect(zoomAt({ ...camera, scale: 12 }, pointer, 2).scale).toBe(12)
  })
  for (const [width, height] of [[1600, 400], [400, 1600], [600, 600]]) it(`contains ${width} × ${height} with a small margin`, () => {
    const viewport = { width: 1440, height: 870 }, rect = { x: 210, y: 95, width, height }
    const camera = frameElement(rect, viewport)
    const top = worldToScreen(rect, camera), bottom = worldToScreen({ x: rect.x + width, y: rect.y + height }, camera)
    expect(top.x).toBeGreaterThanOrEqual(43)
    expect(top.y).toBeGreaterThanOrEqual(43)
    expect(bottom.x).toBeLessThanOrEqual(viewport.width - 43)
    expect(bottom.y).toBeLessThanOrEqual(viewport.height - 43)
    expect((top.x + bottom.x) / 2).toBeCloseTo(720)
    expect((top.y + bottom.y) / 2).toBeCloseTo(435)
    expect((bottom.x - top.x) / (bottom.y - top.y)).toBeCloseTo(width / height)
  })
  it('uses the whole actual canvas viewport and appropriate safe scale limits', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 }
    expect(frameElement(rect, { width: 1440, height: 870 }).scale).toBeCloseTo(7.83)
    expect(frameElement(rect, { width: 1440, height: 870 }, 2).scale).toBe(2)
    expect(frameElement({ ...rect, width: 1, height: 1 }, { width: 1440, height: 870 }).scale).toBe(12)
  })
})

describe('hierarchy, transforms and stacking', () => {
  it('round trips arbitrary nested and sibling coordinate frames without screen jumps', () => {
    const layout = new SceneLayout(demoScene), root = { x: 81, y: -32, scale: 1.3 }
    const inner = layout.cameraIn(root, 'home', 'timber')
    const restored = layout.cameraIn(inner, 'timber', 'home')
    expect(restored.x).toBeCloseTo(root.x); expect(restored.y).toBeCloseTo(root.y); expect(restored.scale).toBeCloseTo(root.scale)
    const sibling = layout.cameraIn(inner, 'timber', 'lighting')
    expect(layout.cameraIn(sibling, 'lighting', 'timber').scale).toBeCloseTo(inner.scale)
  })
  it('implements deterministic per-board layer commands', () => {
    const layout = new SceneLayout(demoScene)
    layout.layer('image-1', 'front'); expect(layout.nodes('home').at(-1)?.id).toBe('image-1')
    layout.layer('image-2', 'front'); expect(layout.nodes('home').at(-1)?.id).toBe('image-2')
    layout.layer('image-2', 'backward'); expect(layout.nodes('home').at(-2)?.id).toBe('image-2')
    layout.layer('image-2', 'back'); expect(layout.nodes('home')[0].id).toBe('image-2')
    layout.layer('image-2', 'forward'); expect(layout.nodes('home')[1].id).toBe('image-2')
    expect(new SceneLayout(demoScene, layout.snapshot()).nodes('home').map(node => node.id)).toEqual(layout.nodes('home').map(node => node.id))
  })
  it('picks the topmost visible node, including accessible ancestor and sibling content', () => {
    const layout = new SceneLayout(demoScene), root = { x: 0, y: 0, scale: 1 }
    layout.transfer('image-1', { parentId: 'home', x: 100, y: 580, width: 290, height: 220 })
    layout.transfer('image-2', { parentId: 'home', x: 100, y: 580, width: 324, height: 270 })
    expect(layout.hit('home', { x: 200, y: 650 }, root, 'materials')?.node.id).toBe('image-2')
    layout.layer('image-1', 'front')
    expect(layout.hit('home', { x: 200, y: 650 }, root, 'materials')?.node.id).toBe('image-1')
    expect(layout.hit('home', { x: 1450, y: 150 }, root, 'materials')?.node.id).toBe('frame-lighting')
  })
  it('allows detailed sibling content to be picked without first activating its board', () => {
    const layout = new SceneLayout(demoScene), root = { x: -2600, y: -100, scale: 2 }
    const point = worldToScreen({ x: 200, y: 180 }, layout.cameraIn(root, 'home', 'lighting'))
    expect(layout.hit('home', point, root, 'materials')?.node.id).toBe('image-25')
  })
  it('keeps empty space inside the active board available for canvas panning', () => {
    const layout = new SceneLayout(demoScene), root = { x: 0, y: 0, scale: 1 }
    const living = layout.cameraIn(root, 'home', 'living'), empty = worldToScreen({ x: 1185, y: 835 }, living)
    expect(layout.hit('home', empty, root, 'living')).toBeNull()
  })
  it('adapts tiny outgoing cards to a useful destination-relative size without enlarging adequate ones', () => {
    const layout = new SceneLayout(demoScene), node = layout.node('image-1')
    if (!node) throw new Error('Missing image')
    const camera = { x: 0, y: 0, scale: 1 }
    const tiny = transferPlacement(node, { x: 400, y: 400, width: 4, height: 4 * 220 / 290 }, camera, 'home', true)
    expect(tiny.width).toBeGreaterThan(150)
    const adequate = transferPlacement(node, { x: 400, y: 400, width: 290, height: 220 }, camera, 'home', true)
    expect(adequate.width).toBe(290)
  })
  it('rejects self/descendant board transfers and keeps internal layouts intact', () => {
    const layout = new SceneLayout(demoScene), before = layout.nodes('timber')
    expect(layout.canTransfer('frame-materials', 'materials')).toBe(false)
    expect(layout.canTransfer('frame-materials', 'timber')).toBe(false)
    expect(layout.canTransfer('missing-root-node', 'living')).toBe(false)
    expect(layout.transfer('frame-timber', { parentId: 'living', x: 60, y: 90, width: 500, height: 400 })).toBe(true)
    expect(layout.nodes('timber')).toEqual(before)
    expect(layout.path('timber')).toEqual(['home', 'living', 'timber'])
  })
  it('sizes transfers proportionally around the intended drop and clamps to usable board area', () => {
    const layout = new SceneLayout(demoScene), node = layout.node('image-1')
    if (!node) throw new Error('Missing demo image')
    const camera = { x: 100, y: 50, scale: 0.3 }, screen = { x: 190, y: 110, width: 290, height: 220 }
    const placement = transferPlacement(node, screen, camera, 'living', false)
    expect(placement.width / placement.height).toBeCloseTo(node.width / node.height)
    expect(placement.width).toBeLessThanOrEqual(1200 * 0.38)
    expect(placement.height).toBeLessThanOrEqual(850 * 0.38 + 1e-8)
    expect(placement.x).toBeGreaterThanOrEqual(24)
    expect(placement.y).toBeGreaterThanOrEqual(24)
    expect(placement.x + placement.width).toBeLessThanOrEqual(1176)
    const centre = screenToWorld({ x: screen.x + screen.width / 2, y: screen.y + screen.height / 2 }, camera)
    expect(placement.x + placement.width / 2).toBeCloseTo(centre.x)
    layout.transfer(node.id, placement)
    expect(layout.parentOf(node.id)).toBe('living')
    expect(layout.nodes('living').at(-1)?.id).toBe(node.id)
    expect(new SceneLayout(demoScene, layout.snapshot()).placement(node.id)).toEqual(placement)
  })
})

describe('restoration and optional presentation', () => {
  it('accepts absent captions without inventing placeholder data', () => {
    const image = nodeSchema.parse({ kind: 'image', id: 'uncaptioned', title: 'Quiet', asset: '01', x: 0, y: 0, width: 200, height: 150 })
    if (image.kind !== 'image') throw new Error('Expected image')
    expect(image.caption).toBeUndefined()
  })
  it('restores transfers, dimensions, stacking and independent display preferences', () => {
    const layout = new SceneLayout(demoScene)
    layout.transfer('image-1', { parentId: 'timber', x: 100, y: 200, width: 290, height: 220 })
    layout.layer('image-19', 'front')
    const data = { ...emptyState(), layout: layout.snapshot(), showCaptions: false, showImageBorders: false }
    const restored = restoreState(JSON.stringify(data), demoScene)
    expect(restored).toEqual(data)
    const rebuilt = new SceneLayout(demoScene, restored.layout)
    expect(rebuilt.parentOf('image-1')).toBe('timber')
    expect(rebuilt.nodes('timber').at(-1)?.id).toBe('image-19')
  })
  it('rejects corrupt hierarchy, dimensions, coordinates and order without losing valid entries', () => {
    const raw = { ...emptyState(), layout: { placements: {
      'frame-materials': { parentId: 'timber', x: 0, y: 0, width: 520, height: 420.8333333333 },
      'image-1': { parentId: 'living', x: 40, y: 55, width: 290, height: 220 },
      'image-2': { parentId: 'missing', x: 0, y: 0, width: 324, height: 270 },
      'image-3': { parentId: 'home', x: 0, y: 0, width: -1, height: 100 },
      'image-4': { parentId: 'home', x: 999999, y: 0, width: 244, height: 200 },
    }, order: { home: ['missing', 'image-1', 'image-2', 'image-2'], living: 'broken' } } }
    const restored = restoreState(JSON.stringify(raw), demoScene)
    expect(Object.keys(restored.layout.placements)).toEqual(['image-1'])
    expect(restored.layout.order.home).not.toContain('image-1')
    expect(restored.layout.order.home?.filter(id => id === 'image-2')).toHaveLength(1)
  })
})
