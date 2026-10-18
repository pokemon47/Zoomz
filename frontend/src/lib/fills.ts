// How notes and boards are filled.
//
// Boards: plain (the background's own white / dark), outline (that surface, with a coloured
// rim and stack), full (the colour's deep tone on the rim and stack, a pastel of it on the
// surface), glass (frosted, blurring what's behind) or clear (fully see-through). The surface is
// also the floor you stand on once you step inside, so a board is a canvas of its own.
// Notes: a full colour, or glass.

import { colorById, type CardColor } from "./colors"

export type BoardFill = "plain" | "outline" | "full" | "glass" | "clear"
export type NoteFill = "full" | "glass"
export type Look = { fill: BoardFill | NoteFill; color: string | null }

export type BoardLook = {
  fill: BoardFill
  color?: CardColor
  /** The face / floor: a CSS colour. */
  surface: string
  /** Rim and stacked layers (when coloured). */
  rim?: string
  layer?: string
}

const SURFACE = "var(--depth-0)"

/** Glass and Clear are switched off for now (they need more work); items saved with them show
 *  as plain boards / lemon notes until they're turned back on. The code stays in place. */
export const SEE_THROUGH_ENABLED = false

export function boardLook(content: { color?: string | null; fill?: string | null }): BoardLook {
  const color = colorById(content.color)
  let fill = (content.fill as BoardFill | undefined) ?? (color ? "full" : "plain")
  if (!SEE_THROUGH_ENABLED && (fill === "glass" || fill === "clear")) fill = "plain"
  if (fill === "glass") return { fill, surface: "var(--glass)" }
  if (fill === "clear") return { fill, surface: "transparent" }
  if (fill === "outline" && color) return { fill, color, surface: SURFACE, rim: color.face, layer: color.face }
  if (fill === "full" && color) return { fill, color, surface: `color-mix(in srgb, ${color.face} 30%, ${SURFACE})`, rim: color.side, layer: color.face }
  return { fill: "plain", surface: SURFACE }
}

export function noteLook(content: { color?: string | null; fill?: string | null }): { fill: NoteFill; color: CardColor } {
  return { fill: SEE_THROUGH_ENABLED && content.fill === "glass" ? "glass" : "full", color: colorById(content.color) ?? colorById("lemon")! }
}
