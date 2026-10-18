import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { api } from "@/lib/http"
import type { SourceReference } from "@/lib/types"

export function SourceIndicator({ references }: { references: SourceReference[] }) {
  const [open, setOpen] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    let live = true
    void Promise.all(references.filter((r) => r.asset_id).map(async (reference) => {
      const id = reference.asset_id
      if (!id) return null
      try {
        const result = await api<{ url: string }>(`/api/mcp/sources/${encodeURIComponent(id)}${reference.page ? `?page=${reference.page}` : ""}`)
        return { key: `${id}:${reference.page ?? 0}`, url: result.url }
      } catch { return null }
    })).then((items) => { if (live) setUrls(Object.fromEntries(items.filter((item) => item !== null).map((item) => [item.key, item.url]))) })
    return () => { live = false }
  }, [open, references])
  return <div onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
    e.stopPropagation()
    if (e.key === "Escape") { e.preventDefault(); setOpen(false) }
  }}>
    <button type="button" className="zb-btn zb-btn-sm" style={{ position: "absolute", right: 8, top: 8 }} onClick={(e) => { e.stopPropagation(); setOpen(true) }}>Sources · {references.length}</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Sources</DialogTitle><DialogDescription>Citations were supplied by the assistant and are not independently verified by Zoomz.</DialogDescription></DialogHeader>
      {references.map((ref, i) => {
        const href = ref.asset_id ? urls[`${ref.asset_id}:${ref.page ?? 0}`] : ref.url
        return <section key={i}><h3>{ref.title ?? ref.filename ?? "Source reference"}</h3><p>{ref.classification} · {ref.availability ?? "unverified"}{ref.page ? ` · Page ${ref.page}` : ""}{ref.slide ? ` · Slide ${ref.slide}` : ""}</p><p>{ref.section}</p><blockquote>{ref.excerpt}</blockquote>
          {href && ref.availability !== "missing" ? <a href={href} target="_blank" rel="noopener noreferrer">Open original</a> : <p>Original unavailable or still resolving.</p>}
        </section>
      })}
    </DialogContent></Dialog>
  </div>
}
