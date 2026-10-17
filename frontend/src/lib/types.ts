// Scene contract — mirrors backend/app/main.py (Scene, BoardNode, ImageNode, NoteNode).
// FileNode/LinkNode and file facts come from the live API (see backend/app/ops.py).

export type BaseNode = {
  id: string
  parentId: string | null
  x: number
  y: number
  /** Height above the parent board's floor, local units (drives depth parallax). */
  z?: number
  w: number
  h: number
  /** Stacking order among siblings; higher paints on top. Unset = default order by type. */
  rank?: number | null
}

/** Signed file URLs and facts the server adds to items that point at an uploaded file. */
export type FileFacts = {
  fileId?: string
  mime?: string
  size?: number
  kind?: string
  /** processing (video being prepared) | ready | missing | uploading (client-only, in flight) */
  status?: string
  width?: number
  height?: number
  thumb_256?: string
  thumb_1024?: string
  poster?: string
  preview?: string
  /** 0–1 while uploading (client-only). */
  progress?: number
}

export type Frame = { x: number; y: number; w: number; h: number }

export type BoardNode = BaseNode & {
  type: "board"
  content: { title: string; description?: string | null; frame?: Frame }
}

export type ImageNode = BaseNode & {
  type: "image"
  content: { title: string; src: string; alt: string } & FileFacts
}

export type NoteNode = BaseNode & {
  type: "note"
  content: { title: string; body: string }
}

/** Any other uploaded file (PDF, video, document…). */
export type FileNode = BaseNode & {
  type: "file"
  content: { title: string; src: string; mime: string; size: number } & FileFacts
}

/** A pasted web link, with a preview (and an embed for YouTube, Vimeo, Figma). */
export type LinkNode = BaseNode & {
  type: "link"
  content: { url: string; title?: string; description?: string; image?: string | null; site?: string; embed?: string | null }
}

export type SceneNode = BoardNode | ImageNode | NoteNode | FileNode | LinkNode

export type Role = "owner" | "editor" | "viewer"

export type Scene = { rootBoardId: string; nodes: SceneNode[] }

export type LOD = "far" | "medium" | "close"
