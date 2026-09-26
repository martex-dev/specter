// specter://webapps — manage sidebar web apps: your apps (reorder, rename,
// per-app options, site permissions), the built-in catalog and custom apps.
import { useEffect, useState } from 'react'
import { ArrowUpRight, ChevronDown, ChevronRight, Eye, GripVertical, Home, Info, LayoutGrid, PowerOff, RotateCw, Trash2 } from 'lucide-react'
import type { PermissionDecision, SitePermission } from '@shared/types'
import { badgeLabel, hostOf, normalizeAppUrl, originOfUrl, UNREAD_DOT, WEBAPP_ZOOMS, type WebApp } from '@shared/modules/webapps'
import { invoke } from '../../lib/ipc'
import { useBrowser } from '../../stores/browser'
import { getSetting, setSetting, useSetting } from '../../stores/settings'
import { openOverlay, toast } from '../../stores/ui'
import { confirmAction } from '../../components/prompt'
import { Seg, Switch } from '../../components/ui'
import type { PageProps } from '../../pages/registry'
import { AppIcon } from './AppIcon'
import { CatalogGrid, CustomAppForm } from './Catalog'
import {
  goHome,
  openApp,
  openInTab,
  panelIdOf,
  reloadApp,
  removeApp,
  reorderApps,
  saveApp,
  setMobile,
  setMuted,
  setZoom,
  unloadAll,
  unloadApp,
  useRuntime,
  useWebApps
} from './store'

export default function WebAppsPage({ url }: PageProps) {
  const apps = useWebApps((s) => s.apps)
  const loaded = useWebApps((s) => s.loaded)
  const profile = useBrowser((s) => s.profile)
  const liveCount = useWebApps((s) => Object.values(s.runtime).filter((r) => r.live).length)
  const [open, setOpen] = useState<string | null>(() => url.split('#')[1] || null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  useEffect(() => {
    const h = url.split('#')[1]
    if (h) setOpen(h)
  }, [url])

  const drop = (targetId: string) => {
    if (!drag || drag === targetId) return
    const ids = apps.map((a) => a.id).filter((x) => x !== drag)
    const at = ids.indexOf(targetId)
    const from = apps.findIndex((a) => a.id === drag)
    const to = apps.findIndex((a) => a.id === targetId)
    ids.splice(from < to ? at + 1 : at, 0, drag)
    void reorderApps(ids)
  }
  const move = (id: string, dir: -1 | 1) => {
    const ids = apps.map((a) => a.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void reorderApps(ids)
  }

  return (
    <div className="page wide wa-page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Sidebar</div>
          <h1 className="page-title">Web apps</h1>
          <div className="page-sub">
            Messengers, music and AI chats that live in the sidebar and keep running while their panel is closed. They share cookies and logins with your normal tabs
            {profile ? ` in the “${profile.name}” profile` : ''}.
          </div>
        </div>
        <button
          className="btn"
          disabled={!liveCount}
          onClick={() => {
            const n = unloadAll()
            toast({ kind: 'ok', title: `Unloaded ${n} app${n === 1 ? '' : 's'}` })
          }}
          data-tip="Close every running web app to free memory"
        >
          <PowerOff size={14} /> Unload all{liveCount ? ` (${liveCount})` : ''}
        </button>
        <button className="btn primary" onClick={() => openOverlay('webapps.add')}>
          <LayoutGrid size={14} /> Add apps
        </button>
      </div>

      <div className="section">
        <div className="section-title">In your sidebar{apps.length ? ` · ${apps.length}` : ''}</div>
        {!loaded ? (
          <div className="empty">Loading…</div>
        ) : !apps.length ? (
          <div className="card wa-empty-card">
            <div>
              <b>No web apps yet.</b>
              <div className="muted">Turn on apps from the catalog below, or add any site as a custom app. They appear at the top of the sidebar.</div>
            </div>
          </div>
        ) : (
          <div className="wa-list">
            {apps.map((a, i) => (
              <div
                key={a.id}
                className={'wa-row-wrap' + (over === a.id && drag && drag !== a.id ? ' drop' : '') + (drag === a.id ? ' dragging' : '')}
                onDragOver={(e) => {
                  if (!drag) return
                  e.preventDefault()
                  setOver(a.id)
                }}
                onDragLeave={() => setOver((o) => (o === a.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault()
                  drop(a.id)
                  setDrag(null)
                  setOver(null)
                }}
              >
                <AppRow app={a} index={i} count={apps.length} expanded={open === a.id} onToggle={() => setOpen((o) => (o === a.id ? null : a.id))} onDragStart={() => setDrag(a.id)} onDragEnd={() => (setDrag(null), setOver(null))} onMove={(d) => move(a.id, d)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-title">Catalog</div>
        <CatalogGrid />
      </div>

      <div className="section">
        <div className="section-title">Custom web app</div>
        <div className="card" style={{ padding: 16 }}>
          <CustomAppForm onAdded={(id) => setOpen(id)} />
        </div>
      </div>

      <div className="section">
        <div className="section-title">Notes</div>
        <div className="card wa-notes">
          <p>
            <Info size={13} /> Apps load only when first opened, then keep running in the background (the pin in the panel header). “Unload” closes the page and frees its memory.
          </p>
          <p>
            <Info size={13} /> Sidebar apps can't show SPECTER's permission prompt. When a site asks for notifications, the microphone or the camera, the panel shows a bar to allow it; you can
            also set these per app below. Desktop notifications from sites appear only when allowed.
          </p>
          <p>
            <Info size={13} /> Unread badges come from the page title (for example “(3) WhatsApp”). Zoom follows Chromium's per-site zoom, so it also applies to that site in normal tabs.
          </p>
          <p>
            <Info size={13} /> Spotify and Apple Music need Widevine DRM for playback, which SPECTER's Chromium build does not include.
          </p>
        </div>
      </div>
    </div>
  )
}

function AppRow({
  app,
  index,
  count,
  expanded,
  onToggle,
  onDragStart,
  onDragEnd,
  onMove
}: {
  app: WebApp
  index: number
  count: number
  expanded: boolean
  onToggle: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const rt = useRuntime(app.id)
  const hidden = useSetting('sidebar.hiddenItems').includes(panelIdOf(app.id))
  const unread = app.badges ? rt.unread : 0
  return (
    <div className={'wa-row' + (expanded ? ' open' : '')} id={'app-' + app.id}>
      <div className="wa-row-h" onClick={onToggle}>
        <span
          className="wa-grip"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', app.id)
            onDragStart()
          }}
          onDragEnd={onDragEnd}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && index > 0) (e.preventDefault(), onMove(-1))
            if (e.key === 'ArrowDown' && index < count - 1) (e.preventDefault(), onMove(1))
          }}
          tabIndex={0}
          role="button"
          aria-label={`Reorder ${app.name} (drag, or use arrow keys)`}
          data-tip="Drag to reorder"
        >
          <GripVertical size={14} />
        </span>
        <AppIcon id={app.id} size={22} />
        <div className="wa-row-title">
          <div className="wa-row-name">{app.name}</div>
          <div className="wa-row-host mono">{hostOf(app.url)}</div>
        </div>
        <div className="wa-chips">
          {rt.live ? <span className="badge ok">Running</span> : <span className="badge">Not loaded</span>}
          {rt.audible && <span className="badge accent">Playing</span>}
          {unread !== 0 && <span className="badge warn">{unread === UNREAD_DOT ? 'Unread' : `${badgeLabel(unread)} unread`}</span>}
          {(rt.error || rt.crashed) && <span className="badge bad">Failed</span>}
          {app.mobile && <span className="badge">Mobile</span>}
          {app.muted && <span className="badge">Muted</span>}
          {hidden && <span className="badge warn">Hidden from dock</span>}
        </div>
        <button
          className="btn sm"
          onClick={(e) => {
            e.stopPropagation()
            openApp(app.id)
          }}
        >
          Open
        </button>
        <span className="wa-chev">{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
      </div>
      {expanded && <AppOptions app={app} hidden={hidden} />}
    </div>
  )
}

function AppOptions({ app, hidden }: { app: WebApp; hidden: boolean }) {
  const rt = useRuntime(app.id)
  const [name, setName] = useState(app.name)
  const [home, setHome] = useState(app.url)
  useEffect(() => setName(app.name), [app.name])
  useEffect(() => setHome(app.url), [app.url])
  const homeOk = !!normalizeAppUrl(home)

  const commitName = () => {
    if (name.trim() && name.trim() !== app.name) void saveApp({ id: app.id, name })
    else setName(app.name)
  }
  const commitHome = async () => {
    const u = normalizeAppUrl(home)
    if (!u) return
    if (u !== app.url) {
      const saved = await saveApp({ id: app.id, url: u })
      if (saved) toast({ kind: 'ok', title: 'Home page updated', body: rt.live ? 'Use “Go home” to load it.' : undefined, ttl: 2500 })
    } else setHome(app.url)
  }

  return (
    <div className="wa-opts">
      <div className="wa-opts-grid">
        <label className="wa-field">
          <span className="label">Name</span>
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
        </label>
        <label className="wa-field">
          <span className="label">Home page</span>
          <input
            className={'input mono' + (homeOk ? '' : ' invalid')}
            value={home}
            spellCheck={false}
            onChange={(e) => setHome(e.target.value)}
            onBlur={() => void commitHome()}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </label>

        <div className="wa-opt">
          <span className="label">Layout</span>
          <Seg
            value={app.mobile ? 'mobile' : 'desktop'}
            options={[
              { value: 'desktop', label: 'Desktop' },
              { value: 'mobile', label: 'Mobile' }
            ]}
            onChange={(v) => void setMobile(app.id, v === 'mobile')}
          />
          <span className="wa-hint">User agent sent to the site{rt.live ? '; reloads the app' : ''}</span>
        </div>
        <div className="wa-opt">
          <span className="label">Zoom</span>
          <select className="select" value={String(app.zoom)} onChange={(e) => void setZoom(app.id, Number(e.target.value))}>
            {[...new Set([...WEBAPP_ZOOMS, app.zoom])]
              .sort((a, b) => a - b)
              .map((z) => (
                <option key={z} value={String(z)}>
                  {Math.round(z * 100)}%
                </option>
              ))}
          </select>
        </div>
        <div className="wa-opt">
          <span className="label">Sound</span>
          <span className="row" style={{ gap: 8 }}>
            <Switch on={!app.muted} onChange={(v) => void setMuted(app.id, !v)} label="Sound" />
            <span className="muted">{app.muted ? 'Muted' : 'On'}</span>
          </span>
        </div>
        <div className="wa-opt">
          <span className="label">Unread badge</span>
          <span className="row" style={{ gap: 8 }}>
            <Switch on={app.badges} onChange={(v) => void saveApp({ id: app.id, badges: v })} label="Unread badge" />
            <span className="muted">Count from the page title</span>
          </span>
        </div>
        <div className="wa-opt">
          <span className="label">Unread alerts</span>
          <span className="row" style={{ gap: 8 }}>
            <Switch on={app.notify && app.badges} disabled={!app.badges} onChange={(v) => void saveApp({ id: app.id, notify: v })} label="Unread alerts" />
            <span className="muted">Toast when the count rises while closed{getSetting('notifications.enabled') ? '' : ' (notifications are off in Settings)'}</span>
          </span>
        </div>
        {hidden && (
          <div className="wa-opt">
            <span className="label">Dock</span>
            <button className="btn sm" onClick={() => setSetting('sidebar.hiddenItems', getSetting('sidebar.hiddenItems').filter((x) => x !== panelIdOf(app.id)))}>
              <Eye size={13} /> Show in dock
            </button>
          </div>
        )}
      </div>

      <SitePermissions pageUrl={rt.live && rt.url ? rt.url : app.url} />

      <div className="wa-actions">
        <button className="btn sm" onClick={() => reloadApp(app.id)}>
          <RotateCw size={13} /> {rt.live ? 'Reload' : 'Load'}
        </button>
        <button className="btn sm" disabled={!rt.live} onClick={() => goHome(app.id)}>
          <Home size={13} /> Go home
        </button>
        <button className="btn sm" onClick={() => openInTab(app.id)}>
          <ArrowUpRight size={13} /> Open in tab
        </button>
        <button className="btn sm" disabled={!rt.live} onClick={() => unloadApp(app.id)} data-tip={rt.live ? 'Close the page and free its memory' : 'Not running'}>
          <PowerOff size={13} /> Unload
        </button>
        <span className="grow" />
        <button
          className="btn sm danger"
          onClick={async () => {
            if (await confirmAction(`Remove ${app.name}?`, 'The app leaves the sidebar. Your login for the site is kept, because it is shared with normal tabs.', 'Remove', true)) await removeApp(app.id)
          }}
        >
          <Trash2 size={13} /> Remove
        </button>
      </div>
    </div>
  )
}

const PERMS: { id: string; label: string }[] = [
  { id: 'notifications', label: 'Notifications' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'camera', label: 'Camera' }
]

function SitePermissions({ pageUrl }: { pageUrl: string }) {
  const [perms, setPerms] = useState<SitePermission[]>([])
  // Current page origin once loaded (sites often redirect), else the home page.
  const origin = originOfUrl(pageUrl)
  const load = () => invoke('permissions:list').then(setPerms).catch(() => setPerms([]))
  useEffect(() => {
    void load()
  }, [origin])
  if (!origin) return null
  const decision = (p: string): PermissionDecision => perms.find((x) => x.origin === origin && x.permission === p)?.decision ?? 'ask'
  return (
    <div className="wa-perms">
      <div className="label">
        Site permissions · <span className="mono">{hostOf(origin)}</span>
      </div>
      <div className="wa-perms-grid">
        {PERMS.map((p) => (
          <div key={p.id} className="wa-perm">
            <span>{p.label}</span>
            <Seg
              value={decision(p.id)}
              options={[
                { value: 'ask', label: 'Not set' },
                { value: 'allow', label: 'Allow' },
                { value: 'deny', label: 'Block' }
              ]}
              onChange={async (v) => {
                try {
                  await invoke('permissions:set', origin, p.id, v)
                  await load()
                } catch (err) {
                  toast({ kind: 'error', title: 'Could not change permission', body: String(err) })
                }
              }}
            />
          </div>
        ))}
      </div>
      <div className="wa-hint">“Not set” means the site is refused (sidebar apps can't prompt). Changes apply after the app reloads.</div>
    </div>
  )
}
