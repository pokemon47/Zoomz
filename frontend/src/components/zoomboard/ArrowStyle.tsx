import { arrowGeometry } from "@/components/space/ArrowItem"
import { DEFAULT_ARROW, curveControl } from "@/lib/arrows"
import type { ArrowStyle } from "@/lib/types"

/** A small drawing of an arrow in a given style. */
export function ArrowGlyph({ style, width = 34, height = 20, strokeWidth = 2, headFactor = 3.2 }: { style: ArrowStyle; width?: number; height?: number; strokeWidth?: number; headFactor?: number }) {
  const a = { x: 3, y: style.shape === "curved" ? height - 4 : height / 2 }
  const b = { x: width - 3, y: style.shape === "curved" ? height - 4 : height / 2 }
  const c = style.shape === "curved" ? curveControl(a, b) : null
  // Flatten the bend so the glyph fits its box.
  const cc = c && { x: c.x, y: Math.max(1, c.y + (height - 4 - c.y) * 0.35) }
  const g = arrowGeometry(a, b, cc, style, strokeWidth, headFactor)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="zb-arrow-glyph">
      <path d={g.line} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" strokeDasharray={g.dash ? `0 ${strokeWidth * 2.2}` : undefined} />
      {g.heads.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  )
}

const ROWS: { key: keyof ArrowStyle; label: string; options: { value: string; label: string }[] }[] = [
  { key: "shape", label: "Shape", options: [{ value: "straight", label: "Straight" }, { value: "curved", label: "Curved" }] },
  { key: "line", label: "Line", options: [{ value: "solid", label: "Solid" }, { value: "dotted", label: "Dotted" }] },
  {
    key: "heads",
    label: "Direction",
    options: [
      { value: "end", label: "Points forward" },
      { value: "start", label: "Points back" },
      { value: "both", label: "Both ways" },
      { value: "none", label: "No arrowhead" },
    ],
  },
]

/** Pick an arrow's shape, line and direction; each option shows what it looks like. */
export function ArrowStyleControls({ value, onChange, compact }: { value: ArrowStyle; onChange(next: ArrowStyle, change: Partial<ArrowStyle>): void; compact?: boolean }) {
  return (
    <div className={`zb-arrow-style${compact ? " is-compact" : ""}`}>
      {ROWS.map((row) => (
        <div key={row.key} className="zb-arrow-style-row" role="radiogroup" aria-label={row.label}>
          {row.options.map((o) => {
            const next = { ...value, [row.key]: o.value } as ArrowStyle
            // Each option is drawn on its own (against a plain arrow), so the choices read clearly.
            const preview = { ...DEFAULT_ARROW, [row.key]: o.value } as ArrowStyle
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={value[row.key] === o.value}
                aria-label={o.label}
                title={o.label}
                className="zb-arrow-opt"
                onClick={() => onChange(next, { [row.key]: o.value } as Partial<ArrowStyle>)}
              >
                <ArrowGlyph style={preview} width={compact ? 28 : 34} height={compact ? 16 : 18} strokeWidth={1.8} />
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
