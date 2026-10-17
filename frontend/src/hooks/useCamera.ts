import { animate, useMotionValue, type AnimationPlaybackControls, type MotionValue, type Transition } from "motion/react"
import { useCallback, useMemo, useRef, type RefObject } from "react"
import { ZOOM } from "@/lib/constants"
import type { Rect } from "@/lib/scene"

export type CameraState = { x: number; y: number; scale: number }

type Padding = { top: number; right: number; bottom: number; left: number }

export type Camera = {
  x: MotionValue<number>
  y: MotionValue<number>
  scale: MotionValue<number>
  get(): CameraState
  set(next: CameraState): void
  stop(): void
  animateTo(next: CameraState, transition: Transition): Promise<void>
  panBy(dx: number, dy: number): void
  zoomAt(px: number, py: number, factor: number, transition?: Transition): void
  /** Camera that fits `rect` (world coords) inside the viewport. */
  fitFor(rect: Rect, padding?: Padding, maxScale?: number): CameraState
  viewportSize(): { width: number; height: number }
}

export const clampScale = (s: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, s))

/**
 * Camera translation and scale as Motion values: screen = world * scale + (x, y).
 * Pointer-driven updates write the values directly, so no React render per frame.
 */
export function useCamera(viewportRef: RefObject<HTMLElement | null>): Camera {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scale = useMotionValue(1)
  const running = useRef<AnimationPlaybackControls[]>([])

  const stop = useCallback(() => {
    running.current.forEach((a) => a.stop())
    running.current = []
  }, [])

  const viewportSize = useCallback(() => {
    const el = viewportRef.current
    const width = el?.clientWidth || window.innerWidth || 1280
    const height = el?.clientHeight || window.innerHeight || 800
    return { width, height }
  }, [viewportRef])

  const animateTo = useCallback(
    (next: CameraState, transition: Transition) => {
      stop()
      // One shared spring per axis; with equal dynamics the anchor point stays exact.
      const anims = [animate(x, next.x, transition), animate(y, next.y, transition), animate(scale, next.scale, transition)]
      running.current = anims
      return Promise.all(anims.map((a) => a.finished)).then(() => undefined)
    },
    [scale, stop, x, y],
  )

  return useMemo<Camera>(() => {
    const get = () => ({ x: x.get(), y: y.get(), scale: scale.get() })
    const set = (next: CameraState) => {
      stop()
      // jump() resets velocity, so a teleport never leaks speed into the next spring.
      x.jump(next.x)
      y.jump(next.y)
      scale.jump(next.scale)
    }
    return {
      x,
      y,
      scale,
      get,
      set,
      stop,
      animateTo,
      viewportSize,
      panBy(dx, dy) {
        stop()
        x.set(x.get() + dx)
        y.set(y.get() + dy)
      },
      zoomAt(px, py, factor, transition) {
        // When animating, zoom from the target of any running zoom so repeated clicks compound.
        const cur = get()
        const nextScale = clampScale(cur.scale * factor)
        const k = nextScale / cur.scale
        const next = { scale: nextScale, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k }
        if (transition) void animateTo(next, transition)
        else set(next)
      },
      fitFor(rect, padding = ZOOM.fitPadding, maxScale = ZOOM.fitMax) {
        const { width, height } = viewportSize()
        const availW = Math.max(100, width - padding.left - padding.right)
        const availH = Math.max(100, height - padding.top - padding.bottom)
        const s = clampScale(Math.min(availW / rect.w, availH / rect.h, maxScale))
        const cx = padding.left + availW / 2
        const cy = padding.top + availH / 2
        return { scale: s, x: cx - (rect.x + rect.w / 2) * s, y: cy - (rect.y + rect.h / 2) * s }
      },
    }
  }, [animateTo, scale, stop, viewportSize, x, y])
}
