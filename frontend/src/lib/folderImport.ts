import { imageCard } from "./store"

// Dropping a folder from the desktop recreates it as boards: every folder becomes a board,
// every subfolder a board inside it, and the files land on the board of their folder.

export type FolderTree = { name: string; files: File[]; folders: FolderTree[] }

/** Most files one drop may import, and how deep folders may nest. */
export const IMPORT_LIMITS = { files: 1000, depth: 24 }

const hidden = (name: string) => name.startsWith(".") || name === "Thumbs.db" || name === "desktop.ini"
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true })

/**
 * The folders in a drop, read into trees, plus any loose files dropped alongside them.
 * Must be called synchronously inside the drop handler: the entries vanish once it returns.
 */
export function readDrop(dt: DataTransfer): { folders: Promise<FolderTree[]>; looseFiles: File[] } | null {
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e)
  if (!entries.some((e) => e.isDirectory)) return null
  const dirs = entries.filter((e): e is FileSystemDirectoryEntry => e.isDirectory)
  const names = new Set(entries.filter((e) => e.isFile).map((e) => e.name))
  const looseFiles = Array.from(dt.files).filter((f) => names.has(f.name) && !hidden(f.name))
  const budget = { files: 0 }
  return { folders: Promise.all(dirs.map((d) => readDir(d, 0, budget))), looseFiles }
}

async function readDir(dir: FileSystemDirectoryEntry, depth: number, budget: { files: number }): Promise<FolderTree> {
  const tree: FolderTree = { name: dir.name, files: [], folders: [] }
  if (depth >= IMPORT_LIMITS.depth) return tree
  const reader = dir.createReader()
  const entries: FileSystemEntry[] = []
  // readEntries returns results in chunks (about 100 at a time in Chrome) until it returns none.
  for (;;) {
    const chunk = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
    if (!chunk.length) break
    entries.push(...chunk)
  }
  for (const e of entries.sort(byName)) {
    if (hidden(e.name)) continue
    if (e.isDirectory) tree.folders.push(await readDir(e as FileSystemDirectoryEntry, depth + 1, budget))
    else if (budget.files < IMPORT_LIMITS.files) {
      budget.files++
      tree.files.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)))
    }
  }
  return tree
}

export function countFiles(t: FolderTree): number {
  return t.files.length + t.folders.reduce((n, f) => n + countFiles(f), 0)
}

// ---------------------------------------------------------------- layout

/** Card sizes used on an imported board's face, in that board's own units. */
export const IMPORT_GRID = { pad: 90, gap: 40, boardW: 360, fileCellW: 250, fileCellH: 340 }

export type BoardPlan = {
  name: string
  /** The board's content window: everything inside it is laid out within this. */
  frame: { x: number; y: number; w: number; h: number }
  /** Card size of this board when shown on its parent. */
  w: number
  h: number
  files: File[]
  /** Top-left of each file's cell, in this board's units (same order as `files`). */
  fileCells: { x: number; y: number }[]
  /** Each child board with its top-left on this board. */
  folders: { plan: BoardPlan; x: number; y: number }[]
}

/** Boards in a row, then files in a grid below them; each board sized to hold what's in it. */
export function planFolder(tree: FolderTree): BoardPlan {
  const { pad, gap, boardW, fileCellW, fileCellH } = IMPORT_GRID
  const subs = tree.folders.map(planFolder)

  const boardCols = Math.max(1, Math.ceil(Math.sqrt(subs.length * 1.4)))
  const folders: BoardPlan["folders"] = []
  let y = pad
  let width = 0
  for (let r = 0; r * boardCols < subs.length; r++) {
    const row = subs.slice(r * boardCols, (r + 1) * boardCols)
    const rowH = Math.max(...row.map((p) => p.h))
    row.forEach((plan, c) => folders.push({ plan, x: pad + c * (boardW + gap), y }))
    width = Math.max(width, row.length * (boardW + gap) - gap)
    y += rowH + gap
  }

  const n = tree.files.length
  const fileCols = Math.max(1, Math.ceil(Math.sqrt(n * 1.4)))
  const fileCells = tree.files.map((_, i) => ({ x: pad + (i % fileCols) * fileCellW, y: y + Math.floor(i / fileCols) * fileCellH }))
  if (n) {
    width = Math.max(width, Math.min(n, fileCols) * fileCellW)
    y += Math.ceil(n / fileCols) * fileCellH
  } else if (subs.length) y -= gap

  const frame = { x: 0, y: 0, w: Math.max(800, width + pad * 2), h: Math.max(600, y + pad) }
  return { name: tree.name, frame, w: boardW, h: Math.round((boardW * frame.h) / frame.w), files: tree.files, fileCells, folders }
}

/** An image or file card that fits a file cell, at the picture's true shape. */
export function fileCard(file: File, ratio: number): { w: number; h: number } {
  if (!file.type.startsWith("image/")) return { w: 200, h: 240 }
  return imageCard(ratio, 220, IMPORT_GRID.fileCellH - 30)
}
