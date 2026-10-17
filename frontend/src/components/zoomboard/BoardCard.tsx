import { motion } from "motion/react"
import { memo } from "react"
import { MOTION, STACK } from "@/lib/constants"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type BoardCardProps = {
  title: string
  description?: string | null
  count: number
  preview: { src: string; alt: string }[]
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
  /** Whether contents are being drawn on the face (cover hidden). Continuous value comes via --reveal. */
  open: boolean
  /** Floor colour of the level inside. */
  innerFloor: string
  /** Dot pitch of the inner floor in this card's local px (24 × the inner scale). */
  innerDot: number
}

const FALLBACK = ["var(--tomato)", "var(--cobalt)", "var(--lemon)", "var(--mint)"]

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
 * A board as a stack of slabs. Far away it is a closed cover (mosaic + title). As you
 * approach, the cover fades and the face becomes the floor of the level inside, on which
 * the board's own contents are drawn — keep zooming and you are standing in it.
 */
export const BoardCard = memo(function BoardCard({
  title,
  description,
  count,
  preview,
  lod,
  selected,
  tactile,
  reduced,
  open,
  innerFloor,
  innerDot,
}: BoardCardProps) {
  const fanned = !reduced && !open && (tactile === "hover" || tactile === "drag")
  const tiles = preview.slice(0, 4)

  return (
    <div className="zb-board-wrap">
      <StackLayer index={1} fanned={fanned} colour="zb-mint" />
      <StackLayer index={0} fanned={fanned} colour="zb-lilac" />
      <TactileSlab
        tactile={open ? "rest" : tactile}
        reduced={reduced}
        className={cn("zb-board", lod === "far" && "zb-far", selected && !open && "is-selected")}
        style={{ position: "relative", zIndex: 1 }}
      >
        {/* the floor of the level inside: revealed as you approach */}
        <div
          className="zb-inner-floor"
          aria-hidden
          style={{ background: innerFloor, ["--dot" as string]: `${innerDot}px` }}
        />
        <div className="zb-inner-head" aria-hidden>
          <span className="zb-inner-title">{title}</span>
          <span className="zb-meta">{count} items</span>
        </div>
        {/* the closed cover */}
        <div className="zb-cover">
          <div className="zb-mosaic" aria-hidden>
            {tiles.length
              ? tiles.map((t) => <img key={t.src} src={t.src} alt="" draggable={false} decoding="async" />)
              : FALLBACK.map((c) => <i key={c} style={{ ["--c" as string]: c }} />)}
          </div>
          <div key={lod} className="zb-lod-block">
            <h3>{title}</h3>
            {lod !== "far" && (
              <div className="zb-board-row">
                <span className="zb-meta">{count} items</span>
                <span className="zb-zoomin" aria-hidden>
                  zoom in
                </span>
              </div>
            )}
            {lod === "close" && description && <p className="zb-meta zb-board-desc">{description}</p>}
          </div>
        </div>
      </TactileSlab>
    </div>
  )
})
