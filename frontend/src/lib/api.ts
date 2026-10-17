import type { Scene } from "./types"

// Relative by default: Vite proxies /api in dev, the host routes it in production.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? ""

export function apiUrl(path: string): string {
  return path.startsWith("/api") ? `${API_BASE}${path}` : path
}

export async function fetchScene(signal?: AbortSignal): Promise<Scene> {
  const res = await fetch(apiUrl("/api/demo-board"), { signal })
  if (!res.ok) throw new Error(`Board request failed (${res.status})`)
  const data = (await res.json()) as Scene
  if (!data || !Array.isArray(data.nodes) || !data.rootBoardId) throw new Error("Board data was malformed")
  return data
}
