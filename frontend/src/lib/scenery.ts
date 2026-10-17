// Scenery: endless 2.5D backdrops you move *through* as you zoom.
//
// Each theme is a stack of flat, low-poly layers ("theatre flats") spaced one unit
// apart in depth. Zooming moves the camera forward along that stack: layer n sits at
// depth d = n − Z and is drawn at perspective scale p = SCENERY.focal / d about the
// vanishing point. Near layers grow fast and slide past the edges, far layers barely
// move and are hazed toward the sky colour, so going deeper feels like walking into a
// landscape. Layers are generated per index from a seeded RNG, so the space never
// ends and never changes when you come back.

export type SceneryId = "studio" | "mountains" | "clouds" | "forest" | "dunes" | "cosmos"

export const SCENERY = {
  /** Depth at which a layer is drawn at scale 1. */
  focal: 1.25,
  /** Layers closer than this have passed you; farther than this aren't drawn yet. */
  near: 0.32,
  far: 7.5,
  /** Camera moves this many layers per e-fold of zoom. */
  layersPerEFold: 0.85,
  /** Depth window over which an approaching layer fades away. */
  passFade: 0.75,
  /** How strongly camera pans and the pointer slide near layers. */
  panGain: 0.35,
  pointerGain: 26,
  /** Vanishing point height as a fraction of the viewport. */
  horizon: 0.6,
  /** Virtual layer box: one period is PERIOD wide; three are tiled. */
  period: 2000,
  halfHeight: 700,
} as const

export type Theme = {
  id: SceneryId
  name: string
  /** CSS background for the sky behind everything. */
  sky: string
  /** Colour distant layers fade toward. */
  haze: string
  /** Picker swatch. */
  swatch: string
  /** Draw one period of layer n, x ∈ [−period/2, period/2), horizon at y = 0. */
  layer?(n: number): string
  /** Fixed sky decoration (sun, moon). */
  celestial?: string
}

// ---------------------------------------------------------------- helpers

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (theme: string, n: number) => {
  let h = 2166136261 ^ n
  for (const ch of theme) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

/** A fill that hazes toward the sky with distance (--hz is set per layer, per frame). */
const fill = (c: string) => `style="fill:color-mix(in srgb, ${c} calc(100% - var(--hz)), var(--haze))"`
const poly = (pts: [number, number][], c: string) => `<polygon points="${pts.map(([x, y]) => `${x.toFixed(0)},${y.toFixed(0)}`).join(" ")}" ${fill(c)}/>`
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
const P = SCENERY.period
const BOTTOM = SCENERY.halfHeight

/** Low-poly ridge: a jagged skyline with a lit and a shaded facet per peak. */
function ridge(r: () => number, base: number, amp: [number, number], step: [number, number], cols: { lit: string; mid: string; dark: string }, snow?: string) {
  const pts: [number, number][] = []
  let x = -P / 2
  const startY = base - amp[0] * 0.3
  pts.push([x, startY])
  while (x < P / 2) {
    x = Math.min(P / 2, x + step[0] + r() * (step[1] - step[0]))
    const isEnd = x >= P / 2
    pts.push([x, isEnd ? startY : base - (amp[0] + r() * (amp[1] - amp[0])) * (pts.length % 2 ? 1 : 0.35)])
  }
  let out = poly([...pts, [P / 2, BOTTOM], [-P / 2, BOTTOM]], cols.mid)
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]
    const [lx, ly] = pts[i - 1]
    const [rx, ry] = pts[i + 1]
    if (py > ly || py > ry) continue // valleys get no facets
    const foot: [number, number] = [px + (rx - lx) * 0.08, Math.max(ly, ry) + (BOTTOM - Math.max(ly, ry)) * 0.25]
    out += poly([[lx, ly], [px, py], foot], cols.lit)
    out += poly([[px, py], [rx, ry], foot], cols.dark)
    if (snow && base - py > amp[1] * 0.7) {
      const t = 0.28
      out += poly([[px, py], [px + (lx - px) * t, py + (ly - py) * t], [px + (foot[0] - px) * t * 0.6, py + (foot[1] - py) * t * 0.6], [px + (rx - px) * t, py + (ry - py) * t]], snow)
    }
  }
  return out
}

/** Repeat one period three times so a layer can slide sideways forever. */
export function tile(inner: string): string {
  return `<g transform="translate(${-P},0)">${inner}</g><g>${inner}</g><g transform="translate(${P},0)">${inner}</g>`
}

// ---------------------------------------------------------------- themes

const MOUNTAIN_COLS = [
  { lit: "#D9CCFF", mid: "#B8A3F5", dark: "#9583D6" },
  { lit: "#B9C6FF", mid: "#8DA3FF", dark: "#6E86E8" },
  { lit: "#A9E8C9", mid: "#7CCFA6", dark: "#5DB28B" },
  { lit: "#FFC3B0", mid: "#F2A08A", dark: "#D9826C" },
] as const

const FOREST_COLS = [
  { lit: "#9FE0BE", dark: "#62B88E" },
  { lit: "#7FD0A8", dark: "#4E9E78" },
  { lit: "#B7E6A1", dark: "#80BF6A" },
  { lit: "#8EC9B7", dark: "#5A9C89" },
] as const

const DUNE_COLS = [
  { lit: "#FFE3A3", mid: "#F7CF7E", dark: "#E6B35E" },
  { lit: "#FFD2B8", mid: "#F5B694", dark: "#DE9573" },
  { lit: "#F9E2C4", mid: "#EBC99D", dark: "#D3AC7C" },
] as const

export const THEMES: Theme[] = [
  {
    id: "studio",
    name: "Studio",
    sky: "var(--depth-0)",
    haze: "var(--depth-0)",
    swatch: "radial-gradient(#d8cfc4 1.4px, transparent 1.6px) 0 0/7px 7px, #F3EDE2",
  },
  {
    id: "mountains",
    name: "Mountains",
    sky: "linear-gradient(180deg, #CFE0FF 0%, #F4E9FF 52%, #FFE9DF 70%, #FFF4EC 100%)",
    haze: "#EFE6FB",
    swatch: "linear-gradient(160deg, #CFE0FF, #F4E9FF 50%, #B8A3F5 51%, #8DA3FF)",
    celestial: `<circle cx="0" cy="-150" r="120" fill="#FFD9C2"/><circle cx="0" cy="-150" r="86" fill="#FFC3A6"/>`,
    layer(n) {
      const r = rng(hash("mountains", n))
      const cols = MOUNTAIN_COLS[((n % 4) + 4) % 4]
      return ridge(r, 60 + r() * 60, [120, 460], [90, 220], cols, r() > 0.35 ? "#FFFFFF" : undefined)
    },
  },
  {
    id: "clouds",
    name: "Clouds",
    sky: "linear-gradient(180deg, #A9C3FF 0%, #CFDDFF 45%, #FFE4EC 80%, #FFF1E6 100%)",
    haze: "#DCE6FF",
    swatch: "radial-gradient(circle at 35% 60%, #fff 22%, transparent 23%), radial-gradient(circle at 62% 52%, #fff 26%, transparent 27%), linear-gradient(180deg, #A9C3FF, #FFE4EC)",
    celestial: `<circle cx="-520" cy="-260" r="70" fill="#FFF3C9"/>`,
    layer(n) {
      const r = rng(hash("clouds", n))
      let out = ""
      const count = 3 + Math.floor(r() * 3)
      for (let i = 0; i < count; i++) {
        const cx = -P / 2 + (i + r() * 0.8) * (P / count)
        const cy = -520 + r() * 900
        const tint = pick(r, ["#FFFFFF", "#FFF6FA", "#F4F1FF", "#FFF9EE"])
        const shade = pick(r, ["#E7E2FA", "#F3DCE6", "#E2E9FB"])
        const size = 90 + r() * 140
        // low-poly puffs: heptagons, then a flat shaded base
        const puffs = 3 + Math.floor(r() * 3)
        for (let k = 0; k < puffs; k++) {
          const px = cx + (k - (puffs - 1) / 2) * size * 0.75 + (r() - 0.5) * 30
          const rad = size * (0.55 + r() * 0.5) * (k === Math.floor(puffs / 2) ? 1.25 : 1)
          const py = cy - rad * 0.25
          const pts: [number, number][] = []
          for (let a = 0; a < 7; a++) {
            const ang = (a / 7) * Math.PI * 2 + r() * 0.2
            pts.push([px + Math.cos(ang) * rad, py + Math.sin(ang) * rad * 0.82])
          }
          out += poly(pts, tint)
        }
        const w = size * (puffs * 0.75 + 0.6)
        out += poly([[cx - w / 2, cy + size * 0.2], [cx + w / 2, cy + size * 0.2], [cx + w / 2 - size * 0.4, cy + size * 0.55], [cx - w / 2 + size * 0.4, cy + size * 0.55]], shade)
      }
      return out
    },
  },
  {
    id: "forest",
    name: "Forest",
    sky: "linear-gradient(180deg, #CFF1E1 0%, #EAF8EF 50%, #FFF4DE 78%, #FFF8EC 100%)",
    haze: "#E4F4EA",
    swatch: "linear-gradient(180deg, #CFF1E1 45%, transparent 46%), conic-gradient(from 150deg at 30% 30%, #7FD0A8 0 60deg, transparent 0) , conic-gradient(from 150deg at 70% 40%, #4E9E78 0 60deg, transparent 0), #9FE0BE",
    celestial: `<circle cx="380" cy="-210" r="90" fill="#FFE7A8"/>`,
    layer(n) {
      const r = rng(hash("forest", n))
      const cols = FOREST_COLS[((n % 4) + 4) % 4]
      const ground = 70 + r() * 70
      let out = poly([[-P / 2, ground], [P / 2, ground], [P / 2, BOTTOM], [-P / 2, BOTTOM]], cols.dark)
      let x = -P / 2 + r() * 60
      while (x < P / 2 - 40) {
        const h = 160 + r() * 260
        const w = 40 + r() * 46
        const base = ground + 6 + r() * 24
        out += poly([[x - 7, base], [x + 7, base], [x + 7, base - h * 0.2], [x - 7, base - h * 0.2]], "#8C6E54")
        // two stacked tiers, each split into a lit and a shaded half
        for (const [lo, hi, k] of [[0.15, 0.7, 1], [0.45, 1, 0.72]] as const) {
          const yb = base - h * lo, yt = base - h * hi, ww = w * k
          out += poly([[x - ww, yb], [x, yt], [x, yb]], cols.lit)
          out += poly([[x, yt], [x + ww, yb], [x, yb]], cols.dark)
        }
        x += w * 1.1 + r() * 90
      }
      return out
    },
  },
  {
    id: "dunes",
    name: "Dunes",
    sky: "linear-gradient(180deg, #FFD7C2 0%, #FFE8D0 45%, #FFF4E0 75%, #FFF8EE 100%)",
    haze: "#FFEBDD",
    swatch: "linear-gradient(170deg, #FFD7C2 40%, #F7CF7E 41%, #F7CF7E 62%, #DE9573 63%)",
    celestial: `<circle cx="-300" cy="-120" r="150" fill="#FFB892"/><circle cx="-300" cy="-120" r="110" fill="#FF9E7A"/>`,
    layer(n) {
      const r = rng(hash("dunes", n))
      const cols = DUNE_COLS[((n % 3) + 3) % 3]
      let out = ridge(r, 110 + r() * 50, [40, 170], [260, 520], cols)
      // a few low-poly rocks and cacti-like posts for scale
      const rocks = Math.floor(r() * 3)
      for (let i = 0; i < rocks; i++) {
        const x = -P / 2 + r() * P, y = 190 + r() * 120, s = 24 + r() * 40
        out += poly([[x - s, y], [x - s * 0.4, y - s * 0.9], [x + s * 0.5, y - s * 0.7], [x + s, y]], "#C99A78")
      }
      return out
    },
  },
  {
    id: "cosmos",
    name: "Cosmos",
    sky: "radial-gradient(ellipse at 50% 60%, #3B2E6E 0%, #221B45 45%, #120F26 100%)",
    haze: "#221B45",
    swatch: "radial-gradient(circle at 30% 35%, #fff 6%, transparent 7%), radial-gradient(circle at 70% 60%, #FFD56E 14%, transparent 15%), radial-gradient(#3B2E6E, #120F26)",
    layer(n) {
      const r = rng(hash("cosmos", n))
      let out = ""
      const stars = 34 + Math.floor(r() * 20)
      for (let i = 0; i < stars; i++) {
        const x = -P / 2 + r() * P, y = -BOTTOM + r() * BOTTOM * 2, s = 2 + r() * 5
        // four-point low-poly stars
        out += poly([[x, y - s * 2], [x + s * 0.5, y - s * 0.5], [x + s * 2, y], [x + s * 0.5, y + s * 0.5], [x, y + s * 2], [x - s * 0.5, y + s * 0.5], [x - s * 2, y], [x - s * 0.5, y - s * 0.5]], pick(r, ["#FFFFFF", "#FFF3C9", "#D3BFFF", "#B9C6FF"]))
      }
      if (r() > 0.45) {
        const x = -P / 2 + r() * P, y = -400 + r() * 800, rad = 50 + r() * 110
        const c = pick(r, [["#FF957B", "#C9705A"], ["#7ADDB0", "#4FAA80"], ["#C7AEFF", "#9A82D6"], ["#FFD978", "#C9A350"]] as const)
        const pts: [number, number][] = []
        for (let a = 0; a < 10; a++) pts.push([x + Math.cos((a / 10) * Math.PI * 2) * rad, y + Math.sin((a / 10) * Math.PI * 2) * rad])
        out += poly(pts, c[0])
        out += poly(pts.slice(2, 7).concat([[x, y]]), c[1])
        if (r() > 0.5) out += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(rad * 1.8).toFixed(0)}" ry="${(rad * 0.35).toFixed(0)}" fill="none" stroke-width="${(rad * 0.12).toFixed(0)}" style="stroke:color-mix(in srgb, #FFF3C9 calc(100% - var(--hz)), var(--haze))" transform="rotate(-14 ${x.toFixed(0)} ${y.toFixed(0)})"/>`
      }
      return out
    },
  },
]

export const themeById = (id: SceneryId) => THEMES.find((t) => t.id === id) ?? THEMES[0]

const cache = new Map<string, string>()
/** SVG markup for layer n of a theme (tiled three periods wide), memoized. */
export function layerMarkup(theme: Theme, n: number): string {
  const key = `${theme.id}:${n}`
  let m = cache.get(key)
  if (m === undefined) {
    m = theme.layer ? tile(theme.layer(n)) : ""
    if (cache.size > 400) cache.clear()
    cache.set(key, m)
  }
  return m
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export type LayerPlacement = { n: number; scale: number; tx: number; ty: number; opacity: number; haze: number }

/** Which layers are visible for a camera at depth Z, and how each is placed. */
export function placeLayers(z: number, panX: number, panY: number, pointer: { x: number; y: number }, layerWidth: number, vpH: number, parallax: boolean): LayerPlacement[] {
  const out: LayerPlacement[] = []
  const first = Math.floor(z + SCENERY.near) + 1
  const last = Math.floor(z + SCENERY.far)
  const periodPx = layerWidth / 3
  for (let n = last; n >= first; n--) {
    const d = n - z
    const scale = SCENERY.focal / d
    const slide = ((((panX * SCENERY.panGain) % periodPx) + periodPx) % periodPx) - periodPx / 2
    const tx = (slide + (parallax ? pointer.x * SCENERY.pointerGain : 0)) * scale
    const ty = Math.max(-vpH * 0.3, Math.min(vpH * 0.3, panY * SCENERY.panGain * 0.4 + (parallax ? pointer.y * SCENERY.pointerGain * 0.5 : 0))) * scale
    // Fade a layer out as it comes at you (like walking past it), and in as it appears on the horizon.
    const opacity = smooth(SCENERY.near, SCENERY.near + SCENERY.passFade, d) * smooth(SCENERY.far, SCENERY.far - 1.2, d)
    const haze = Math.min(88, Math.max(0, ((d - 0.6) / (SCENERY.far - 0.6)) * 100))
    out.push({ n, scale, tx, ty, opacity, haze })
  }
  return out
}

/**
 * The part of a layer that is on screen, as an SVG viewBox in layer units.
 *
 * A layer is laid out three periods wide (`layerW` px at scale 1), centred on the vanishing
 * point (screen x = vp.w/2, y = horizonY), then shifted by (tx, ty) and scaled by `scale`
 * about that point. So layer point (u, v) lands on screen at
 *   X = vp.w/2 + tx + u·unit·scale,   Y = horizonY + ty + v·unit·scale,   unit = layerW / (3·period).
 * Inverting that for the screen's corners gives the viewBox.
 */
export function layerViewBox(p: LayerPlacement, layerW: number, vp: { w: number; h: number }, horizonY: number): string {
  const k = (layerW / (SCENERY.period * 3)) * p.scale // screen px per layer unit
  const u0 = (0 - vp.w / 2 - p.tx) / k
  const v0 = (0 - horizonY - p.ty) / k
  return `${u0.toFixed(3)} ${v0.toFixed(3)} ${(vp.w / k).toFixed(3)} ${(vp.h / k).toFixed(3)}`
}
