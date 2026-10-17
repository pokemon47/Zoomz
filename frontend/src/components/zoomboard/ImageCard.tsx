import { memo } from "react"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type ImageCardProps = {
  title: string
  alt: string
  /** The resolution to show at this size (small thumbnail far away, original up close). */
  src: string
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
  /** 0–1 while uploading. */
  progress?: number
}

/** The image as a mounted print on a neutral mat. Far: compact tile. Close: larger image + caption. */
export const ImageCard = memo(function ImageCard({ title, alt, src, lod, selected, tactile, reduced, progress }: ImageCardProps) {
  return (
    <TactileSlab
      tactile={tactile}
      reduced={reduced}
      className={cn("zb-img", `zb-${lod}`, selected && "is-selected")}
      role="img"
      aria-label={`${title}: ${alt}`}
    >
      <img className="zb-ph" src={src} alt="" draggable={false} decoding="async" />
      {progress !== undefined && <Progress value={progress} />}
      {lod !== "far" && (
        <div>
          <div className="zb-cap">{title}</div>
          {lod === "close" && <div className="zb-alt">{alt}</div>}
        </div>
      )}
    </TactileSlab>
  )
})

/** Upload progress as a small lemon bar across the print. */
export function Progress({ value }: { value: number }) {
  return (
    <div className="zb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label="Uploading">
      <i style={{ width: `${Math.max(6, value * 100)}%` }} />
    </div>
  )
}
