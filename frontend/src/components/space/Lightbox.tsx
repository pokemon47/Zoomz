import { motion, useReducedMotion, type Transition } from "motion/react"
import { ExternalLink, Pencil, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { fileKind, formatBytes } from "@/lib/files"
import { titleOf } from "@/lib/scene"
import type { SceneNode } from "@/lib/types"

export type Rect = { x: number; y: number; w: number; h: number }

type Props = {
  node: SceneNode
  /** Where the card lies on the board right now (it flies from — and back to — here). */
  getRect(): Rect | null
  canEdit: boolean
  /** Edit was chosen: called once the card is back on the board (instead of onClosed). */
  onEdit(): void
  /** Called once the card is back on the board. */
  onClosed(): void
}

const BAR = 76 // caption bar under the media
const LIFT: Transition = { type: "spring", stiffness: 190, damping: 22, mass: 1 }
const PUT_DOWN: Transition = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 }

/** The size the item wants when held up close: its own shape, as big as the screen allows. */
function heldSize(n: SceneNode): { w: number; h: number; bar: boolean } {
  const maxW = Math.min(window.innerWidth * 0.88, 1280)
  const maxH = window.innerHeight * 0.82
  const fit = (aspect: number, bar = true) => {
    const roomH = maxH - (bar ? BAR : 0)
    let w = Math.min(maxW, roomH * aspect)
    let h = w / aspect
    if (h > roomH) {
      h = roomH
      w = h * aspect
    }
    return { w: Math.round(w), h: Math.round(h + (bar ? BAR : 0)), bar }
  }
  const c = n.content as { width?: number; height?: number; embed?: string | null; mime?: string; preview?: string }
  if (n.type === "note") return fit(0.82, false)
  if (n.type === "image") return fit(c.width && c.height ? c.width / c.height : n.w / Math.max(1, n.h - 52))
  if (n.type === "link") return fit(c.embed ? 16 / 9 : 1.5)
  if (n.type === "file") return fit(c.mime === "application/pdf" ? 0.75 : c.mime?.startsWith("video/") ? 16 / 9 : 1.3)
  return fit(1.3)
}

/**
 * Picking a card up off the table: it lifts from exactly where it lies, rises toward you
 * (tipping slightly on its hinge, its shadow deepening and softening as it gets closer)
 * while the room behind it dims. Closing sets it back down in its place on the board.
 */
export function Lightbox({ node, getRect, canEdit, onEdit, onClosed }: Props) {
  const reduced = useReducedMotion() ?? false
  const [size] = useState(() => heldSize(node))
  const [start] = useState(() => getRect())
  const [closing, setClosing] = useState<Rect | null | false>(false)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const editAfter = useRef(false)
  const returnFocus = useRef<Element | null>(null)

  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  const box = { left: cx - size.w / 2, top: cy - size.h / 2, width: size.w, height: size.h }

  /** Transform that makes the held card sit exactly over a rect on the board. */
  const onBoard = (r: Rect | null) =>
    r
      ? { x: r.x + r.w / 2 - cx, y: r.y + r.h / 2 - cy, scale: Math.max(0.02, r.w / size.w), rotateX: 0, rotateZ: node.type === "note" ? -2 : 0 }
      : { x: 0, y: 40, scale: 0.6, rotateX: 0, rotateZ: 0 }

  const close = useCallback(() => {
    if (closing !== false) return
    setClosing(getRect())
  }, [closing, getRect])

  useEffect(() => {
    returnFocus.current = document.activeElement
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [close])

  const finish = () => {
    if (closing === false) return
    if (editAfter.current) return onEdit()
    ;(returnFocus.current as HTMLElement | null)?.focus?.({ preventScroll: true })
    onClosed()
  }

  const held = { x: 0, y: 0, scale: 1, rotateX: 0, rotateZ: 0 }
  const restShadow = "0 2px 0 0 var(--surface-side), 0 6px 10px -6px rgba(20, 14, 30, 0.25)"
  const heldShadow = "0 14px 0 0 var(--surface-side), 0 60px 90px -24px rgba(10, 6, 20, 0.55)"

  const cardMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: closing === false ? 1 : 0 }, transition: { duration: 0.12 } }
    : closing === false
      ? {
          initial: { ...onBoard(start), boxShadow: restShadow },
          // Lift: a little hinge tip on the way up, like taking a print off a table.
          animate: { ...held, rotateX: [0, 13, 0], boxShadow: heldShadow },
          transition: { default: LIFT, rotateX: { duration: 0.62, times: [0, 0.4, 1], ease: "easeOut" }, boxShadow: { duration: 0.5, ease: "easeOut" } },
        }
      : {
          animate: { ...onBoard(closing), rotateX: [0, 9, 0], boxShadow: restShadow },
          transition: { default: PUT_DOWN, rotateX: { duration: 0.45, times: [0, 0.5, 1], ease: "easeInOut" }, boxShadow: { duration: 0.35 } },
        }

  return (
    <div className="zb-lightbox" role="dialog" aria-modal="true" aria-label={titleOf(node)}>
      <motion.div
        className="zb-lightbox-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing === false ? 1 : 0 }}
        transition={{ duration: reduced ? 0.12 : closing === false ? 0.42 : 0.3, ease: "easeOut" }}
        onClick={close}
      />
      <div className="zb-lightbox-stage">
        <motion.div
          className={`zb-held zb-held-${node.type}`}
          style={{ ...box, transformPerspective: 1100, transformOrigin: "50% 50%" }}
          {...cardMotion}
          onAnimationComplete={finish}
        >
          <Held node={node} bar={size.bar} />
          <div className="zb-held-actions">
            {canEdit && node.type !== "board" && (
              <button type="button" className="zb-ibtn zb-ibtn-sm" aria-label="Edit title and caption" title="Edit" onClick={() => {
                  editAfter.current = true
                  close()
                }}>
                <Pencil size={15} strokeWidth={2.25} />
              </button>
            )}
            <button ref={closeBtn} type="button" className="zb-ibtn zb-ibtn-sm" aria-label="Close (Esc)" title="Close (Esc)" onClick={close}>
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function Held({ node: n, bar }: { node: SceneNode; bar: boolean }) {
  if (n.type === "note") {
    return (
      <div className="zb-held-notebody">
        <h2>{n.content.title}</h2>
        <p>{n.content.body}</p>
      </div>
    )
  }
  let media: React.ReactNode = null
  let caption = ""
  let meta = ""
  let open: string | null = null
  if (n.type === "image") {
    media = <img src={n.content.src} alt={n.content.alt} draggable={false} />
    caption = n.content.alt
    open = n.content.fileId ? n.content.src : null
  } else if (n.type === "file") {
    const mime = n.content.mime ?? ""
    const kind = fileKind(mime, n.content.title)
    if (mime.startsWith("video/")) media = <video src={n.content.src} poster={n.content.poster} controls autoPlay playsInline />
    else if (mime === "application/pdf") media = <iframe src={n.content.src} title={n.content.title} />
    else if (n.content.preview || n.content.thumb_1024) media = <img src={n.content.preview ?? n.content.thumb_1024} alt="" />
    else media = <kind.Icon className="zb-held-icon" strokeWidth={2} aria-hidden />
    meta = `${kind.label} · ${formatBytes(n.content.size ?? 0)}`
    open = n.content.src
  } else if (n.type === "link") {
    media = n.content.embed ? (
      <iframe src={n.content.embed} title={titleOf(n)} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" referrerPolicy="strict-origin-when-cross-origin" />
    ) : n.content.image ? (
      <img src={n.content.image} alt="" referrerPolicy="no-referrer" />
    ) : null
    caption = n.content.description ?? ""
    meta = n.content.site ?? ""
    open = n.content.url
  }
  return (
    <>
      <div className="zb-held-media">{media}</div>
      {bar && (
        <div className="zb-held-bar">
          <div className="zb-held-text">
            <strong>{titleOf(n)}</strong>
            {(caption || meta) && <span>{caption || meta}</span>}
          </div>
          {open && (
            <a className="zb-file-open" href={open} target="_blank" rel="noreferrer noopener">
              Open <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
            </a>
          )}
        </div>
      )}
    </>
  )
}
