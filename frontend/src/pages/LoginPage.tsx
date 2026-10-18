import { Mail } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Link, navigate, useLocation } from "@/app/router"
import { useSession } from "@/app/session"
import { Button } from "@/components/zoomboard/Button"
import { api } from "@/lib/http"

const ERRORS: Record<string, string> = {
  expired: "That sign-in link has expired or was already used. Ask for a new one.",
  google: "Google sign-in didn't go through. Try again, or use your email.",
}

export function LoginPage() {
  const { config, guestExpired } = useSession()
  const { query } = useLocation()
  const next = query.get("next") ?? "/"
  const [email, setEmail] = useState(guestExpired?.email ?? "")
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle")
  const [error, setError] = useState(ERRORS[query.get("error") ?? ""] ?? "")
  const [devLink, setDevLink] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setState("sending")
    try {
      const r = await api<{ sent: boolean; devLink?: string }>("/api/auth/magic-link", { json: { email, next } })
      setDevLink(r.devLink ?? null)
      setState("sent")
    } catch (err) {
      setError((err as Error).message)
      setState("idle")
    }
  }

  return (
    <main className="zb-page zb-page-center">
      <div className="zb-panel zb-login">
        <div className="zb-logo" aria-hidden>
          <i className="zb-tomato" />
          <i className="zb-lilac" />
          <i className="zb-mint" />
        </div>
        <h1 className="zb-login-title">Zoomz</h1>
        {guestExpired ? (
          <p role="status">Your guest access has ended. Sign in to keep using Zoomz — your canvases are still here.</p>
        ) : (
          <p>Moodboards you walk into. Sign in to make your own and share them.</p>
        )}
        {state === "sent" ? (
          <div className="zb-sent" role="status">
            <Mail size={22} strokeWidth={2.25} aria-hidden />
            <div>
              <strong>Check {email}</strong>
              <span>We sent you a sign-in link. It works once and expires in 20 minutes.</span>
              {devLink && (
                <a className="zb-btn zb-btn-cobalt zb-btn-sm" href={devLink}>
                  Open sign-in link (development)
                </a>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="zb-login-form">
            <label className="zb-field">
              <span>Email</span>
              <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@studio.com" />
            </label>
            <Button variant="primary" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a sign-in link"}
            </Button>
            {config.google && (
              <a className="zb-btn" href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>
                <GoogleMark /> Continue with Google
              </a>
            )}
          </form>
        )}
        {error && (
          <p className="zb-error" role="alert">
            {error}
          </p>
        )}
        <p className="zb-fine">
          <Link to="/demo">Try the demo canvas</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
        </p>
      </div>
    </main>
  )
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** The page an emailed sign-in link opens. Signing in takes a click, so mail scanners that
 *  open links can't use the link up first. */
export function SignInConfirmPage({ token }: { token: string }) {
  const { refresh } = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const go = async () => {
    setBusy(true)
    try {
      const r = await api<{ next: string }>("/api/auth/verify", { json: { token } })
      await refresh()
      navigate(r.next || "/", { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <main className="zb-page zb-page-center">
      <div className="zb-panel zb-login">
        <h1 className="zb-login-title">Sign in to Zoomz</h1>
        {error ? (
          <>
            <p className="zb-error" role="alert">{error}</p>
            <Button onClick={() => navigate("/login", { replace: true })}>Get a new link</Button>
          </>
        ) : (
          <>
            <p>You're one click away from your canvases.</p>
            <Button variant="primary" autoFocus onClick={go} disabled={busy}>
              {busy ? "Signing in…" : "Continue to Zoomz"}
            </Button>
          </>
        )}
      </div>
    </main>
  )
}
