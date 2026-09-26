import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Columns2,
  Columns3,
  Download,
  EllipsisVertical,
  Grid2x2,
  Home,
  LayoutPanelLeft,
  PanelRight,
  RotateCw,
  Rows2,
  Save,
  Square,
  X,
  Paintbrush,
  Palette as PaletteIcon
} from 'lucide-react'
import type { DownloadInfo, SplitPreset } from '@shared/types'
import { invoke, on } from '../lib/ipc'
import { runCommand, shortcutFor } from '../lib/commands'
import { goBack, goForward, loadUrl, reload, setLayout, stop, useActiveTab, useActiveWs, useBrowser } from '../stores/browser'
import { getSetting, useSetting } from '../stores/settings'
import { openMenu, toggleSidePanel, useUi, type MenuItem } from '../stores/ui'
import { Omnibox } from './Omnibox'
import { mainMenu } from './mainMenu'
import { promptText } from '../components/prompt'
import { resolveTheme, THEMES } from '../lib/themes'
import { setSetting as setSettingValue } from '../stores/settings'

function themeMenu(): MenuItem[] {
  const { theme, palette } = resolveTheme(getSetting('appearance.theme'), getSetting('appearance.palette'))
  const swatch = (bg: string, a: string) => <span style={{ width: 12, height: 12, borderRadius: 3, background: `linear-gradient(135deg, ${bg} 50%, ${a} 50%)`, display: 'inline-block', border: '1px solid rgba(255,255,255,0.2)' }} />
  return [
    { header: 'Theme' },
    ...THEMES.map((t) => ({
      label: t.name,
      icon: swatch(t.palettes[0].bg0, t.palettes[0].accent),
      checked: t.id === theme.id ? true : undefined,
      submenu: t.palettes.map((p) => ({
        label: p.name,
        icon: swatch(p.bg0, p.accent),
        run: () => {
          setSettingValue('appearance.theme', t.id)
          setSettingValue('appearance.palette', p.id)
          setSettingValue('appearance.accent', '')
          if (t.id !== theme.id) setSettingValue('appearance.layout', {})
        }
      }))
    })),
    { separator: true },
    { label: `Palette: ${palette.name} — next`, icon: <PaletteIcon size={14} />, run: () => runCommand('ui.nextPalette') },
    { label: 'Theme gallery & accent colour…', icon: <Paintbrush size={14} />, run: () => runCommand('ui.themes') }
  ]
}

export function Toolbar() {
  const tab = useActiveTab()
  const ws = useActiveWs()
  const sidePanel = useUi((s) => s.sidePanel)
  const showRail = useSetting('appearance.showSideRail')
  const profile = useBrowser((s) => s.profile)
  const canBack = !!tab && (!!tab.canGoBack || !!tab.internalBack)
  const canFwd = !!tab?.canGoForward
  const split = ws && ws.layout.preset !== 'single'

  return (
    <div className="toolbar" onDoubleClick={(e) => e.target === e.currentTarget && invoke('window:toggleMaximize')}>
      <div className="toolbar-group">
        <button className="icon-btn" disabled={!canBack} onClick={() => tab && goBack(tab.id)} onContextMenu={(e) => tab && historyMenu(e, tab.id, -1)} data-tip="Back" data-kbd={shortcutFor('browser.back')} aria-label="Back">
          <ArrowLeft size={17} />
        </button>
        <button className="icon-btn" disabled={!canFwd} onClick={() => tab && goForward(tab.id)} onContextMenu={(e) => tab && historyMenu(e, tab.id, 1)} data-tip="Forward" data-kbd={shortcutFor('browser.forward')} aria-label="Forward">
          <ArrowRight size={17} />
        </button>
        {tab?.loading ? (
          <button className="icon-btn" onClick={() => tab && stop(tab.id)} data-tip="Stop" aria-label="Stop loading">
            <X size={17} />
          </button>
        ) : (
          <button className="icon-btn" onClick={(e) => tab && reload(tab.id, e.shiftKey || e.ctrlKey)} data-tip="Reload" data-kbd={shortcutFor('browser.reload')} aria-label="Reload">
            <RotateCw size={15} />
          </button>
        )}
        <button className="icon-btn extra" onClick={() => tab && loadUrl(tab.id, getSetting('general.homepage') || 'specter://newtab')} data-tip="Home" aria-label="Home">
          <Home size={16} />
        </button>
      </div>
      <Omnibox />
      <div className="toolbar-group extra">
        <button
          className={'icon-btn' + (split ? ' on' : '')}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            openMenu({ x: r.left - 180, y: r.bottom + 6, items: layoutMenu(), width: 240 })
          }}
          data-tip="Split view & layouts"
          data-kbd={shortcutFor('layout.split')}
          aria-label="Split view"
        >
          <Columns2 size={16} />
        </button>
        <button
          className="icon-btn"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            openMenu({ x: r.left - 200, y: r.bottom + 6, items: themeMenu(), width: 250 })
          }}
          data-tip="Theme & colours"
          aria-label="Theme and colours"
        >
          <Paintbrush size={16} />
        </button>
        <DownloadsButton />
        {!showRail && (
          <button className={'icon-btn' + (sidePanel ? ' on' : '')} onClick={() => toggleSidePanel(sidePanel ?? 'ai')} data-tip="Side panel" data-kbd={shortcutFor('ui.toggleSidebar')} aria-label="Toggle side panel">
            <PanelRight size={16} />
          </button>
        )}
        <div className="toolbar-divider" />
        <button
          className="icon-btn"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            runCommand('profiles.menu', { x: r.left - 180, y: r.bottom + 6 })
          }}
          data-tip={`Profile: ${profile?.name ?? ''}`}
          aria-label="Profile"
        >
          <span style={{ width: 20, height: 20, borderRadius: '50%', background: profile?.color ?? 'var(--accent)', color: '#0c0d10', display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700 }}>{(profile?.name ?? 'P').slice(0, 1).toUpperCase()}</span>
        </button>
      </div>
      <button
        className="icon-btn"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          openMenu({ x: r.right - 260, y: r.bottom + 6, items: mainMenu(), width: 260 })
        }}
        data-tip="Menu"
        aria-label="Main menu"
      >
        <EllipsisVertical size={17} />
      </button>
    </div>
  )
}

async function historyMenu(e: React.MouseEvent, tabId: string, dir: -1 | 1) {
  e.preventDefault()
  const { webviewFor } = await import('../lib/webviews')
  const wv = webviewFor(tabId)
  if (!wv) return
  const nav = await invoke('guest:navHistory', wv.getWebContentsId()).catch(() => [])
  const items: MenuItem[] = nav
    .filter((n) => (dir < 0 ? n.offset < 0 : n.offset > 0))
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset))
    .slice(0, 15)
    .map((n) => ({ label: n.title || n.url, run: () => wv.goToOffset(n.offset) }))
  if (!items.length) return
  openMenu({ x: e.clientX, y: e.clientY, items, width: 300 })
}

const LAYOUTS: { preset: SplitPreset; label: string; icon: JSX.Element }[] = [
  { preset: '50/50', label: 'Split 50 / 50', icon: <Columns2 size={14} /> },
  { preset: '33/67', label: 'Split 33 / 67', icon: <LayoutPanelLeft size={14} /> },
  { preset: '67/33', label: 'Split 67 / 33', icon: <LayoutPanelLeft size={14} style={{ transform: 'scaleX(-1)' }} /> },
  { preset: '25/75', label: 'Split 25 / 75', icon: <LayoutPanelLeft size={14} /> },
  { preset: 'rows-50/50', label: 'Stacked rows', icon: <Rows2 size={14} /> },
  { preset: 'three-column', label: 'Three columns', icon: <Columns3 size={14} /> },
  { preset: 'quadrant', label: 'Quadrant (2 × 2)', icon: <Grid2x2 size={14} /> },
  { preset: 'four-panel', label: 'Four panels', icon: <Columns3 size={14} /> }
]

export function layoutMenu(): MenuItem[] {
  const st = useBrowser.getState()
  const ws = st.open[st.activeWsId]
  const cur = ws?.layout.preset ?? 'single'
  return [
    { header: 'Layout' },
    { label: 'Single view', icon: <Square size={14} />, checked: cur === 'single', run: () => setLayout('single') },
    ...LAYOUTS.map((l) => ({ label: l.label, icon: l.icon, checked: cur === l.preset, run: () => setLayout(l.preset) })),
    { separator: true },
    { label: 'Reset pane sizes', disabled: cur === 'single', run: () => import('../stores/browser').then((m) => m.setPaneSizes([])) },
    {
      label: 'Save current layout…',
      icon: <Save size={14} />,
      disabled: cur === 'single',
      run: async () => {
        if (!ws) return
        const name = await promptText({ title: 'Save layout', placeholder: 'e.g. Research + notes' })
        if (!name) return
        const urls = ws.layout.panes.map((id) => ws.tabs.find((t) => t.id === id)?.url ?? 'specter://newtab')
        await invoke('workspaces:saveLayout', { name, layout: { preset: ws.layout.preset, panes: [], sizes: ws.layout.sizes }, urls })
      }
    },
    { label: 'Saved layouts…', run: () => runCommand('layout.saved') }
  ]
}

function DownloadsButton() {
  const [active, setActive] = useState<Record<string, DownloadInfo>>({})
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    invoke('downloads:list').then((list) => setActive(Object.fromEntries(list.filter((d) => d.state === 'progressing' || d.state === 'paused').map((d) => [d.id, d]))))
    return on('downloads:changed', (d) => {
      setActive((a) => {
        const next = { ...a }
        if (d.state === 'progressing' || d.state === 'paused') next[d.id] = d
        else delete next[d.id]
        return next
      })
      if (d.state === 'completed') {
        setFlash(true)
        setTimeout(() => setFlash(false), 1600)
      }
    })
  }, [])
  const list = Object.values(active)
  const total = list.reduce((a, d) => a + (d.totalBytes || 0), 0)
  const recv = list.reduce((a, d) => a + d.receivedBytes, 0)
  const pct = total > 0 ? recv / total : list.length ? 0.1 : 0
  const sidePanel = useUi((s) => s.sidePanel)
  return (
    <button className={'icon-btn' + (sidePanel === 'downloads' || flash ? ' on' : '')} onClick={() => toggleSidePanel('downloads')} data-tip={list.length ? `${list.length} download${list.length > 1 ? 's' : ''} in progress` : 'Downloads'} data-kbd={shortcutFor('browser.downloads')} aria-label="Downloads">
      {list.length > 0 ? (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray={`${pct * 50.3} 50.3`} transform="rotate(-90 10 10)" strokeLinecap="round" />
          <path d="M10 6v6m-2.5-2.5L10 12l2.5-2.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      ) : (
        <Download size={16} />
      )}
    </button>
  )
}
