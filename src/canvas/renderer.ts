import { BOARD_SIZE, type ImageNode, type SceneNode, type Rect } from '../../shared/scene'
import { childFrame, intoChild, worldToScreen, type Camera, type Size } from '../lib/camera'
import { SceneLayout } from '../lib/layout'
import type { DisplayPreferences } from '../lib/storage'

type Asset = { image: HTMLImageElement; status: 'loading' | 'ready' | 'failed'; loadedAt: number }
export type RenderState = DisplayPreferences & {
  boardId: string
  camera: Camera
  selected: string | null
  hovered: string | null
  reduced: boolean
  ghost: { node: SceneNode; rect: Rect; scale: number } | null
  destination: { boardId: string; valid: boolean } | null
}
const clamp = (n: number) => Math.max(0, Math.min(1, n))

export class SceneRenderer {
  private assets = new Map<string, Asset>()
  needsFrame = false
  constructor(readonly layout: SceneLayout, private invalidate: () => void) {}

  imageBounds(node: ImageNode): Rect {
    const asset = this.asset(node.asset), available = { x: node.x + 7, y: node.y + 7, width: node.width - 14, height: node.height - 14 }
    if (asset.status !== 'ready') return available
    const ratio = Math.min(available.width / asset.image.naturalWidth, available.height / asset.image.naturalHeight)
    const width = asset.image.naturalWidth * ratio, height = asset.image.naturalHeight * ratio
    return { x: available.x + (available.width - width) / 2, y: available.y + (available.height - height) / 2, width, height }
  }

  private asset(id: string, large = false): Asset {
    const key = `${id}-${large ? 'large' : 'thumb'}`
    const existing = this.assets.get(key)
    if (existing) return existing
    const image = new Image()
    const asset: Asset = { image, status: 'loading', loadedAt: 0 }
    this.assets.set(key, asset)
    image.onload = () => { asset.status = 'ready'; asset.loadedAt = performance.now(); this.invalidate() }
    image.onerror = () => { asset.status = 'failed'; this.invalidate() }
    image.src = `/images/${key}.jpg`
    return asset
  }

  private rounded(ctx: CanvasRenderingContext2D, rect: Rect, radius: number) {
    ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
  }

  private image(ctx: CanvasRenderingContext2D, asset: Asset, rect: Rect, opacity = 1) {
    if (asset.status !== 'ready') return
    const ratio = Math.min(rect.width / asset.image.naturalWidth, rect.height / asset.image.naturalHeight)
    const width = asset.image.naturalWidth * ratio, height = asset.image.naturalHeight * ratio
    ctx.save(); this.rounded(ctx, rect, 5); ctx.clip(); ctx.globalAlpha *= opacity
    ctx.drawImage(asset.image, rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2, width, height)
    ctx.restore()
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) {
    let line = '', row = 0
    for (const paragraph of text.split('\n')) {
      for (const word of paragraph.split(' ')) {
        const next = `${line}${line ? ' ' : ''}${word}`
        if (ctx.measureText(next).width > width && line) { ctx.fillText(line, x, y + row++ * lineHeight); line = word; if (row >= maxLines) return }
        else line = next
      }
      ctx.fillText(line, x, y + row++ * lineHeight); line = ''
      if (row >= maxLines) return
    }
  }

  draw(ctx: CanvasRenderingContext2D, size: Size, dpr: number, state: RenderState) {
    this.needsFrame = false
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    const root = this.layout.scene.rootId
    const rootCamera = this.layout.cameraIn(state.camera, state.boardId, root)
    if (!state.reduced) {
      ctx.fillStyle = '#d8d4c9'
      const ox = rootCamera.x * 0.06 % 28, oy = rootCamera.y * 0.06 % 28
      for (let x = ox; x < size.width; x += 28) for (let y = oy; y < size.height; y += 28) { ctx.beginPath(); ctx.arc(x, y, 0.55, 0, Math.PI * 2); ctx.fill() }
    }
    this.drawBoard(ctx, root, rootCamera, size, state, 0)
    if (state.ghost) {
      const { node, rect, scale } = state.ghost
      ctx.save(); ctx.shadowColor = '#353e3338'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8
      this.drawBoard(ctx, '', { x: rect.x, y: rect.y, scale }, size, state, 0, [{ ...node, x: 0, y: 0, width: rect.width / scale, height: rect.height / scale }])
      ctx.restore()
    }
  }

  private drawBoard(ctx: CanvasRenderingContext2D, id: string, camera: Camera, size: Size, state: RenderState, depth: number, overlay?: SceneNode[]) {
    for (const node of overlay ?? this.layout.nodes(id)) {
      if (!overlay && node.id === state.ghost?.node.id) continue
      const p = worldToScreen(node, camera)
      const rect = { x: p.x, y: p.y, width: node.width * camera.scale, height: node.height * camera.scale }
      if (rect.x + rect.width < -30 || rect.y + rect.height < -30 || rect.x > size.width + 30 || rect.y > size.height + 30 || rect.width < 5 || rect.height < 5) continue
      const s = camera.scale
      ctx.save()
      if (!overlay) { ctx.shadowColor = '#453b2a14'; ctx.shadowBlur = Math.min(22, s * 14); ctx.shadowOffsetY = 4 * Math.min(s, 2) }
      this.rounded(ctx, rect, Math.min(9, 8 * s))
      ctx.fillStyle = node.kind === 'note' ? ({ paper: '#f0ece2', sage: '#e5e8dc', sand: '#eee3d3' })[node.tone] : '#fffefa'
      if (node.kind !== 'image' || state.showImageBorders) ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.strokeStyle = '#dedbd250'; ctx.lineWidth = 1
      if (node.kind !== 'image' || state.showImageBorders) ctx.stroke()
      if (node.kind === 'image') {
        const detail = clamp((rect.width - 160) / 100)
        const inset = Math.max(2, 7 * s)
        const picture = { x: rect.x + inset, y: rect.y + inset, width: rect.width - inset * 2, height: rect.height - inset * 2 }
        const thumb = this.asset(node.asset)
        this.image(ctx, thumb, picture)
        if (rect.width > 490) {
          const large = this.asset(node.asset, true)
          if (large.status === 'ready') {
            const fade = state.reduced ? 1 : clamp((performance.now() - large.loadedAt) / 160)
            this.image(ctx, large, picture, fade)
            if (fade < 1) this.needsFrame = true
          }
        }
        if (thumb.status === 'failed') {
          ctx.fillStyle = '#77776c'; ctx.font = `${Math.max(9, Math.min(14, 13 * s))}px system-ui`; ctx.textAlign = 'center'
          ctx.fillText('Image unavailable', picture.x + picture.width / 2, picture.y + picture.height / 2, picture.width - 12)
        }
        if (detail > 0 && state.showCaptions && node.caption) {
          ctx.globalAlpha *= detail
          const textSize = Math.max(10, Math.min(14, 12 * s))
          ctx.fillStyle = '#fffefbe8'; ctx.fillRect(picture.x, picture.y + picture.height - textSize * 2.5, picture.width, textSize * 2.5)
          ctx.fillStyle = '#69685e'; ctx.font = `${textSize}px system-ui`
          ctx.save(); ctx.beginPath(); ctx.rect(picture.x + 8, picture.y, Math.max(0, picture.width - 16), picture.height); ctx.clip()
          ctx.fillText(node.caption, picture.x + 8, picture.y + picture.height - textSize * 0.9)
          ctx.restore()
        }
      } else if (node.kind === 'note') {
        const heading = clamp((rect.width - 65) / 65), detail = clamp((rect.width - 150) / 80)
        ctx.globalAlpha *= heading; ctx.fillStyle = '#5e6552'; ctx.font = `${10 * s}px system-ui`
        ctx.fillText('A LITTLE THOUGHT', rect.x + 23 * s, rect.y + 30 * s, rect.width - 46 * s)
        ctx.fillStyle = '#383e32'; ctx.font = `${21 * s}px Georgia`
        ctx.fillText(node.title, rect.x + 23 * s, rect.y + 64 * s, rect.width - 46 * s)
        ctx.globalAlpha *= detail; ctx.fillStyle = '#65695d'; ctx.font = `${13 * s}px system-ui`
        this.wrapText(ctx, node.body, rect.x + 23 * s, rect.y + 93 * s, rect.width - 46 * s, 20 * s, 5)
      } else {
        const frame = childFrame(node)
        const nestedCamera = intoChild(camera, frame)
        const origin = worldToScreen({ x: 0, y: 0 }, nestedCamera)
        const detail = clamp((rect.width - 110) / 100)
        ctx.globalAlpha *= detail
        ctx.fillStyle = '#767d68'; ctx.font = `${12 * s}px system-ui`
        ctx.fillText('⊞', rect.x + 19 * s, rect.y + 28 * s)
        ctx.fillStyle = '#333a30'; ctx.font = `${21 * s}px Georgia`
        ctx.fillText(node.title, rect.x + 43 * s, rect.y + 31 * s, rect.width - 90 * s)
        ctx.fillStyle = '#85877e'; ctx.font = `${11 * s}px system-ui`
        ctx.fillText(`${this.layout.nodes(node.boardId).length} items   ↗`, rect.x + rect.width - 93 * s, rect.y + 29 * s)
        ctx.restore(); ctx.save()
        this.rounded(ctx, { x: origin.x, y: origin.y, width: BOARD_SIZE.width * nestedCamera.scale, height: BOARD_SIZE.height * nestedCamera.scale }, 4 * s)
        ctx.fillStyle = '#f8f7f3'; ctx.fill(); ctx.clip()
        const followsActive = this.layout.path(state.boardId).includes(node.boardId)
        if ((depth < 2 || followsActive) && rect.width > 85) this.drawBoard(ctx, node.boardId, nestedCamera, size, state, followsActive ? 0 : depth + 1)
        else {
          for (const position of this.layout.nodes(node.boardId)) {
            const at = worldToScreen(position, nestedCamera)
            ctx.fillStyle = position.kind === 'note' ? '#d9ddcd' : '#d9d5cc'
            ctx.fillRect(at.x, at.y, position.width * nestedCamera.scale, position.height * nestedCamera.scale)
          }
        }
      }
      ctx.restore()
      const drop = node.kind === 'board' && node.boardId === state.destination?.boardId
      if (node.id === state.selected || node.id === state.hovered || drop) {
        ctx.save(); this.rounded(ctx, { x: rect.x - 3, y: rect.y - 3, width: rect.width + 6, height: rect.height + 6 }, 10)
        ctx.strokeStyle = drop ? state.destination?.valid ? '#71885a' : '#ad6754' : node.id === state.selected ? '#79866b' : '#a5ad99'; ctx.lineWidth = drop || node.id === state.selected ? 2 : 1; ctx.stroke(); ctx.restore()
      }
    }
  }

  dispose() { for (const asset of this.assets.values()) { asset.image.onload = null; asset.image.onerror = null } this.assets.clear() }
}
