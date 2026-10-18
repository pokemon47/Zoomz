import { useState } from "react"
import { THEMES, themeById, type SceneryId } from "@/lib/scenery"

/**
 * The world behind the boards: one small swatch showing the current scenery, which opens into
 * the others on hover (or focus / tap) and folds away again.
 */
export function SceneryPicker({ value, onChange }: { value: SceneryId; onChange(id: SceneryId): void }) {
  const [open, setOpen] = useState(false)
  const current = themeById(value)
  return (
    <div
      className={`zb-sky-picker${open ? " is-open" : ""}`}
      role="group"
      aria-label={`Scenery: ${current.name}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <button
        type="button"
        className="zb-sky-current"
        aria-label={`Scenery: ${current.name}. Choose another`}
        aria-expanded={open}
        title={`Scenery: ${current.name}`}
        style={{ background: current.swatch }}
        onClick={() => setOpen((o) => !o)}
      />
      <div className="zb-sky-options" aria-hidden={!open}>
        {THEMES.filter((t) => t.id !== value).map((t) => (
          <button
            key={t.id}
            type="button"
            className="zb-swatch"
            aria-label={t.name}
            title={t.name}
            tabIndex={open ? 0 : -1}
            style={{ background: t.swatch }}
            onClick={() => {
              onChange(t.id)
              setOpen(false)
            }}
          />
        ))}
      </div>
    </div>
  )
}
