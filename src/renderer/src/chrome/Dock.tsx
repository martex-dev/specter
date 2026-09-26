// The dock: an Opera-GX-style sidebar of app, widget and tool buttons, plus the
// side-panel host. Panels marked keepAlive stay mounted while hidden, so web
// apps (music, chats) keep running when their panel is closed.
import { Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { EyeOff, ExternalLink, Pin, Plus, Settings2, X } from 'lucide-react'
import { invoke } from '../lib/ipc'
import { sidePanels, type SidePanelDef, type SidebarSection } from '../lib/registry'
import { getCommand, runCommand, shortcutFor } from '../lib/commands'
import { themeLayout } from '../lib/themes'
import { getSetting, setSetting, useSetting, useSettingsStore } from '../stores/settings'
import { openMenu, toggleSidePanel, useUi } from '../stores/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'

const SECTIONS: SidebarSection[] = ['apps', 'widgets', 'tools']

export function sectionOf(p: SidePanelDef): SidebarSection {
  return p.section ?? (p.order >= 100 ? 'system' : 'tools')
}

function usePanels(): SidePanelDef[] {
  return useSyncExternalStore(sidePanels.subscribe, () => sidePanels.list())
}

/** Resolved dock side: user setting, or the active theme's layout. */
export function useDockSide(): 'left' | 'right' {
  const pos = useSetting('sidebar.position')
  const theme = useSetting('appearance.theme')
  const layoutOverride = useSetting('appearance.layout')
  if (pos === 'left' || pos === 'right') return pos
  return layoutOverride.rail ?? themeLayout(theme).rail
}

function DockButton({ p, active }: { p: SidePanelDef; active: boolean }) {
  const Badge = p.Badge
  return (
    <button
      className={'dock-btn' + (active ? ' on' : '')}
      onClick={() => toggleSidePanel(p.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { header: p.title },
            ...(p.popout ? [{ label: 'Pop out', icon: <ExternalLink size={14} />, run: () => invoke('window:popout', p.id, { alwaysOnTop: false }) }] : []),
            ...(p.contextItems?.() ?? []),
            { label: 'Hide from sidebar', icon: <EyeOff size={14} />, run: () => setSetting('sidebar.hiddenItems', [...getSetting('sidebar.hiddenItems'), p.id]) },
            { label: 'Customize sidebar…', icon: <Settings2 size={14} />, run: () => runCommand('sidebar.customize') }
          ]
        })
      }}
      data-tip={p.title}
      data-kbd={p.shortcutCommand ? shortcutFor(p.shortcutCommand) : undefined}
      aria-label={p.title}
      aria-pressed={active}
    >
      {p.iconNode ?? <p.icon size={18} />}
      {Badge && (
        <ErrorBoundary name={'badge ' + p.id} fallback={null}>
          <Badge />
        </ErrorBoundary>
      )}
    </button>
  )
}

export function Dock() {
  useSettingsStore((s) => s.s) // enabled() predicates read settings
  const panels = usePanels()
  const hidden = useSetting('sidebar.hiddenItems')
  const active = useUi((s) => s.sidePanel)
  const side = useDockSide()
  const visible = panels.filter((p) => (!p.enabled || p.enabled()) && !hidden.includes(p.id))
  const bySection = (s: SidebarSection) => visible.filter((p) => sectionOf(p) === s)
  const system = bySection('system')
  const canAddApp = !!getCommand('webpanels.add')
  return (
    <nav className={'rail dock dock-' + side} aria-label="Sidebar">
      {SECTIONS.map((s, i) => {
        const items = bySection(s)
        if (!items.length && !(s === 'apps' && canAddApp)) return null
        return (
          <div key={s} className={'dock-section dock-' + s}>
            {i > 0 && <span className="rail-sep" />}
            {items.map((p) => (
              <DockButton key={p.id} p={p} active={active === p.id} />
            ))}
            {s === 'apps' && canAddApp && (
              <button className="dock-btn dock-add" onClick={() => runCommand('webpanels.add')} data-tip="Add web app to sidebar" aria-label="Add web app">
                <Plus size={16} />
              </button>
            )}
          </div>
        )
      })}
      <span className="spacer" />
      {system.length > 0 && <span className="rail-sep" />}
      {system.map((p) => (
        <DockButton key={p.id} p={p} active={active === p.id} />
      ))}
    </nav>
  )
}

export function SidePanelHost() {
  const id = useUi((s) => s.sidePanel)
  const widths = useSetting('sidebar.panelWidths')
  const panels = usePanels()
  const side = useDockSide()
  const [alive, setAlive] = useState<string[]>([])
  const def = id ? sidePanels.get(id) : undefined

  // Remember keep-alive panels once opened so they stay mounted.
  useEffect(() => {
    if (def?.keepAlive && !alive.includes(def.id)) setAlive((a) => [...a, def.id])
  }, [def, alive])

  // Allow modules to unload a keep-alive panel (e.g. "Log out / close app").
  useEffect(() => {
    const drop = (e: Event) => setAlive((a) => a.filter((x) => x !== (e as CustomEvent<string>).detail))
    window.addEventListener('specter:panel-unload', drop)
    return () => window.removeEventListener('specter:panel-unload', drop)
  }, [])

  const width = def ? (widths[def.id] ?? def.width ?? 380) : 380
  const startResize = (e: React.MouseEvent) => {
    if (!def) return
    e.preventDefault()
    const startX = e.clientX
    const start = width
    const dir = side === 'right' ? -1 : 1
    let latest = start
    const move = (ev: MouseEvent) => {
      latest = Math.round(Math.max(260, Math.min(window.innerWidth * 0.7, start + dir * (ev.clientX - startX))))
      useUi.setState({ sidePanelWidth: latest })
      shieldEl.dataset.w = String(latest)
      aside?.style.setProperty('width', latest + 'px')
    }
    const up = () => {
      shieldEl.remove()
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setSetting('sidebar.panelWidths', { ...getSetting('sidebar.panelWidths'), [def.id]: latest })
    }
    const aside = (e.currentTarget as HTMLElement).closest('aside') as HTMLElement | null
    const shieldEl = document.createElement('div')
    shieldEl.className = 'drag-shield'
    shieldEl.style.cursor = 'col-resize'
    document.body.appendChild(shieldEl)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const mounted = [...new Set([...alive, ...(def && !def.keepAlive ? [def.id] : [])])]
  if (!def && !alive.length) return null
  return (
    <>
      {mounted.map((pid) => {
        const p = panels.find((x) => x.id === pid)
        if (!p) return null
        const show = pid === id
        const C = p.component
        return (
          <aside key={pid} className={'sidepanel sidepanel-' + side} style={{ width: show ? width : 0, display: show ? undefined : 'none' }} aria-label={p.title} aria-hidden={!show}>
            <div className="sidepanel-resize" onMouseDown={startResize} />
            {!p.bare && (
              <div className="sidepanel-h">
                {p.iconNode ?? <p.icon size={15} style={{ color: 'var(--accent)' }} />}
                <h3>{p.title}</h3>
                <span className="spacer" />
                {p.headerExtra && <p.headerExtra />}
                {p.keepAlive && (
                  <span className="dock-alive" data-tip="Keeps running in the background while closed">
                    <Pin size={11} />
                  </span>
                )}
                {p.popout && (
                  <button className="icon-btn sm" onClick={() => (invoke('window:popout', p.id, { alwaysOnTop: false }), toggleSidePanel(p.id))} data-tip="Pop out into floating window" aria-label="Pop out">
                    <ExternalLink size={13} />
                  </button>
                )}
                <button className="icon-btn sm" onClick={() => toggleSidePanel(p.id)} aria-label="Close panel" data-tip="Close">
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="sidepanel-b">
              <ErrorBoundary name={p.title} key={p.id}>
                <Suspense fallback={<div className="empty">Loading…</div>}>
                  <C />
                </Suspense>
              </ErrorBoundary>
            </div>
          </aside>
        )
      })}
    </>
  )
}
