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

export type SourceReference = {
  title?: string; filename?: string; asset_id?: string; page?: number; slide?: number
  section?: string; excerpt?: string; url?: string
  classification: "source" | "supplementary" | "external"
  availability?: "available" | "missing" | "unverified"
}
type Provenance = { references?: SourceReference[] }

export type BoardNode = BaseNode & {
  type: "board"
  content: { title: string; description?: string | null; frame?: Frame; color?: string | null } & Provenance
}

export type ImageNode = BaseNode & {
  type: "image"
  content: { title: string; src: string; alt: string } & FileFacts & Provenance
}

export type NoteNode = BaseNode & {
  type: "note"
  content: { title: string; body: string; color?: string | null } & Provenance
}

/** Any other uploaded file (PDF, video, document…). */
export type FileNode = BaseNode & {
  type: "file"
  content: { title: string; src: string; mime: string; size: number } & FileFacts & Provenance
}

/** A pasted web link, with a preview (and an embed for YouTube, Vimeo, Figma). */
export type LinkNode = BaseNode & {
  type: "link"
  content: { url: string; title?: string; description?: string; image?: string | null; site?: string; embed?: string | null } & Provenance
}

/** An arrow on a board. Its ends are points relative to the arrow's own x/y (board units);
 *  either end can be attached to another item on the same board (`from` / `to` = its id),
 *  and then follows that item around. */
export type ArrowNode = BaseNode & {
  type: "arrow"
  /** bend: how far a curved arrow bows out, as a share of its length (sideways, signed). */
  content: { x1: number; y1: number; x2: number; y2: number; from?: string | null; to?: string | null; bend?: number } & Partial<ArrowStyle>
}

/** How an arrow is drawn. Unset fields mean straight, solid, pointing at its end. */
export type ArrowStyle = { shape: "straight" | "curved" | "elbow"; line: "solid" | "dotted"; heads: "end" | "start" | "both" | "none" }

export type SceneNode = BoardNode | ImageNode | NoteNode | FileNode | LinkNode | ArrowNode

export type Role = "owner" | "editor" | "viewer"

export type Scene = { rootBoardId: string; nodes: SceneNode[] }

export type LOD = "far" | "medium" | "close"
