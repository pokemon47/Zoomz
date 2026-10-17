import { ExternalLink, Globe, Play } from "lucide-react"
import { memo, useState } from "react"
import type { LOD } from "@/lib/types"
import { cn } from "@/lib/utils"
import { TactileSlab, type Tactile } from "./TactileSlab"

export type LinkCardProps = {
  url: string
  title?: string
  description?: string
  image?: string | null
  site?: string
  embed?: string | null
  lod: LOD
  selected?: boolean
  tactile: Tactile
  reduced: boolean
}

/**
 * A pasted link as a cobalt-tabbed slab: preview image, title, site. YouTube, Vimeo and
 * Figma links can be played in place up close (the embed only loads when you ask for it).
 */
export const LinkCard = memo(function LinkCard({ url, title, description, image, site, embed, lod, selected, tactile, reduced }: LinkCardProps) {
  const [playing, setPlaying] = useState(false)
  const host = site || safeHost(url)
  return (
    <TactileSlab tactile={tactile} reduced={reduced} className={cn("zb-link", `zb-${lod}`, selected && "is-selected")} aria-label={`Link: ${title || url}`}>
      <div className="zb-link-well">
        {playing && embed && lod === "close" ? (
          <iframe
            className="zb-link-embed"
            src={embed}
            title={title || url}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            referrerPolicy="strict-origin-when-cross-origin"
            data-no-drag
          />
        ) : image ? (
          <img src={image} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <Globe className="zb-link-globe" strokeWidth={2.25} aria-hidden />
        )}
        {embed && lod === "close" && !playing && (
          <button type="button" className="zb-link-play" data-no-drag onClick={() => setPlaying(true)} aria-label={`Play ${title || "video"}`}>
            <Play size={18} strokeWidth={2.5} aria-hidden />
          </button>
        )}
      </div>
      {lod !== "far" && (
        <div className="zb-link-meta">
          <div className="zb-cap">{title || url}</div>
          {lod === "close" && description && <div className="zb-alt">{description}</div>}
          <div className="zb-file-row">
            <span className="zb-meta zb-link-site">{host}</span>
            {lod === "close" && (
              <a className="zb-file-open" href={url} target="_blank" rel="noreferrer noopener" data-no-drag onPointerDown={(e) => e.stopPropagation()}>
                Open <ExternalLink size={12} strokeWidth={2.5} aria-hidden />
              </a>
            )}
          </div>
        </div>
      )}
    </TactileSlab>
  )
})

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
