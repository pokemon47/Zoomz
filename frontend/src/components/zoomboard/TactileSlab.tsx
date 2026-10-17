import { motion, type HTMLMotionProps, type Transition } from "motion/react"
import { useState } from "react"
import { MOTION, TILT } from "@/lib/constants"
import { cn } from "@/lib/utils"

export type Tactile = "rest" | "hover" | "press" | "drag"

type Props = HTMLMotionProps<"div"> & {
  tactile: Tactile
  reduced: boolean
  /** Resting z-rotation in degrees (notes sit at −2°). */
  baseRotate?: number
}

const SHADOW: Record<Tactile, string> = {
  rest: "var(--zb-l2)",
  hover: "var(--zb-l3)",
  press: "var(--zb-press)",
  drag: "var(--zb-l3)",
}

/**
 * The card face as a physical slab. Transform is sprung by Motion; the box-shadow
 * swaps between lift tokens with a short CSS transition on the active card only.
 */
export function TactileSlab({ tactile, reduced, baseRotate = 0, className, style, children, ...rest }: Props) {
  // Remember which state we came from, so leaving "drag" settles with a bounce.
  const [seen, setSeen] = useState({ current: tactile, from: tactile })
  if (seen.current !== tactile) setSeen({ current: tactile, from: seen.current })
  const from = seen.current !== tactile ? seen.current : seen.from

  const state = reduced && tactile !== "press" ? "rest" : tactile
  const target = {
    rest: { rotateX: 0, rotateY: 0, rotateZ: baseRotate, y: 0, scale: 1 },
    hover: { rotateX: TILT.hover.rotateX, rotateY: TILT.hover.rotateY, rotateZ: baseRotate, y: TILT.hover.y, scale: 1 },
    press: { rotateX: 0, rotateY: 0, rotateZ: baseRotate, y: TILT.press.y, scale: 1 },
    drag: { rotateX: TILT.drag.rotateX, rotateY: 0, rotateZ: baseRotate + TILT.drag.rotateZ, y: TILT.drag.y, scale: TILT.drag.scale },
  }[state]

  let transition: Transition = MOTION.tactile
  if (reduced) transition = { duration: 0 }
  else if (state === "press") transition = MOTION.press
  else if (state === "drag") transition = MOTION.lift
  else if (from === "drag") transition = MOTION.settle

  const shadow = reduced && tactile === "hover" ? SHADOW.rest : SHADOW[tactile]
  const active = tactile !== "rest"

  return (
    <motion.div
      className={cn("zb-card", className)}
      initial={false}
      animate={target}
      transition={transition}
      style={{
        boxShadow: shadow,
        transition: active || from !== "rest" ? "box-shadow 220ms var(--zb-spring)" : undefined,
        willChange: tactile === "drag" ? "transform" : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
