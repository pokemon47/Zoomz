import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { THEMES, type SceneryId } from "@/lib/scenery"

/** Pick the world behind the boards. */
export function SceneryPicker({ value, onChange }: { value: SceneryId; onChange(id: SceneryId): void }) {
  return (
    <div className="zb-picker" role="group" aria-label="Scenery">
      <span className="zb-picker-label">Scenery</span>
      {THEMES.map((t) => (
        <Tooltip key={t.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="zb-swatch"
                aria-label={t.name}
                aria-pressed={value === t.id}
                style={{ background: t.swatch }}
                onClick={() => onChange(t.id)}
              />
            }
          />
          <TooltipContent className="zb-tip" sideOffset={10}>
            {t.name}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
