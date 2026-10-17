import { z } from 'zod'

export const pointSchema = z.object({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000) })
const rect = pointSchema.extend({ width: z.number().positive().max(5000), height: z.number().positive().max(5000) })
const base = rect.extend({ id: z.string().min(1), title: z.string() })
export const nodeSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('image'), asset: z.string(), caption: z.string().optional() }),
  base.extend({ kind: z.literal('note'), body: z.string(), tone: z.enum(['paper', 'sage', 'sand']) }),
  base.extend({ kind: z.literal('board'), boardId: z.string(), subtitle: z.string() }),
])
export const boardSchema = z.object({ id: z.string(), title: z.string(), description: z.string(), nodes: z.array(nodeSchema) })
export const sceneSchema = z.object({ version: z.literal(1), rootId: z.string(), boards: z.array(boardSchema) }).superRefine((scene, ctx) => {
  const boards = new Map(scene.boards.map(board => [board.id, board]))
  const ids = new Set<string>()
  const parents = new Set<string>()
  if (boards.size !== scene.boards.length || !boards.has(scene.rootId)) ctx.addIssue({ code: 'custom', message: 'Invalid board IDs' })
  for (const board of scene.boards) for (const node of board.nodes) {
    if (ids.has(node.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate node ID' })
    ids.add(node.id)
    if (node.kind === 'board') {
      if (!boards.has(node.boardId) || parents.has(node.boardId) || node.boardId === scene.rootId) ctx.addIssue({ code: 'custom', message: 'Invalid board tree' })
      parents.add(node.boardId)
    }
  }
  const visited = new Set<string>()
  const visit = (id: string, path: Set<string>) => {
    if (path.has(id)) { ctx.addIssue({ code: 'custom', message: 'Cyclic board tree' }); return }
    const next = new Set(path).add(id)
    visited.add(id)
    for (const node of boards.get(id)?.nodes ?? []) if (node.kind === 'board') visit(node.boardId, next)
  }
  visit(scene.rootId, new Set())
  if (parents.size !== scene.boards.length - 1 || visited.size !== scene.boards.length) ctx.addIssue({ code: 'custom', message: 'Disconnected board tree' })
})
export type Scene = z.infer<typeof sceneSchema>
export type Board = z.infer<typeof boardSchema>
export type SceneNode = z.infer<typeof nodeSchema>
export type BoardNode = Extract<SceneNode, { kind: 'board' }>
export type ImageNode = Extract<SceneNode, { kind: 'image' }>
export type Point = z.infer<typeof pointSchema>
export type Rect = z.infer<typeof rect>
export const BOARD_SIZE = { width: 1200, height: 850 }
