// Talking to the API: same-origin cookies, the CSRF header on writes, readable errors.

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? ""

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function apiUrl(path: string): string {
  return path.startsWith("/api") ? `${API_BASE}${path}` : path
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `Something went wrong (${res.status}).`
  try {
    const body = await res.json()
    if (typeof body?.detail === "string") message = body.detail
    else if (Array.isArray(body?.detail)) message = "Some of that didn't look right. Check it and try again."
  } catch {
    if (res.status >= 500) message = "The server had a problem. Try again in a moment."
  }
  return new ApiError(message, res.status)
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const method = (rest.method ?? (json !== undefined ? "POST" : "GET")).toUpperCase()
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      ...rest,
      method,
      credentials: "same-origin",
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "X-Zoomz": "1" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0)
  }
  if (!res.ok) throw await errorFrom(res)
  const type = res.headers.get("content-type") ?? ""
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>
}

/** Upload with progress (fetch can't report upload progress). */
export function upload<T>(path: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", apiUrl(path))
    xhr.withCredentials = true
    xhr.setRequestHeader("X-Zoomz", "1")
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => {
      let body: { detail?: string } | T | null = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T)
      else reject(new ApiError((body as { detail?: string })?.detail ?? `Upload failed (${xhr.status}).`, xhr.status))
    }
    xhr.onerror = () => reject(new ApiError("The upload was interrupted. Check your connection and try again.", 0))
    signal?.addEventListener("abort", () => xhr.abort())
    const form = new FormData()
    form.append("file", file)
    xhr.send(form)
  })
}
