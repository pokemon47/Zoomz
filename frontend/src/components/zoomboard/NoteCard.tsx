import { memo, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react"
import { colorById } from "@/lib/colors"
import { fitFontSize, useFontsVersion } from "@/lib/fitText"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type NoteField = "title" | "body"

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
  /** Being edited in place: which field has the caret. */
  editing?: NoteField | null
  /** One of the card colours (lib/colors); unset = lemon. */
  color?: string | null
  /** Editing finished: the new text (unchanged fields included). */
  onDone?(next: { title: string; body: string }): void
}

/** Text box inside the note: below the masking tape, inside the padding. */
const PAD_X = 16
const PAD_TOP = 26
const PAD_BOTTOM = 16

/**
 * Lemon slab at −2° with masking tape. However much you write, the text sizes itself to fill
 * the note — a few words are big and bold, a long note is set small — at every zoom level.
 * Click the text to edit it right there.
 */
export const NoteCard = memo(function NoteCard({ title, body, w, h, lod, selected, tactile, reduced, editing, onDone, color }: NoteCardProps) {
  useFontsVersion()
  const editingNow = !!editing && !!onDone
  const c = colorById(color)
  return (
    <TactileSlab
      tactile={editingNow ? "rest" : tactile}
      reduced={reduced}
      baseRotate={-2}
      className={cn("zb-note", `zb-${lod}`, selected && "is-selected", editingNow && "is-editing", c && `is-${c.id}`)}
      style={c ? ({ ["--face" as string]: c.face, ["--side" as string]: c.side, color: c.ink } as CSSProperties) : undefined}
      aria-label={`Note: ${title}`}
    >
      {editingNow ? (
        <NoteEditor title={title} body={body} w={w} h={h} field={editing!} onDone={onDone!} />
      ) : (
        <NoteText title={title} body={body} w={w} h={h} />
      )}
    </TactileSlab>
  )
})

function NoteText({ title, body, w, h }: { title: string; body: string; w: number; h: number }) {
  const size = fitFontSize(title, body, w - PAD_X * 2, h - PAD_TOP - PAD_BOTTOM)
  if (!title && !body)
    return (
      <div className="zb-note-text" style={{ fontSize: 18 }}>
        <div className="zb-note-empty" data-edit="body">
          Write something…
        </div>
      </div>
    )
  return (
    <div className="zb-note-text" style={{ fontSize: size }}>
      {title && (
        <div className="zb-note-title" data-edit="title">
          {title}
        </div>
      )}
      {body && (
        <div className="zb-note-body" data-edit="body">
          {body}
        </div>
      )}
    </div>
  )
}

/** The note's own text, editable where it sits; the type keeps fitting the note as you write. */
function NoteEditor({ title, body, w, h, field, onDone }: { title: string; body: string; w: number; h: number; field: NoteField; onDone(next: { title: string; body: string }): void }) {
  const [t, setT] = useState(title)
  const [b, setB] = useState(body)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  // Leave room for the empty title line while you write, so the text doesn't jump.
  const size = Math.min(40, fitFontSize(t || "Title", b || " ", w - PAD_X * 2, h - PAD_TOP - PAD_BOTTOM))

  useEffect(() => {
    const el = field === "title" ? titleRef.current : bodyRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [field])

  const finish = () => {
    if (done.current) return
    done.current = true
    onDone({ title: t.trim(), body: b.replace(/\s+$/, "") })
  }
  // Scrolled out of view mid-edit (the card unmounts): keep what was typed.
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
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish()
  }
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      finish()
    }
  }

  return (
    <div className="zb-note-text zb-note-edit" style={{ fontSize: size }} onBlur={onBlur} data-editor>
      <input
        ref={titleRef}
        className="zb-note-title"
        value={t}
        maxLength={120}
        placeholder="Title"
        aria-label="Note title"
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            bodyRef.current?.focus()
          }
          onKey(e)
        }}
      />
      <textarea ref={bodyRef} className="zb-note-body" value={b} placeholder="Write something…" aria-label="Note text" onChange={(e) => setB(e.target.value)} onKeyDown={onKey} />
    </div>
  )
}
