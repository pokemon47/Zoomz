import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api, ApiError } from "@/lib/http"

export type User = { id: string; email: string; name: string; color: string; avatar: string | null }
type AuthConfig = { google: boolean; dev: boolean }

type Session = {
  user: User | null
  loading: boolean
  config: AuthConfig
  refresh(): Promise<void>
  setUser(u: User): void
  signOut(): Promise<void>
}

const Ctx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<AuthConfig>({ google: false, dev: false })

  const refresh = useCallback(async () => {
    try {
      setUser(await api<User>("/api/me"))
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.warn(e)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    api<AuthConfig>("/api/auth/config").then(setConfig, () => {})
  }, [refresh])

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {})
    setUser(null)
  }, [])

  return <Ctx.Provider value={{ user, loading, config, refresh, setUser, signOut }}>{children}</Ctx.Provider>
}

export function useSession(): Session {
  const s = useContext(Ctx)
  if (!s) throw new Error("useSession outside SessionProvider")
  return s
}
