import { useEffect } from "react"
import { match, navigate, useLocation } from "@/app/router"
import { SessionProvider, useSession } from "@/app/session"
import { ToastProvider } from "@/app/toasts"
import { TooltipProvider } from "@/components/ui/tooltip"
import { StatePanel } from "@/components/zoomboard/StatePanel"
import { InvitePage, PublicPage } from "@/pages/AccessPages"
import { BoardPage } from "@/pages/BoardPage"
import { HomePage } from "@/pages/HomePage"
import { LoginPage, SignInConfirmPage } from "@/pages/LoginPage"
import { LegalPage, SettingsPage } from "@/pages/SettingsPage"

export default function App() {
  return (
    <TooltipProvider delay={400}>
      <ToastProvider>
        <SessionProvider>
          <h1 className="sr-only">Zoomz</h1>
          <Routes />
        </SessionProvider>
      </ToastProvider>
    </TooltipProvider>
  )
}

function Routes() {
  const { path } = useLocation()
  const { user, loading } = useSession()

  // Public routes: no account needed.
  if (path === "/login") return <LoginPage />
  if (path === "/demo") return <BoardPage demo />
  if (path === "/terms") return <LegalPage kind="terms" />
  if (path === "/privacy") return <LegalPage kind="privacy" />
  let m = match("/signin/:token", path)
  if (m) return <SignInConfirmPage token={m.token} />
  m = match("/p/:token", path)
  if (m) return <PublicPage token={m.token} />
  m = match("/invite/:token", path)
  if (m) return <InvitePage token={m.token} kind="invite" />
  m = match("/join/:token", path)
  if (m) return <InvitePage token={m.token} kind="join" />

  if (loading) return <main className="zb-page zb-page-center"><StatePanel kind="loading" title="Opening Zoomz" /></main>
  if (!user) return <RedirectToLogin />

  if (path === "/" || path === "") return <HomePage />
  if (path === "/settings") return <SettingsPage />
  m = match("/b/:id", path)
  if (m) return <BoardPage key={m.id} spaceId={m.id} />
  return (
    <main className="zb-page zb-page-center">
      <StatePanel kind="error" title="Nothing here" message="That page doesn't exist." onRetry={() => navigate("/")} />
    </main>
  )
}

function RedirectToLogin() {
  useEffect(() => {
    if (location.pathname === "/login") return
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
  }, [])
  return null
}
