import { ImagePlus, LayoutGrid, MoveUpRight, StickyNote } from "lucide-react"
import { useRef, useState, type PointerEvent, type ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export type ToolKind = "note" | "board" | "arrow"

type Props = {
  /** Put a new item down: at a screen point (client px) when dropped, else in the middle of the view. */
  onPlace(kind: ToolKind, at: { x: number; y: number } | null): void
  onFiles(files: File[]): void
}

const TOOLS: { kind: ToolKind; label: string; key: string; icon: ReactNode }[] = [
  { kind: "note", label: "Note", key: "N", icon: <StickyNote strokeWidth={2.25} /> },
  { kind: "board", label: "Board", key: "B", icon: <LayoutGrid strokeWidth={2.25} /> },
  { kind: "arrow", label: "Arrow", key: "A", icon: <MoveUpRight strokeWidth={2.25} /> },
]

/**
 * A slim rail of things you can drag onto the canvas. Drag one out and it lands exactly where
 * you let go; click (or press its key) and it lands in the middle of the view.
 */
export function Toolbar({ onPlace, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const drag = useRef<{ kind: ToolKind; sx: number; sy: number; moved: boolean } | null>(null)
  const [ghost, setGhost] = useState<{ kind: ToolKind; x: number; y: number } | null>(null)

  const down = (kind: ToolKind) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind, sx: e.clientX, sy: e.clientY, moved: false }
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
    d.moved = true
    setGhost({ kind: d.kind, x: e.clientX, y: e.clientY })
  }
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    drag.current = null
    setGhost(null)
    if (!d) return
    if (!d.moved) return onPlace(d.kind, null)
    // Only drops on the canvas count (not back on the toolbar or on other controls).
    const under = document.elementFromPoint(e.clientX, e.clientY)
    if (under?.closest(".zb-viewport")) onPlace(d.kind, { x: e.clientX, y: e.clientY })
  }
  const cancel = () => {
    drag.current = null
    setGhost(null)
  }

  return (
    <>
      <div className="zb-toolbar" role="toolbar" aria-orientation="vertical" aria-label="Add to the canvas" data-no-drag>
        {TOOLS.map((t) => (
          <Tooltip key={t.kind}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={`zb-tool${ghost?.kind === t.kind ? " is-dragging" : ""}`}
                  aria-label={`${t.label} — drag onto the canvas, or press ${t.key}`}
                  onPointerDown={down(t.kind)}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={cancel}
                  // Pointer clicks are handled on pointer up; this is Enter / Space.
                  onClick={(e) => e.detail === 0 && onPlace(t.kind, null)}
                />
              }
            >
              {t.icon}
            </TooltipTrigger>
            <TooltipContent className="zb-tip" side="right" sideOffset={10}>
              {t.label} <kbd>{t.key}</kbd>
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
      </div>
      {ghost && (
        <div className={`zb-tool-ghost is-${ghost.kind}`} style={{ left: ghost.x, top: ghost.y }} aria-hidden>
          {ghost.kind === "arrow" ? (
            <svg width="120" height="24" viewBox="0 0 120 24">
              <line x1="4" y1="12" x2="104" y2="12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              <path d="M100 4 L116 12 L100 20 Z" fill="currentColor" />
            </svg>
          ) : null}
        </div>
      )}
    </>
  )
}
