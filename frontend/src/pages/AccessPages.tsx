// Arriving through an email invite, a join link, or a public link.

import { useEffect, useState } from "react"
import { navigate } from "@/app/router"
import { useSession } from "@/app/session"
import { Button } from "@/components/zoomboard/Button"
import { StatePanel } from "@/components/zoomboard/StatePanel"
import { api } from "@/lib/http"
import { BoardPage } from "./BoardPage"

type Info = { spaceId: string; title: string; role: string; email?: string; invitedBy?: string | null }

export function InvitePage({ token, kind }: { token: string; kind: "invite" | "join" }) {
  const { user, loading } = useSession()
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Info>(kind === "invite" ? `/api/invites/${token}` : `/api/join/${token}`).then(setInfo, (e) => setError(e.message))
  }, [kind, token])

  const accept = async () => {
    setBusy(true)
    try {
      const r = await api<{ spaceId: string }>(kind === "invite" ? `/api/invites/${token}/accept` : `/api/join/${token}`, { method: "POST" })
      navigate(`/b/${r.spaceId}`, { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (error) return <Page><StatePanel kind="error" title="This link didn't work" message={error} onRetry={() => navigate("/")} /></Page>
  if (!info || loading) return <Page><StatePanel kind="loading" title="Opening your invite" /></Page>
  const what = info.role === "editor" ? "edit" : "view"
  return (
    <Page>
      <div className="zb-panel zb-login">
        <h1 className="zb-login-title">{info.title}</h1>
        <p>{info.invitedBy ? `${info.invitedBy} invited you to ${what} this board.` : `You've been invited to ${what} this board.`}</p>
        {user ? (
          <>
            <Button variant="primary" onClick={accept} disabled={busy}>
              {busy ? "Opening…" : "Open the board"}
            </Button>
            {info.email && info.email !== user.email && <p className="zb-error">This invite is for {info.email} — you're signed in as {user.email}.</p>}
          </>
        ) : (
          <Button variant="primary" onClick={() => navigate(`/login?next=${encodeURIComponent(location.pathname)}`)}>
            Sign in to continue
          </Button>
        )}
      </div>
    </Page>
  )
}

export function PublicPage({ token }: { token: string }) {
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    api<{ spaceId: string }>(`/api/public/${token}`).then((r) => setSpaceId(r.spaceId), (e) => setError(e.message))
  }, [token])
  if (error) return <Page><StatePanel kind="error" title="This link was turned off" message={error} onRetry={() => navigate("/")} /></Page>
  if (!spaceId) return <Page><StatePanel kind="loading" /></Page>
  return <BoardPage spaceId={spaceId} publicToken={token} />
}

function Page({ children }: { children: React.ReactNode }) {
  return <main className="zb-page zb-page-center">{children}</main>
}
