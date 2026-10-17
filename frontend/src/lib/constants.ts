// Every tunable camera, depth, zoom and motion value lives here.
import type { LOD, SceneNode } from "./types"

export const SPACE = {
  /** Camera "eye height" in screen px. Smaller = stronger depth and earlier fly-by. */
  eye: 1500,
  /** Pointer parallax: screen px of drift per screen px of height, at full pointer offset. */
  pointerParallax: 0.12,
  /** Things whose perspective boost passes this start fading; gone by passFadeEnd. */
  passFadeStart: 2.0,
  passFadeEnd: 3.2,
  /** Below this perspective denominator a thing is behind the camera (skip). */
  passDenom: 0.12,
  /** A board draws its contents once its card is this many px on screen (smaller = just the face)… */
  contentsFrom: 56,
  /** …fully faded in by here. */
  contentsFull: 120,
  /** You are "in" a board (breadcrumbs) once it spans this fraction of the viewport around its centre. */
  focusSpan: 0.42,
  /** Board faces let this much scenery through (frosted acrylic); 1 = opaque. */
  faceAlpha: 0.84,
  /** Frosted floors drawn when deep inside boards (0.16³ ≈ 0.4% shows through a fourth). */
  maxFloorLayers: 3,
  /** Card face layout (local units): padding and title header above the content window. */
  facePad: 14,
  faceHeader: 44,
  /** Breathing room around a board's content when drawn on its face. */
  contentPad: 40,
  /** Off-screen margin before culling, px. */
  cullMargin: 160,
  /** Root frame can zoom out to this fraction of its fit (far enough to see it as a speck). */
  minZoomOfFit: 0.05,
  /** No frame zooms past this (into an image). Boards re-anchor long before. */
  maxLocalScale: 14,
  /** Screen padding when fitting a board. */
  fitPad: { top: 96, right: 72, bottom: 104, left: 72 },
} as const

export const ZOOM = {
  /** Wheel/trackpad sensitivity: zoom factor = exp(-deltaY * this). */
  wheel: 0.0022,
  /** Pinch (ctrl + wheel) is finer-grained, so it gets more gain. */
  pinch: 0.012,
  /** Zoom buttons and +/- keys. */
  step: 1.6,
  /** Arrow-key pan distance in screen px. */
  keyPan: 140,
} as const

export const CAMERA = {
  /** Exponential smoothing toward the target camera per 60fps frame (fluid wheel zoom). */
  follow: 0.18,
  /** Pointer parallax smoothing per frame. */
  pointerFollow: 0.08,
  /** Flights: base + per doubling of zoom, seconds. */
  flightBase: 0.45,
  flightPerOctave: 0.12,
  flightMax: 1.6,
} as const

/** Level of detail from a card's on-screen width (px), not a global zoom. */
export function lodFor(type: SceneNode["type"], screenW: number): LOD {
  if (type === "image") return screenW < 90 ? "far" : screenW > 380 ? "close" : "medium"
  if (type === "note") return screenW < 120 ? "far" : screenW > 200 ? "close" : "medium"
  if (type === "file") return screenW < 100 ? "far" : screenW > 320 ? "close" : "medium"
  return screenW < 170 ? "far" : screenW > 520 ? "close" : "medium"
}

export const MOTION = {
  /** Hover tilt + press release: springy with ~8% overshoot. */
  tactile: { type: "spring", stiffness: 420, damping: 22, mass: 0.8 },
  /** Press down is quick: ~70ms. */
  press: { type: "tween", duration: 0.07, ease: "easeOut" },
  /** Drag lift / tilt. */
  lift: { type: "spring", stiffness: 380, damping: 24 },
  /** Drop settle: one small bounce. */
  settle: { type: "spring", stiffness: 520, damping: 18 },
  /** Pointer travel (px) before a press becomes a drag. */
  dragThreshold: 4,
} as const

export const TILT = {
  hover: { rotateX: 6, rotateY: -4, y: -4 },
  drag: { rotateX: 10, rotateZ: 2, scale: 1.03, y: -10 },
  press: { y: 3 },
} as const

/**
 * Perspective for a card's tilt, in its own units. Scaling it with the card keeps the tilt
 * looking the same at any size (a 220×290 card at 900px) — and, crucially, keeps a card that
 * was resized huge from swinging its corners past the eye point, which can't be projected.
 */
export function perspectiveFor(w: number, h: number): number {
  return Math.max(900, Math.max(w, h) * 3.1)
}

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
export const floorFor = (depth: number) => DEPTH_FLOOR[Math.min(depth, DEPTH_FLOOR.length - 1)]
