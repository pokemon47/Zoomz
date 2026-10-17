import { createContext, useCallback, useContext, useState, type ReactNode } from "react"

type Toast = { id: number; message: string }
const Ctx = createContext<(message: string) => void>(() => {})
let next = 1

/** Small slabs at the bottom centre for errors and confirmations. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string) => {
    const id = next++
    setToasts((t) => [...t.filter((x) => x.message !== message), { id, message }].slice(-3))
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="zb-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="zb-toast">
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
