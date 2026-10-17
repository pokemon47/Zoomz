import { motion, useMotionValue, type MotionValue } from "motion/react"
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import type { Tactile } from "@/components/zoomboard/TactileSlab"
import { MOTION } from "@/lib/constants"
import type { SceneNode } from "@/lib/types"

type Props = {
  node: SceneNode
  scale: MotionValue<number>
  opacity?: MotionValue<number>
  label: string
  disabled: boolean
  onSelect(id: string): void
  onMove(id: string, x: number, y: number): void
  onOpen?(id: string): void
  /** Keyboard focus landed on this node (used to keep it in view). */
  onKeyboardFocus?(id: string): void
  children(tactile: Tactile): ReactNode
}

/**
 * Positions a node in board-local coordinates and turns pointer input into the
 * tactile states. Position follows the pointer 1:1 via Motion values (no spring,
 * no React render per frame); only the lift/tilt in the slab springs.
 */
export function SpatialNode({ node, scale, opacity, label, disabled, onSelect, onMove, onOpen, onKeyboardFocus, children }: Props) {
  const x = useMotionValue(node.x)
  const y = useMotionValue(node.y)
  const [tactile, setTactile] = useState<Tactile>("rest")
  const hovered = useRef(false)
  const drag = useRef<{ id: number; sx: number; sy: number; nx: number; ny: number; moved: boolean } | null>(null)

  // Keep in sync if the scene changes underneath us (e.g. a fresh load).
  useEffect(() => {
    if (!drag.current) {
      x.set(node.x)
      y.set(node.y)
    }
  }, [node.x, node.y, x, y])

  const restState = (): Tactile => (hovered.current ? "hover" : "rest")

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled || e.button !== 0) return
    e.stopPropagation() // pressing a node never pans the floor
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, nx: x.get(), ny: y.get(), moved: false }
    setTactile("press")
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < MOTION.dragThreshold) return
    if (!d.moved) {
      d.moved = true
      setTactile("drag")
      onSelect(node.id)
    }
    const s = scale.get()
    x.set(d.nx + dx / s)
    y.set(d.ny + dy / s)
  }

  function endPointer(e: PointerEvent<HTMLDivElement>, cancelled = false) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (d.moved && !cancelled) {
      onMove(node.id, Math.round(x.get()), Math.round(y.get()))
    } else if (d.moved && cancelled) {
      x.set(d.nx)
      y.set(d.ny)
    } else {
      onSelect(node.id)
    }
    setTactile(restState())
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (node.type === "board" && onOpen) onOpen(node.id)
      else onSelect(node.id)
    }
  }

  return (
    <motion.div
      className={`zb-node${tactile === "drag" ? " is-dragging" : ""}`}
      data-node-id={node.id}
      style={{ x, y, width: node.w, height: node.h, opacity }}
      tabIndex={0}
      role="group"
      aria-roledescription={node.type === "board" ? "board" : node.type === "note" ? "note" : "image"}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e)}
      onPointerCancel={(e) => endPointer(e, true)}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return
        hovered.current = true
        if (!drag.current && !disabled) setTactile("hover")
      }}
      onPointerLeave={() => {
        hovered.current = false
        if (!drag.current) setTactile("rest")
      }}
      onDoubleClick={(e) => {
        if (disabled || node.type !== "board" || !onOpen) return
        e.stopPropagation()
        onOpen(node.id)
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible")) onKeyboardFocus?.(node.id)
      }}
      onKeyDown={onKeyDown}
    >
      {children(tactile)}
    </motion.div>
  )
}
