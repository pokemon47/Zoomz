// Things drawn in screen space over the board: other people's cursors, the selection
// marquee, the resize grip, and the in-place text editor.

import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { Peer } from "@/lib/store"
import type { Cam, Space, Viewport } from "@/lib/space"

export function RemoteCursors({ peers, space, cam, vp, me }: { peers: Peer[]; space: Space; cam: Cam; vp: Viewport; me: string | null }) {
  return (
    <div className="zb-cursors" aria-hidden>
      {peers.map((p) => {
        if (p.connId === me || !p.cursor || !space.node(p.cursor.b)) return null
        const c = space.toFrame(cam, p.cursor.b)
        const x = p.cursor.x * c.s + c.x
        const y = p.cursor.y * c.s + c.y
        if (x < -20 || y < -20 || x > vp.w + 20 || y > vp.h + 20) return null
        return (
          <div key={p.connId} className="zb-cursor" style={{ transform: `translate(${x}px, ${y}px)`, ["--pc" as string]: p.color } as CSSProperties}>
            <svg width="20" height="22" viewBox="0 0 20 22">
              <path d="M2 2 L17 10 L10 12 L7 19 Z" fill="var(--pc)" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <span className="zb-cursor-name">{p.name}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Marquee({ rect }: { rect: { x: number; y: number; w: number; h: number } }) {
  return <div className="zb-marquee" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} aria-hidden />
}

export type EditTarget = {
  id: string
  kind: "note" | "board"
  title: string
  body: string
  /** Screen rect of the card (or of the board's title strip). */
  rect: { x: number; y: number; w: number; h: number }
}

/** Edit a note's title and text, or a board's name, right where it sits. */
export function EditOverlay({ target, onSave, onCancel }: { target: EditTarget; onSave(title: string, body: string): void; onCancel(): void }) {
  const [title, setTitle] = useState(target.title)
  const [body, setBody] = useState(target.body)
  const done = useRef(false)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    first.current?.focus()
    first.current?.select()
  }, [])
  const save = () => {
    if (done.current) return
    done.current = true
    onSave(title.trim() || target.title, body)
  }
  const cancel = () => {
    done.current = true
    onCancel()
  }
  const w = Math.max(target.kind === "board" ? 260 : 240, Math.min(target.rect.w, 520))
  const style: CSSProperties = {
    left: Math.max(8, Math.min(target.rect.x, window.innerWidth - w - 8)),
    top: Math.max(8, Math.min(target.rect.y, window.innerHeight - (target.kind === "note" ? 240 : 64))),
    width: w,
  }
  return (
    <div
      className={`zb-editor zb-editor-${target.kind}`}
      style={style}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Escape") cancel()
        if (e.key === "Enter" && (target.kind === "board" || e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === "INPUT")) {
          e.preventDefault()
          save()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input ref={first} className="zb-editor-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label={target.kind === "note" ? "Note title" : "Board name"} />
      {target.kind === "note" && (
        <textarea className="zb-editor-body" value={body} maxLength={4000} rows={5} onChange={(e) => setBody(e.target.value)} aria-label="Note text" onBlur={save} />
      )}
      <div className="zb-editor-row">
        <span className="zb-meta">{target.kind === "note" ? "⌘↵ to save · Esc to cancel" : "↵ to save · Esc to cancel"}</span>
        <button type="button" className="zb-btn zb-btn-primary zb-btn-sm" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}
