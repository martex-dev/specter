import { useEffect, useState, useSyncExternalStore } from 'react'
import { Clock, Layers, Pencil, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import type { QuickLink } from '@shared/settings'
import { SEARCH_ENGINES } from '@shared/settings'
import { invoke } from '../lib/ipc'
import { newTabBackgrounds, newTabWidgets } from '../lib/registry'
import { getCommand } from '../lib/commands'
import { workspaceIcon } from '../lib/icons'
import { timeAgo } from '../lib/format'
import { loadUrl, switchWorkspace, useBrowser } from '../stores/browser'
import { getSetting, setSetting, useSetting } from '../stores/settings'
import { openMenu } from '../stores/ui'
import { Favicon, Kbd, SpecterMark } from '../components/ui'
import { promptText } from '../components/prompt'
import type { PageProps } from './registry'

function faviconFor(url: string): string | undefined {
  try {
    // Chromium-cached favicons are not accessible; use the site's own /favicon.ico (no third-party service).
    const u = new URL(url)
    return `${u.origin}/favicon.ico`
  } catch {
    return undefined
  }
}

function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 5) return 'Night owl mode'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Late night session'
}

export default function NewTab({ tabId }: PageProps) {
  const [now, setNow] = useState(Date.now())
  const showClock = useSetting('newtab.showClock')
  const showRecent = useSetting('newtab.showRecent')
  const showLinks = useSetting('newtab.showQuickLinks')
  const links = useSetting('newtab.quickLinks')
  const engineId = useSetting('search.engine')
  const engine = SEARCH_ENGINES.find((e) => e.id === engineId)
  const workspaces = useBrowser((s) => s.workspaces)
  const activeWsId = useBrowser((s) => s.activeWsId)
  const [top, setTop] = useState<{ url: string; title: string; visits: number }[]>([])
  const widgets = useSyncExternalStore(newTabWidgets.subscribe, () => newTabWidgets.list())
  const backgrounds = useSyncExternalStore(newTabBackgrounds.subscribe, () => newTabBackgrounds.list())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    invoke('history:topSites', 8)
      .then(setTop)
      .catch(() => undefined)
    return () => clearInterval(t)
  }, [])

  const typeIntoOmnibox = (text = '') => window.dispatchEvent(new CustomEvent('specter:omnibox-type', { detail: text }))

  const editLink = async (l?: QuickLink) => {
    const title = await promptText({ title: l ? 'Edit shortcut' : 'Add shortcut', label: 'Name', initial: l?.title, placeholder: 'e.g. GitHub' })
    if (!title) return
    const url = await promptText({ title: l ? 'Edit shortcut' : 'Add shortcut', label: 'URL', initial: l?.url ?? 'https://' })
    if (!url) return
    const next = l ? links.map((x) => (x.id === l.id ? { ...x, title, url } : x)) : [...links, { id: 'ql' + Date.now().toString(36), title, url }]
    setSetting('newtab.quickLinks', next)
  }

  const recentWs = [...workspaces].filter((w) => w.id !== activeWsId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4)
  const d = new Date(now)

  return (
    <div className="ntp" onKeyDown={(e) => e.key.length === 1 && !e.ctrlKey && !e.altKey && typeIntoOmnibox(e.key)}>
      {backgrounds.map((b) => (
        <b.component key={b.id} />
      ))}
      <div className="ntp-brand">
        <SpecterMark size={20} /> SPECTER
      </div>
      {showClock && (
        <>
          <div className="ntp-greeting">{greeting(d)}</div>
          <div className="ntp-clock">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="ntp-date">{d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </>
      )}
      <div className="ntp-search" onClick={() => typeIntoOmnibox()} role="search">
        <Search size={18} className="muted" />
        <input
          placeholder={`Search ${engine?.name ?? 'the web'}, type a URL, @tabs, @history, > command…`}
          readOnly
          onFocus={() => typeIntoOmnibox()}
          aria-label="Search"
        />
        <Kbd keys="Ctrl+L" />
      </div>

      {widgets.length > 0 && (
        <div className="ntp-row ntp-widgets">
          {widgets.map((w) => (
            <w.component key={w.id} />
          ))}
        </div>
      )}

      {showLinks && (
        <div className="ntp-row">
          <div className="quick-links">
            {links.map((l) => (
              <button
                key={l.id}
                className="quick-link"
                onClick={(e) => (e.ctrlKey ? invoke('window:new', { url: l.url }) : loadUrl(tabId, l.url))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      { label: 'Edit…', icon: <Pencil size={14} />, run: () => editLink(l) },
                      { label: 'Remove', icon: <X size={14} />, danger: true, run: () => setSetting('newtab.quickLinks', links.filter((x) => x.id !== l.id)) }
                    ]
                  })
                }}
              >
                <span className="ql-icon">
                  <Favicon src={faviconFor(l.url)} url={l.url} size={20} />
                </span>
                <span className="ellipsis" style={{ maxWidth: '100%' }}>
                  {l.title}
                </span>
                <span
                  className="ql-x icon-btn sm"
                  role="button"
                  aria-label="Remove shortcut"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSetting('newtab.quickLinks', links.filter((x) => x.id !== l.id))
                  }}
                >
                  <X size={11} />
                </span>
              </button>
            ))}
            {links.length < 24 && (
              <button className="quick-link" onClick={() => editLink()}>
                <span className="ql-icon">
                  <Plus size={18} className="muted" />
                </span>
                <span className="muted">Add</span>
              </button>
            )}
          </div>
        </div>
      )}

      {showRecent && (top.length > 0 || recentWs.length > 0) && (
        <div className="ntp-row ntp-widgets">
          {top.length > 0 && (
            <div className="ntp-card">
              <div className="ntp-card-h">
                <Clock size={13} className="muted" />
                <span className="label">Frequent sites · 30 days</span>
              </div>
              {top.slice(0, 6).map((s) => (
                <div key={s.url} className="list-row" onClick={() => loadUrl(tabId, s.url)}>
                  <Favicon src={faviconFor(s.url)} url={s.url} size={14} />
                  <span className="ellipsis grow">{s.title || s.url}</span>
                  <span className="dim mono" style={{ fontSize: 10.5 }}>
                    {s.visits}×
                  </span>
                </div>
              ))}
            </div>
          )}
          {recentWs.length > 0 && (
            <div className="ntp-card">
              <div className="ntp-card-h">
                <Layers size={13} className="muted" />
                <span className="label">Recent workspaces</span>
              </div>
              {recentWs.map((w) => {
                const Icon = workspaceIcon(w.icon)
                return (
                  <div key={w.id} className="list-row" onClick={() => switchWorkspace(w.id)}>
                    <Icon size={14} color={w.color} />
                    <span className="ellipsis grow">{w.name}</span>
                    <span className="dim" style={{ fontSize: 11 }}>
                      {w.state.tabs.length} tabs · {timeAgo(w.updatedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <button
        className="btn sm ghost"
        style={{ position: 'absolute', right: 16, bottom: 14 }}
        onClick={(e) =>
          openMenu({
            x: e.clientX - 220,
            y: e.clientY - 200,
            width: 240,
            items: [
              { header: 'Customize new tab' },
              { label: 'Clock', checked: showClock, run: () => setSetting('newtab.showClock', !showClock) },
              { label: 'Shortcuts', checked: showLinks, run: () => setSetting('newtab.showQuickLinks', !showLinks) },
              { label: 'Frequent sites & workspaces', checked: showRecent, run: () => setSetting('newtab.showRecent', !showRecent) },
              { label: 'Market strip', checked: useSettingSnapshot('newtab.showMarkets'), run: () => setSetting('newtab.showMarkets', !useSettingSnapshot('newtab.showMarkets')) },
              { label: 'System stats', checked: useSettingSnapshot('newtab.showSystem'), run: () => setSetting('newtab.showSystem', !useSettingSnapshot('newtab.showSystem')) },
              ...(getCommand('control.wallpaper') ? [{ separator: true } as const, { label: 'Wallpaper…', run: () => getCommand('control.wallpaper')?.run() }] : [])
            ]
          })
        }
      >
        <SlidersHorizontal size={13} /> Customize
      </button>
    </div>
  )
}

function useSettingSnapshot(k: 'newtab.showMarkets' | 'newtab.showSystem'): boolean {
  return getSetting(k)
}
