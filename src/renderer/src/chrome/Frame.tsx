// HUD (title bar telemetry), status bar, side rail and side panel host.
import { Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { Bell, ExternalLink, Moon, ShieldCheck, X, Zap } from 'lucide-react'
import { invoke, on } from '../lib/ipc'
import { hudItems, sidePanels, statusItems } from '../lib/registry'
import { runCommand, shortcutFor } from '../lib/commands'
import { useBrowser, useActiveWs, visibleTabIds } from '../stores/browser'
import { useSetting, useSettingsStore } from '../stores/settings'
import { toggleSidePanel, useUi } from '../stores/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'

function useRegistry<T>(reg: { list: () => T[]; subscribe: (l: () => void) => () => void }): T[] {
  const [, force] = useState(0)
  useEffect(() => reg.subscribe(() => force((n) => n + 1)), [reg])
  return reg.list()
}

export function Hud() {
  useSettingsStore((s) => s.s)
  const items = useRegistry(hudItems)
  const enabled = items.filter((i) => !i.enabled || i.enabled())
  if (!enabled.length) return null
  return (
    <div className="hud" aria-label="Telemetry">
      {enabled.map((it, i) => (
        <span key={it.id} style={{ display: 'contents' }}>
          {i > 0 && <span className="hud-sep" />}
          <ErrorBoundary name={'HUD ' + it.id} compact>
            <it.component />
          </ErrorBoundary>
        </span>
      ))}
    </div>
  )
}

/** Tabs: active vs sleeping — always real counts. */
function TabsHudItem() {
  const counts = useBrowser((s) => {
    let active = 0
    let sleeping = 0
    for (const ws of Object.values(s.open))
      for (const t of ws.tabs) {
        if (t.suspended) sleeping++
        else active++
      }
    return active + ':' + sleeping
  })
  const [active, sleeping] = counts.split(':').map(Number)
  return (
    <button className="hud-item" onClick={() => toggleSidePanel('tabs')} data-tip={`${active} active · ${sleeping} sleeping tabs`}>
      <Zap size={11} /> <b>{active}</b>
      <Moon size={11} style={{ marginLeft: 2 }} /> <b>{sleeping}</b>
    </button>
  )
}

function TrackersHudItem() {
  const [n, setN] = useState(0)
  useEffect(() => on('privacy:blocked', (p) => setN(p.total)), [])
  return (
    <button className="hud-item" onClick={() => runCommand('privacy.open')} data-tip={`${n} tracker requests blocked this session`}>
      <ShieldCheck size={11} /> <b>{n}</b>
    </button>
  )
}

export function registerCoreHud(): void {
  hudItems.register({ id: 'tabs', order: 10, component: TabsHudItem })
  hudItems.register({ id: 'trackers', order: 90, component: TrackersHudItem })
}

// ---------------------------------------------------------------- status bar

export function StatusBar() {
  const items = useRegistry(statusItems)
  const left = items.filter((i) => i.side === 'left')
  const right = items.filter((i) => i.side === 'right')
  return (
    <div className="statusbar" role="status">
      {left.map((it) => (
        <ErrorBoundary key={it.id} name={'Status ' + it.id} compact>
          <it.component />
        </ErrorBoundary>
      ))}
      <span className="spacer" />
      {right.map((it) => (
        <ErrorBoundary key={it.id} name={'Status ' + it.id} compact>
          <it.component />
        </ErrorBoundary>
      ))}
    </div>
  )
}

function WorkspaceStatus() {
  const ws = useActiveWs()
  if (!ws) return null
  return (
    <button className="sb-item" onClick={() => runCommand('workspace.switcher')} data-kbd={shortcutFor('workspace.switcher')} data-tip="Switch workspace">
      <span style={{ width: 7, height: 7, borderRadius: 2, background: ws.color }} />
      {ws.name.toUpperCase()}
    </button>
  )
}

function TabCountStatus() {
  const ws = useActiveWs()
  if (!ws) return null
  const vis = visibleTabIds(ws).length
  return (
    <span className="sb-item static">
      {ws.tabs.length} TABS{ws.groups.length ? ` · ${ws.groups.length} GROUPS` : ''}
      {vis > 1 ? ` · SPLIT ${ws.layout.preset.toUpperCase()}` : ''}
    </span>
  )
}

function ModeStatus() {
  const mode = useSetting('performance.mode')
  return (
    <button className="sb-item" onClick={() => runCommand('system.modeMenu')} data-tip="Performance mode">
      MODE {mode.toUpperCase()}
    </button>
  )
}

function ZoomStatus() {
  const zoom = useBrowser((s) => {
    const ws = s.open[s.activeWsId]
    return ws?.tabs.find((t) => t.id === ws.activeTabId)?.zoom ?? 1
  })
  if (Math.abs(zoom - 1) < 0.01) return null
  return (
    <button className="sb-item" onClick={() => runCommand('browser.zoomReset')} data-tip="Reset zoom">
      ZOOM {Math.round(zoom * 100)}%
    </button>
  )
}

function NotificationsStatus() {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    invoke('notifications:list').then((l) => setUnread(l.filter((n) => !n.read).length))
    return on('notifications:new', () => setUnread((n) => n + 1))
  }, [])
  useEffect(() => {
    const reset = () => setUnread(0)
    window.addEventListener('specter:notifications-read', reset)
    return () => window.removeEventListener('specter:notifications-read', reset)
  }, [])
  return (
    <button className="sb-item" onClick={() => toggleSidePanel('notifications')} data-tip="Notifications">
      <Bell size={11} />
      {unread > 0 && <span className="accent">{unread}</span>}
    </button>
  )
}

export function registerCoreStatus(): void {
  statusItems.register({ id: 'workspace', side: 'left', order: 10, component: WorkspaceStatus })
  statusItems.register({ id: 'tabs', side: 'left', order: 20, component: TabCountStatus })
  statusItems.register({ id: 'zoom', side: 'right', order: 10, component: ZoomStatus })
  statusItems.register({ id: 'mode', side: 'right', order: 50, component: ModeStatus })
  statusItems.register({ id: 'notifications', side: 'right', order: 100, component: NotificationsStatus })
}

// ---------------------------------------------------------------- rail + side panel

export function SideRail() {
  // Re-render when any setting changes: panels' enabled() predicates read settings.
  useSettingsStore((s) => s.s)
  const panels = useRegistry(sidePanels).filter((p) => !p.enabled || p.enabled())
  const active = useUi((s) => s.sidePanel)
  const top = panels.filter((p) => p.order < 100)
  const bottom = panels.filter((p) => p.order >= 100)
  return (
    <nav className="rail" aria-label="Tools">
      {top.map((p) => (
        <button key={p.id} className={'icon-btn' + (active === p.id ? ' on' : '')} onClick={() => toggleSidePanel(p.id)} data-tip={p.title} data-kbd={p.shortcutCommand ? shortcutFor(p.shortcutCommand) : undefined} aria-label={p.title}>
          <p.icon size={17} />
        </button>
      ))}
      <span className="spacer" />
      {bottom.length > 0 && <span className="rail-sep" />}
      {bottom.map((p) => (
        <button key={p.id} className={'icon-btn' + (active === p.id ? ' on' : '')} onClick={() => toggleSidePanel(p.id)} data-tip={p.title} aria-label={p.title}>
          <p.icon size={17} />
        </button>
      ))}
    </nav>
  )
}

export function SidePanelHost() {
  const id = useUi((s) => s.sidePanel)
  const width = useUi((s) => s.sidePanelWidth)
  useSyncExternalStore(sidePanels.subscribe, () => sidePanels.list().length)
  const def = id ? sidePanels.get(id) : undefined
  if (!def) return null
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const start = width
    const move = (ev: MouseEvent) => useUi.setState({ sidePanelWidth: Math.max(260, Math.min(window.innerWidth * 0.7, start - (ev.clientX - startX))) })
    const up = () => {
      document.body.style.cursor = ''
      shield.remove()
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    const shield = document.createElement('div')
    shield.className = 'drag-shield'
    shield.style.cursor = 'col-resize'
    document.body.appendChild(shield)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const C = def.component
  return (
    <aside className="sidepanel" style={{ width }} aria-label={def.title}>
      <div className="sidepanel-resize" onMouseDown={startResize} />
      <div className="sidepanel-h">
        <def.icon size={15} style={{ color: 'var(--accent)' }} />
        <h3>{def.title}</h3>
        <span className="spacer" />
        {def.popout && (
          <button className="icon-btn sm" onClick={() => (invoke('window:popout', def.id, { alwaysOnTop: false }), toggleSidePanel(def.id))} data-tip="Pop out into floating window" aria-label="Pop out">
            <ExternalLink size={13} />
          </button>
        )}
        <button className="icon-btn sm" onClick={() => toggleSidePanel(def.id)} aria-label="Close panel" data-tip="Close">
          <X size={14} />
        </button>
      </div>
      <div className="sidepanel-b">
        <ErrorBoundary name={def.title} key={def.id}>
          <Suspense fallback={<div className="empty">Loading…</div>}>
            <C />
          </Suspense>
        </ErrorBoundary>
      </div>
    </aside>
  )
}
