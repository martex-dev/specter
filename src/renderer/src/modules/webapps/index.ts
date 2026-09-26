// Sidebar web apps (messengers, music) — module entry.
//
// Each app is a keep-alive side panel in the dock's "apps" section hosting one
// persistent <webview>. Webviews are created lazily on first open, stay alive
// while hidden, and are destroyed by "Unload".
import { createElement, lazy, Suspense } from 'react'
import { AppWindow, LayoutGrid, PowerOff } from 'lucide-react'
import type { WebApp } from '@shared/modules/webapps'
import { registerCommand, registerCommands } from '../../lib/commands'
import { on, onRaw } from '../../lib/ipc'
import { lazyPage, registerPage } from '../../pages/registry'
import { newTab } from '../../stores/browser'
import { openOverlay, toast } from '../../stores/ui'
import { registerOverlay } from '../overlays'
import { syncPanels } from './panels'
import { appIdForWcId, getApp, openApp, saveApp, setRuntime, startSync, unloadAll, useWebApps } from './store'
import './webapps.css'

const LazyPicker = lazy(() => import('./AddAppsOverlay'))
function Picker() {
  return createElement(Suspense, { fallback: null }, createElement(LazyPicker))
}

const appCommands = new Map<string, { name: string; off: () => void }>()

function syncCommands(apps: WebApp[]): void {
  const ids = new Set(apps.map((a) => a.id))
  for (const [id, c] of appCommands) {
    const app = apps.find((a) => a.id === id)
    if (!ids.has(id) || app?.name !== c.name) {
      c.off()
      appCommands.delete(id)
    }
  }
  for (const app of apps) {
    if (appCommands.has(app.id)) continue
    const off = registerCommand({
      id: 'webapps.app.' + app.id,
      title: `Open ${app.name}`,
      description: 'Sidebar web app',
      category: 'View',
      icon: AppWindow,
      keywords: ['sidebar', 'web app', 'panel', app.name.toLowerCase()],
      run: () => openApp(app.id)
    })
    appCommands.set(app.id, { name: app.name, off })
  }
}

export function register(): void {
  registerOverlay('webapps.add', Picker)
  registerPage({ id: 'webapps', title: 'Web apps', icon: LayoutGrid, component: lazyPage(() => import('./WebAppsPage')), listed: true, category: 'Browser' })

  registerCommands([
    {
      id: 'webpanels.add',
      title: 'Add web app to sidebar',
      description: 'WhatsApp, Discord, Spotify, ChatGPT… or any site',
      category: 'View',
      icon: LayoutGrid,
      keywords: ['sidebar', 'messenger', 'whatsapp', 'telegram', 'discord', 'spotify', 'music', 'panel', 'web app'],
      run: () => openOverlay('webapps.add')
    },
    {
      id: 'webapps.manage',
      title: 'Manage sidebar web apps',
      category: 'View',
      icon: AppWindow,
      keywords: ['sidebar', 'web apps', 'messengers', 'reorder'],
      run: () => newTab('specter://webapps')
    },
    {
      id: 'webapps.open',
      title: 'Open sidebar web app',
      category: 'View',
      icon: AppWindow,
      hidden: true,
      run: (args?: { id?: string }) => {
        if (args?.id && getApp(args.id)) return openApp(args.id)
        if (args?.id) toast({ kind: 'warn', title: 'That web app is not in your sidebar' })
        else newTab('specter://webapps')
      }
    },
    {
      id: 'webapps.unloadAll',
      title: 'Unload all sidebar web apps',
      description: 'Close running sidebar apps to free memory',
      category: 'View',
      icon: PowerOff,
      when: () => useWebApps.getState().apps.length > 0,
      run: () => {
        const n = unloadAll()
        toast({ kind: 'ok', title: n ? `Unloaded ${n} app${n === 1 ? '' : 's'}` : 'No sidebar apps are running' })
      }
    }
  ])

  // Keep the dock (and palette entries) in sync with the stored apps.
  useWebApps.subscribe((s, prev) => {
    if (s.apps === prev.apps && s.loaded === prev.loaded) return
    syncPanels(s.apps)
    syncCommands(s.apps)
    // Subtle hint on the dock "+" until the first app is added.
    if (s.loaded) document.documentElement.toggleAttribute('data-webapps-empty', s.apps.length === 0)
  })
  startSync()

  // Sidebar apps are not tabs, so SPECTER's permission prompt refuses their
  // requests. Surface them inside the panel with a one-click "Allow".
  on('permissions:request', (req) => {
    const id = appIdForWcId(req.webContentsId)
    if (id) setRuntime(id, { blockedPermission: { permission: req.permission, origin: req.origin } })
  })

  // Right-click inside an app's page (the page context menu only serves tabs).
  on('guest:contextMenu', (p) => {
    if (appIdForWcId(p.webContentsId)) void import('./contextMenu').then((m) => m.showAppContextMenu(p))
  })

  // Ctrl+wheel / pinch zoom inside an app: remember the new factor.
  onRaw<{ id: string; args?: { wcId?: number; factor?: number } }>('command:run', ({ id, args }) => {
    if (id !== 'internal.zoomChanged' || !args?.wcId || !args.factor) return
    const appId = appIdForWcId(args.wcId)
    if (appId) void saveApp({ id: appId, zoom: args.factor })
  })
}
