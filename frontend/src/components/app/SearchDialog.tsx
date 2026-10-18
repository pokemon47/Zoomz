import { FileText, Image as ImageIcon, LayoutGrid, Link2, MoveUpRight, Search, StickyNote } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { navigate } from "@/app/router"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/http"
import { titleOf } from "@/lib/scene"
import type { Space } from "@/lib/space"
import type { SceneNode } from "@/lib/types"

type Hit = { spaceId: string; spaceTitle: string; node: SceneNode; path: { id: string; title: string }[] }

const ICON = { board: LayoutGrid, image: ImageIcon, note: StickyNote, file: FileText, link: Link2, arrow: MoveUpRight }

type Scope = "board" | "workspace"

type Props = {
  open: boolean
  onClose(): void
  /** When searching from inside a board: its live contents (instant results) and how to fly there. */
  here?: { spaceId: string | null; space: Space; workspaceId: string; boardId(): string; flyTo(id: string): void }
  /** On the dashboard: the workspace being looked at (results stay within it). */
  workspace?: { id: string; name: string }
}

/** ⌘K: find things and fly to them. Inside a board it searches that board and everything in
 *  it by default, or the whole workspace; on the dashboard, the workspace you're looking at. */
export function SearchDialog({ open, onClose, here, workspace }: Props) {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<Scope>("board")
  const [board, setBoard] = useState<string | null>(null)
  const seq = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setQ("")
      setHits([])
      setActive(0)
      setScope("board")
    } else if (here) setBoard(here.boardId())
  }, [open, here])

  const boardTitle = here && board ? titleOf(here.space.node(board) ?? ({ type: "board", content: { title: "this board" } } as SceneNode)) : ""
  const canScope = !!here?.spaceId && !!here.workspaceId

  useEffect(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2) {
      setHits([])
      return
    }
    // Instant results from what's loaded here, then the server's (which also knows file names).
    const inBoard = (n: SceneNode) => !board || !here || isInside(here.space, n.id, board)
    const localHits: Hit[] = here
      ? [...here.space.index.byId.values()]
          .filter((n) => n.parentId && inBoard(n) && searchable(n).includes(term))
          .slice(0, 12)
          .map((n) => ({ spaceId: here.spaceId ?? "", spaceTitle: "", node: n, path: pathOf(here.space, n) }))
      : []
    setHits(localHits)
    setActive(0)
    if (here && !here.spaceId) return // local demo: no server search
    const params = new URLSearchParams({ q: term })
    if (here && scope === "board") {
      params.set("scope", "board")
      params.set("space", here.spaceId!)
      if (board) params.set("board", board)
    } else if (here?.workspaceId || workspace) {
      params.set("scope", "workspace")
      params.set("workspace", here?.workspaceId || workspace!.id)
    }
    const mine = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const remote = await api<Hit[]>(`/api/search?${params}`)
        if (mine !== seq.current) return
        const seen = new Set(localHits.map((h) => h.node.id))
        setHits([...localHits, ...remote.filter((h) => !seen.has(h.node.id))].slice(0, 30))
      } catch {
        /* keep local results */
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    }, 180)
    return () => clearTimeout(t)
  }, [q, here, scope, board, workspace])

  const pick = (h: Hit) => {
    onClose()
    if (here && (h.spaceId === here.spaceId || !h.spaceId)) here.flyTo(h.node.id)
    else navigate(`/b/${h.spaceId}?focus=${encodeURIComponent(h.node.id)}`)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="zb-dialog zb-search" showCloseButton={false}>
        <DialogTitle className="sr-only">Search your boards</DialogTitle>
        <div className="zb-search-input">
          <Search size={18} strokeWidth={2.25} aria-hidden />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={here && scope === "board" ? `Search in ${boardTitle}…` : `Search ${workspace?.name ?? "the workspace"}…`}
            aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((a) => Math.min(hits.length - 1, a + 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === "Enter" && hits[active]) {
                e.preventDefault()
                pick(hits[active])
              }
            }}
          />
        </div>
        {canScope && (
          <div className="zb-search-scope" role="radiogroup" aria-label="Search in">
            {(["board", "workspace"] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                role="radio"
                aria-checked={scope === sc}
                className="zb-chip"
                onClick={() => {
                  setScope(sc)
                  input.current?.focus()
                }}
              >
                {sc === "board" ? `This board · ${boardTitle}` : "Whole workspace"}
              </button>
            ))}
          </div>
        )}
        <ul className="zb-results" role="listbox" aria-label="Results">
          {hits.map((h, i) => {
            const Icon = ICON[h.node.type]
            return (
              <li key={`${h.spaceId}:${h.node.id}`} role="option" aria-selected={i === active}>
                <button type="button" className="zb-result" onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                  <Icon size={16} strokeWidth={2.25} aria-hidden />
                  <span className="zb-result-title">{titleOf(h.node)}</span>
                  <span className="zb-result-path">{[h.spaceTitle || h.path[0]?.title, ...h.path.slice(1).map((p) => p.title)].filter(Boolean).join(" › ")}</span>
                </button>
              </li>
            )
          })}
          {q.trim().length >= 2 && !hits.length && !loading && <li className="zb-results-empty">Nothing found for “{q.trim()}”.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function searchable(n: SceneNode): string {
  const c = n.content as Record<string, unknown>
  return ["title", "body", "description", "alt", "url", "site"].map((k) => (typeof c[k] === "string" ? c[k] : "")).join(" ").toLowerCase()
}

function isInside(space: Space, id: string, board: string): boolean {
  for (let p = space.parentOf(id); p; p = space.parentOf(p)) if (p === board) return true
  return false
}

function pathOf(space: Space, n: SceneNode) {
  const out: { id: string; title: string }[] = []
  for (let id = n.parentId; id; id = space.parentOf(id)) {
    const b = space.node(id)
    if (b) out.unshift({ id, title: titleOf(b) })
  }
  return out
}
