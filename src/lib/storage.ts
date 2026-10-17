import { z } from 'zod'
import { pointSchema, type Scene } from '../../shared/scene'
import { SceneLayout, type LayoutState } from './layout'

export type DisplayPreferences = { showCaptions: boolean; showImageBorders: boolean }
export type SavedState = DisplayPreferences & { version: 2; layout: LayoutState; reduceMotion: boolean | null }
export const STORAGE_KEY = 'zoomz:demo:v2'
export const LEGACY_STORAGE_KEY = 'zoomz:demo:v1'
export const emptyState = (): SavedState => ({ version: 2, layout: { placements: {}, order: {} }, reduceMotion: null, showCaptions: true, showImageBorders: true })
const placementSchema = pointSchema.extend({ parentId: z.string(), width: z.number().finite().min(8).max(5000), height: z.number().finite().min(8).max(5000) })
const envelope = z.object({ version: z.union([z.literal(1), z.literal(2)]), positions: z.record(z.string(), z.unknown()).optional(), layout: z.object({ placements: z.record(z.string(), z.unknown()), order: z.record(z.string(), z.unknown()) }).optional(), reduceMotion: z.unknown().optional(), showCaptions: z.unknown().optional(), showImageBorders: z.unknown().optional() })

export function restoreState(raw: string | null, scene: Scene): SavedState {
  const empty = emptyState()
  try {
    const parsed = envelope.safeParse(JSON.parse(raw ?? 'null'))
    if (!parsed.success) return empty
    const data = parsed.data, layout = new SceneLayout(scene)
    if (data.version === 1 && data.positions) {
      for (const [id, value] of Object.entries(data.positions)) {
        const point = pointSchema.safeParse(value), original = layout.placement(id)
        if (point.success && original) layout.setPlacement(id, { ...original, ...point.data })
      }
    } else if (data.version === 2 && data.layout) {
      for (const [id, value] of Object.entries(data.layout.placements)) {
        const placement = placementSchema.safeParse(value), node = layout.node(id)
        if (!placement.success || !node || !layout.canTransfer(id, placement.data.parentId)) continue
        if (node.kind === 'board') {
          const expected = 78 + (placement.data.width - 36) * 850 / 1200
          if (placement.data.width < 180 || Math.abs(placement.data.height - expected) > 1) continue
        } else if (Math.abs(placement.data.width / placement.data.height - node.width / node.height) > 0.01) continue
        layout.setPlacement(id, placement.data)
      }
      for (const [parentId, value] of Object.entries(data.layout.order)) {
        const order = z.array(z.string()).safeParse(value)
        if (!order.success || !layout.boards.has(parentId)) continue
        const valid = new Set(layout.nodes(parentId).map(node => node.id))
        for (const id of new Set(order.data)) if (valid.has(id)) layout.layer(id, 'front')
      }
    } else return empty
    return { version: 2, layout: layout.snapshot(), reduceMotion: typeof data.reduceMotion === 'boolean' ? data.reduceMotion : null, showCaptions: typeof data.showCaptions === 'boolean' ? data.showCaptions : true, showImageBorders: typeof data.showImageBorders === 'boolean' ? data.showImageBorders : true }
  } catch { return empty }
}

export function readState(scene: Scene): SavedState {
  try { return restoreState(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY), scene) }
  catch { return emptyState() }
}
export function writeState(state: SavedState): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.removeItem(LEGACY_STORAGE_KEY); return true }
  catch { return false }
}
export function clearState(): boolean {
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY); return true }
  catch { return false }
}
