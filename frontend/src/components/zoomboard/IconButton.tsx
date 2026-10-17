import type { ButtonHTMLAttributes, ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Accessible name and tooltip text. */
  label: string
  shortcut?: string
  children: ReactNode
}

/** Round extruded button for a single Lucide glyph, with a shadcn tooltip. */
export function IconButton({ label, shortcut, className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type={type} aria-label={label} className={cn("zb-ibtn", className)} {...rest} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="zb-tip" sideOffset={10}>
        {label}
        {shortcut && <kbd className="ml-1 font-mono text-[11px] text-ink-muted">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
