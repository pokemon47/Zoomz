// Every tunable camera, zoom and motion value lives here.
import type { LOD } from "./types"

export const ZOOM = {
  min: 0.2,
  max: 3,
  /** Multiplier for the zoom-in / zoom-out buttons and +/- keys. */
  step: 1.35,
  /** Sensitivity of Ctrl/Cmd + wheel (and trackpad pinch). */
  wheelSensitivity: 0.0075,
  /** Screen padding around content when fitting a board, in px. */
  fitPadding: { top: 96, right: 64, bottom: 104, left: 64 },
  /** Fit never zooms in past this, so sparse boards don't blow up. */
  fitMax: 1,
  /** Arrow-key pan distance in screen px. */
  keyPan: 120,
} as const

/** Semantic zoom thresholds (design system: far < 0.45 ≤ medium ≤ 1.2 < close). */
export const LOD_THRESHOLDS = { far: 0.45, close: 1.2 } as const

export function lodForScale(scale: number): LOD {
  if (scale < LOD_THRESHOLDS.far) return "far"
  if (scale > LOD_THRESHOLDS.close) return "close"
  return "medium"
}

export const MOTION = {
  /** Camera flight: stiffness 170 / damping 26 ≈ critically damped, ~600ms, no overshoot. */
  camera: { type: "spring", stiffness: 170, damping: 26, mass: 1 },
  /** Zoom buttons / fit: same spring so pointer anchoring stays exact. */
  zoom: { type: "spring", stiffness: 170, damping: 26, mass: 1 },
  /** Hover tilt + press release: springy with ~8% overshoot. */
  tactile: { type: "spring", stiffness: 420, damping: 22, mass: 0.8 },
  /** Press down is quick: ~70ms. */
  press: { type: "tween", duration: 0.07, ease: "easeOut" },
  /** Drag lift / tilt. */
  lift: { type: "spring", stiffness: 380, damping: 24 },
  /** Drop settle: one small bounce. */
  settle: { type: "spring", stiffness: 520, damping: 18 },
  /** Child content rushing in after the dive. */
  arrive: { type: "spring", stiffness: 170, damping: 26 },
  /** Reduced-motion replacement for every flight. */
  reducedFade: 0.12,
  /** Pointer travel (px) before a press becomes a drag. */
  dragThreshold: 4,
} as const

export const TILT = {
  hover: { rotateX: 6, rotateY: -4, y: -4 },
  drag: { rotateX: 10, rotateZ: 2, scale: 1.03, y: -10 },
  press: { y: 3 },
} as const

/** Board stack fan-out per layer, rest vs. hover (design system: 4px/12px spread). */
export const STACK = {
  rest: [
    { x: 10, y: 14 },
    { x: 20, y: 28 },
  ],
  fanned: [
    { x: 14, y: 20 },
    { x: 28, y: 40 },
  ],
} as const

export const DEPTH_FLOOR = ["var(--depth-0)", "var(--depth-1)", "var(--depth-2)", "var(--depth-3)"]
export const DEPTH_DOT = ["var(--surface-side)", "var(--tomato)", "var(--lilac)", "var(--mint)"]
