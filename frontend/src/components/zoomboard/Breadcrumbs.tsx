import { ArrowLeft } from "lucide-react"
import { Fragment } from "react"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { DEPTH_DOT } from "@/lib/constants"
import { IconButton } from "./IconButton"

export type Crumb = { id: string; title: string }

export type BreadcrumbsProps = {
  path: Crumb[]
  onNavigate(crumb: Crumb, depth: number): void
  onBack?(): void
}

/** Path pill, top-left. Each level's dot matches its depth-n floor tint. */
export function Breadcrumbs({ path, onNavigate, onBack }: BreadcrumbsProps) {
  return (
    <Breadcrumb className="zb-crumbs" aria-label="Board path">
      {onBack && (
        <IconButton label="Back" shortcut="Esc" onClick={onBack}>
          <ArrowLeft strokeWidth={2.25} />
        </IconButton>
      )}
      <BreadcrumbList className="gap-1 text-[14px] text-inherit">
        {path.map((c, i) => {
          const last = i === path.length - 1
          return (
            <Fragment key={c.id}>
              {i > 0 && (
                <BreadcrumbSeparator className="zb-sep">
                  <span>/</span>
                </BreadcrumbSeparator>
              )}
              <BreadcrumbItem>
                <button
                  type="button"
                  className="zb-crumb"
                  aria-current={last ? "page" : undefined}
                  onClick={() => !last && onNavigate(c, i)}
                >
                  <span className="zb-dot" style={{ ["--d" as string]: DEPTH_DOT[Math.min(i, 3)] }} />
                  {c.title}
                </button>
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
