import { memo } from "react"
import { SCENERY, layerMarkup, placeLayers, type Theme } from "@/lib/scenery"

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

const VIEWBOX = `${-SCENERY.period * 1.5} ${-SCENERY.halfHeight} ${SCENERY.period * 3} ${SCENERY.halfHeight * 2}`

/** One static layer: markup never changes, only its transform does. */
const Layer = memo(function Layer({ markup }: { markup: string }) {
  return <svg className="zb-scene-svg" viewBox={VIEWBOX} preserveAspectRatio="xMidYMid meet" aria-hidden dangerouslySetInnerHTML={{ __html: markup }} />
})

/** The world behind the boards: sky, sun, and layers you walk through as you zoom. */
export function Scenery({ theme, z, panX, panY, pointer, vp, parallax }: Props) {
  if (!theme.layer) return null
  // Wide enough that the farthest layer still spans the screen.
  const layerW = Math.max(vp.w, vp.h * 2) * 3.2
  const layerH = (layerW * SCENERY.halfHeight * 2) / (SCENERY.period * 3)
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
        <div
          key={p.n}
          className="zb-scene-layer"
          style={{
            width: layerW,
            height: layerH,
            left: vp.w / 2 - layerW / 2,
            top: horizonY - layerH / 2,
            opacity: p.opacity,
            transform: `translate3d(${p.tx}px, ${p.ty}px, 0) scale(${p.scale})`,
            ["--hz" as string]: `${p.haze}%`,
          }}
        >
          <Layer markup={layerMarkup(theme, p.n)} />
        </div>
      ))}
    </div>
  )
}
