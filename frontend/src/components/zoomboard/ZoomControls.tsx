import { Maximize, Minus, Plus } from "lucide-react"
import { Button } from "./Button"
import { IconButton } from "./IconButton"

export type ZoomControlsProps = {
  /** Formatted magnification, e.g. "240%" or "38×". */
  readout: string
  onZoomIn(): void
  onZoomOut(): void
  onFit(): void
}

/** Floating zoom pill, bottom-right. */
export function ZoomControls({ readout, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
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
    </div>
  )
}
