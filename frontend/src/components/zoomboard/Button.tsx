import type { ButtonHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "cobalt" | "ghost"
  size?: "md" | "sm"
}

/** Puffy pill slab: top-lit face, visible side face, soft cast. Sinks on press. */
export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("zb-btn", variant !== "secondary" && `zb-btn-${variant}`, size === "sm" && "zb-btn-sm", className)}
      {...rest}
    />
  )
}
