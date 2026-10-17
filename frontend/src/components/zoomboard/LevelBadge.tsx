import { DEPTH_DOT } from "@/lib/constants"

/** Small pill naming how deep you are; its dot matches the breadcrumb and floor tint. */
export function LevelBadge({ depth }: { depth: number }) {
  return (
    <span className="zb-badge zb-level" aria-hidden>
      <span className="zb-dot" style={{ ["--d" as string]: DEPTH_DOT[Math.min(depth, 3)] }} />
      Level {depth + 1}
    </span>
  )
}
