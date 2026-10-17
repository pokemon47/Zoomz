import { memo } from "react"
import { fitFontSize, useFontsVersion } from "@/lib/fitText"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type NoteCardProps = {
  title: string
  body: string
  /** The note's size in its own units (its text is fitted to this). */
  w: number
  h: number
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
}

/** Text box inside the note: below the masking tape, inside the padding. */
const PAD_X = 16
const PAD_TOP = 26
const PAD_BOTTOM = 16

/**
 * Lemon slab at −2° with masking tape. However much you write, the text sizes itself to fill
 * the note — a few words are big and bold, a long note is set small — at every zoom level.
 */
export const NoteCard = memo(function NoteCard({ title, body, w, h, lod, selected, tactile, reduced }: NoteCardProps) {
  useFontsVersion()
  const size = fitFontSize(title, body, w - PAD_X * 2, h - PAD_TOP - PAD_BOTTOM)
  return (
    <TactileSlab
      tactile={tactile}
      reduced={reduced}
      baseRotate={-2}
      className={cn("zb-note", `zb-${lod}`, selected && "is-selected")}
      aria-label={`Note: ${title}`}
    >
      <div className="zb-note-text" style={{ fontSize: size }}>
        <div className="zb-note-title">{title}</div>
        {body && <div className="zb-note-body">{body}</div>}
      </div>
    </TactileSlab>
  )
})
