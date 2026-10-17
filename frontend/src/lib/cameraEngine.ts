// Camera engine: a displayed camera that glides toward a target camera (fluid wheel
// zoom), cross-level flights, and smoothed pointer parallax. Pure TS, ticked by rAF.

import { CAMERA } from "./constants"
import type { Cam, Pointer, Space, Viewport } from "./space"

type Flight = { frame: string; from: Cam; to: Cam; start: number; dur: number }

/** Interpolate two cameras in the same frame so zoom is uniform (log-scale) and anchored. */
export function lerpCam(a: Cam, b: Cam, t: number, vp: Viewport): Cam {
  const cx = vp.w / 2, cy = vp.h / 2
  const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * t)
  // World point at the screen centre for each camera.
  const ax = (cx - a.x) / a.s, ay = (cy - a.y) / a.s
  const bx = (cx - b.x) / b.s, by = (cy - b.y) / b.s
  // Weight by 1/s so the shared fixed point of a pure zoom stays put.
  const inv = 1 / b.s - 1 / a.s
  const w = Math.abs(inv) > 1e-9 ? (1 / s - 1 / a.s) / inv : t
  const px = ax + (bx - ax) * w, py = ay + (by - ay) * w
  return { b: a.b, s, x: cx - px * s, y: cy - py * s }
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class CameraEngine {
  display: Cam
  target: Cam
  pointer: Pointer = { x: 0, y: 0 }
  private pointerTarget: Pointer = { x: 0, y: 0 }
  private flight: Flight | null = null
  space: Space
  vp: Viewport
  reduced = false

  constructor(space: Space, vp: Viewport, initial: Cam) {
    this.space = space
    this.vp = vp
    this.display = space.normalize(initial, vp)
    this.target = this.display
  }

  setViewport(vp: Viewport) {
    this.vp = vp
  }

  /** Advance one frame. Returns true while anything is still moving. */
  tick(now: number, dt: number): boolean {
    const vp = this.vp
    let moving = false
    if (this.flight) {
      const f = this.flight
      const u = Math.min(1, (now - f.start) / f.dur)
      const cam = lerpCam(f.from, f.to, easeInOut(u), vp)
      this.display = this.space.normalize(cam, vp)
      this.target = this.display
      if (u >= 1) this.flight = null
      moving = true
    } else {
      const tgt = this.space.toFrame(this.target, this.display.b)
      const a = this.reduced ? 1 : 1 - Math.pow(1 - CAMERA.follow, dt / 16.67)
      const next = lerpCam(this.display, tgt, a, vp)
      const done = Math.abs(Math.log(next.s / tgt.s)) < 1e-4 && Math.abs(next.x - tgt.x) < 0.1 && Math.abs(next.y - tgt.y) < 0.1
      this.display = this.space.normalize(done ? tgt : next, vp)
      moving = !done
    }
    const pa = this.reduced ? 1 : 1 - Math.pow(1 - CAMERA.pointerFollow, dt / 16.67)
    this.pointer = {
      x: this.pointer.x + (this.pointerTarget.x - this.pointer.x) * pa,
      y: this.pointer.y + (this.pointerTarget.y - this.pointer.y) * pa,
    }
    if (Math.abs(this.pointer.x - this.pointerTarget.x) > 0.001 || Math.abs(this.pointer.y - this.pointerTarget.y) > 0.001) moving = true
    return moving
  }

  /** Direct manipulation: follows the pointer 1:1, no glide. */
  panBy(dx: number, dy: number) {
    this.flight = null
    const tgt = this.space.toFrame(this.target, this.display.b)
    const vp = this.vp
    this.display = this.space.normalize({ ...this.display, x: this.display.x + dx, y: this.display.y + dy }, vp)
    const t2 = this.space.toFrame({ ...tgt, x: tgt.x + dx, y: tgt.y + dy }, this.display.b)
    this.target = this.space.normalize(t2, vp)
  }

  /** Zoom the target around a screen point; the display glides after it. */
  zoomAt(px: number, py: number, factor: number) {
    if (this.flight) {
      this.target = this.display
      this.flight = null
    }
    const t = this.space.normalize(this.target, this.vp)
    const zoomed = { b: t.b, s: t.s * factor, x: px - (px - t.x) * factor, y: py - (py - t.y) * factor }
    const n = this.space.normalize(zoomed, this.vp)
    this.target = this.space.clampScale(n, this.vp)
    if (this.reduced) this.display = this.space.normalize(this.target, this.vp)
  }

  /** Fly to a camera expressed in any board's frame. */
  flyTo(to: Cam, now: number) {
    if (this.reduced) {
      this.flight = null
      this.display = this.space.normalize(to, this.vp)
      this.target = this.display
      return
    }
    const from = this.space.toFrame(this.display, to.b)
    const octaves = Math.abs(Math.log2(to.s / from.s))
    const dur = Math.min(CAMERA.flightMax, CAMERA.flightBase + CAMERA.flightPerOctave * octaves) * 1000
    this.flight = { frame: to.b, from, to, start: now, dur }
  }

  stop() {
    this.flight = null
    this.target = this.display
  }

  setPointer(p: Pointer) {
    this.pointerTarget = this.reduced ? { x: 0, y: 0 } : p
  }

  get flying() {
    return this.flight !== null
  }
}
