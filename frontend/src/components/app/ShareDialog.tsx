import { Check, Copy, Globe, Link2, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState, type FormEvent } from "react"
import { useSession } from "@/app/session"
import { useToast } from "@/app/toasts"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/zoomboard/Button"
import { api } from "@/lib/http"
import { titleOf } from "@/lib/scene"
import type { Space } from "@/lib/space"
import type { Role } from "@/lib/types"
import { Avatar } from "./TopBar"

type Member = { userId: string; email: string; name: string; color: string; avatar: string | null; role: Role; via: "space" | "workspace" }
type Sharing = {
  role: Role
  members: Member[]
  invites?: { id: string; email: string; role: Role; expiresAt: string }[]
  joinLink?: { url: string; role: Role; expiresAt: string | null } | null
  publicLink?: { url: string } | null
  overrides?: { boardId: string; userId: string; role: Role }[]
}

type Props = { spaceId: string; title: string; space: Space; open: boolean; onClose(): void }

/** Who can see and edit this board: people, invites, links, and per-board access. */
export function ShareDialog({ spaceId, title, space, open, onClose }: Props) {
  const toast = useToast()
  const { user } = useSession()
  const [data, setData] = useState<Sharing | null>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("editor")
  const [devLink, setDevLink] = useState<string | null>(null)

  const load = useCallback(() => api<Sharing>(`/api/spaces/${spaceId}/sharing`).then(setData, (e) => toast(e.message)), [spaceId, toast])
  useEffect(() => {
    if (open) void load()
  }, [load, open])

  const run = async (fn: () => Promise<unknown>) => {
    try {
      const r = await fn()
      if (r && typeof r === "object" && "members" in (r as object)) setData(r as Sharing)
      else void load()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  const invite = async (e: FormEvent) => {
    e.preventDefault()
    await run(async () => {
      const r = await api<{ devLink?: string }>(`/api/spaces/${spaceId}/invites`, { json: { email, role } })
      setDevLink(r.devLink ?? null)
      toast(`Invite sent to ${email}`)
      setEmail("")
    })
  }

  const owner = data?.role === "owner"
  const boards = [...space.index.byId.values()].filter((n) => n.type === "board" && n.parentId)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="zb-dialog zb-dialog-wide zb-share" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="zb-dialog-title">Share “{title}”</DialogTitle>
          <DialogDescription>{owner ? "Invite people, or turn on a link." : "People on this board."}</DialogDescription>
        </DialogHeader>

        {owner && (
          <form onSubmit={invite} className="zb-invite-row">
            <input type="email" required placeholder="name@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email to invite" />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Access">
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <Button variant="primary" size="sm" type="submit">Invite</Button>
          </form>
        )}
        {devLink && (
          <p className="zb-meta">
            No mail server in development — <a href={devLink}>invite link</a>.
          </p>
        )}

        <ul className="zb-people">
          {data?.members.map((m) => (
            <li key={m.userId}>
              <Avatar name={m.name} color={m.color} avatar={m.avatar} size={30} />
              <div>
                <strong>
                  {m.name}
                  {m.userId === user?.id ? " (you)" : ""}
                </strong>
                <span>{m.via === "workspace" ? `${m.email} · via workspace` : m.email}</span>
              </div>
              {owner && m.via === "space" && m.userId !== user?.id ? (
                <select value={m.role} aria-label={`${m.name}'s access`} onChange={(e) => run(() => api(`/api/spaces/${spaceId}/members/${m.userId}`, { method: "PUT", json: { role: e.target.value } }))}>
                  <option value="owner">Owner</option>
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
              ) : (
                <span className="zb-role">{m.role === "owner" ? "Owner" : m.role === "editor" ? "Can edit" : "Can view"}</span>
              )}
              {owner && m.via === "space" && m.userId !== user?.id && (
                <button type="button" className="zb-ibtn zb-ibtn-sm" aria-label={`Remove ${m.name}`} onClick={() => run(() => api(`/api/spaces/${spaceId}/members/${m.userId}`, { method: "DELETE" }))}>
                  <Trash2 size={14} strokeWidth={2.25} aria-hidden />
                </button>
              )}
            </li>
          ))}
          {data?.invites?.map((i) => (
            <li key={i.id} className="is-pending">
              <Avatar name={i.email} color="var(--surface-side)" size={30} />
              <div>
                <strong>{i.email}</strong>
                <span>Invited · {i.role === "editor" ? "can edit" : "can view"}</span>
              </div>
              <button type="button" className="zb-ibtn zb-ibtn-sm" aria-label={`Withdraw invite for ${i.email}`} onClick={() => run(() => api(`/api/spaces/${spaceId}/invites/${i.id}`, { method: "DELETE" }))}>
                <Trash2 size={14} strokeWidth={2.25} aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        {owner && (
          <div className="zb-links">
            <LinkRow
              icon={<Link2 size={16} strokeWidth={2.25} aria-hidden />}
              title="Anyone with the link can join"
              hint="They sign in, then get the access you choose."
              url={data?.joinLink?.url}
              onToggle={(on) => run(() => api(`/api/spaces/${spaceId}/join-link`, { method: "PUT", json: { enabled: on, role: data?.joinLink?.role ?? "viewer" } }))}
            >
              {data?.joinLink && (
                <>
                  <select value={data.joinLink.role} aria-label="Link access" onChange={(e) => run(() => api(`/api/spaces/${spaceId}/join-link`, { method: "PUT", json: { enabled: true, role: e.target.value } }))}>
                    <option value="viewer">Can view</option>
                    <option value="editor">Can edit</option>
                  </select>
                  <select
                    value={data.joinLink.expiresAt ? "7" : ""}
                    aria-label="Link expiry"
                    onChange={(e) => run(() => api(`/api/spaces/${spaceId}/join-link`, { method: "PUT", json: { enabled: true, role: data.joinLink!.role, expiresInDays: e.target.value ? Number(e.target.value) : null } }))}
                  >
                    <option value="">Never expires</option>
                    <option value="1">Expires in 1 day</option>
                    <option value="7">Expires in 7 days</option>
                    <option value="30">Expires in 30 days</option>
                  </select>
                </>
              )}
            </LinkRow>
            <LinkRow
              icon={<Globe size={16} strokeWidth={2.25} aria-hidden />}
              title="Public, view only"
              hint="Anyone with this link can look — no account needed."
              url={data?.publicLink?.url}
              onToggle={(on) => run(() => api(`/api/spaces/${spaceId}/public-link`, { method: "PUT", json: { enabled: on } }))}
            />
          </div>
        )}

        {owner && boards.length > 0 && data && data.members.some((m) => m.role !== "owner") && (
          <details className="zb-overrides">
            <summary>Access inside individual boards</summary>
            <p className="zb-meta">Give someone a different role inside one board (and everything in it).</p>
            {data.members
              .filter((m) => m.role !== "owner")
              .map((m) => (
                <div key={m.userId} className="zb-override-person">
                  <strong>{m.name}</strong>
                  {boards.map((b) => {
                    const o = data.overrides?.find((x) => x.boardId === b.id && x.userId === m.userId)
                    return (
                      <label key={b.id} className="zb-override">
                        <span>{titleOf(b)}</span>
                        <select
                          value={o?.role ?? ""}
                          onChange={(e) => run(() => api(`/api/spaces/${spaceId}/overrides`, { method: "PUT", json: { boardId: b.id, userId: m.userId, role: e.target.value || null } }))}
                        >
                          <option value="">Same as the board ({m.role === "editor" ? "can edit" : "can view"})</option>
                          <option value="editor">Can edit</option>
                          <option value="viewer">Can view</option>
                        </select>
                      </label>
                    )
                  })}
                </div>
              ))}
          </details>
        )}
        <div className="zb-dialog-footer">
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LinkRow({ icon, title, hint, url, onToggle, children }: { icon: React.ReactNode; title: string; hint: string; url?: string; onToggle(on: boolean): void; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="zb-linkrow">
      <div className="zb-linkrow-head">
        {icon}
        <div>
          <strong>{title}</strong>
          <span className="zb-meta">{hint}</span>
        </div>
        <label className="zb-switch">
          <input type="checkbox" checked={!!url} onChange={(e) => onToggle(e.target.checked)} />
          <span aria-hidden />
          <span className="sr-only">{title}</span>
        </label>
      </div>
      {url && (
        <div className="zb-linkrow-body">
          <input readOnly value={url} aria-label={`${title} URL`} onFocus={(e) => e.target.select()} />
          <Button
            size="sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => {})
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <Copy size={14} strokeWidth={2.5} aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
          {children}
        </div>
      )}
    </div>
  )
}
