import type { LOD } from "@/lib/types"

const CLASS: Record<LOD, string> = { far: "zb-lilac", medium: "zb-lemon", close: "zb-mint" }
const LABEL: Record<LOD, string> = { far: "Far", medium: "Medium", close: "Close" }

/** Tiny pill naming the semantic zoom level. Onboarding/debug only. */
export function ZoomBadge({ level }: { level: LOD }) {
  return <span className={`zb-badge ${CLASS[level]}`}>{LABEL[level]}</span>
}
