// Sticky notes size their text to fill the note: a few words are big, a long note is small.
//
// The largest font size whose wrapped title + body fits the note's text box is found by binary
// search against a hidden element laid out exactly like the note. Sizes are in the note's own
// units, so the result doesn't depend on zoom; it's cached by content and box size and only
// re-measured when the text or the note's size changes (or once web fonts finish loading).

import { useEffect, useState } from "react"

/** Title is this much bigger than the body text. */
export const TITLE_RATIO = 1.18
export const LINE_HEIGHT = 1.3
const GAP_EM = 0.35 // space between title and body, in body ems

let measurer: HTMLDivElement | null = null
let titleEl: HTMLDivElement
let bodyEl: HTMLDivElement
let fontsVersion = 0
const cache = new Map<string, number>()

function ensureMeasurer() {
  if (measurer) return
  measurer = document.createElement("div")
  measurer.setAttribute("aria-hidden", "true")
  measurer.className = "zb-note-measure"
  titleEl = document.createElement("div")
  titleEl.className = "zb-note-title"
  bodyEl = document.createElement("div")
  bodyEl.className = "zb-note-body"
  measurer.append(titleEl, bodyEl)
  document.body.appendChild(measurer)
}

function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return `${s.length}:${(h >>> 0).toString(36)}`
}

/**
 * Body font size (title is TITLE_RATIO× this) that makes the text fill a `boxW × boxH` box.
 * Never below `min`; if even `min` overflows, the caller lets it scroll or clip.
 */
export function fitFontSize(title: string, body: string, boxW: number, boxH: number, opts: { min?: number; max?: number } = {}): number {
  const min = opts.min ?? 2
  const max = opts.max ?? 140
  if (typeof document === "undefined" || boxW <= 0 || boxH <= 0) return min
  const key = `${fontsVersion}|${Math.round(boxW)}|${Math.round(boxH)}|${min}|${max}|${hash(title)}|${hash(body)}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  ensureMeasurer()
  measurer!.style.width = `${boxW}px`
  titleEl.textContent = title
  bodyEl.textContent = body
  bodyEl.style.display = body ? "" : "none"
  const fits = (size: number) => {
    measurer!.style.fontSize = `${size}px`
    return measurer!.scrollHeight <= boxH + 0.5 && measurer!.scrollWidth <= boxW + 0.5
  }
  let lo = min
  let hi = max
  if (fits(hi)) lo = hi
  else {
    // ~0.1px precision is plenty; 14 steps cover a 2–140px range.
    for (let i = 0; i < 14 && hi - lo > 0.1; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
  }
  const size = Math.max(min, Math.floor(lo * 10) / 10)
  if (cache.size > 2000) cache.clear()
  cache.set(key, size)
  return size
}

/** Re-render once web fonts have loaded (their metrics differ from the fallback). */
export function useFontsVersion(): number {
  const [v, setV] = useState(fontsVersion)
  useEffect(() => {
    const fonts = document.fonts
    if (!fonts) return
    const bump = () => {
      fontsVersion++
      setV(fontsVersion)
    }
    let alive = true
    fonts.ready.then(() => alive && bump())
    fonts.addEventListener?.("loadingdone", bump)
    return () => {
      alive = false
      fonts.removeEventListener?.("loadingdone", bump)
    }
  }, [])
  return v
}

/** Layout used both for measuring and for the real note, so they always agree. */
export const GAP = GAP_EM
