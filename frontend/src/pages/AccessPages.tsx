// Arriving through an email invite, a join link, or a public link.

import { useEffect, useState } from "react"
import { navigate } from "@/app/router"
import { useSession } from "@/app/session"
import { Button } from "@/components/zoomboard/Button"
import { StatePanel } from "@/components/zoomboard/StatePanel"
import { api } from "@/lib/http"
import { BoardPage } from "./BoardPage"

type Info = {
  title: string
  role: string
  kind?: "space" | "workspace"
  spaceId?: string
  workspaceId?: string
  email?: string
  invitedBy?: string | null
  signedInAs?: string | null
}

/** An emailed invite: one click accepts it and signs the invited person in, no second email.
 *  Reading the invite never uses it up; only the button does. */
export function InvitePage({ token, kind }: { token: string; kind: "invite" | "join" }) {
  if (kind === "join") return <JoinPage token={token} />
  return <EmailInvitePage token={token} />
}

function EmailInvitePage({ token }: { token: string }) {
  const { user, loading, refresh } = useSession()
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Info>(`/api/invites/${token}`).then(setInfo, (e) => setError(e.message))
  }, [token])

  const redeem = async (switchAccount = false) => {
    setBusy(true)
    try {
      const r = await api<{ spaceId?: string; workspaceId?: string }>(`/api/invites/${token}/redeem`, { json: { switch: switchAccount } })
      await refresh()
      navigate(r.spaceId ? `/b/${r.spaceId}` : `/?ws=${r.workspaceId}`, { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (error) return <Page><StatePanel kind="error" title="This invite didn't work" message={error} onRetry={() => navigate(user ? "/" : "/login")} /></Page>
  if (!info || loading) return <Page><StatePanel kind="loading" title="Opening your invite" /></Page>
  const what = info.role === "viewer" ? "view" : "edit"
  const thing = info.kind === "workspace" ? `the canvases in the workspace “${info.title}”` : `the canvas “${info.title}”`
  const mismatch = user && info.email && user.email !== info.email
  return (
    <Page>
      <div className="zb-panel zb-login">
        <h1 className="zb-login-title">{info.title}</h1>
        <p>{info.invitedBy ? `${info.invitedBy} invited you to ${what} ${thing}.` : `You've been invited to ${what} ${thing}.`}</p>
        {mismatch ? (
          <>
            <p className="zb-error" role="alert">
              This invite is for <strong>{info.email}</strong>, but you're signed in as <strong>{user.email}</strong>.
            </p>
            <Button variant="primary" onClick={() => redeem(true)} disabled={busy}>
              {busy ? "Switching…" : `Continue as ${info.email}`}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/")} disabled={busy}>
              Stay as {user.email}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" autoFocus onClick={() => redeem()} disabled={busy}>
              {busy ? "Opening…" : info.kind === "workspace" ? "Open the workspace" : "Open the canvas"}
            </Button>
            {!user && <p className="zb-fine">You'll join as {info.email}. No password or extra email needed.</p>}
          </>
        )}
      </div>
    </Page>
  )
}

/** "Anyone with the link" join links: these need an account (they aren't tied to an email). */
function JoinPage({ token }: { token: string }) {
  const { user, loading } = useSession()
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Info>(`/api/join/${token}`).then(setInfo, (e) => setError(e.message))
  }, [token])

  const accept = async () => {
    setBusy(true)
    try {
      const r = await api<{ spaceId: string }>(`/api/join/${token}`, { method: "POST" })
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
        <p>You've been invited to {what} this canvas.</p>
        {user ? (
          <Button variant="primary" onClick={accept} disabled={busy}>
            {busy ? "Opening…" : "Open the canvas"}
          </Button>
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
