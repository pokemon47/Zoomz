import { motion } from "motion/react"
import { GripHorizontal } from "lucide-react"
import { memo } from "react"
import { MOTION, STACK } from "@/lib/constants"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { Tactile } from "./TactileSlab"

export type BoardCardProps = {
  title: string
  count: number
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
  /** Floor colour of the level inside. */
  innerFloor: string
  /** Inner floor dot grid: pitch and origin in this card's local px, so it lines up with the floor you land on. */
  innerDot: { pitch: number; ox: number; oy: number }
  /** Something is being dragged over this board and would land in it. */
  dropTarget?: boolean
}

function StackLayer({ index, fanned, colour }: { index: 0 | 1; fanned: boolean; colour: string }) {
  const pos = fanned ? STACK.fanned[index] : STACK.rest[index]
  return (
    <motion.div
      className={cn("zb-layer", colour)}
      aria-hidden
      initial={false}
      animate={{ x: pos.x, y: pos.y }}
      transition={MOTION.tactile}
    />
  )
}

/**
 * A board is a place, not a folder: its face is always the (frosted) floor of the
 * level inside, and its contents are drawn on it by the space. The stack underneath
 * shows there is depth to fall into. Grab the title strip to move the whole board.
 */
export const BoardCard = memo(function BoardCard({ title, count, lod, selected, tactile, reduced, innerFloor, innerDot, dropTarget }: BoardCardProps) {
  const fanned = !reduced && (tactile === "hover" || tactile === "drag")
  return (
    <div className="zb-board-wrap">
      <StackLayer index={1} fanned={fanned} colour="zb-mint" />
      <StackLayer index={0} fanned={fanned} colour="zb-lilac" />
      <div
        className={cn(
          "zb-card zb-board",
          lod === "far" && "zb-far",
          selected && "is-selected",
          tactile === "drag" && "is-lifted",
          dropTarget && "is-drop-target",
        )}
      >
        <div
          className="zb-inner-floor"
          aria-hidden
          style={{
            ["--floor-c" as string]: innerFloor,
            ["--dot" as string]: `${innerDot.pitch}px`,
            backgroundPosition: `${innerDot.ox}px ${innerDot.oy}px`,
          }}
        />
        <div className="zb-inner-head" data-board-handle title="Drag to move this board">
          <span className="zb-inner-title">{title}</span>
          <span className="zb-head-meta">
            <span className="zb-meta">{count} items</span>
            <GripHorizontal size={16} strokeWidth={2.25} aria-hidden className="zb-grip" />
          </span>
        </div>
      </div>
    </div>
  )
})
