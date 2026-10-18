import { motion } from "motion/react"
import { GripHorizontal } from "lucide-react"
import { memo, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react"
import { colorById } from "@/lib/colors"
import { MOTION, STACK } from "@/lib/constants"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { Tactile } from "./TactileSlab"

export type BoardCardProps = {
  title: string
  /** Caption, shown under the title once the board is big enough to read it. */
  description?: string | null
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
  /** You may edit its title and description (shows the description field when selected). */
  editable?: boolean
  /** Being edited in place: which field has the caret. */
  editing?: BoardField | null
  /** One of the card colours (lib/colors): the board's rim, label and the stack under it. */
  color?: string | null
  /** Editing finished: the new title and description. */
  onDone?(next: { title: string; description: string }): void
}

export type BoardField = "title" | "description"

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
export const BoardCard = memo(function BoardCard({ title, description, count, lod, selected, tactile, reduced, innerFloor, innerDot, dropTarget, editable, editing, onDone, color }: BoardCardProps) {
  const fanned = !reduced && (tactile === "hover" || tactile === "drag")
  const c = colorById(color)
  return (
    <div className={cn("zb-board-wrap", c && "is-tinted")} style={c ? ({ ["--tint" as string]: c.face, ["--tint-side" as string]: c.side, ["--tint-ink" as string]: c.ink } as CSSProperties) : undefined}>
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
          {editing && onDone ? (
            <BoardLabelEditor title={title} description={description ?? ""} field={editing} showDescription onDone={onDone} />
          ) : (
            <span className="zb-inner-titles">
              <span className={cn("zb-inner-title", !title && "is-empty")} data-edit="title">
                {title || "Untitled board"}
              </span>
              {lod !== "far" &&
                (description ? (
                  <span className="zb-inner-caption" data-edit="description">
                    {description}
                  </span>
                ) : (
                  editable &&
                  selected && (
                    <span className="zb-inner-caption is-empty" data-edit="description">
                      Add a description
                    </span>
                  )
                ))}
            </span>
          )}
          <span className="zb-head-meta">
            <span className="zb-meta">{count} items</span>
            <GripHorizontal size={16} strokeWidth={2.25} aria-hidden className="zb-grip" />
          </span>
        </div>
      </div>
    </div>
  )
})

/** The board's title and description, editable where they sit in its title strip. */
function BoardLabelEditor({ title, description, field, showDescription, onDone }: { title: string; description: string; field: BoardField; showDescription: boolean; onDone(next: { title: string; description: string }): void }) {
  const [t, setT] = useState(title)
  const [d, setD] = useState(description)
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const el = field === "description" && showDescription ? descRef.current : titleRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.select()
  }, [field, showDescription])

  const finish = () => {
    if (done.current) return
    done.current = true
    onDone({ title: t.trim(), description: d.trim() })
  }
  const latest = useRef(finish)
  useEffect(() => {
    latest.current = finish
  })
  // Only a real unmount saves: React's development double-mount remounts straight away.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => !mounted.current && latest.current())
    }
  }, [])

  const onBlur = (e: FocusEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish()
  }
  const focusDescription = () => descRef.current?.focus()
  const onKey = (next?: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === "Escape") {
      e.preventDefault()
      finish()
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (next && !e.shiftKey) next()
      else finish()
    }
  }
  return (
    <span className="zb-inner-titles zb-label-edit" onBlur={onBlur} data-editor>
      <input ref={titleRef} className="zb-inner-title" value={t} maxLength={120} placeholder="Untitled board" aria-label="Board title" onChange={(e) => setT(e.target.value)} onKeyDown={onKey(showDescription ? focusDescription : undefined)} />
      {showDescription && (
        <input ref={descRef} className="zb-inner-caption" value={d} maxLength={600} placeholder="Add a description" aria-label="Board description" onChange={(e) => setD(e.target.value)} onKeyDown={onKey()} />
      )}
    </span>
  )
}
