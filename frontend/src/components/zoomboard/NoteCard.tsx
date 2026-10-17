import { memo } from "react"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type NoteCardProps = {
  title: string
  body: string
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
}

/** Lemon slab at −2° with masking tape. Title always; body only up close. */
export const NoteCard = memo(function NoteCard({ title, body, lod, selected, tactile, reduced }: NoteCardProps) {
  return (
    <TactileSlab
      tactile={tactile}
      reduced={reduced}
      baseRotate={-2}
      className={cn("zb-note", `zb-${lod}`, selected && "is-selected")}
      aria-label={`Note: ${title}`}
    >
      <div key={lod} className="zb-lod-block">
        <h4>{title}</h4>
        {lod === "close" && <p>{body}</p>}
        {lod === "medium" && <p className="zb-meta" aria-hidden>Zoom in to read</p>}
      </div>
    </TactileSlab>
  )
})
