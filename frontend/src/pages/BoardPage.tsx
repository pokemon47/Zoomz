import { CloudOff, Eye, Loader2, Share2, Wifi } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Link, navigate, useLocation } from "@/app/router"
import { useSession } from "@/app/session"
import { useToast } from "@/app/toasts"
import { SearchDialog } from "@/components/app/SearchDialog"
import { ShareDialog } from "@/components/app/ShareDialog"
import { Avatar, TopBar } from "@/components/app/TopBar"
import { SpaceCanvas, type CanvasController } from "@/components/space/SpaceCanvas"
import { StatePanel } from "@/components/zoomboard/StatePanel"
import { fetchScene } from "@/lib/api"
import { api } from "@/lib/http"
import type { SceneryId } from "@/lib/scenery"
import { SceneStore, type Peer, type SceneSnapshot } from "@/lib/store"

type Props = { spaceId?: string; publicToken?: string; demo?: boolean }

const LOCAL_SCENERY = "zoomz.scenery"
const readScenery = (): SceneryId | null => {
  try {
    return localStorage.getItem(LOCAL_SCENERY) as SceneryId | null
  } catch {
    return null
  }
}

export function BoardPage({ spaceId, publicToken, demo }: Props) {
  const toast = useToast()
  const [store, setStore] = useState<SceneStore | null>(null)
  const [error, setError] = useState<{ message: string; status?: number } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    let made: SceneStore | null = null
    setStore(null)
    setError(null)
    ;(async () => {
      try {
        let snap: SceneSnapshot
        if (demo) {
          const s = await fetchScene()
          snap = { space: { id: "demo", title: "Summer Light", role: "owner", scenery: readScenery() ?? "mountains", workspaceId: "" }, rootBoardId: s.rootBoardId, seq: 0, nodes: s.nodes, boardRoles: {} }
        } else {
          const q = publicToken ? `?public=${encodeURIComponent(publicToken)}` : ""
          snap = await api<SceneSnapshot>(`/api/spaces/${spaceId}/scene${q}`)
        }
        if (!alive) return
        made = new SceneStore(snap, { local: demo, publicToken })
        made.onError = toast
        made.connect()
        setStore(made)
      } catch (e) {
        if (alive) setError({ message: (e as Error).message, status: (e as { status?: number }).status })
      }
    })()
    return () => {
      alive = false
      made?.close()
    }
  }, [attempt, demo, publicToken, spaceId, toast])

  if (error) {
    return (
      <main className="zb-page zb-page-center">
        {error.status === 401 ? (
          <StatePanel kind="error" title="Sign in to see this board" message="This board is private." onRetry={() => navigate(`/login?next=${encodeURIComponent(location.pathname)}`)} />
        ) : (
          <StatePanel kind="error" title={error.status === 403 || error.status === 404 ? "Can't open this board" : undefined} message={error.message} onRetry={() => setAttempt((a) => a + 1)} />
        )}
      </main>
    )
  }
  if (!store) return <main className="zb-page zb-page-center"><StatePanel kind="loading" /></main>
  return <LiveBoard store={store} />
}

function LiveBoard({ store }: { store: SceneStore }) {
  const toast = useToast()
  const { user } = useSession()
  const { query } = useLocation()
  const controller = useRef<CanvasController | null>(null)
  const [follow, setFollow] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [searching, setSearching] = useState(false)
  const [localScenery, setLocalScenery] = useState<SceneryId | null>(readScenery)
  const version = useSyncExternalStore(
    useCallback((cb) => store.subscribe(cb), [store]),
    () => `${store.status}|${store.peers.size}|${store.title}|${store.scenery}|${store.role}|${[...store.peers.values()].map((p) => p.focus).join()}`,
  )
  void version

  // Fly to a search result we arrived with (?focus=…).
  const focus = query.get("focus")
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => controller.current?.flyToNode(focus), 400)
    return () => clearTimeout(t)
  }, [focus])

  // Don't lose edits that haven't reached the server yet.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (store.unsaved > 0) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [store])

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

  const canEditSpace = store.canEdit(store.space.rootId)
  const scenery = (store.local ? localScenery : (localScenery && !canEditSpace ? localScenery : store.scenery)) as SceneryId
  const setScenery = async (id: SceneryId) => {
    try {
      localStorage.setItem(LOCAL_SCENERY, id)
    } catch {
      /* fine */
    }
    if (store.local || !canEditSpace) return setLocalScenery(id)
    setLocalScenery(null)
    store.scenery = id
    try {
      await api(`/api/spaces/${store.spaceId}`, { method: "PATCH", json: { scenery: id } })
    } catch (e) {
      toast((e as Error).message)
    }
  }

  const rename = async (title: string) => {
    if (!title.trim() || title === store.title) return
    try {
      await api(`/api/spaces/${store.spaceId}`, { method: "PATCH", json: { title } })
      store.title = title
    } catch (e) {
      toast((e as Error).message)
    }
  }

  // One avatar per person (they may have several tabs open).
  const people = new Map<string, Peer>()
  for (const p of store.peers.values()) if (p.connId !== store.me && !people.has(p.userId ?? p.connId)) people.set(p.userId ?? p.connId, p)

  if (store.status === "kicked") {
    return (
      <main className="zb-page zb-page-center">
        <StatePanel kind="error" title="This board isn't available" message={store.kickedReason} onRetry={() => location.reload()} />
      </main>
    )
  }

  return (
    <main className="zb-board-page">
      <SpaceCanvas
        store={store}
        scenery={scenery}
        onScenery={setScenery}
        follow={follow}
        onStopFollow={() => follow && setFollow(null)}
        onToast={toast}
        controller={controller}
      />
      <TopBar onSearch={() => setSearching(true)}>
        {store.local ? (
          <span className="zb-board-title">Demo board · <Link to="/login">sign in to make your own</Link></span>
        ) : (
          <TitleField value={store.title} editable={canEditSpace && !!user} onSave={rename} />
        )}
        <Status store={store} />
        <div className="zb-people-row" aria-label="People here">
          {[...people.values()].map((p) => (
            <button
              key={p.connId}
              type="button"
              className={`zb-person${follow === p.connId ? " is-following" : ""}`}
              onClick={() => setFollow(follow === p.connId ? null : p.connId)}
              aria-pressed={follow === p.connId}
              title={follow === p.connId ? `Stop following ${p.name}` : `Follow ${p.name}`}
            >
              <Avatar name={p.name} color={p.color} avatar={p.avatar} size={30} ring={follow === p.connId} />
            </button>
          ))}
        </div>
        {store.readOnly && (
          <span className="zb-pill">
            <Eye size={14} strokeWidth={2.25} aria-hidden /> View only
          </span>
        )}
        {!store.local && user && (
          <button type="button" className="zb-btn zb-btn-cobalt zb-btn-sm" onClick={() => setSharing(true)}>
            <Share2 size={14} strokeWidth={2.5} aria-hidden /> Share
          </button>
        )}
      </TopBar>
      {follow && store.peers.get(follow) && (
        <div className="zb-follow-banner" role="status">
          Following {store.peers.get(follow)!.name} — scroll or drag to stop
        </div>
      )}
      <SearchDialog open={searching} onClose={() => setSearching(false)} here={{ spaceId: store.spaceId, space: store.space, flyTo: (id) => controller.current?.flyToNode(id) }} />
      {store.spaceId && <ShareDialog spaceId={store.spaceId} title={store.title} space={store.space} open={sharing} onClose={() => setSharing(false)} />}
    </main>
  )
}

function Status({ store }: { store: SceneStore }) {
  if (store.local) return null
  if (store.status === "live")
    return store.unsaved > 0 ? (
      <span className="zb-status" title="Saving">
        <Loader2 size={14} strokeWidth={2.5} className="zb-spin-icon" aria-hidden /> Saving
      </span>
    ) : (
      <span className="zb-status is-live" title="Connected — changes save instantly">
        <Wifi size={14} strokeWidth={2.5} aria-hidden /> Saved
      </span>
    )
  return (
    <span className="zb-status is-off" role="status">
      <CloudOff size={14} strokeWidth={2.5} aria-hidden /> {store.status === "connecting" ? "Connecting…" : `Offline${store.unsaved ? ` · ${store.unsaved} unsaved` : ""} — reconnecting`}
    </span>
  )
}

function TitleField({ value, editable, onSave }: { value: string; editable: boolean; onSave(v: string): void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  if (!editable) return <span className="zb-board-title">{value}</span>
  return (
    <input
      className="zb-board-title zb-title-input"
      value={v}
      maxLength={120}
      aria-label="Board name"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSave(v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        if (e.key === "Escape") {
          setV(value)
          ;(e.target as HTMLInputElement).blur()
        }
        e.stopPropagation()
      }}
    />
  )
}
