// Things drawn in screen space over the board: other people's cursors, the selection
// marquee, the resize grip, and the in-place text editor.

import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { Peer } from "@/lib/store"
import type { Cam, Space, Viewport } from "@/lib/space"
import type { SceneNode } from "@/lib/types"

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

/** `max` is a length limit; notes have none (their text shrinks to fit). */
export type EditField = { key: string; label: string; value: string; multiline?: boolean; max?: number; placeholder?: string }

export type EditTarget = {
  id: string
  /** Note editors are lemon slabs; everything else uses the plain surface. */
  tone: "note" | "surface"
  heading: string
  fields: EditField[]
  /** Screen rect of the card to sit over. */
  rect: { x: number; y: number; w: number; h: number }
}

/** Fields that can be edited on each kind of item (all within the server's content whitelist). */
export function editFields(n: SceneNode): EditField[] {
  const c = n.content as Record<string, unknown>
  const s = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "")
  switch (n.type) {
    case "note":
      return [
        { key: "title", label: "Title", value: s("title"), max: 120 },
        { key: "body", label: "Note", value: s("body"), multiline: true },
      ]
    case "board":
      return [
        { key: "title", label: "Title", value: s("title"), max: 120 },
        { key: "description", label: "Caption", value: s("description"), multiline: true, max: 600, placeholder: "What's this board for?" },
      ]
    case "image":
      return [
        { key: "title", label: "Title", value: s("title"), max: 160 },
        { key: "alt", label: "Caption", value: s("alt"), multiline: true, max: 600, placeholder: "Describe the image (also read out by screen readers)" },
      ]
    case "link":
      return [
        { key: "title", label: "Title", value: s("title"), max: 300 },
        { key: "description", label: "Caption", value: s("description"), multiline: true, max: 600 },
      ]
    case "file":
      return [{ key: "title", label: "Name", value: s("title"), max: 255 }]
  }
}

/** Edit an item's title and caption (or a note's text), right where it sits. */
export function EditOverlay({ target, onSave, onCancel }: { target: EditTarget; onSave(values: Record<string, string>): void; onCancel(): void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(target.fields.map((f) => [f.key, f.value])))
  const done = useRef(false)
  const first = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    first.current?.focus()
    first.current?.select()
  }, [])
  const save = () => {
    if (done.current) return
    done.current = true
    const out: Record<string, string> = {}
    for (const f of target.fields) {
      const v = values[f.key] ?? ""
      out[f.key] = f.key === "title" ? v.trim() || f.value : v
    }
    onSave(out)
  }
  const cancel = () => {
    done.current = true
    onCancel()
  }
  const w = Math.max(280, Math.min(Math.max(target.rect.w, 320), 520))
  const style: CSSProperties = {
    left: Math.max(8, Math.min(target.rect.x, window.innerWidth - w - 8)),
    top: Math.max(8, Math.min(target.rect.y, window.innerHeight - 80 - target.fields.length * 110)),
    width: w,
  }
  return (
    <div
      ref={root}
      className={`zb-editor zb-editor-${target.tone}`}
      style={style}
      role="dialog"
      aria-label={target.heading}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Escape") cancel()
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === "INPUT")) {
          e.preventDefault()
          save()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        // Clicking away saves, like a normal text field.
        if (!root.current?.contains(e.relatedTarget as Node | null)) save()
      }}
    >
      <span className="zb-editor-heading">{target.heading}</span>
      {target.fields.map((f, i) => (
        <label key={f.key} className="zb-editor-field">
          <span>{f.label}</span>
          {f.multiline ? (
            <textarea value={values[f.key]} maxLength={f.max} rows={f.key === "body" ? 5 : 3} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          ) : (
            <input ref={i === 0 ? first : undefined} value={values[f.key]} maxLength={f.max} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          )}
        </label>
      ))}
      <div className="zb-editor-row">
        <span className="zb-meta">⌘↵ to save · Esc to cancel</span>
        <button type="button" className="zb-btn zb-btn-primary zb-btn-sm" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}
