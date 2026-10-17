import { Plus, Trash2, Users } from "lucide-react"
import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Link, navigate } from "@/app/router"
import { useToast } from "@/app/toasts"
import { SearchDialog } from "@/components/app/SearchDialog"
import { Avatar, TopBar } from "@/components/app/TopBar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/zoomboard/Button"
import { StatePanel } from "@/components/zoomboard/StatePanel"
import { api } from "@/lib/http"
import type { Role } from "@/lib/types"

type SpaceCard = { id: string; title: string; role: Role; workspaceId: string; updatedAt: string; thumbs: string[]; shared: boolean }
type Workspace = { id: string; name: string; personal: boolean; role: Role }
type Listing = { mine: SpaceCard[]; shared: SpaceCard[]; workspaces: Workspace[] }
type Member = { userId: string; email: string; name: string; color: string; role: Role }

export function HomePage() {
  const toast = useToast()
  const [data, setData] = useState<Listing | null>(null)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<string>("")
  const [searching, setSearching] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const [membersOf, setMembersOf] = useState<Workspace | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<Listing>("/api/spaces")
      setData(d)
      setTab((t) => t || d.workspaces[0]?.id || "")
      setError("")
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const newBoard = async () => {
    try {
      const s = await api<SpaceCard>("/api/spaces", { json: { title: "Untitled board", workspaceId: tab || undefined } })
      navigate(`/b/${s.id}`)
    } catch (e) {
      toast((e as Error).message)
    }
  }

  if (error) return <Center><StatePanel kind="error" message={error} onRetry={load} /></Center>
  if (!data) return <Center><StatePanel kind="loading" title="Loading your boards" /></Center>

  const ws = data.workspaces.find((w) => w.id === tab) ?? data.workspaces[0]
  const boards = data.mine.filter((s) => s.workspaceId === ws?.id)
  const canAdd = ws && ws.role !== "viewer"

  return (
    <main className="zb-page">
      <TopBar onSearch={() => setSearching(true)} />
      <div className="zb-home">
        <div className="zb-home-head">
          <div className="zb-tabs" role="tablist" aria-label="Workspaces">
            {data.workspaces.map((w) => (
              <button key={w.id} role="tab" aria-selected={w.id === ws?.id} className="zb-tab" onClick={() => setTab(w.id)}>
                {w.personal ? "Personal" : w.name}
              </button>
            ))}
            <button className="zb-tab zb-tab-add" onClick={() => setTeamOpen(true)}>
              <Plus size={14} strokeWidth={2.5} aria-hidden /> Team
            </button>
          </div>
          <div className="zb-home-actions">
            {ws && !ws.personal && (
              <Button size="sm" onClick={() => setMembersOf(ws)}>
                <Users size={14} strokeWidth={2.5} aria-hidden /> Members
              </Button>
            )}
            {canAdd && (
              <Button variant="primary" size="sm" onClick={newBoard}>
                <Plus size={14} strokeWidth={2.5} aria-hidden /> New board
              </Button>
            )}
          </div>
        </div>

        {boards.length ? (
          <div className="zb-grid">{boards.map((s) => <BoardTile key={s.id} s={s} />)}</div>
        ) : (
          <div className="zb-empty">
            <p>Nothing here yet — make a board and drop some inspiration in!</p>
            {canAdd && <Button variant="primary" onClick={newBoard}>New board</Button>}
          </div>
        )}

        {data.shared.length > 0 && (
          <>
            <h2 className="zb-section">Shared with you</h2>
            <div className="zb-grid">{data.shared.map((s) => <BoardTile key={s.id} s={s} />)}</div>
          </>
        )}
      </div>
      <SearchDialog open={searching} onClose={() => setSearching(false)} />
      <NewTeamDialog
        open={teamOpen}
        onClose={() => setTeamOpen(false)}
        onCreated={(w) => {
          setTeamOpen(false)
          setTab(w.id)
          void load()
        }}
      />
      {membersOf && <MembersDialog ws={membersOf} onClose={() => setMembersOf(null)} />}
    </main>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="zb-page zb-page-center">{children}</main>
}

function BoardTile({ s }: { s: SpaceCard }) {
  const tiles = s.thumbs.slice(0, 4)
  return (
    <Link to={`/b/${s.id}`} className="zb-tile">
      <div className="zb-tile-stack" aria-hidden>
        <i className="zb-mint" />
        <i className="zb-lilac" />
      </div>
      <div className="zb-tile-face">
        <div className="zb-mosaic">
          {tiles.length ? tiles.map((t) => <img key={t} src={t} alt="" loading="lazy" />) : ["var(--tomato)", "var(--cobalt)", "var(--lemon)", "var(--mint)"].map((c) => <i key={c} style={{ ["--c" as string]: c }} />)}
        </div>
        <div className="zb-tile-title">{s.title}</div>
        <div className="zb-meta">
          {s.role === "owner" ? "Yours" : s.role === "editor" ? "Can edit" : "View only"}
          {s.shared ? " · Shared" : ""} · {timeAgo(s.updatedAt)}
        </div>
      </div>
    </Link>
  )
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

function NewTeamDialog({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(w: Workspace): void }) {
  const toast = useToast()
  const [name, setName] = useState("")
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      onCreated(await api<Workspace>("/api/workspaces", { json: { name } }))
      setName("")
    } catch (err) {
      toast((err as Error).message)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="zb-dialog" showCloseButton={false}>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="zb-dialog-title">New team workspace</DialogTitle>
            <DialogDescription>Everyone you add can see the boards in it.</DialogDescription>
          </DialogHeader>
          <label className="zb-field">
            <span>Name</span>
            <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio" />
          </label>
          <div className="zb-dialog-footer">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit">Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MembersDialog({ ws, onClose }: { ws: Workspace; onClose(): void }) {
  const toast = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("editor")
  const load = useCallback(() => api<Member[]>(`/api/workspaces/${ws.id}/members`).then(setMembers, (e) => toast(e.message)), [toast, ws.id])
  useEffect(() => {
    void load()
  }, [load])
  const add = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api(`/api/workspaces/${ws.id}/members`, { json: { email, role } })
      setEmail("")
      void load()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="zb-dialog zb-dialog-wide" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="zb-dialog-title">{ws.name} members</DialogTitle>
          <DialogDescription>Members see every board in this workspace with their role.</DialogDescription>
        </DialogHeader>
        {ws.role === "owner" && (
          <form onSubmit={add} className="zb-invite-row">
            <input type="email" required placeholder="name@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
            <Button variant="primary" size="sm" type="submit">Add</Button>
          </form>
        )}
        <ul className="zb-people">
          {members.map((m) => (
            <li key={m.userId}>
              <Avatar name={m.name} color={m.color} size={30} />
              <div>
                <strong>{m.name}</strong>
                <span>{m.email}</span>
              </div>
              <span className="zb-role">{m.role}</span>
              {ws.role === "owner" && (
                <button
                  type="button"
                  className="zb-ibtn zb-ibtn-sm"
                  aria-label={`Remove ${m.name}`}
                  onClick={async () => {
                    try {
                      await api(`/api/workspaces/${ws.id}/members/${m.userId}`, { method: "DELETE" })
                      void load()
                    } catch (err) {
                      toast((err as Error).message)
                    }
                  }}
                >
                  <Trash2 size={14} strokeWidth={2.25} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="zb-dialog-footer">
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
