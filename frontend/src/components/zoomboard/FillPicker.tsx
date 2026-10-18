import { useState } from "react"
import { CARD_COLORS } from "@/lib/colors"
import type { BoardFill, Look } from "@/lib/fills"

type Props = {
  kind: "note" | "board"
  value: Look
  onChange(next: Look): void
  size?: number
}

/**
 * Pick how a note or board is filled. Boards: Outline or Full in a colour, or Plain, Glass,
 * Clear. Notes: a colour (in full) or Glass.
 */
export function FillPicker({ kind, value, onChange, size = 24 }: Props) {
  const [mode, setMode] = useState<"outline" | "full">(value.fill === "outline" ? "outline" : "full")
  const colored = value.fill === "outline" || value.fill === "full"
  const pick = (fill: BoardFill | "full", color: string | null) => onChange({ fill, color })
  return (
    <div className="zb-fill">
      {kind === "board" && (
        <div className="zb-fill-mode" role="radiogroup" aria-label="Colour as">
          {(["outline", "full"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className="zb-chip"
              onClick={() => {
                setMode(m)
                if (colored && value.color) pick(m, value.color)
              }}
            >
              {m === "outline" ? "Outline" : "Full colour"}
            </button>
          ))}
        </div>
      )}
      <div className="zb-colors" role="radiogroup" aria-label="Colour">
        {CARD_COLORS.map((c) => {
          const on = kind === "note" ? value.fill === "full" && (value.color ?? "lemon") === c.id : colored && value.color === c.id
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.name}
              title={c.name}
              className={`zb-color${kind === "board" && mode === "outline" ? " is-outline" : ""}`}
              style={{ width: size, height: size, ["--c" as string]: c.face, ["--c-side" as string]: c.side }}
              onClick={() => pick(kind === "note" ? "full" : mode, c.id)}
            />
          )
        })}
      </div>
      <div className="zb-fill-special" role="radiogroup" aria-label="Surface">
        {kind === "board" && (
          <button type="button" role="radio" aria-checked={value.fill === "plain"} className="zb-fill-chip is-plain" onClick={() => pick("plain", null)}>
            <i aria-hidden /> Plain
          </button>
        )}
        <button type="button" role="radio" aria-checked={value.fill === "glass"} className="zb-fill-chip is-glass" onClick={() => pick("glass", null)}>
          <i aria-hidden /> Glass
        </button>
        {kind === "board" && (
          <button type="button" role="radio" aria-checked={value.fill === "clear"} className="zb-fill-chip is-clear" onClick={() => pick("clear", null)}>
            <i aria-hidden /> Clear
          </button>
        )}
      </div>
    </div>
  )
}
