import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Link, useLocation } from "@/app/router"
import { TopBar } from "@/components/app/TopBar"
import { Button } from "@/components/zoomboard/Button"
import { api } from "@/lib/http"

type Grants = {
  mode: "workspaces" | "boards" | "all"
  ids: string[]
  edit: boolean
  destructive: "approve" | "block" | "elevated"
  elevation?: "task" | "time" | "persistent" | null
  task_id?: string | null
  until?: number | null
}
type Connection = { id: string; client: string; grants: Grants; revoked: boolean }
type Task = { id: string; space_id: string; board_id: string; objective: string; state: string; checkpoint: { summary?: string; outstanding_work?: string; missing_sources?: string[] } }
type Approval = { id: string; space_id: string; connection_id: string; approved: boolean; expires: number; request: unknown }
type ScopeOption = { id: string; name: string }
const DEFAULT_GRANTS: Grants = { mode: "workspaces", ids: [], edit: false, destructive: "approve" }

function GrantsForm({ initial, options, onSave, consent = false }: { initial: Grants; options: ScopeOption[]; onSave(value: Grants): Promise<void>; consent?: boolean }) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try { await onSave(value) } catch (e) { setError(e instanceof Error ? e.message : "Could not save permissions") } finally { setBusy(false) }
  }
  return <form className="zb-form" onSubmit={submit}>
    <label>Access scope
      <select value={value.mode} onChange={(e) => { const mode = e.target.value; if (mode === "workspaces" || mode === "boards" || mode === "all") setValue({ ...value, mode, ids: [] }) }}>
        <option value="workspaces">Selected workspaces</option><option value="boards">Selected board IDs</option><option value="all">All accessible workspaces, explicitly authorize</option>
      </select>
    </label>
    {value.mode === "workspaces" ? <fieldset><legend>Choose workspaces</legend>{options.map((option) => <label key={option.id}><input type="checkbox" checked={value.ids.includes(option.id)} onChange={(e) => setValue({ ...value, ids: e.target.checked ? [...value.ids, option.id] : value.ids.filter((id) => id !== option.id) })} /> {option.name}</label>)}</fieldset> : null}
    {value.mode === "boards" ? <label>Board IDs, separated by commas. Use the board picker below.
      <input value={value.ids.join(",")} onChange={(e) => setValue({ ...value, ids: e.target.value.split(",").map((id) => id.trim()).filter(Boolean) })} />
    </label> : null}
    {value.mode === "all" ? <p>This includes future workspaces you can access. The AI can never exceed your own role.</p> : null}
    <label><input type="checkbox" checked={value.edit} onChange={(e) => setValue({ ...value, edit: e.target.checked })} /> Allow creation and editing</label>
    <label>Destructive operations<select value={value.destructive} onChange={(e) => { const policy = e.target.value; if (policy === "approve" || policy === "block" || policy === "elevated") setValue({ ...value, destructive: policy, elevation: null }) }}>
      <option value="approve">Require exact-operation approval</option><option value="block">Block</option>{!consent ? <option value="elevated">Explicitly elevate access</option> : null}
    </select></label>
    {value.destructive === "elevated" ? <>
      <label>Elevation duration<select value={value.elevation ?? ""} required onChange={(e) => { const duration = e.target.value; if (duration === "task" || duration === "time" || duration === "persistent") setValue({ ...value, elevation: duration, until: duration === "time" ? Math.floor(Date.now() / 1000) + 3600 : null }) }}>
        <option value="" disabled>Choose explicitly</option><option value="task">One task</option><option value="time">One hour</option><option value="persistent">Until revoked</option>
      </select></label>
      {value.elevation === "task" ? <label>Task ID<input required value={value.task_id ?? ""} onChange={(e) => setValue({ ...value, task_id: e.target.value })} /></label> : null}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    <Button type="submit" variant="primary" disabled={busy || (value.mode !== "all" && !value.ids.length)}>{busy ? "Saving…" : consent ? "Authorize this client" : "Save permissions"}</Button>
  </form>
}

export function AiPage() {
  const { query } = useLocation()
  const pending = query.get("request")
  const [consent, setConsent] = useState<{ client: string; requested_scope: string; redirect_uri: string } | null>(null)
  const [data, setData] = useState<{ endpoint: string; connections: Connection[] } | null>(null)
  const [options, setOptions] = useState<ScopeOption[]>([])
  const [spaces, setSpaces] = useState<ScopeOption[]>([])
  const [boards, setBoards] = useState<ScopeOption[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [error, setError] = useState("")
  const refresh = useCallback(async () => {
    try {
      const [connections, available, requests] = await Promise.all([
        api<{ endpoint: string; connections: Connection[] }>("/api/mcp/connections"),
        api<{ workspaces: ScopeOption[]; mine: { id: string; title: string }[]; shared: { id: string; title: string }[] }>("/api/spaces"),
        api<{ approvals: Approval[] }>("/api/mcp/approvals"),
      ])
      setData(connections); setOptions(available.workspaces); setApprovals(requests.approvals)
      setSpaces([...available.mine, ...available.shared].map((s) => ({ id: s.id, name: s.title })))
      if (pending) setConsent(await api(`/api/mcp/consent/${encodeURIComponent(pending)}`))
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load AI settings") }
  }, [pending])
  useEffect(() => { void refresh() }, [refresh])
  return <main className="zb-page"><TopBar /><div className="zb-settings">
    <section className="zb-panel zb-card-section"><h2>AI connections</h2>
      <p>Your assistant brings the AI. Zoomz supplies editable boards, not a paid inference service.</p>
      <label>Instance MCP endpoint<input readOnly value={data?.endpoint ?? ""} /></label>
      <Button onClick={() => { if (data) void navigator.clipboard.writeText(data.endpoint).catch(() => setError("Copy the endpoint from the field above")) }}>Copy MCP URL</Button>
      <details><summary>Connect Claude</summary><p>Open Customize → Connectors → Add custom connector. Enter this public HTTPS MCP endpoint and select automatic OAuth registration. Sign in to Zoomz and approve the chosen scope. Free accounts allow one custom connector. Your server must be reachable from Claude's cloud.</p></details>
      <details><summary>ChatGPT compatibility and setup</summary><p>Where your account permits it, open Plugins → Add custom MCP server, enter the HTTPS endpoint, configure OAuth, and review the discovered tools. OpenAI currently documents full write-capable custom MCP for Business and Enterprise/Edu, not Plus. Plus write compatibility is unverified. Publishing a public plugin requires separate OpenAI approval; this instance is not a published plugin.</p></details>
      <p><Link to="/">Back to workspaces</Link></p><Button onClick={() => void refresh()}>Refresh</Button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
    <section className="zb-panel zb-card-section"><h2>Board scope picker</h2><label>Inspect a moodboard<select defaultValue="" onChange={(e) => { if (e.target.value) void api<{ nodes: { id: string; type: string; content: { title?: string } }[] }>(`/api/spaces/${encodeURIComponent(e.target.value)}/scene`).then((scene) => setBoards(scene.nodes.filter((n) => n.type === "board").map((n) => ({ id: n.id, name: n.content.title ?? "Board" })))).catch(() => setError("Could not load boards")) }}><option value="" disabled>Choose moodboard</option>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {boards.map((b) => <p key={b.id}>{b.name} <code>{b.id}</code></p>)}
    </section>
    {pending && consent ? <section className="zb-panel zb-card-section"><h2>Authorize {consent.client}</h2><p>Client names are self-reported. Verify this callback before authorizing.</p><code>{consent.redirect_uri}</code><p>Requested scopes: {consent.requested_scope}</p>
      <GrantsForm initial={DEFAULT_GRANTS} options={options} consent onSave={async (value) => { const result = await api<{ redirect: string }>(`/api/mcp/consent/${encodeURIComponent(pending)}`, { json: value }); location.assign(result.redirect) }} />
      <Link to="/ai">Cancel without granting access</Link>
    </section> : null}
    {data?.connections.map((connection) => <section key={connection.id} className="zb-panel zb-card-section"><h2>{connection.client}{connection.revoked ? " · Revoked" : ""}</h2>
      {!connection.revoked ? <><GrantsForm initial={connection.grants} options={options} onSave={async (grants) => { await api(`/api/mcp/connections/${connection.id}`, { method: "PUT", json: grants }); await refresh() }} /><Button onClick={() => { void api(`/api/mcp/connections/${connection.id}`, { method: "DELETE" }).then(refresh).catch(() => setError("Could not revoke connection")) }}>Revoke connection</Button></> : null}
    </section>)}
    <section className="zb-panel zb-card-section"><h2>Destructive approvals</h2><p>Approve only after inspecting the exact targets and operations. Approval expires after ten minutes and is single-use.</p>
      {approvals.map((a) => <div key={a.id}><p>Connection {a.connection_id}, moodboard {a.space_id}</p><details><summary>Inspect exact request</summary><pre style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}>{JSON.stringify(a.request, null, 2)}</pre></details><Button disabled={a.approved} onClick={() => { void api(`/api/mcp/approvals/${a.id}`, { json: {} }).then(refresh).catch(() => setError("Could not approve request")) }}>{a.approved ? "Approved; assistant may retry" : "Approve these exact operations"}</Button></div>)}
    </section>
    <section className="zb-panel zb-card-section"><h2>Generation tasks</h2><DraftStatus /></section>
    <section className="zb-panel zb-card-section"><h2>Recover destructive changes</h2><SnapshotRecovery /></section>
  </div></main>
}

function SnapshotRecovery() {
  const [snapshots, setSnapshots] = useState<{ id: string; space_id: string; revision: number; at: number }[]>([])
  const [confirmation, setConfirmation] = useState("")
  const [message, setMessage] = useState("")
  const load = async () => {
    try { setSnapshots((await api<{ snapshots: typeof snapshots }>("/api/mcp/snapshots")).snapshots) }
    catch { setMessage("Could not load snapshots") }
  }
  const restore = async (id: string, spaceId: string) => {
    try {
      const scene = await api<{ seq: number }>(`/api/spaces/${spaceId}/scene`)
      await api(`/api/mcp/snapshots/${id}/restore`, { json: { expected_revision: scene.seq, confirm: confirmation } })
      setConfirmation(""); setMessage("Snapshot restored. The replaced state was saved as another snapshot."); await load()
    } catch { setMessage("Restore refused. Verify ownership and refresh; newer edits are never silently overwritten.") }
  }
  return <div><p>Owner-only recovery replaces the current layout and content with a saved snapshot. Inspect the snapshot first.</p><Button onClick={() => void load()}>Load snapshots</Button>
    <label>Type RESTORE SNAPSHOT to enable recovery<input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
    {message ? <p role="status">{message}</p> : null}
    {snapshots.map((snapshot) => <p key={snapshot.id}>Revision {snapshot.revision} · {new Date(snapshot.at * 1000).toLocaleString()} <a href={`/api/mcp/snapshots/${snapshot.id}`} target="_blank" rel="noreferrer">Inspect JSON</a> <Button disabled={confirmation !== "RESTORE SNAPSHOT"} onClick={() => void restore(snapshot.id, snapshot.space_id)}>Restore snapshot</Button></p>)}
  </div>
}

export function DraftStatus({ spaceId }: { spaceId?: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState("")
  const refresh = useCallback(async () => {
    try { setTasks((await api<{ tasks: Task[] }>(`/api/mcp/tasks${spaceId ? `?space_id=${encodeURIComponent(spaceId)}` : ""}`)).tasks) }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load drafts") }
  }, [spaceId])
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer) }, [refresh])
  const change = async (task: Task, state: string) => {
    try {
      const scene = await api<{ seq: number }>(`/api/spaces/${task.space_id}/scene`)
      await api(`/api/mcp/tasks/${task.id}`, { json: { state, expected_revision: scene.seq } })
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : "Task changed; refresh and retry") }
  }
  return <div aria-label="AI draft status">
    {error ? <p role="alert">{error}</p> : null}
    {tasks.map((task) => <details key={task.id} className="zb-panel"><summary>{task.state === "completed" ? "Finished" : "AI draft"} · {task.state} · {task.objective.slice(0, 70)}</summary>
      <p>{task.objective}</p><p>{task.checkpoint.summary}</p><p>{task.checkpoint.outstanding_work}</p><p>{task.checkpoint.missing_sources?.length ? `Missing sources: ${task.checkpoint.missing_sources.join(", ")}` : ""}</p><code>{task.id}</code>
      <Link to={`/b/${task.space_id}`}>Open moodboard</Link>
      {["created", "generating", "interrupted"].includes(task.state) ? <Button size="sm" onClick={() => void change(task, "paused")}>Pause</Button> : null}
      {["paused", "interrupted", "failed"].includes(task.state) ? <Button size="sm" onClick={() => void change(task, "generating")}>Resume writes</Button> : null}
      {task.state === "generating" ? <Button size="sm" onClick={() => void change(task, "completed")}>Finalize</Button> : null}
      {!["completed", "cancelled"].includes(task.state) ? <Button size="sm" onClick={() => void change(task, "cancelled")}>Cancel generation</Button> : null}
      <p>Pausing stops Zoomz writes, not the assistant's inference. Resume the conversation separately if needed. Add → Images &amp; files accepts multiple original sources without categorization; cite their file IDs explicitly rather than guessing matches.</p>
    </details>)}
  </div>
}
