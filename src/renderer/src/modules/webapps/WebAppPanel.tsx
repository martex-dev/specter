// A sidebar web app: one persistent <webview> per app. The element is created
// imperatively once and never re-parented (moving a webview reloads it). The
// side-panel host keeps this component mounted while the panel is hidden
// (keepAlive), so chats keep receiving and music keeps playing.
import { useEffect, useRef } from 'react'
import type { WebviewTag } from 'electron'
import { AlertTriangle, ArrowUpRight, Bell, Home, RotateCw, WifiOff, X } from 'lucide-react'
import { parseUnread, pickFavicon, sameAppHost, type WebApp } from '@shared/modules/webapps'
import { invoke } from '../../lib/ipc'
import { webviewFor } from '../../lib/webviews'
import { activeTab, useBrowser } from '../../stores/browser'
import { getSetting } from '../../stores/settings'
import { toast, useUi } from '../../stores/ui'
import {
  getApp,
  goHome,
  openApp,
  openInTab,
  panelIdOf,
  registerView,
  reloadApp,
  resetRuntime,
  runtimeOf,
  saveApp,
  setRuntime,
  unloadApp,
  unregisterView,
  useRuntime,
  userAgentFor,
  useWebApps
} from './store'

export default function WebAppPanel({ id }: { id: string }) {
  const app = useWebApps((s) => s.apps.find((a) => a.id === id))
  const partition = useBrowser((s) => s.profile?.partition) ?? 'persist:specter-default'
  if (!app) return <div className="empty">This web app was removed from the sidebar.</div>
  return <WebAppView app={app} partition={partition} />
}

function WebAppView({ app, partition }: { app: WebApp; partition: string }) {
  const id = app.id
  const hostRef = useRef<HTMLDivElement>(null)
  const rt = useRuntime(id)

  useEffect(() => {
    const host = hostRef.current!
    const initial = getApp(id) ?? app
    const wv = document.createElement('webview') as WebviewTag
    wv.setAttribute('partition', partition)
    wv.setAttribute('allowpopups', '')
    wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes')
    // The user agent must be set before the first navigation.
    wv.setAttribute('useragent', userAgentFor(initial.mobile))
    wv.setAttribute('src', initial.url)
    wv.className = 'wa-webview'
    registerView(id, wv)
    setRuntime(id, { live: true, ready: false, loading: true, error: null, crashed: null })

    let attached = false
    let baselineUntil = 0
    let notifiedAt = 0
    const nav = () => {
      try {
        setRuntime(id, { canGoBack: wv.canGoBack(), url: wv.getURL() })
      } catch {
        /* not ready */
      }
    }
    const on = (ev: string, fn: (e: any) => void) => wv.addEventListener(ev, fn)

    on('dom-ready', () => {
      if (!attached) {
        attached = true
        const a = getApp(id)
        try {
          invoke('webapps:guest', wv.getWebContentsId()).catch(() => undefined)
          if (a?.muted) wv.setAudioMuted(true)
          if (a && a.zoom !== 1) wv.setZoomFactor(a.zoom)
        } catch {
          /* ignore */
        }
        // Titles seen right after load are the existing state, not new messages.
        baselineUntil = Date.now() + 5000
        setRuntime(id, { ready: true })
        if (isShown(id)) focusSoon(wv)
      }
      nav()
    })
    on('did-start-loading', () => setRuntime(id, { loading: true }))
    on('did-stop-loading', () => {
      setRuntime(id, { loading: false })
      nav()
    })
    on('did-navigate', (e) => {
      setRuntime(id, { error: null, crashed: null, url: e.url, blockedPermission: null })
      nav()
    })
    on('did-navigate-in-page', (e) => e.isMainFrame && nav())
    on('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3) return
      setRuntime(id, { loading: false, error: { code: e.errorCode, description: e.errorDescription || 'Failed to load', url: e.validatedURL || getApp(id)?.url || '' } })
    })
    on('render-process-gone', (e) => {
      if (e.details?.reason === 'clean-exit') return
      setRuntime(id, { crashed: e.details?.reason ?? 'crashed', loading: false, audible: false })
    })
    on('page-title-updated', (e) => {
      const a = getApp(id)
      const count = a?.badges ? parseUnread(e.title) : 0
      const prev = runtimeOf(id).unread
      setRuntime(id, { title: e.title, unread: count })
      if (!a || !a.badges || !a.notify || count <= 0 || count <= Math.max(prev, 0)) return
      if (Date.now() < baselineUntil) return
      if (isShown(id) && document.hasFocus()) return
      if (Date.now() - notifiedAt < 15_000) return
      notifiedAt = Date.now()
      alertUnread(a, count)
    })
    on('page-favicon-updated', (e) => {
      const fav = pickFavicon(e.favicons)
      const a = getApp(id)
      // Only remember icons of the app's own site (not of pages navigated to later).
      if (!fav || !a || a.icon === fav || !sameAppHost(safeUrl(wv), a.url)) return
      void saveApp({ id, icon: fav })
    })
    const audibleNow = () => {
      try {
        return wv.isCurrentlyAudible()
      } catch {
        return false
      }
    }
    on('media-started-playing', () => {
      setRuntime(id, { hasMedia: true, audible: audibleNow() })
      setTimeout(() => setRuntime(id, { audible: audibleNow() }), 800)
    })
    on('media-paused', () => setTimeout(() => setRuntime(id, { audible: audibleNow() }), 300))
    on('close', () => {
      // window.close() from the page: treat as "unload". This also closes the panel
      // if it is shown; otherwise the host would re-mount it at once (reloading the page).
      unloadApp(id)
    })
    on('enter-html-full-screen', () => document.documentElement.classList.add('html-fullscreen'))
    on('leave-html-full-screen', () => document.documentElement.classList.remove('html-fullscreen'))

    host.appendChild(wv)

    // Playing indicator: one cheap poll while mounted (media events don't cover
    // Web Audio, and pauses aren't always reported). Stops when unloaded.
    const audioTimer = window.setInterval(() => {
      if (attached && !runtimeOf(id).crashed) setRuntime(id, { audible: audibleNow() })
    }, 2500)

    return () => {
      clearInterval(audioTimer)
      unregisterView(id)
      if (document.activeElement === wv) refocusPage()
      wv.remove()
      resetRuntime(id)
    }
    // The webview is created once per mount; later changes go through its API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, partition])

  // Hidden panels must not keep keyboard focus; shown panels take it.
  useEffect(() => {
    let was = isShown(id)
    return useUi.subscribe((s) => {
      const now = s.sidePanel === panelIdOf(id)
      if (now === was) return
      was = now
      const wv = viewOrNull(hostRef.current)
      if (!wv) return
      wv.tabIndex = now ? 0 : -1
      if (now) focusSoon(wv)
      else if (document.activeElement === wv) {
        wv.blur()
        refocusPage()
      }
    })
  }, [id])

  const failed = rt.crashed || rt.error
  return (
    <div className="wa-panel">
      {rt.loading && !failed && <div className="wa-progress" />}
      {rt.blockedPermission && !failed && <PermissionBar id={id} perm={rt.blockedPermission} />}
      <div ref={hostRef} className={'wa-host' + (failed ? ' wa-host-failed' : '')} />
      {failed && (
        <div className="wa-fail">
          {rt.crashed ? <AlertTriangle size={26} /> : navigator.onLine ? <AlertTriangle size={26} /> : <WifiOff size={26} />}
          <h4>{rt.crashed ? `${app.name} stopped working` : `Couldn't load ${app.name}`}</h4>
          <p className="muted">
            {rt.crashed
              ? `The page's process ended (${rt.crashed}).`
              : !navigator.onLine
                ? 'You appear to be offline.'
                : `${rt.error!.description} (${rt.error!.code})`}
          </p>
          {rt.error?.url && <p className="mono wa-fail-url">{rt.error.url}</p>}
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <button className="btn primary sm" onClick={() => reloadApp(id)}>
              <RotateCw size={13} /> Retry
            </button>
            <button className="btn sm" onClick={() => goHome(id)}>
              <Home size={13} /> Home
            </button>
            <button className="btn sm ghost" onClick={() => openInTab(id)}>
              <ArrowUpRight size={13} /> Open in tab
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PermissionBar({ id, perm }: { id: string; perm: { permission: string; origin: string } }) {
  const label = perm.permission.replace(/\+/g, ' & ')
  return (
    <div className="wa-permbar">
      <Bell size={13} />
      <span className="grow">
        {hostLabel(perm.origin)} asked for <b>{label}</b>. Sidebar apps can't show permission prompts — allow it to use this feature.
      </span>
      <button
        className="btn sm primary"
        onClick={async () => {
          for (const p of perm.permission.split('+')) await invoke('permissions:set', perm.origin, p, 'allow')
          setRuntime(id, { blockedPermission: null })
          toast({ kind: 'ok', title: `Allowed ${label} for ${hostLabel(perm.origin)}` })
          reloadApp(id)
        }}
      >
        Allow & reload
      </button>
      <button className="icon-btn sm" aria-label="Dismiss" onClick={() => setRuntime(id, { blockedPermission: null })}>
        <X size={13} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ helpers

function isShown(id: string): boolean {
  return useUi.getState().sidePanel === panelIdOf(id)
}

function viewOrNull(host: HTMLDivElement | null): WebviewTag | null {
  return (host?.querySelector('webview') as WebviewTag | null) ?? null
}

function focusSoon(wv: WebviewTag): void {
  setTimeout(() => {
    try {
      if (wv.isConnected && wv.offsetParent !== null) wv.focus()
    } catch {
      /* ignore */
    }
  }, 60)
}

/** Gives keyboard focus back to the active tab's page. */
function refocusPage(): void {
  const t = activeTab()
  const tabWv = t ? webviewFor(t.id) : null
  if (tabWv) tabWv.focus()
  else (document.activeElement as HTMLElement | null)?.blur?.()
}

function hostLabel(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return origin
  }
}

function alertUnread(app: WebApp, count: number): void {
  if (!getSetting('notifications.enabled')) return
  if (getSetting('notifications.categories')?.browser === false) return
  const title = `${app.name}: ${count} unread`
  if (document.hasFocus()) toast({ kind: 'info', title, action: { label: 'Open', run: () => openApp(app.id) }, ttl: 6000 })
  // Notification center entry (+ a desktop toast when SPECTER isn't focused).
  invoke('app:notify', { title, body: 'New activity in your sidebar app', category: 'browser' }).catch(() => undefined)
}

function safeUrl(wv: WebviewTag): string {
  try {
    return wv.getURL()
  } catch {
    return ''
  }
}
