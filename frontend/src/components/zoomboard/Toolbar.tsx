import { createPortal } from "react-dom"
import { ImagePlus, LayoutGrid, StickyNote } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DEFAULT_ARROW } from "@/lib/arrows"
import { colorById } from "@/lib/colors"
import type { ArrowStyle } from "@/lib/types"
import { ArrowGlyph, ArrowStyleControls } from "./ArrowStyle"
import { ColorSwatches } from "./ColorSwatches"

export type ToolKind = "note" | "board" | "arrow"
/** What a new item looks like: an arrow's style, or a note's / board's colour. */
export type ToolLook = { arrow: ArrowStyle; note: string | null; board: string | null }

type Props = {
  /** Put a new item down: at a screen point (client px) when dropped, else in the middle of the view. */
  onPlace(kind: ToolKind, at: { x: number; y: number } | null, look: ToolLook): void
  onFiles(files: File[]): void
}

const LABEL: Record<ToolKind, { name: string; key: string; menu: string }> = {
  note: { name: "Note", key: "N", menu: "Note colour" },
  board: { name: "Board", key: "B", menu: "Board colour" },
  arrow: { name: "Arrow", key: "A", menu: "Arrow styles" },
}

const LOOK_KEY = { arrow: "zoomz.arrowStyle", note: "zoomz.noteColor", board: "zoomz.boardColor" }

/** The look last picked in the toolbar (the N / B / A keys use it too). */
export function lastLook(): ToolLook {
  const read = (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  }
  let arrow = DEFAULT_ARROW
  try {
    arrow = { ...DEFAULT_ARROW, ...(JSON.parse(read(LOOK_KEY.arrow) ?? "{}") as Partial<ArrowStyle>) }
  } catch {
    /* keep the default */
  }
  const note = read(LOOK_KEY.note)
  const board = read(LOOK_KEY.board)
  return { arrow, note: colorById(note) ? note : null, board: colorById(board) ? board : null }
}

/**
 * A slim rail of things you can drag onto the canvas; each lands exactly where you let go.
 * Clicking a tool opens its options (a note's or board's colour, an arrow's style) with a
 * preview you can drag out or click to place in the middle of the view. Dragging the tool
 * itself uses whatever was picked last.
 */
export function Toolbar({ onPlace, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const drag = useRef<{ kind: ToolKind; sx: number; sy: number; moved: boolean } | null>(null)
  const [ghost, setGhost] = useState<{ kind: ToolKind; x: number; y: number } | null>(null)
  const [look, setLook] = useState<ToolLook>(lastLook)
  const [open, setOpen] = useState<ToolKind | null>(null)
  const flyout = useRef<HTMLDivElement>(null)
  const buttons = useRef<Record<ToolKind, HTMLButtonElement | null>>({ note: null, board: null, arrow: null })

  const choose = <K extends ToolKind>(kind: K, value: ToolLook[K]) => {
    setLook((l) => ({ ...l, [kind]: value }))
    try {
      if (value === null) localStorage.removeItem(LOOK_KEY[kind])
      else localStorage.setItem(LOOK_KEY[kind], typeof value === "string" ? value : JSON.stringify(value))
    } catch {
      /* private mode */
    }
  }

  // Beside its tool, kept inside the window.
  const [flyPos, setFlyPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) return setFlyPos(null)
    const place = () => {
      const b = buttons.current[open]?.getBoundingClientRect()
      const bar = buttons.current[open]?.closest(".zb-toolbar")?.getBoundingClientRect()
      const f = flyout.current
      if (!b || !bar || !f) return
      const h = f.offsetHeight, w = f.offsetWidth
      setFlyPos({
        left: Math.min(bar.right + 12, window.innerWidth - w - 8),
        top: Math.max(8, Math.min(b.top + b.height / 2 - h / 2, window.innerHeight - h - 8)),
      })
    }
    place()
    window.addEventListener("resize", place)
    return () => window.removeEventListener("resize", place)
  }, [open])

  // The menu closes when you click elsewhere or press Escape.
  useEffect(() => {
    if (!open) return
    const away = (e: globalThis.PointerEvent) => {
      const t = e.target as Node
      if (!flyout.current?.contains(t) && !buttons.current[open]?.contains(t)) setOpen(null)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null)
    document.addEventListener("pointerdown", away, true)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerdown", away, true)
      document.removeEventListener("keydown", esc)
    }
  }, [open])

  const down = (kind: ToolKind) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind, sx: e.clientX, sy: e.clientY, moved: false }
  }
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
    d.moved = true
    setGhost({ kind: d.kind, x: e.clientX, y: e.clientY })
  }
  const up = (fromMenu: boolean) => (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    drag.current = null
    setGhost(null)
    if (!d) return
    if (!d.moved) {
      // A click on a tool opens (or closes) its options; a click on the preview places it.
      if (!fromMenu) return setOpen((o) => (o === d.kind ? null : d.kind))
      setOpen(null)
      return onPlace(d.kind, null, look)
    }
    // Only drops on the canvas count (not back on the toolbar or on other controls).
    const under = document.elementFromPoint(e.clientX, e.clientY)
    if (under?.closest(".zb-viewport")) {
      onPlace(d.kind, { x: e.clientX, y: e.clientY }, look)
      setOpen(null)
    }
  }
  const cancel = () => {
    drag.current = null
    setGhost(null)
  }
  const dragProps = (kind: ToolKind, fromMenu = false) => ({ onPointerDown: down(kind), onPointerMove: move, onPointerUp: up(fromMenu), onPointerCancel: cancel })

  const icon = (kind: ToolKind) => {
    if (kind === "arrow") return <ArrowGlyph style={look.arrow} width={24} height={16} strokeWidth={2} headFactor={2.4} />
    const c = colorById(look[kind])
    const Icon = kind === "note" ? StickyNote : LayoutGrid
    return (
      <span className="zb-tool-icon">
        <Icon strokeWidth={2.25} />
        {c && <i className="zb-tool-dot" style={{ background: c.face, boxShadow: `0 0 0 1.5px ${c.side}` }} />}
      </span>
    )
  }

  return (
    <>
      <div className="zb-toolbar" role="toolbar" aria-orientation="vertical" aria-label="Add to the canvas" data-no-drag>
        {(["note", "board", "arrow"] as ToolKind[]).map((kind) => (
          <Tooltip key={kind} disabled={open === kind}>
            <TooltipTrigger
              render={
                <button
                  ref={(el) => {
                    buttons.current[kind] = el
                  }}
                  type="button"
                  className={`zb-tool${ghost?.kind === kind ? " is-dragging" : ""}${open === kind ? " is-open" : ""}`}
                  aria-label={`${LABEL[kind].name} — click for ${kind === "arrow" ? "styles" : "colours"}, or drag onto the canvas`}
                  aria-expanded={open === kind}
                  {...dragProps(kind)}
                  // Pointer clicks are handled on pointer up; this is Enter / Space.
                  onClick={(e) => e.detail === 0 && setOpen((o) => (o === kind ? null : kind))}
                />
              }
            >
              {icon(kind)}
            </TooltipTrigger>
            <TooltipContent className="zb-tip" side="right" sideOffset={10}>
              {LABEL[kind].name} — click for {kind === "arrow" ? "styles" : "colours"} <kbd>{LABEL[kind].key}</kbd>
            </TooltipContent>
          </Tooltip>
        ))}
        <span className="zb-tool-sep" aria-hidden />
        <Tooltip>
          <TooltipTrigger render={<button type="button" className="zb-tool" aria-label="Add images and files" onClick={() => input.current?.click()} />}>
            <ImagePlus strokeWidth={2.25} />
          </TooltipTrigger>
          <TooltipContent className="zb-tip" side="right" sideOffset={10}>
            Images & files — or drop them anywhere
          </TooltipContent>
        </Tooltip>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) onFiles(files)
            e.target.value = ""
          }}
        />
        {open &&
          createPortal(
            <div
              ref={flyout}
              className={`zb-arrow-flyout${ghost?.kind === open ? " is-carrying" : ""}`}
              role="dialog"
              aria-label={LABEL[open].menu}
              style={flyPos ?? { visibility: "hidden" }}
            >
              {open === "arrow" ? (
                <ArrowStyleControls value={look.arrow} onChange={(s) => choose("arrow", s)} />
              ) : (
                <ColorSwatches value={look[open] ?? (open === "note" ? "lemon" : null)} plain={open === "board"} onChange={(c) => choose(open, c === "lemon" && open === "note" ? null : c)} />
              )}
              <button
                type="button"
                className={`zb-arrow-drag${ghost?.kind === open ? " is-dragging" : ""}`}
                aria-label={`Drag this ${LABEL[open].name.toLowerCase()} onto the canvas (or click to add it in the middle)`}
                {...dragProps(open, true)}
              >
                <Preview kind={open} look={look} />
                <span>Drag onto the canvas</span>
              </button>
            </div>,
            document.body,
          )}
      </div>
      {ghost && (
        <div className={`zb-tool-ghost is-${ghost.kind}`} style={{ left: ghost.x, top: ghost.y, ...lookStyle(ghost.kind, look) }} aria-hidden>
          {ghost.kind === "arrow" ? <ArrowGlyph style={look.arrow} width={120} height={40} strokeWidth={3} /> : null}
        </div>
      )}
    </>
  )
}

/** Colours for the ghost / preview of a note or board. */
function lookStyle(kind: ToolKind, look: ToolLook): CSSProperties {
  if (kind === "arrow") return {}
  const c = colorById(look[kind])
  if (!c) return {}
  return kind === "note" ? { background: c.face, boxShadow: `0 5px 0 0 ${c.side}, 0 16px 24px -10px rgba(0, 0, 0, 0.3)` } : { boxShadow: `inset 0 0 0 4px ${c.face}, 6px 7px 0 0 ${c.face}, 12px 14px 0 0 ${c.side}, 0 18px 26px -12px rgba(0, 0, 0, 0.3)` }
}

function Preview({ kind, look }: { kind: ToolKind; look: ToolLook }) {
  if (kind === "arrow") return <ArrowGlyph style={look.arrow} width={64} height={26} strokeWidth={2.5} />
  return <span className={`zb-tool-preview is-${kind}`} style={lookStyle(kind, look)} />
}
