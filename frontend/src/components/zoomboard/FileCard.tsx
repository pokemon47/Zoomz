import { ExternalLink } from "lucide-react"
import { memo } from "react"
import { fileKind, formatBytes } from "@/lib/files"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type FileCardProps = {
  title: string
  src: string
  mime: string
  size: number
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
}

/** A dropped file as a chunky slab: type tab, name, size; videos preview inline. */
export const FileCard = memo(function FileCard({ title, src, mime, size, lod, selected, tactile, reduced }: FileCardProps) {
  const kind = fileKind(mime, title)
  const video = mime.startsWith("video/")
  return (
    <TactileSlab tactile={tactile} reduced={reduced} className={cn("zb-file", `zb-${lod}`, selected && "is-selected")} aria-label={`File: ${title}`}>
      <div className={cn("zb-file-well", !video && kind.tone)}>
        {video ? (
          <video className="zb-file-video" src={src} muted loop playsInline preload="metadata" autoPlay={lod === "close" && !reduced} />
        ) : (
          <kind.Icon className="zb-file-icon" strokeWidth={2.25} aria-hidden />
        )}
        <span className={cn("zb-file-tab", kind.tone)}>{kind.label}</span>
      </div>
      {lod !== "far" && (
        <div key={lod} className="zb-lod-block zb-file-meta">
          <div className="zb-cap">{title}</div>
          <div className="zb-file-row">
            <span className="zb-meta">{formatBytes(size)}</span>
            {lod === "close" && (
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
