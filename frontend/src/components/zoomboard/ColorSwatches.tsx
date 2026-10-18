import { Ban } from "lucide-react"
import { CARD_COLORS } from "@/lib/colors"

/** Pick a note or board colour. `plain` adds a "no colour" choice first (boards' usual look). */
export function ColorSwatches({ value, onChange, plain, size = 26 }: { value: string | null; onChange(id: string | null): void; plain?: boolean; size?: number }) {
  return (
    <div className="zb-colors" role="radiogroup" aria-label="Colour">
      {plain && (
        <button type="button" role="radio" aria-checked={!value} aria-label="No colour" title="No colour" className="zb-color is-plain" style={{ width: size, height: size }} onClick={() => onChange(null)}>
          <Ban size={size * 0.55} strokeWidth={2.25} aria-hidden />
        </button>
      )}
      {CARD_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-label={c.name}
          title={c.name}
          className="zb-color"
          style={{ width: size, height: size, background: c.face, boxShadow: `inset 0 -3px 0 ${c.side}` }}
          onClick={() => onChange(c.id)}
        />
      ))}
    </div>
  )
}
