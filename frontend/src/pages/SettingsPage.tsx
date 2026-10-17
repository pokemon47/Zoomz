import { useState, type FormEvent } from "react"
import { navigate } from "@/app/router"
import { useSession, type User } from "@/app/session"
import { useToast } from "@/app/toasts"
import { TopBar } from "@/components/app/TopBar"
import { Button } from "@/components/zoomboard/Button"
import { api } from "@/lib/http"

const COLORS = ["#FF8E72", "#6E8BFF", "#E2B33B", "#3FB984", "#A98BF5", "#F26D8F", "#2BB5C8"]

export function SettingsPage() {
  const { user, setUser, signOut } = useSession()
  const toast = useToast()
  const [name, setName] = useState(user?.name ?? "")
  const [color, setColor] = useState(user?.color ?? COLORS[0])
  const [confirm, setConfirm] = useState("")
  if (!user) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      setUser(await api<User>("/api/me", { method: "PATCH", json: { name, color } }))
      toast("Saved")
    } catch (err) {
      toast((err as Error).message)
    }
  }

  const remove = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api("/api/me", { method: "DELETE", json: { confirmEmail: confirm } })
      await signOut()
      navigate("/login", { replace: true })
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <main className="zb-page">
      <TopBar />
      <div className="zb-settings">
        <section className="zb-panel zb-card-section">
          <h2>Profile</h2>
          <form onSubmit={save} className="zb-form">
            <label className="zb-field">
              <span>Name</span>
              <input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
            </label>
            <fieldset className="zb-field">
              <span>Your colour (cursor and avatar)</span>
              <div className="zb-colors">
                {COLORS.map((c) => (
                  <button key={c} type="button" className="zb-swatch" style={{ background: c }} aria-label={c} aria-pressed={c === color} onClick={() => setColor(c)} />
                ))}
              </div>
            </fieldset>
            <p className="zb-meta">Signed in as {user.email}</p>
            <Button variant="primary" size="sm" type="submit">Save</Button>
          </form>
        </section>

        <section className="zb-panel zb-card-section">
          <h2>Your data</h2>
          <p>Download everything we keep about you, plus the boards you own and their files, as a zip.</p>
          <a className="zb-btn zb-btn-sm" href="/api/me/export" download>
            Download my data
          </a>
        </section>

        <section className="zb-panel zb-card-section zb-danger">
          <h2>Delete account</h2>
          <p>This deletes your account, every workspace you created, and all of their boards and files. Boards other people own stay theirs. This can't be undone.</p>
          <form onSubmit={remove} className="zb-form">
            <label className="zb-field">
              <span>Type {user.email} to confirm</span>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </label>
            <Button variant="primary" size="sm" type="submit" disabled={confirm.trim().toLowerCase() !== user.email}>
              Delete my account
            </Button>
          </form>
        </section>
      </div>
    </main>
  )
}

export function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  return (
    <main className="zb-page">
      <TopBar />
      <article className="zb-legal zb-panel">
        <p className="zb-draft">Draft — to be reviewed by a lawyer before launch.</p>
        {kind === "terms" ? (
          <>
            <h1>Terms of service</h1>
            <p>Zoomz lets you make moodboards, upload images and files, and share them with other people.</p>
            <h2>Your content</h2>
            <p>You keep all rights to what you upload. You give us permission to store it and show it to the people you share it with, only to run the service.</p>
            <h2>Acceptable use</h2>
            <p>Don't upload anything illegal, malware, or content you don't have the right to share. We may remove content or suspend accounts that break these rules.</p>
            <h2>Availability</h2>
            <p>We work to keep Zoomz running and your data safe, but the service is provided as is. Export your data any time from Settings.</p>
            <h2>Ending your account</h2>
            <p>You can delete your account in Settings at any time; your workspaces, boards and files are deleted with it.</p>
          </>
        ) : (
          <>
            <h1>Privacy</h1>
            <h2>What we keep</h2>
            <p>Your email address, name and colour; the boards, notes and files you create; who you share them with; and short-lived session and sign-in records. If you sign in with Google we receive your name, email and profile picture.</p>
            <h2>What we don't do</h2>
            <p>We don't sell your data or use it for advertising. Link previews are fetched by our server; images in previews load from the linked site.</p>
            <h2>Cookies</h2>
            <p>One essential cookie keeps you signed in. No tracking cookies.</p>
            <h2>Your rights</h2>
            <p>Download all your data or delete your account from Settings. Deleting removes your account and everything in the workspaces you created.</p>
            <h2>Processors</h2>
            <p>Hosting on Zenith; email delivery through our mail provider; error reports (without personal data) to our monitoring service, if enabled.</p>
          </>
        )}
      </article>
    </main>
  )
}
