import { FileText, Image as ImageIcon, LayoutGrid, Link2, Search, StickyNote } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { navigate } from "@/app/router"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/http"
import { titleOf } from "@/lib/scene"
import type { Space } from "@/lib/space"
import type { SceneNode } from "@/lib/types"

type Hit = { spaceId: string; spaceTitle: string; node: SceneNode; path: { id: string; title: string }[] }

const ICON = { board: LayoutGrid, image: ImageIcon, note: StickyNote, file: FileText, link: Link2 }

type Props = {
  open: boolean
  onClose(): void
  /** When searching from inside a board: its live contents (instant results) and how to fly there. */
  here?: { spaceId: string | null; space: Space; flyTo(id: string): void }
}

/** ⌘K: find anything on any of your boards, and fly to it. */
export function SearchDialog({ open, onClose, here }: Props) {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) {
      setQ("")
      setHits([])
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2) {
      setHits([])
      return
    }
    // Instant results from the board you're on, then everything else from the server.
    const localHits: Hit[] = here
      ? [...here.space.index.byId.values()]
          .filter((n) => n.parentId && searchable(n).includes(term))
          .slice(0, 12)
          .map((n) => ({ spaceId: here.spaceId ?? "", spaceTitle: "This board", node: n, path: pathOf(here.space, n) }))
      : []
    setHits(localHits)
    setActive(0)
    if (here && !here.spaceId) return // local demo: no server search
    const mine = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const remote = await api<Hit[]>(`/api/search?q=${encodeURIComponent(term)}`)
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
  }, [q, here])

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
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes, images, files, boards…"
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
        <ul className="zb-results" role="listbox" aria-label="Results">
          {hits.map((h, i) => {
            const Icon = ICON[h.node.type]
            return (
              <li key={`${h.spaceId}:${h.node.id}`} role="option" aria-selected={i === active}>
                <button type="button" className="zb-result" onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                  <Icon size={16} strokeWidth={2.25} aria-hidden />
                  <span className="zb-result-title">{titleOf(h.node)}</span>
                  <span className="zb-result-path">{[h.spaceTitle, ...h.path.slice(1).map((p) => p.title)].join(" / ")}</span>
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

function pathOf(space: Space, n: SceneNode) {
  const out: { id: string; title: string }[] = []
  for (let id = n.parentId; id; id = space.parentOf(id)) {
    const b = space.node(id)
    if (b) out.unshift({ id, title: titleOf(b) })
  }
  return out
}
