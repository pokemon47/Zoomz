import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Check, ChevronRight, Expand, Home, ImageOff, Layers2, Maximize2, Minus, MousePointer2, Plus, RotateCcw, Scan, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuGroup, ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { sceneSchema, type ImageNode, type Scene } from '../shared/scene'
import { WorkspaceController, type WorkspaceInfo } from './canvas/controller'
import { clearState, emptyState, readState, writeState, type DisplayPreferences } from './lib/storage'
import type { SavedState } from './lib/storage'

type Loaded = { scene: Scene; saved: SavedState }
type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; value: Loaded }
const initialInfo: WorkspaceInfo = { boardId: 'home', path: [], nodes: [], selected: null, zoom: 1, dragHint: '' }

export default function App() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    async function fetchScene() {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/scene`, { signal: abort.signal })
        if (!response.ok) throw new Error('The demo API is unavailable. Start the backend and try again.')
        const scene = sceneSchema.parse(await response.json())
        const saved = readState(scene)
        setLoad({ kind: 'ready', value: { scene, saved } })
      } catch (error) {
        if (!abort.signal.aborted) setLoad({ kind: 'error', message: error instanceof Error ? error.message : 'Could not load the demo.' })
      }
    }
    void fetchScene()
    return () => abort.abort()
  }, [attempt])
  if (load.kind !== 'ready') return <div className="loading-screen"><div className="brand">zoomz<span>↗</span></div><p>{load.kind === 'loading' ? 'Making a little room for inspiration…' : load.message}</p>{load.kind === 'error' ? <Button variant="outline" onClick={() => { setLoad({ kind: 'loading' }); setAttempt(value => value + 1) }}>Try again</Button> : null}</div>
  return <Workspace loaded={load.value} />
}

function Workspace({ loaded }: { loaded: Loaded }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const minimap = useRef<HTMLCanvasElement>(null)
  const controller = useRef<WorkspaceController | null>(null)
  const saved = useRef(loaded.saved)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [info, setInfo] = useState(initialInfo)
  const [viewer, setViewer] = useState<ImageNode | null>(null)
  const [contents, setContents] = useState(false)
  const [contextTarget, setContextTarget] = useState<string | null>(null)
  const keyboardContext = useRef(false)
  const [display, setDisplay] = useState<DisplayPreferences>({ showCaptions: loaded.saved.showCaptions, showImageBorders: loaded.saved.showImageBorders })
  const [reduceOverride, setReduceOverride] = useState(loaded.saved.reduceMotion)
  const systemReduced = useReducedMotion()
  const reduced = reduceOverride ?? systemReduced ?? false
  const [saveStatus, setSaveStatus] = useState('Saved on this device')
  const board = loaded.scene.boards.find(item => item.id === info.boardId) ?? loaded.scene.boards[0]
  const depth = Math.max(0, info.path.length - 1)

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('Saving…')
    saveTimer.current = setTimeout(() => { saveTimer.current = null; setSaveStatus(writeState(saved.current) ? 'Saved on this device' : 'Session only · storage unavailable') }, 350)
  }

  useEffect(() => {
    if (!canvas.current || !minimap.current) return
    const workspace = new WorkspaceController(canvas.current, minimap.current, loaded.scene, saved.current, reduced, {
      change: setInfo,
      save: layout => { saved.current = { ...saved.current, layout }; scheduleSave() },
      openImage: image => setViewer(image),
    })
    controller.current = workspace
    const flush = () => { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; writeState(saved.current) } }
    window.addEventListener('pagehide', flush)
    return () => { workspace.dispose(); controller.current = null; window.removeEventListener('pagehide', flush); flush() }
  }, [loaded])

  useEffect(() => { controller.current?.setReduced(reduced) }, [reduced])
  useEffect(() => { controller.current?.setDisplay(display) }, [display])

  function changeDisplay(key: keyof DisplayPreferences, checked: boolean) {
    setDisplay(previous => ({ ...previous, [key]: checked }))
    saved.current = { ...saved.current, [key]: checked }; scheduleSave()
  }

  function canvasKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    keyboardContext.current = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
    if (!keyboardContext.current) return
    event.preventDefault()
    if (!info.selected) return
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + 65 }))
  }

  function reset() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    saved.current = emptyState()
    setReduceOverride(null)
    setDisplay({ showCaptions: true, showImageBorders: true })
    setSaveStatus(clearState() ? 'Original arrangement restored' : 'Reset for this session · storage unavailable')
    controller.current?.reset()
  }

  return <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
    <div className="workspace" data-reduced-motion={reduced} data-show-captions={display.showCaptions} data-show-image-borders={display.showImageBorders}>
      <header className="topbar">
        <button className="brand" aria-label="Zoomz home" onClick={() => controller.current?.home()}>zoomz<span>↗</span></button>
        <div className="header-divider" />
        <nav className="breadcrumbs" aria-label="Board breadcrumbs">
          <Button variant="ghost" size="sm" onClick={() => controller.current?.home()}><Layers2 data-icon="inline-start" />My workspace</Button>
          {info.path.map((item, index) => <div className="crumb" key={item.id}><ChevronRight aria-hidden="true" /><Button variant="ghost" size="sm" aria-current={index === info.path.length - 1 ? 'page' : undefined} onClick={() => controller.current?.goTo(item.id)}>{index === 0 ? 'Inspiration' : item.title}</Button></div>)}
        </nav>
        <div className="topbar-actions">
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label="Display options"><SlidersHorizontal data-icon="inline-start" />Display</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuCheckboxItem checked={display.showCaptions} onCheckedChange={checked => changeDisplay('showCaptions', checked)} onSelect={event => event.preventDefault()}>Show Captions</DropdownMenuCheckboxItem><DropdownMenuCheckboxItem checked={display.showImageBorders} onCheckedChange={checked => changeDisplay('showImageBorders', checked)} onSelect={event => event.preventDefault()}>Show Image Borders</DropdownMenuCheckboxItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
          <label className="motion-setting" htmlFor="reduce-motion"><Switch id="reduce-motion" checked={reduced} onCheckedChange={checked => { setReduceOverride(checked); saved.current = { ...saved.current, reduceMotion: checked }; scheduleSave() }} />Reduce motion</label>
          <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm"><RotateCcw data-icon="inline-start" />Reset demo</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Make room for a fresh start?</AlertDialogTitle><AlertDialogDescription>This restores the original demo arrangement and motion preference. Only Zoomz demo data on this device is cleared.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep my arrangement</AlertDialogCancel><AlertDialogAction onClick={reset}>Reset demo</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        </div>
      </header>
      <main className="canvas-area" aria-label="Zoomable board workspace">
        <ContextMenu><ContextMenuTrigger asChild><canvas ref={canvas} className="scene-canvas" tabIndex={0} aria-label={`${board.title}. Wheel to zoom, drag to arrange, double-click to frame. Use Browse items for keyboard access.`} aria-describedby="canvas-help" onPointerDown={() => { keyboardContext.current = false }} onKeyDown={canvasKeyDown} onContextMenu={event => { const id = keyboardContext.current ? info.selected?.id ?? null : controller.current?.contextAt(event.clientX, event.clientY) ?? null; keyboardContext.current = false; setContextTarget(id); if (!id) event.preventDefault() }} /></ContextMenuTrigger><ContextMenuContent><ContextMenuGroup><ContextMenuItem disabled={!contextTarget} onSelect={() => { if (contextTarget) controller.current?.layer(contextTarget, 'front') }}>Bring to Front</ContextMenuItem><ContextMenuItem disabled={!contextTarget} onSelect={() => { if (contextTarget) controller.current?.layer(contextTarget, 'forward') }}>Bring Forward</ContextMenuItem><ContextMenuItem disabled={!contextTarget} onSelect={() => { if (contextTarget) controller.current?.layer(contextTarget, 'backward') }}>Send Backward</ContextMenuItem><ContextMenuItem disabled={!contextTarget} onSelect={() => { if (contextTarget) controller.current?.layer(contextTarget, 'back') }}>Send to Back</ContextMenuItem></ContextMenuGroup></ContextMenuContent></ContextMenu>
        <div className="canvas-tools"><Button size="icon" variant="outline" aria-label="Back to parent board" title="Back to parent board" disabled={depth === 0} onClick={() => controller.current?.back()}><ArrowLeft /></Button><Button size="icon" variant="outline" aria-label="Home overview" title="Home overview" onClick={() => controller.current?.home()}><Home /></Button><div className="tool-rule" /><Button size="icon" variant="outline" aria-label="Fit board" title="Fit board (0)" onClick={() => controller.current?.fit()}><Scan /></Button></div>
        {info.zoom < 1.05 ? <div className="canvas-corner-label"><span className="tiny-cross">＋</span> A SPACE FOR YOUR IDEAS</div> : null}
        <AnimatePresence>{info.selected && !info.dragHint ? <motion.div className="selection-bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><MousePointer2 /><span>{info.selected.title}</span><Button variant="ghost" size="sm" onClick={() => { if (info.selected) controller.current?.activate(info.selected.id) }}>{info.selected.kind === 'board' ? 'Enter board' : 'Zoom to item'}<ArrowUpRight data-icon="inline-end" /></Button>{info.selected.kind === 'image' ? <Button variant="ghost" size="sm" onClick={() => { if (info.selected) controller.current?.viewImage(info.selected.id) }}>View full image</Button> : null}<Button variant="ghost" size="icon" aria-label="Clear selection" onClick={() => controller.current?.clearSelection()}><X /></Button></motion.div> : null}</AnimatePresence>
        {info.dragHint ? <div className="drag-feedback" aria-live="polite">{info.dragHint}</div> : null}
        <aside className="minimap-panel" aria-label="Active board minimap"><div className="minimap-title"><Layers2 /><span>{board.title}</span><span className="minimap-live">LIVE</span></div><canvas ref={minimap} className="minimap" aria-label="Minimap. Click to centre the viewport at that position." /><div className="minimap-caption">You are here <span>{depth === 0 ? 'Collection overview' : `${depth} ${depth === 1 ? 'level' : 'levels'} deep`}</span></div></aside>
        <div className="zoom-controls"><Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => controller.current?.zoom(-1)}><Minus /></Button><span aria-label="Zoom level">{Math.round(info.zoom * 100)}%</span><Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => controller.current?.zoom(1)}><Plus /></Button><div className="tool-rule" /><Button variant="ghost" size="icon" aria-label="Fit board to viewport" title="Fit board" onClick={() => controller.current?.fit()}><Maximize2 /></Button></div>
        {depth === 0 && info.zoom < 1.05 ? <div className="explore-hint"><ArrowDownRight /><span>There’s more inside.<small>Zoom into a board to explore.</small></span></div> : null}
      </main>
      <footer className="statusbar"><div id="canvas-help"><span><span className="wheel-symbol">↕</span> Scroll to zoom</span><span><MousePointer2 />Drag to arrange</span><span><kbd>space</kbd> + drag to pan</span><span>Double-click to explore</span></div><div className="footer-actions"><Button variant="ghost" size="sm" onClick={() => setContents(true)}>Browse items<Expand data-icon="inline-end" /></Button><span className="save-status" role="status"><Check />{saveStatus}</span></div></footer>
    </div>
    <Dialog open={viewer !== null} onOpenChange={open => { if (!open) setViewer(null) }}><DialogContent className="image-viewer" onCloseAutoFocus={event => { event.preventDefault(); canvas.current?.focus({ preventScroll: true }) }}><DialogHeader><DialogTitle>{viewer?.title}</DialogTitle><DialogDescription>{viewer?.caption}</DialogDescription></DialogHeader>{viewer ? <ViewerImage key={viewer.id} image={viewer} /> : null}<p className="viewer-hint">A closer look. <kbd>esc</kbd> to return to your board.</p></DialogContent></Dialog>
    <Dialog open={contents} onOpenChange={setContents}><DialogContent><DialogHeader><DialogTitle>{board.title}</DialogTitle><DialogDescription>Enter a board or zoom to an item. Notes are read-only.</DialogDescription></DialogHeader><div className="contents-list">{info.nodes.map(node => <Button variant="outline" key={node.id} onClick={() => { setContents(false); setTimeout(() => controller.current?.activate(node.id), 0) }}>{node.title}<span>{node.kind === 'board' ? 'Enter board ↗' : node.kind === 'image' ? 'Zoom to image ↗' : 'Read note'}</span></Button>)}</div></DialogContent></Dialog>
  </MotionConfig>
}

function ViewerImage({ image }: { image: ImageNode }) {
  const [failed, setFailed] = useState(false)
  return failed ? <div className="image-fallback" role="img" aria-label={`${image.title}. Image unavailable.`}><ImageOff /><p>This image couldn’t be loaded.</p><span>Your board is right where you left it.</span></div> : <img className="viewer-image" src={`/images/${image.asset}-large.jpg`} alt={image.title} onError={() => setFailed(true)} draggable={false} />
}
