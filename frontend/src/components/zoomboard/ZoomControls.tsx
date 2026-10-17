import { useMotionValueEvent, type MotionValue } from "motion/react"
import { Maximize, Minus, Plus } from "lucide-react"
import { useState } from "react"
import { Button } from "./Button"
import { IconButton } from "./IconButton"

export type ZoomControlsProps = {
  scale: MotionValue<number>
  onZoomIn(): void
  onZoomOut(): void
  onFit(): void
}

/** Floating zoom pill, bottom-right. The readout subscribes to the camera scale directly. */
export function ZoomControls({ scale, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  const [pct, setPct] = useState(() => Math.round(scale.get() * 100))
  useMotionValueEvent(scale, "change", (s) => setPct(Math.round(s * 100)))
  return (
    <div className="zb-zoom" role="group" aria-label="Zoom">
      <IconButton label="Zoom out" shortcut="−" onClick={onZoomOut}>
        <Minus strokeWidth={2.25} />
      </IconButton>
      <span className="zb-readout" aria-live="polite" aria-label={`Zoom ${pct}%`}>
        {pct}%
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
