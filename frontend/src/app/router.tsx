// A tiny history-API router: the app has a handful of routes and no nested layouts.

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react"

const listeners = new Set<() => void>()

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, "", to)
  else history.pushState(null, "", to)
  listeners.forEach((fn) => fn())
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const [, force] = useState(0)
  useEffect(() => {
    const on = () => force((n) => n + 1)
    listeners.add(on)
    window.addEventListener("popstate", on)
    return () => {
      listeners.delete(on)
      window.removeEventListener("popstate", on)
    }
  }, [])
  return { path: location.pathname, query: new URLSearchParams(location.search) }
}

/** Match "/b/:id" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean)
  const b = path.split("/").filter(Boolean)
  if (a.length !== b.length) return null
  const out: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) out[a[i].slice(1)] = decodeURIComponent(b[i])
    else if (a[i] !== b[i]) return null
  }
  return out
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
      {...rest}
    />
  )
}
