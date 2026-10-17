import { test, expect, type Page } from '@playwright/test'
import { demoScene } from '../server/scene'
import { worldToScreen, type Camera } from '../src/lib/camera'
import type { SceneNode } from '../shared/scene'
import { SceneLayout } from '../src/lib/layout'
import { restoreState } from '../src/lib/storage'

const sceneCanvas = (page: Page) => page.locator('.scene-canvas')
async function camera(page: Page): Promise<Camera> {
  return JSON.parse(await sceneCanvas(page).getAttribute('data-camera') ?? '{}')
}
async function boardId(page: Page) { return sceneCanvas(page).getAttribute('data-board-id') }
async function currentLayout(page: Page) {
  const raw = await page.evaluate(() => localStorage.getItem('zoomz:demo:v2') ?? localStorage.getItem('zoomz:demo:v1'))
  return new SceneLayout(demoScene, restoreState(raw, demoScene).layout)
}
async function boardPoint(page: Page, board: string, point: { x: number; y: number }) {
  const layout = await currentLayout(page), active = await boardId(page), rect = await sceneCanvas(page).boundingBox()
  if (!active || !rect) throw new Error('Workspace is not visible')
  const p = worldToScreen(point, layout.cameraIn(await camera(page), active, board))
  return { x: rect.x + p.x, y: rect.y + p.y }
}
async function nodePoint(page: Page, id: string, fx = 0.5, fy = 0.5) {
  const layout = await currentLayout(page), node = layout.node(id)
  if (!node) throw new Error(`Missing fixture ${id}`)
  const rect = await sceneCanvas(page).boundingBox()
  if (!rect) throw new Error('Canvas is not visible')
  const current = layout.cameraIn(await camera(page), await boardId(page) ?? 'home', layout.parentOf(id))
  const p = worldToScreen({ x: node.x + node.width * fx, y: node.y + node.height * fy }, current)
  return { x: rect.x + p.x, y: rect.y + p.y }
}
async function doubleClick(page: Page, id: string) { const p = await nodePoint(page, id, 0.4, id.startsWith('frame-') ? 0.055 : 0.5); await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(500) }
async function drag(page: Page, id: string, target: { x: number; y: number }, fx = 0.5, fy = 0.5) {
  const start = await nodePoint(page, id, fx, fy)
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(420)
}
async function wheelInto(page: Page, id: string, expected: string, settle = true) {
  const point = await nodePoint(page, id)
  await page.mouse.move(point.x, point.y)
  for (let i = 0; i < 18 && await boardId(page) !== expected; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(100) }
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', expected)
  if (settle) await page.waitForTimeout(500)
}
async function wheelOut(page: Page, expected: string) {
  const rect = await sceneCanvas(page).boundingBox()
  if (!rect) throw new Error('Canvas is not visible')
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  for (let i = 0; i < 22 && await boardId(page) !== expected; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(100) }
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', expected)
  await page.waitForTimeout(500)
}

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home'); await page.waitForTimeout(250) })

test('wheel exploration across three levels, momentum guard, reversal and interrupted travel', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await wheelInto(page, 'frame-materials', 'materials', false)
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40) }
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'materials')
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()
  await page.waitForTimeout(500)
  await wheelInto(page, 'frame-timber', 'timber')
  await wheelOut(page, 'materials')
  await wheelOut(page, 'home')
  await page.mouse.wheel(0, -140); await page.waitForTimeout(25); await page.mouse.wheel(0, 140)
  await page.waitForTimeout(250)
  expect((await camera(page)).scale).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()
  await page.waitForTimeout(30)
  await page.mouse.move(700, 500); await page.mouse.down(); await page.mouse.move(740, 540, { steps: 5 }); await page.mouse.up()
  expect(Number.isFinite((await camera(page)).x)).toBe(true)
  expect(errors).toEqual([])
})

test('Escape clears selection after using a toolbar control', async ({ page }) => {
  const point = await nodePoint(page, 'image-1')
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('.selection-bar')).toBeVisible()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.selection-bar')).not.toBeVisible()
})

test('double click, Back, breadcrumbs, Home and Fit preserve navigation', async ({ page }) => {
  const original = await camera(page)
  await doubleClick(page, 'frame-materials')
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'materials')
  await expect(page.locator('.board-heading')).toHaveCount(0)
  await expect(page.locator('.selection-bar')).toHaveCount(0)
  await doubleClick(page, 'frame-timber')
  await page.getByRole('button', { name: 'Back to parent board' }).click()
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'materials')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Inspiration', exact: true }).click()
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
  await page.waitForTimeout(500)
  expect((await camera(page)).scale).toBeCloseTo(original.scale, 3)
  await doubleClick(page, 'frame-living')
  await page.getByRole('button', { name: 'Home overview' }).click()
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
})

test('dragging persists on reload, board frames move their miniature, reset restores', async ({ page }) => {
  for (const id of ['image-1', 'note-intent', 'frame-materials']) {
    const start = await nodePoint(page, id)
    const before = await camera(page)
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 35, start.y + 30, { steps: 8 }); await page.mouse.up()
    await page.waitForTimeout(450)
    expect(await camera(page)).toEqual(before)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zoomz:demo:v2') ?? '{}'))
    expect(saved.layout.placements[id]).toBeDefined()
    expect(await boardId(page)).toBe('home')
  }
  const saved = await page.evaluate(() => localStorage.getItem('zoomz:demo:v2'))
  await page.reload(); await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
  expect(await page.evaluate(() => localStorage.getItem('zoomz:demo:v2'))).toBe(saved)
  await page.getByRole('button', { name: 'Reset demo' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset demo' }).click()
  expect(await page.evaluate(() => localStorage.getItem('zoomz:demo:v2'))).toBeNull()
  await expect(page.getByRole('status')).toHaveText('Original arrangement restored')
})

test('space pan, minimap, image viewer and Escape preserve the camera', async ({ page }) => {
  const p = await nodePoint(page, 'image-1'), before = await camera(page)
  await sceneCanvas(page).focus(); await page.keyboard.down('Space')
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 50, p.y + 30, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Space')
  expect((await camera(page)).x).toBeCloseTo(before.x + 50)
  expect(await page.evaluate(() => localStorage.getItem('zoomz:demo:v2'))).toBeNull()
  await page.locator('.minimap').click({ position: { x: 90, y: 60 } }); await page.waitForTimeout(500)
  expect((await camera(page)).x).not.toBeCloseTo(before.x + 50)
  await page.getByRole('button', { name: 'Fit board', exact: true }).click(); await page.waitForTimeout(500)
  const viewerCamera = await camera(page)
  const image = await nodePoint(page, 'image-1'); await page.mouse.click(image.x, image.y)
  await page.getByRole('button', { name: 'View full image', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('img', { name: 'A softer kind of space' })).toBeVisible()
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await camera(page)).toEqual(viewerCamera)
  await expect(sceneCanvas(page)).toBeFocused()
  await page.getByRole('button', { name: 'View full image', exact: true }).click(); await page.getByRole('button', { name: 'Close', exact: true }).click()
  expect(await camera(page)).toEqual(viewerCamera)
})

test('reduced motion, keyboard controls, resize, malformed storage and missing image fallback', async ({ page }) => {
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await expect(page.locator('.workspace')).toHaveAttribute('data-reduced-motion', 'true')
  await page.waitForTimeout(450); await page.reload()
  await expect(page.getByRole('switch', { name: 'Reduce motion' })).toBeChecked()
  await page.getByRole('button', { name: 'Browse items' }).focus(); await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Living spaces Enter board' }).click()
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'living')
  await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(250)
  expect(Number.isFinite((await camera(page)).scale)).toBe(true)
  await page.getByRole('button', { name: 'Home overview' }).click(); await page.waitForTimeout(200)
  await page.route('**/images/01-large.jpg', route => route.abort())
  await doubleClick(page, 'image-1')
  await page.getByRole('button', { name: 'View full image', exact: true }).click()
  await expect(page.getByText('This image couldn’t be loaded.')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => localStorage.setItem('zoomz:demo:v2', '{broken'))
  await page.reload(); await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
  await page.screenshot({ path: '.audit/verified-home.png' })
})

test('all bundled assets decode and system reduced motion is respected', async ({ page, request }) => {
  const response = await request.get('/api/health'); expect(await response.json()).toEqual({ status: 'ok' })
  const assets = demoScene.boards.flatMap(board => board.nodes).filter((node): node is Extract<SceneNode, { kind: 'image' }> => node.kind === 'image').map(node => node.asset)
  const failed = await page.evaluate(async ids => {
    const results = await Promise.all(ids.flatMap(id => ['thumb', 'large'].map(async size => {
      const image = new Image(); image.src = `/images/${id}-${size}.jpg`
      try { await image.decode(); return image.naturalWidth > 0 ? null : image.src } catch { return image.src }
    })))
    return results.filter(Boolean)
  }, assets)
  expect(failed).toEqual([])
  await page.screenshot({ path: '.audit/home-desktop.png' })
  await doubleClick(page, 'frame-materials')
  await page.screenshot({ path: '.audit/materials-desktop.png' })
  await doubleClick(page, 'frame-timber')
  await page.screenshot({ path: '.audit/timber-desktop.png' })
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload()
  await expect(page.getByRole('switch', { name: 'Reduce motion' })).toBeChecked()
})

test('double click frames the canvas image, uses the reclaimed viewport and can be interrupted', async ({ page }) => {
  const rect = await sceneCanvas(page).boundingBox()
  expect(rect?.y).toBe(76)
  expect(rect?.height).toBe(875)
  const before = await camera(page)
  await doubleClick(page, 'image-1')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.explore-hint')).toHaveCount(0)
  const after = await camera(page)
  expect(after.scale).toBeGreaterThan(before.scale * 2)
  const img = demoScene.boards[0].nodes.find(node => node.id === 'image-1')
  if (!img || img.kind !== 'image') throw new Error('Missing image')
  const natural = await page.evaluate(async () => { const image = new Image(); image.src = '/images/01-thumb.jpg'; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight } })
  const ratio = Math.min((img.width - 14) / natural.width, (img.height - 14) / natural.height)
  const width = natural.width * ratio * after.scale, height = natural.height * ratio * after.scale
  expect(width).toBeLessThanOrEqual(1440 - 80)
  expect(height).toBeLessThanOrEqual(875 - 80)
  expect(Math.max(width / 1440, height / 875)).toBeGreaterThan(0.89)
  await page.getByRole('button', { name: 'Fit board', exact: true }).click()
  await page.waitForTimeout(35)
  await page.mouse.move(900, 500); await page.mouse.wheel(0, -80); await page.waitForTimeout(30); await page.mouse.wheel(0, 80)
  await page.waitForTimeout(200)
  expect(Number.isFinite((await camera(page)).scale)).toBe(true)
})

test('dragging raises cards and manual layer commands persist in visible stacking order', async ({ page }) => {
  const point = await nodePoint(page, 'image-2', 0.15, 0.5)
  await drag(page, 'image-1', point)
  let layout = await currentLayout(page)
  expect(layout.nodes('home').at(-1)?.id).toBe('image-1')
  const exposed = await nodePoint(page, 'image-2', 0.85, 0.5)
  await drag(page, 'image-2', { x: exposed.x + 10, y: exposed.y + 10 }, 0.85, 0.5)
  layout = await currentLayout(page)
  expect(layout.nodes('home').at(-1)?.id).toBe('image-2')
  for (const [name, expected] of [['Send to Back', 0], ['Bring Forward', 1], ['Bring to Front', layout.nodes('home').length - 1], ['Send Backward', layout.nodes('home').length - 2]] satisfies [string, number][]) {
    const p = await nodePoint(page, 'image-2', 0.85, 0.5)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await page.getByRole('menuitem', { name, exact: true }).click()
    await page.waitForTimeout(400)
    expect((await currentLayout(page)).nodes('home')[expected].id).toBe('image-2')
  }
  const order = (await currentLayout(page)).nodes('home').map(node => node.id)
  await page.reload(); await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
  expect((await currentLayout(page)).nodes('home').map(node => node.id)).toEqual(order)
})

test('image transfers into a live child preview and back across its visible boundary', async ({ page }) => {
  await drag(page, 'image-1', await boardPoint(page, 'living', { x: 950, y: 470 }))
  let layout = await currentLayout(page)
  expect(layout.parentOf('image-1')).toBe('living')
  const node = layout.node('image-1')
  expect(node?.width).toBeLessThanOrEqual(456)
  expect((node?.width ?? 0) / (node?.height ?? 1)).toBeCloseTo(290 / 220)
  await doubleClick(page, 'frame-living')
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'living')
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await page.waitForTimeout(300)
  const boundary = await nodePoint(page, 'frame-living', 0, 0.5)
  await drag(page, 'image-1', { x: boundary.x - 60, y: boundary.y })
  layout = await currentLayout(page)
  expect(layout.parentOf('image-1')).toBe('home')
  await page.reload(); await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
  expect((await currentLayout(page)).parentOf('image-1')).toBe('home')
})

test('edge dwell reveals one parent while keeping a deeply nested image attached', async ({ page }) => {
  await doubleClick(page, 'frame-materials'); await doubleClick(page, 'frame-timber')
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'timber')
  const start = await nodePoint(page, 'image-19'), rect = await sceneCanvas(page).boundingBox()
  if (!rect) throw new Error('No canvas')
  const node = (await currentLayout(page)).node('image-19')
  if (!node) throw new Error('Missing image')
  const initialScale = (await camera(page)).scale
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 12, rect.y + rect.height * 0.3, { steps: 10 })
  await page.waitForTimeout(200)
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'timber')
  await expect(page.locator('.drag-feedback')).toContainText('Hold at edge')
  await page.waitForTimeout(850)
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'materials')
  await expect(sceneCanvas(page)).toHaveAttribute('data-dragging', 'image-19')
  const ghost = JSON.parse(await sceneCanvas(page).getAttribute('data-drag-rect') ?? '{}')
  expect(ghost.x + node.width * initialScale / 2).toBeCloseTo(rect.width - 12)
  expect(ghost.y + node.height * initialScale / 2).toBeCloseTo(rect.height * 0.3)
  await page.waitForTimeout(800)
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'materials')
  const end = await boardPoint(page, 'materials', { x: 1000, y: 310 })
  await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(450)
  expect((await currentLayout(page)).parentOf('image-19')).toBe('materials')
  await expect(sceneCanvas(page)).toHaveAttribute('data-dragging', '')
})

test('cancelling a cross-board drag restores geometry and stacking without stale drag state', async ({ page }) => {
  const before = (await currentLayout(page)).snapshot(), start = await nodePoint(page, 'image-1'), end = await boardPoint(page, 'living', { x: 500, y: 500 })
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(400)
  expect((await currentLayout(page)).snapshot()).toEqual(before)
  await expect(sceneCanvas(page)).toHaveAttribute('data-dragging', '')
  const click = await nodePoint(page, 'image-1'); await page.mouse.click(click.x, click.y)
  await expect(page.locator('.selection-bar')).toContainText('A softer kind of space')
})

test('panning out of an entered board exposes an interactive sibling without a focus lock', async ({ page }) => {
  await doubleClick(page, 'frame-living')
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await page.waitForTimeout(300)
  await sceneCanvas(page).focus(); await page.keyboard.down('Space')
  await page.mouse.move(1000, 470); await page.mouse.down(); await page.mouse.move(400, 470, { steps: 15 }); await page.mouse.up(); await page.keyboard.up('Space')
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
  await doubleClick(page, 'frame-materials')
  await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'materials')
  await doubleClick(page, 'image-13')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.selection-bar')).toContainText('Stone and shadow')
})

test('display preferences are independent, stable across nesting, persisted and reset', async ({ page }) => {
  const before = await camera(page), initial = (await currentLayout(page)).snapshot()
  await page.getByRole('button', { name: 'Display options' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Show Captions', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Show Captions', exact: true })).not.toBeChecked()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Show Image Borders', exact: true })).toBeChecked()
  await page.getByRole('menuitemcheckbox', { name: 'Show Image Borders', exact: true }).click(); await page.keyboard.press('Escape')
  expect(await camera(page)).toEqual(before)
  await page.waitForTimeout(450); expect((await currentLayout(page)).snapshot()).toEqual(initial)
  await doubleClick(page, 'frame-materials'); await doubleClick(page, 'frame-timber')
  await expect(page.locator('.workspace')).toHaveAttribute('data-show-captions', 'false')
  await expect(page.locator('.workspace')).toHaveAttribute('data-show-image-borders', 'false')
  await page.reload(); await expect(page.locator('.workspace')).toHaveAttribute('data-show-image-borders', 'false')
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Reset demo' }).click()
  await expect(page.locator('.workspace')).toHaveAttribute('data-show-captions', 'true')
  await expect(page.locator('.workspace')).toHaveAttribute('data-show-image-borders', 'true')
})

test('moving a board into a sibling preserves descendants and restores its hierarchy', async ({ page }) => {
  const before = (await currentLayout(page)).nodes('timber')
  await drag(page, 'frame-materials', await boardPoint(page, 'living', { x: 600, y: 420 }), 0.4, 0.055)
  const layout = await currentLayout(page)
  expect(layout.parentOf('frame-materials')).toBe('living')
  expect(layout.nodes('timber')).toEqual(before)
  await page.reload(); await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
  expect((await currentLayout(page)).path('timber')).toEqual(['home', 'living', 'materials', 'timber'])
})

test('layer menu is keyboard accessible and Space pan works after using a toolbar button', async ({ page }) => {
  const point = await nodePoint(page, 'image-1'); await page.mouse.click(point.x, point.y)
  await page.keyboard.press('Shift+F10')
  const front = page.getByRole('menuitem', { name: 'Bring to Front', exact: true })
  await expect(front).toBeVisible(); await front.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  expect((await currentLayout(page)).nodes('home').at(-1)?.id).toBe('image-1')
  await page.getByRole('button', { name: 'Fit board', exact: true }).click(); await page.waitForTimeout(400)
  const before = await camera(page), start = await nodePoint(page, 'image-1')
  await page.keyboard.down('Space'); await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 55, start.y + 35, { steps: 10 }); await page.mouse.up(); await page.keyboard.up('Space')
  expect((await camera(page)).x).toBeCloseTo(before.x + 55)
})

test('previous layouts migrate on save and reset preserves unrelated browser storage', async ({ page }) => {
  await page.evaluate(() => { localStorage.setItem('zoomz:demo:v1', JSON.stringify({ version: 1, positions: { 'image-1': { x: 50, y: 620 } }, reduceMotion: true })); localStorage.setItem('another-app:keep', 'untouched') })
  await page.reload(); await expect(sceneCanvas(page)).toHaveAttribute('data-board-id', 'home')
  expect((await currentLayout(page)).node('image-1')?.x).toBe(50)
  await expect(page.getByRole('switch', { name: 'Reduce motion' })).toBeChecked()
  await page.getByRole('button', { name: 'Display options' }).click(); await page.getByRole('menuitemcheckbox', { name: 'Show Captions', exact: true }).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  expect(await page.evaluate(() => localStorage.getItem('zoomz:demo:v1'))).toBeNull()
  expect((await currentLayout(page)).node('image-1')?.x).toBe(50)
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Reset demo' }).click()
  expect(await page.evaluate(() => localStorage.getItem('another-app:keep'))).toBe('untouched')
  expect((await currentLayout(page)).node('image-1')?.x).toBe(0)
})
