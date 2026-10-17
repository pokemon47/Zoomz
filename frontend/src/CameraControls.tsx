import { motion, useTransform, type MotionValue } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { Button } from "./components/ui/button";

type Props = {
  scale: MotionValue<number>;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  disabled: boolean;
};

export default function CameraControls({ scale, zoomIn, zoomOut, fit, disabled }: Props) {
  const percentage = useTransform(scale, (value) => `${Math.round(value * 100)}%`);

  return (
    <div className="camera-controls" data-camera-controls role="group" aria-label="Board zoom controls">
      <Button variant="ghost" size="icon-sm" type="button" aria-label="Zoom out" title="Zoom out" onClick={zoomOut} disabled={disabled}>
        <Minus data-icon="inline-start" aria-hidden="true" />
      </Button>
      <motion.output className="camera-percentage" aria-label="Current zoom">{percentage}</motion.output>
      <Button variant="ghost" size="icon-sm" type="button" aria-label="Zoom in" title="Zoom in" onClick={zoomIn} disabled={disabled}>
        <Plus data-icon="inline-start" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="sm" type="button" onClick={fit} disabled={disabled}>Fit board</Button>
    </div>
  );
}
