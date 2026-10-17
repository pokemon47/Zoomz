// Light / dark / follow the system. Saved per browser; public/theme-init.js applies it before
// the first paint, and this keeps it applied (and in step with the OS when set to "system").

export type ThemePref = "system" | "light" | "dark"

const KEY = "zoomz.theme"
const media = () => window.matchMedia("(prefers-color-scheme: dark)")
const listeners = new Set<() => void>()

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

export function resolvedTheme(pref = getTheme()): "light" | "dark" {
  return pref === "system" ? (media().matches ? "dark" : "light") : pref
}

export function applyTheme(pref = getTheme()) {
  const root = document.documentElement
  const dark = resolvedTheme(pref) === "dark"
  if (pref === "system") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", pref)
  root.classList.toggle("dark", dark)
  root.classList.toggle("light", !dark)
  root.style.colorScheme = dark ? "dark" : "light"
  listeners.forEach((fn) => fn())
}

export function setTheme(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* private mode: applies for this visit only */
  }
  applyTheme(pref)
}

/** Follow OS changes while set to "system", and changes made in other tabs. */
export function watchTheme() {
  media().addEventListener("change", () => getTheme() === "system" && applyTheme())
  window.addEventListener("storage", (e) => e.key === KEY && applyTheme())
}

export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
