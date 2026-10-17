import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react"
import { ArrowRight } from "lucide-react"
import { MOTION, STACK } from "@/lib/constants"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "./Button"
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
  /** 0 → 1 while the camera dives into this board; drives layers sliding away and the floor tint. */
  dive?: MotionValue<number>
  /** Floor colour of the level inside, revealed as the card fills the screen. */
  innerFloor: string
  onOpen(): void
}

const FALLBACK = ["var(--tomato)", "var(--cobalt)", "var(--lemon)", "var(--mint)"]

function StackLayer({ index, fanned, dive, colour }: { index: 0 | 1; fanned: boolean; dive?: MotionValue<number>; colour: string }) {
  const pos = fanned ? STACK.fanned[index] : STACK.rest[index]
  const zero = useMotionValue(0)
  const d = dive ?? zero
  // During the dive the under-layers slide away and fade: you fall past them.
  const slide = useTransform(d, [0, 0.7], [0, 1])
  const dx = useTransform(slide, (p) => p * (index + 1) * 60)
  const dy = useTransform(slide, (p) => p * (index + 1) * 80)
  const opacity = useTransform(slide, [0, 1], [1, 0])
  return (
    <motion.div className="zb-layer-pos" style={{ position: "absolute", inset: 0, x: dx, y: dy, opacity }} aria-hidden>
      <motion.div
        className={cn("zb-layer", colour)}
        initial={false}
        animate={{ x: pos.x, y: pos.y }}
        transition={MOTION.tactile}
      />
    </motion.div>
  )
}

/** A child board as a stack of slabs: the layers underneath are the levels inside. */
export function BoardCard({ title, description, count, preview, lod, selected, tactile, reduced, dive, innerFloor, onOpen }: BoardCardProps) {
  const fanned = !reduced && (tactile === "hover" || tactile === "drag")
  const zero = useMotionValue(0)
  const tint = useTransform(dive ?? zero, [0.35, 0.9], [0, 1])
  const tiles = preview.slice(0, 4)

  return (
    <div className="zb-board-wrap">
      <StackLayer index={1} fanned={fanned} dive={dive} colour="zb-mint" />
      <StackLayer index={0} fanned={fanned} dive={dive} colour="zb-lilac" />
      <TactileSlab
        tactile={tactile}
        reduced={reduced}
        className={cn("zb-board", lod === "far" && "zb-far", selected && "is-selected")}
        style={{ position: "relative", zIndex: 1 }}
      >
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
              <Button variant="cobalt" size="sm" data-no-drag onClick={onOpen} aria-label={`Open board ${title}`}>
                Open board <ArrowRight size={14} strokeWidth={2.5} aria-hidden />
              </Button>
            </div>
          )}
          {lod === "close" && description && <p className="zb-meta zb-board-desc">{description}</p>}
        </div>
        {/* the floor of the level inside, revealed as the card fills the viewport */}
        <motion.div
          aria-hidden
          style={{ position: "absolute", inset: -1, borderRadius: "inherit", background: innerFloor, opacity: tint, pointerEvents: "none" }}
        />
      </TactileSlab>
      {lod === "far" && selected && (
        <div className="zb-handle" data-no-drag>
          <Button variant="cobalt" size="sm" onClick={onOpen} aria-label={`Open board ${title}`}>
            Open board <ArrowRight size={14} strokeWidth={2.5} aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}
