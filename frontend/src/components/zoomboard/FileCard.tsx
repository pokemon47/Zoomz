import { ExternalLink } from "lucide-react"
import { memo } from "react"
import { fileKind, formatBytes } from "@/lib/files"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Progress } from "./ImageCard"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type FileCardProps = {
  title: string
  src: string
  mime: string
  size: number
  /** PDF first page or video poster, when the server made one. */
  preview?: string
  status?: string
  progress?: number
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
}

/** A file as a chunky slab: type tab, name, size; PDFs show their first page, videos play up close. */
export const FileCard = memo(function FileCard({ title, src, mime, size, preview, status, progress, lod, selected, tactile, reduced }: FileCardProps) {
  const kind = fileKind(mime, title)
  const video = mime.startsWith("video/")
  const playable = video && lod === "close" && status !== "uploading"
  return (
    <TactileSlab tactile={tactile} reduced={reduced} className={cn("zb-file", `zb-${lod}`, selected && "is-selected")} aria-label={`File: ${title}`}>
      <div className={cn("zb-file-well", !video && !preview && kind.tone)}>
        {playable ? (
          <video className="zb-file-video" src={src} poster={preview} muted loop playsInline preload="metadata" autoPlay={!reduced} controls data-no-drag />
        ) : preview ? (
          <img className="zb-file-preview" src={preview} alt="" draggable={false} decoding="async" />
        ) : video ? (
          <video className="zb-file-video" src={src} muted playsInline preload="metadata" />
        ) : (
          <kind.Icon className="zb-file-icon" strokeWidth={2.25} aria-hidden />
        )}
        <span className={cn("zb-file-tab", kind.tone)}>{kind.label}</span>
        {progress !== undefined && <Progress value={progress} />}
      </div>
      {lod !== "far" && (
        <div className="zb-file-meta">
          <div className="zb-cap">{title}</div>
          <div className="zb-file-row">
            <span className="zb-meta">{status === "processing" ? "Preparing video…" : formatBytes(size)}</span>
            {lod === "close" && status !== "uploading" && (
              <a className="zb-file-open" href={src} target="_blank" rel="noreferrer" data-no-drag onPointerDown={(e) => e.stopPropagation()}>
                Open <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
              </a>
            )}
          </div>
        </div>
      )}
    </TactileSlab>
  )
})
