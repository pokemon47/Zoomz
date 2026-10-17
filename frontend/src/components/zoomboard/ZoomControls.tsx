import { Captions, CaptionsOff, Maximize, Minus, PanelTop, PanelTopDashed, Plus } from "lucide-react"
import type { Labels } from "@/lib/labels"
import { Button } from "./Button"
import { IconButton } from "./IconButton"

export type ZoomControlsProps = {
  /** Formatted magnification, e.g. "240%" or "38×". */
  readout: string
  onZoomIn(): void
  onZoomOut(): void
  onFit(): void
  /** Which labels are showing; omitted hides the two toggles. */
  labels?: Labels
  onToggleLabels?(which: keyof Labels): void
}

/** Floating zoom pill, bottom-right. */
export function ZoomControls({ readout, onZoomIn, onZoomOut, onFit, labels, onToggleLabels }: ZoomControlsProps) {
  return (
    <div className="zb-zoom" role="group" aria-label="Zoom">
      <IconButton label="Zoom out" shortcut="−" onClick={onZoomOut}>
        <Minus strokeWidth={2.25} />
      </IconButton>
      <span className="zb-readout" aria-label={`Zoom ${readout}`}>
        {readout}
      </span>
      <IconButton label="Zoom in" shortcut="+" onClick={onZoomIn}>
        <Plus strokeWidth={2.25} />
      </IconButton>
      <Button variant="ghost" size="sm" onClick={onFit}>
        <Maximize size={16} strokeWidth={2.25} aria-hidden />
        Fit board
      </Button>
      {labels && onToggleLabels && (
        <>
          <span className="zb-zoom-sep" aria-hidden />
          <IconButton label={labels.boards ? "Hide board labels" : "Show board labels"} shortcut="⇧L" aria-pressed={!labels.boards} onClick={() => onToggleLabels("boards")}>
            {labels.boards ? <PanelTop strokeWidth={2.25} /> : <PanelTopDashed strokeWidth={2.25} />}
          </IconButton>
          <IconButton label={labels.photos ? "Hide photo labels" : "Show photo labels"} shortcut="L" aria-pressed={!labels.photos} onClick={() => onToggleLabels("photos")}>
            {labels.photos ? <Captions strokeWidth={2.25} /> : <CaptionsOff strokeWidth={2.25} />}
          </IconButton>
        </>
      )}
    </div>
  )
}
