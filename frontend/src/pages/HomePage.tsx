import { Copy, Download, FileUp, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { Link, navigate } from "@/app/router"
import { useToast } from "@/app/toasts"
import { SearchDialog } from "@/components/app/SearchDialog"
import { Avatar, TopBar } from "@/components/app/TopBar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/zoomboard/Button"
import { StatePanel } from "@/components/zoomboard/StatePanel"
import { api, apiUrl, upload } from "@/lib/http"
import type { Role } from "@/lib/types"

type SpaceCard = { id: string; title: string; role: Role; workspaceId: string; updatedAt: string; thumbs: string[]; shared: boolean }
type Workspace = { id: string; name: string; personal: boolean; role: Role }
type Listing = { mine: SpaceCard[]; shared: SpaceCard[]; workspaces: Workspace[] }
type Member = { userId?: string; inviteId?: string; email: string; name?: string; color?: string; role: Role; pending?: boolean }

export function HomePage() {
  const toast = useToast()
  const [data, setData] = useState<Listing | null>(null)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<string>("")
  const [searching, setSearching] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const [membersOf, setMembersOf] = useState<Workspace | null>(null)
  const [renaming, setRenaming] = useState<Workspace | null>(null)
  const [deletingWs, setDeletingWs] = useState<Workspace | null>(null)
  const [deletingBoard, setDeletingBoard] = useState<SpaceCard | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<Listing>("/api/spaces")
      setData(d)
      const wanted = new URLSearchParams(location.search).get("ws")
      setTab((t) => (t && d.workspaces.some((w) => w.id === t) ? t : wanted && d.workspaces.some((w) => w.id === wanted) ? wanted : d.workspaces[0]?.id || ""))
      setError("")
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
    // Boards deleted or shared by someone else show up when you come back to the tab.
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
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

  const newCanvas = async () => {
    try {
      const s = await api<SpaceCard>("/api/spaces", { json: { title: "Untitled canvas", workspaceId: tab || undefined } })
      navigate(`/b/${s.id}`)
    } catch (e) {
      toast((e as Error).message)
    }
  }

  // Import an exported canvas (.zip) as a new canvas in this workspace, laid out exactly as it was.
  const importInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState<number | null>(null)
  const importCanvas = async (file: File) => {
    setImporting(0)
    try {
      const s = await upload<SpaceCard>(`/api/spaces/import${tab ? `?workspaceId=${encodeURIComponent(tab)}` : ""}`, file, (f) => setImporting(f))
      toast(`Imported “${s.title}”`)
      navigate(`/b/${s.id}`)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setImporting(null)
    }
  }

  const duplicate = async (s: SpaceCard) => {
    try {
      const copy = await api<SpaceCard>(`/api/spaces/${s.id}/duplicate`, { json: {} })
      toast(`Duplicated “${s.title}”`)
      await load()
      setTab(copy.workspaceId)
    } catch (e) {
      toast((e as Error).message)
    }
  }

  if (error) return <Center><StatePanel kind="error" message={error} onRetry={load} /></Center>
  if (!data) return <Center><StatePanel kind="loading" title="Loading your canvases" /></Center>

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
                {w.name}
              </button>
            ))}
            <button className="zb-tab zb-tab-add" onClick={() => setTeamOpen(true)}>
              <Plus size={14} strokeWidth={2.5} aria-hidden /> Team
            </button>
          </div>
          <div className="zb-home-actions">
            {ws?.role === "owner" && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<button type="button" className="zb-ibtn zb-ibtn-sm" aria-label={`Manage ${ws.name}`} />}>
                  <MoreHorizontal size={16} strokeWidth={2.25} aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-48">
                  <DropdownMenuItem onClick={() => setRenaming(ws)}>
                    <Pencil aria-hidden /> Rename workspace
                  </DropdownMenuItem>
                  {!ws.personal && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setDeletingWs(ws)}>
                        <Trash2 aria-hidden /> Delete workspace…
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {ws && !ws.personal && (
              <Button size="sm" onClick={() => setMembersOf(ws)}>
                <Users size={14} strokeWidth={2.5} aria-hidden /> Members
              </Button>
            )}
            {canAdd && (
              <>
                <Button size="sm" onClick={() => importInput.current?.click()} disabled={importing !== null}>
                  <FileUp size={14} strokeWidth={2.5} aria-hidden /> {importing !== null ? `Importing… ${Math.round(importing * 100)}%` : <>Import<span className="zb-hide-sm"> canvas</span></>}
                </Button>
                <Button variant="primary" size="sm" onClick={newCanvas}>
                  <Plus size={14} strokeWidth={2.5} aria-hidden /> New<span className="zb-hide-sm"> blank</span> canvas
                </Button>
                <input
                  ref={importInput}
                  type="file"
                  accept=".zip,application/zip"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ""
                    if (f) void importCanvas(f)
                  }}
                />
              </>
            )}
          </div>
        </div>

        {boards.length ? (
          <div className="zb-grid">{boards.map((s) => <BoardTile key={s.id} s={s} onDelete={() => setDeletingBoard(s)} onDuplicate={canAdd ? () => void duplicate(s) : undefined} />)}</div>
        ) : (
          <div className="zb-empty">
            <p>Nothing here yet — start a canvas and drop some inspiration in!</p>
            {canAdd && <Button variant="primary" onClick={newCanvas}>New blank canvas</Button>}
          </div>
        )}

        {data.shared.length > 0 && (
          <>
            <h2 className="zb-section">Shared with you</h2>
            <div className="zb-grid">{data.shared.map((s) => <BoardTile key={s.id} s={s} onDelete={() => setDeletingBoard(s)} onDuplicate={() => void duplicate(s)} />)}</div>
          </>
        )}
      </div>
      <SearchDialog open={searching} onClose={() => setSearching(false)} workspace={ws ? { id: ws.id, name: ws.name } : undefined} />
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
      {renaming && (
        <RenameDialog
          ws={renaming}
          onClose={() => setRenaming(null)}
          onDone={() => {
            setRenaming(null)
            void load()
          }}
        />
      )}
      {deletingWs && (
        <ConfirmDelete
          title={`Delete “${deletingWs.name}”?`}
          message={`This permanently deletes the workspace, every canvas in it (${data.mine.filter((b) => b.workspaceId === deletingWs.id).length}) and all their pictures and files, for everyone. It can't be undone.`}
          typeToConfirm={deletingWs.name}
          action="Delete workspace"
          onClose={() => setDeletingWs(null)}
          onConfirm={async () => {
            await api(`/api/workspaces/${deletingWs.id}`, { method: "DELETE" })
            setDeletingWs(null)
            setTab(data.workspaces.find((w) => w.personal)?.id ?? "")
            toast(`Deleted ${deletingWs.name}`)
            void load()
          }}
        />
      )}
      {deletingBoard && (
        <ConfirmDelete
          title={`Delete “${deletingBoard.title}”?`}
          message="This permanently deletes the canvas, every board on it, and all its pictures, notes and files, for everyone. It can't be undone."
          action="Delete canvas"
          onClose={() => setDeletingBoard(null)}
          onConfirm={async () => {
            await api(`/api/spaces/${deletingBoard.id}`, { method: "DELETE" })
            setDeletingBoard(null)
            toast(`Deleted ${deletingBoard.title}`)
            void load()
          }}
        />
      )}
    </main>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="zb-page zb-page-center">{children}</main>
}

function BoardTile({ s, onDelete, onDuplicate }: { s: SpaceCard; onDelete(): void; onDuplicate?(): void }) {
  const tiles = s.thumbs.slice(0, 4)
  return (
    <div className="zb-tile-wrap">
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
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" className="zb-ibtn zb-ibtn-sm zb-tile-menu" aria-label={`More for ${s.title}`} />}>
          <MoreHorizontal size={16} strokeWidth={2.25} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          {onDuplicate && (
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy aria-hidden /> Duplicate canvas
            </DropdownMenuItem>
          )}
          <DropdownMenuItem render={<a href={apiUrl(`/api/spaces/${s.id}/export`)} download />}>
            <Download aria-hidden /> Export canvas
          </DropdownMenuItem>
          {s.role === "owner" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 aria-hidden /> Delete canvas…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** "Are you sure?" for permanent deletes. With `typeToConfirm`, the name must be typed first. */
function ConfirmDelete({ title, message, action, typeToConfirm, onClose, onConfirm }: { title: string; message: string; action: string; typeToConfirm?: string; onClose(): void; onConfirm(): Promise<void> }) {
  const toast = useToast()
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const ready = !typeToConfirm || typed.trim() === typeToConfirm.trim()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      await onConfirm()
    } catch (err) {
      toast((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="zb-dialog" showCloseButton={false}>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="zb-dialog-title">{title}</DialogTitle>
            <DialogDescription>{message}</DialogDescription>
          </DialogHeader>
          {typeToConfirm && (
            <label className="zb-field">
              <span>Type <strong>{typeToConfirm}</strong> to confirm</span>
              <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </label>
          )}
          <div className="zb-dialog-footer">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="danger" size="sm" type="submit" disabled={!ready || busy} autoFocus={!typeToConfirm}>
              {busy ? "Deleting…" : action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({ ws, onClose, onDone }: { ws: Workspace; onClose(): void; onDone(): void }) {
  const toast = useToast()
  const [name, setName] = useState(ws.name)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api(`/api/workspaces/${ws.id}`, { method: "PATCH", json: { name } })
      onDone()
    } catch (err) {
      toast((err as Error).message)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="zb-dialog" showCloseButton={false}>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="zb-dialog-title">Rename workspace</DialogTitle>
          </DialogHeader>
          <label className="zb-field">
            <span>Name</span>
            <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
          </label>
          <div className="zb-dialog-footer">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" disabled={!name.trim()}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
            <DialogDescription>Everyone you add can see the canvases in it.</DialogDescription>
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
  const [devLink, setDevLink] = useState<string | null>(null)
  const load = useCallback(() => api<Member[]>(`/api/workspaces/${ws.id}/members`).then(setMembers, (e) => toast(e.message)), [toast, ws.id])
  useEffect(() => {
    void load()
  }, [load])
  const add = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const r = await api<{ devLink?: string }>(`/api/workspaces/${ws.id}/members`, { json: { email, role } })
      if (r.devLink) setDevLink(r.devLink)
      toast(`Invite sent to ${email}`)
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
          <DialogDescription>Members see every canvas in this workspace with their role.</DialogDescription>
        </DialogHeader>
        {ws.role === "owner" && (
          <form onSubmit={add} className="zb-invite-row">
            <input type="email" required placeholder="name@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
            <Button variant="primary" size="sm" type="submit">Invite</Button>
          </form>
        )}
        {devLink && (
          <p className="zb-fine">
            No mail server in development — <a href={devLink}>open the invite link</a>.
          </p>
        )}
        <ul className="zb-people">
          {members.map((m) => (
            <li key={m.userId ?? m.inviteId}>
              <Avatar name={m.name ?? m.email} color={m.color ?? "var(--ink-muted)"} size={30} />
              <div>
                <strong>{m.pending ? m.email : m.name}</strong>
                <span>{m.pending ? "Invite sent — joins when they open the email" : m.email}</span>
              </div>
              <span className="zb-role">{m.role}</span>
              {ws.role === "owner" && (
                <button
                  type="button"
                  className="zb-ibtn zb-ibtn-sm"
                  aria-label={m.pending ? `Cancel invite to ${m.email}` : `Remove ${m.name}'s access`}
                  title={m.pending ? "Cancel invite" : "Remove access"}
                  onClick={async () => {
                    try {
                      await api(m.pending ? `/api/workspaces/${ws.id}/invites/${m.inviteId}` : `/api/workspaces/${ws.id}/members/${m.userId}`, { method: "DELETE" })
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
