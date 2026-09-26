// Sidebar web apps (messengers, music) — main-process module entry.
//
// Stores the user's sidebar apps per profile and serves them over the
// `webapps:*` IPC domain. The apps themselves are ordinary <webview> guests
// created by the chrome renderer, so they go through the same hardening in
// guest.ts (will-attach-webview, popup routing, permissions) as normal tabs.
import { webContents } from 'electron'
import { handle, broadcast } from '../../ipc'
import { createLogger } from '../../logger'
import { activeProfileId } from '../../services/profiles'
import { registerDiagnostic } from '../../services/diagnostics'
import { catalogSize, deleteApp, iconCache, listApps, registerWebappMigrations, reorderApps, saveApp } from './store'

const log = createLogger('webapps')

export function register(): void {
  registerWebappMigrations()

  const changed = () => broadcast('webapps:changed', { profileId: activeProfileId() })

  handle('webapps:list', () => listApps(activeProfileId()))
  handle('webapps:save', (_e, input) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid app')
    const isNew = !input.id
    const app = saveApp(activeProfileId(), input)
    if (isNew) log.info('web app added', { name: app.name })
    changed()
    return app
  })
  handle('webapps:delete', (_e, id) => {
    if (typeof id !== 'string') return
    deleteApp(activeProfileId(), id)
    changed()
  })
  handle('webapps:reorder', (_e, ids) => {
    reorderApps(activeProfileId(), ids)
    changed()
  })
  handle('webapps:icons', () => iconCache())

  // A hidden sidebar app must never block closing SPECTER with a "Leave site?"
  // beforeunload (Discord registers one). Only guests embedded by the calling
  // chrome window can be marked.
  const marked = new WeakSet<Electron.WebContents>()
  handle('webapps:guest', (e, wcId) => {
    const wc = typeof wcId === 'number' ? webContents.fromId(wcId) : undefined
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.hostWebContents?.id !== e.sender.id || marked.has(wc)) return
    marked.add(wc)
    wc.on('will-prevent-unload', (ev) => ev.preventDefault())
  })

  registerDiagnostic(() => {
    try {
      const n = listApps(activeProfileId()).length
      return { id: 'webapps', label: 'Sidebar web apps', status: 'ok', detail: `${n} app${n === 1 ? '' : 's'} in this profile · catalog of ${catalogSize()}` }
    } catch (err) {
      return { id: 'webapps', label: 'Sidebar web apps', status: 'error', detail: err instanceof Error ? err.message : String(err) }
    }
  })
}
