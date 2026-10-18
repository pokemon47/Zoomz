import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronRight, ChevronUp, Download, Layers, Palette, Pencil, Trash2 } from "lucide-react"
import { FillPicker } from "@/components/zoomboard/FillPicker"
import type { Look } from "@/lib/fills"
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import type { LayerMove } from "@/lib/layers"

export type ContextAction = { kind: "edit" } | { kind: "delete" } | { kind: "export" } | { kind: "layer"; move: LayerMove } | { kind: "fill"; look: Look }

type Props = {
  x: number
  y: number
  title: string
  canEdit: boolean
  /** Offer "Edit title & caption" (not for arrows, which have no text). */
  canRename?: boolean
  /** Which layer moves would change anything (front/forward disabled when already on top…). */
  layerable: Record<LayerMove, boolean>
  /** Notes and boards: their colour now (boards may have none). */
  colorable?: { kind: "note" | "board"; value: Look }
  /** Offer "Export as zip" (boards, when saved on the server). */
  exportable?: boolean
  onAction(a: ContextAction): void
  onClose(): void
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"

/** Right-click menu for a card: Edit, Layer ▸, Delete. Keyboard: arrows, → opens Layer, Esc closes. */
export function ContextMenu({ x, y, title, canEdit, canRename = true, layerable, exportable, colorable, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState(false)
  const [pos, setPos] = useState({ x, y })
  const [subLeft, setSubLeft] = useState(false)
  // A short grace period so moving the pointer across the gap to the submenu doesn't close it.
  const closeTimer = useRef(0)
  const openSub = () => {
    clearTimeout(closeTimer.current)
    if (canEdit) setSub(true)
  }
  const closeSubSoon = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setSub(false), 220)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  // Opened from the keyboard: move focus into the submenu once it has rendered.
  const focusSub = useRef(false)
  useEffect(() => {
    if (!sub || !focusSub.current) return
    focusSub.current = false
    ref.current?.querySelector<HTMLButtonElement>("[data-submenu] [role=menuitem]:not([disabled])")?.focus()
  }, [sub])

  // Keep the menu (and its submenu) on screen.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) })
    setSubLeft(x + r.width + 230 > window.innerWidth)
  }, [x, y])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus()
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const blur = () => onClose()
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("blur", blur)
    window.addEventListener("wheel", blur, { passive: true })
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("blur", blur)
      window.removeEventListener("wheel", blur)
    }
  }, [onClose])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])].filter((b) => b.offsetParent !== null)
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === "Escape") {
      e.preventDefault()
      if (sub) {
        setSub(false)
        ref.current?.querySelector<HTMLButtonElement>("[data-sub-trigger]")?.focus()
      } else onClose()
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const scope = items.filter((b) => !!b.closest("[data-submenu]") === sub)
      const j = scope.indexOf(document.activeElement as HTMLButtonElement)
      scope[(j + (e.key === "ArrowDown" ? 1 : scope.length - 1)) % scope.length]?.focus()
    } else if (e.key === "ArrowRight" && (document.activeElement as HTMLElement)?.dataset.subTrigger !== undefined) {
      e.preventDefault()
      focusSub.current = true
      setSub(true)
    } else if (e.key === "ArrowLeft" && sub) {
      e.preventDefault()
      setSub(false)
      ref.current?.querySelector<HTMLButtonElement>("[data-sub-trigger]")?.focus()
    } else if (e.key === "Tab") {
      e.preventDefault()
      items[(i + 1) % items.length]?.focus()
    }
  }

  const act = (a: ContextAction) => {
    onAction(a)
    onClose()
  }

  return (
    <div ref={ref} className="zb-ctx" role="menu" aria-label={`Actions for ${title}`} style={{ left: pos.x, top: pos.y }} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      <div className="zb-ctx-title" aria-hidden>
        {title}
      </div>
      {canRename && <Item icon={<Pencil />} label="Edit title & caption" hint="↵" disabled={!canEdit} onClick={() => act({ kind: "edit" })} />}
      <div className="zb-ctx-sub" onPointerEnter={openSub} onPointerLeave={closeSubSoon}>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={sub}
          data-sub-trigger=""
          className="zb-ctx-item"
          disabled={!canEdit}
          onClick={() => {
            focusSub.current = true
            setSub(true)
          }}
        >
          <Layers aria-hidden />
          <span>Layer</span>
          <ChevronRight className="zb-ctx-chev" aria-hidden />
        </button>
        {sub && (
          <div className={`zb-ctx zb-ctx-submenu${subLeft ? " is-left" : ""}`} role="menu" aria-label="Layer" data-submenu="">
            <Item icon={<ArrowUpToLine />} label="Bring to front" hint={`${MOD}⇧]`} disabled={!layerable.front} onClick={() => act({ kind: "layer", move: "front" })} />
            <Item icon={<ChevronUp />} label="Bring forward" hint={`${MOD}]`} disabled={!layerable.forward} onClick={() => act({ kind: "layer", move: "forward" })} />
            <Item icon={<ChevronDown />} label="Send backward" hint={`${MOD}[`} disabled={!layerable.backward} onClick={() => act({ kind: "layer", move: "backward" })} />
            <Item icon={<ArrowDownToLine />} label="Send to back" hint={`${MOD}⇧[`} disabled={!layerable.back} onClick={() => act({ kind: "layer", move: "back" })} />
          </div>
        )}
      </div>
      {colorable && canEdit && (
        <div className="zb-ctx-colors" role="group" aria-label="Colour">
          <span className="zb-ctx-label">
            <Palette aria-hidden /> Colour
          </span>
          <FillPicker kind={colorable.kind} value={colorable.value} size={22} onChange={(look) => act({ kind: "fill", look })} />
        </div>
      )}
      {exportable && <Item icon={<Download />} label="Export as zip" onClick={() => act({ kind: "export" })} />}
      <div className="zb-ctx-sep" role="separator" />
      <Item icon={<Trash2 />} label="Delete" hint="⌫" danger disabled={!canEdit} onClick={() => act({ kind: "delete" })} />
    </div>
  )
}

function Item({ icon, label, hint, disabled, danger, onClick }: { icon: ReactNode; label: string; hint?: string; disabled?: boolean; danger?: boolean; onClick(): void }) {
  return (
    <button type="button" role="menuitem" className={`zb-ctx-item${danger ? " is-danger" : ""}`} disabled={disabled} onClick={onClick}>
      <span className="zb-ctx-icon" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  )
}
