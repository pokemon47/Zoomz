import { memo } from "react"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type ImageCardProps = {
  title: string
  alt: string
  src: string
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
}

/** The image as a mounted print on a neutral mat. Far: compact tile. Close: larger image + caption. */
export const ImageCard = memo(function ImageCard({ title, alt, src, lod, selected, tactile, reduced }: ImageCardProps) {
  return (
    <TactileSlab
      tactile={tactile}
      reduced={reduced}
      className={cn("zb-img", `zb-${lod}`, selected && "is-selected")}
      role="img"
      aria-label={`${title}: ${alt}`}
    >
      <img className="zb-ph" src={src} alt="" draggable={false} decoding="async" />
      {lod !== "far" && (
        <div key={lod} className="zb-lod-block">
          <div className="zb-cap">{title}</div>
          {lod === "close" && <div className="zb-alt">{alt}</div>}
        </div>
      )}
    </TactileSlab>
  )
})
