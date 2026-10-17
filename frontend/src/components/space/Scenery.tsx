import { memo } from "react"
import { SCENERY, layerMarkup, layerViewBox, placeLayers, type Theme } from "@/lib/scenery"

type Props = {
  theme: Theme
  /** Camera depth along the layer stack. */
  z: number
  panX: number
  panY: number
  pointer: { x: number; y: number }
  vp: { w: number; h: number }
  parallax: boolean
}

/**
 * One layer, always exactly the size of the screen. Moving through it changes its viewBox
 * (which part of the layer is visible), never its size: a near layer scaled up as a DOM
 * element would be tens of thousands of pixels wide and overflow GPU texture limits.
 */
const Layer = memo(function Layer({ markup, viewBox, opacity, haze }: { markup: string; viewBox: string; opacity: number; haze: number }) {
  return (
    <svg
      className="zb-scene-layer zb-scene-full"
      viewBox={viewBox}
      preserveAspectRatio="none"
      style={{ opacity, ["--hz" as string]: `${haze}%` }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
})

/** The world behind the boards: sky, sun, and layers you walk through as you zoom. */
export function Scenery({ theme, z, panX, panY, pointer, vp, parallax }: Props) {
  if (!theme.layer) return null
  // Width of a layer drawn at scale 1, chosen so the farthest layer still spans the screen.
  const layerW = Math.max(vp.w, vp.h * 2) * 3.2
  const placements = placeLayers(z, panX, panY, pointer, layerW, vp.h, parallax)
  const horizonY = vp.h * SCENERY.horizon
  return (
    <div className="zb-scenery" style={{ background: theme.sky, ["--haze" as string]: theme.haze }} aria-hidden>
      {theme.celestial && (
        <svg
          className="zb-scene-layer"
          viewBox="-1000 -500 2000 1000"
          style={{
            width: vp.w,
            height: vp.w / 2,
            left: 0,
            top: horizonY - vp.w / 4,
            transform: `translate(${parallax ? -pointer.x * 6 : 0}px, ${parallax ? -pointer.y * 4 : 0}px)`,
          }}
          dangerouslySetInnerHTML={{ __html: theme.celestial }}
        />
      )}
      {placements.map((p) => (
        <Layer key={p.n} markup={layerMarkup(theme, p.n)} viewBox={layerViewBox(p, layerW, vp, horizonY)} opacity={p.opacity} haze={p.haze} />
      ))}
    </div>
  )
}
