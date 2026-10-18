import { createPortal } from "react-dom"
import { ImagePlus, LayoutGrid, MoveUpRight, StickyNote } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DEFAULT_ARROW } from "@/lib/arrows"
import type { ArrowStyle } from "@/lib/types"
import { ArrowGlyph, ArrowStyleControls } from "./ArrowStyle"

export type ToolKind = "note" | "board" | "arrow"

type Props = {
  /** Put a new item down: at a screen point (client px) when dropped, else in the middle of the view. */
  onPlace(kind: ToolKind, at: { x: number; y: number } | null, arrow?: ArrowStyle): void
  onFiles(files: File[]): void
}

const TOOLS: { kind: ToolKind; label: string; key: string; icon: ReactNode }[] = [
  { kind: "note", label: "Note", key: "N", icon: <StickyNote strokeWidth={2.25} /> },
  { kind: "board", label: "Board", key: "B", icon: <LayoutGrid strokeWidth={2.25} /> },
  { kind: "arrow", label: "Arrow", key: "A", icon: <MoveUpRight strokeWidth={2.25} /> },
]

const STYLE_KEY = "zoomz.arrowStyle"
function loadStyle(): ArrowStyle {
  try {
    return { ...DEFAULT_ARROW, ...(JSON.parse(localStorage.getItem(STYLE_KEY) ?? "{}") as Partial<ArrowStyle>) }
  } catch {
    return DEFAULT_ARROW
  }
}

/**
 * A slim rail of things you can drag onto the canvas. Drag one out and it lands exactly where
 * you let go; click a note or board (or press its key) and it lands in the middle of the view.
 * Clicking the arrow opens its styles (curved, dotted, direction); drag the arrow from there.
 */
export function Toolbar({ onPlace, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const drag = useRef<{ kind: ToolKind; sx: number; sy: number; moved: boolean } | null>(null)
  const [ghost, setGhost] = useState<{ kind: ToolKind; x: number; y: number } | null>(null)
  const [arrowStyle, setArrowStyle] = useState<ArrowStyle>(loadStyle)
  const [arrowOpen, setArrowOpen] = useState(false)
  const flyout = useRef<HTMLDivElement>(null)
  const arrowBtn = useRef<HTMLButtonElement>(null)

  const chooseStyle = (s: ArrowStyle) => {
    setArrowStyle(s)
    try {
      localStorage.setItem(STYLE_KEY, JSON.stringify(s))
    } catch {
      /* private mode */
    }
  }

  // Beside the arrow button, kept inside the window.
  const [flyPos, setFlyPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!arrowOpen) return setFlyPos(null)
    const place = () => {
      const b = arrowBtn.current?.getBoundingClientRect()
      const bar = arrowBtn.current?.closest(".zb-toolbar")?.getBoundingClientRect()
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
  }, [arrowOpen])

  // The arrow options close when you click elsewhere or press Escape.
  useEffect(() => {
    if (!arrowOpen) return
    const away = (e: globalThis.PointerEvent) => {
      const t = e.target as Node
      if (!flyout.current?.contains(t) && !arrowBtn.current?.contains(t)) setArrowOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setArrowOpen(false)
    document.addEventListener("pointerdown", away, true)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerdown", away, true)
      document.removeEventListener("keydown", esc)
    }
  }, [arrowOpen])

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
  const up = (fromFlyout: boolean) => (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    drag.current = null
    setGhost(null)
    if (!d) return
    if (!d.moved) {
      // A click: notes and boards go in the middle; the arrow opens (or, in its menu, places).
      if (d.kind === "arrow" && !fromFlyout) return setArrowOpen((o) => !o)
      if (d.kind === "arrow") setArrowOpen(false)
      return onPlace(d.kind, null, arrowStyle)
    }
    // Only drops on the canvas count (not back on the toolbar or on other controls).
    const under = document.elementFromPoint(e.clientX, e.clientY)
    if (under?.closest(".zb-viewport")) {
      onPlace(d.kind, { x: e.clientX, y: e.clientY }, arrowStyle)
      if (d.kind === "arrow") setArrowOpen(false)
    }
  }
  const cancel = () => {
    drag.current = null
    setGhost(null)
  }
  const dragProps = (kind: ToolKind, fromFlyout = false) => ({ onPointerDown: down(kind), onPointerMove: move, onPointerUp: up(fromFlyout), onPointerCancel: cancel })

  return (
    <>
      <div className="zb-toolbar" role="toolbar" aria-orientation="vertical" aria-label="Add to the canvas" data-no-drag>
        {TOOLS.map((t) => (
          <Tooltip key={t.kind} disabled={t.kind === "arrow" && arrowOpen}>
            <TooltipTrigger
              render={
                <button
                  ref={t.kind === "arrow" ? arrowBtn : undefined}
                  type="button"
                  className={`zb-tool${ghost?.kind === t.kind ? " is-dragging" : ""}${t.kind === "arrow" && arrowOpen ? " is-open" : ""}`}
                  aria-label={t.kind === "arrow" ? "Arrow — click for styles, or drag onto the canvas" : `${t.label} — drag onto the canvas, or press ${t.key}`}
                  aria-expanded={t.kind === "arrow" ? arrowOpen : undefined}
                  {...dragProps(t.kind)}
                  // Pointer clicks are handled on pointer up; this is Enter / Space.
                  onClick={(e) => e.detail === 0 && (t.kind === "arrow" ? setArrowOpen((o) => !o) : onPlace(t.kind, null))}
                />
              }
            >
              {t.kind === "arrow" ? <ArrowGlyph style={arrowStyle} width={24} height={16} strokeWidth={2} headFactor={2.4} /> : t.icon}
            </TooltipTrigger>
            <TooltipContent className="zb-tip" side="right" sideOffset={10}>
              {t.kind === "arrow" ? "Arrow — click for styles" : t.label} <kbd>{t.key}</kbd>
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
        {arrowOpen &&
          createPortal(
          <div ref={flyout} className={`zb-arrow-flyout${ghost?.kind === "arrow" ? " is-carrying" : ""}`} role="dialog" aria-label="Arrow styles" style={flyPos ?? { visibility: "hidden" }}>
            <ArrowStyleControls value={arrowStyle} onChange={chooseStyle} />
            <button type="button" className={`zb-arrow-drag${ghost?.kind === "arrow" ? " is-dragging" : ""}`} aria-label="Drag this arrow onto the canvas (or click to add it in the middle)" {...dragProps("arrow", true)}>
              <ArrowGlyph style={arrowStyle} width={64} height={26} strokeWidth={2.5} />
              <span>Drag onto the canvas</span>
            </button>
          </div>,
          document.body,
        )}
      </div>
      {ghost && (
        <div className={`zb-tool-ghost is-${ghost.kind}`} style={{ left: ghost.x, top: ghost.y }} aria-hidden>
          {ghost.kind === "arrow" ? <ArrowGlyph style={arrowStyle} width={120} height={40} strokeWidth={3} /> : null}
        </div>
      )}
    </>
  )
}
