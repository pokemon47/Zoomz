// Scene contract — mirrors backend/app/main.py (Scene, BoardNode, ImageNode, NoteNode).
// FileNode exists only in the browser for files dropped during a session.

export type BaseNode = {
  id: string
  parentId: string | null
  x: number
  y: number
  /** Height above the parent board's floor, local units (drives depth parallax). */
  z?: number
  w: number
  h: number
}

export type BoardNode = BaseNode & {
  type: "board"
  content: { title: string; description?: string | null }
}

export type ImageNode = BaseNode & {
  type: "image"
  content: { title: string; src: string; alt: string }
}

export type NoteNode = BaseNode & {
  type: "note"
  content: { title: string; body: string }
}

/** Client-only: a file the user dropped in this session (never sent to the API). */
export type FileNode = BaseNode & {
  type: "file"
  content: { title: string; src: string; mime: string; size: number }
}

export type SceneNode = BoardNode | ImageNode | NoteNode | FileNode

export type Scene = { rootBoardId: string; nodes: SceneNode[] }

export type LOD = "far" | "medium" | "close"
