// SPECTER main process entry.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, crashReporter } from 'electron'
import { join } from 'node:path'
import { openDatabase, closeDatabase, metaSet, isDbOpen } from './db'
import { createLogger, initLogFile } from './logger'
import { bus, BUS_EVENT_NAMES, type BusEventName } from './bus'
import { broadcastRaw, handleRaw } from './ipc'
import { installGuestHardening } from './guest'
import { createBrowserWindow, chromeContexts, lastFocusedCtx, openStartupWindows, registerWindowIpc, setQuitting } from './windows'
import { getSetting, loadSettings, registerSettingsIpc, setSetting } from './services/settings'
import { registerHistoryIpc } from './services/history'
import { ensureBookmarkRoots, registerBookmarksIpc } from './services/bookmarks'
import { attachDownloads, registerDownloadsIpc } from './services/downloads'
import { attachPermissions, registerPermissionsIpc } from './services/permissions'
import { attachPrivacy, clearOnExitIfEnabled, registerPrivacyIpc } from './services/privacy'
import { activeSession, ensureDefaultProfile, onProfileSwitch, registerProfilesIpc } from './services/profiles'
import { ensureDefaultWorkspaces, registerWorkspacesIpc } from './services/workspaces'
import { attachCertificateCapture, registerPageIpc } from './services/page'
import { registerAppIpc, loadStoredExtensions } from './services/app'
import { registerSearchIpc } from './services/search'
import { registerImportIpc } from './services/importer'
import { registerNotificationsIpc } from './services/notifications'
import { registerDiagnosticsIpc } from './services/diagnostics'
import { registerUpdatesIpc } from './services/updates'
import { registerModules } from './modules'
import { desktopUserAgent } from '@shared/modules/webapps'

// Allow tests / portable installs to isolate the profile directory.
if (process.env.SPECTER_USER_DATA) app.setPath('userData', process.env.SPECTER_USER_DATA)
app.setName('SPECTER')
if (process.platform === 'win32') app.setAppUserModelId('com.specter.browser')

initLogFile(join(app.getPath('userData'), 'logs'))
const log = createLogger('main')
crashReporter.start({ uploadToServer: false })

// Database must be available before 'ready' so hardware-acceleration settings apply.
try {
  openDatabase(join(app.getPath('userData'), 'specter.db'))
  loadSettings()
  if (!getSetting('browser.hardwareAcceleration')) app.disableHardwareAcceleration()
  if (!getSetting('browser.smoothScrolling')) app.commandLine.appendSwitch('disable-smooth-scrolling')
} catch (err) {
  log.error('failed to open database', err)
}

app.commandLine.appendSwitch('enable-features', 'CSSCustomHighlightAPI')

function urlsFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => /^(https?:\/\/|file:\/\/)/i.test(a) || /^[a-zA-Z]:\\.+\.(html?|pdf|svg|txt|json|png|jpe?g|gif|webp)$/i.test(a))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const urls = urlsFromArgv(argv)
    const ctx = lastFocusedCtx()
    if (ctx && urls.length) {
      for (const url of urls) ctx.win.webContents.send('evt:command:run', { id: 'browser.openUrl', args: { url } })
      if (ctx.win.isMinimized()) ctx.win.restore()
      ctx.win.focus()
    } else if (ctx) {
      if (ctx.win.isMinimized()) ctx.win.restore()
      ctx.win.focus()
    } else createBrowserWindow({ urls })
  })
}

function attachSessionHandlers(): void {
  const ses = activeSession()
  attachPermissions(ses)
  attachPrivacy(ses)
  attachDownloads(ses)
  attachCertificateCapture(ses)
  ses.setSpellCheckerLanguages(['en-US'])
}

function registerIpc(): void {
  registerAppIpc()
  registerWindowIpc()
  registerSettingsIpc()
  registerHistoryIpc()
  registerBookmarksIpc()
  registerDownloadsIpc()
  registerPermissionsIpc()
  registerPrivacyIpc()
  registerProfilesIpc()
  registerWorkspacesIpc()
  registerPageIpc()
  registerSearchIpc()
  registerImportIpc()
  registerNotificationsIpc()
  registerDiagnosticsIpc()
  registerUpdatesIpc()

  // Event bus bridge (renderer → main → all windows).
  handleRaw('bus:emit', (_e, name: BusEventName, payload: unknown) => {
    if (BUS_EVENT_NAMES.includes(name)) bus.emit(name, payload as never)
  })
  handleRaw('bus:recent', () => bus.recent())
  bus.onAny((name, payload) => broadcastRaw('bus:event', { name, payload, ts: Date.now() }))

  // Synchronous-ish flush used by renderers during unload.
  ipcMain.on('flush:workspace', (e, id: string, state: unknown) => {
    const ctx = chromeContexts().find((c) => c.win.webContents.id === e.sender.id)
    if (!ctx || !isDbOpen()) return
    import('./services/workspaces').then((m) => m.saveWorkspaceState(id, state as never)).catch(() => undefined)
  })
}

let tray: Tray | null = null
function updateTray(): void {
  const want = getSetting('advanced.tray') || getSetting('general.runInBackground')
  if (want && !tray) {
    const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')).resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.setToolTip('SPECTER')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'New window', click: () => createBrowserWindow({}) },
        { type: 'separator' },
        { label: 'Quit SPECTER', click: () => app.quit() }
      ])
    )
    tray.on('click', () => {
      const ctx = lastFocusedCtx()
      if (ctx) ctx.win.show(), ctx.win.focus()
      else createBrowserWindow({})
    })
  } else if (!want && tray) {
    tray.destroy()
    tray = null
  }
}

async function bootstrapProfile(): Promise<void> {
  ensureDefaultProfile()
  ensureDefaultWorkspaces()
  ensureBookmarkRoots()
  attachSessionHandlers()
  await loadStoredExtensions()
}

app.whenReady().then(async () => {
  const t0 = performance.now()
  // Present as plain Chrome: some sites (e.g. Google sign-in) refuse user agents that mention Electron.
  app.userAgentFallback = desktopUserAgent(app.userAgentFallback)
  Menu.setApplicationMenu(null)
  installGuestHardening()
  registerIpc()
  registerModules()
  await bootstrapProfile()

  onProfileSwitch(async (profileId) => {
    log.info('switching profile', { profileId })
    setQuitting(true)
    for (const c of chromeContexts()) c.win.destroy()
    setQuitting(false)
    setSetting('general.activeProfile', profileId)
    await bootstrapProfile()
    openStartupWindows([])
  })

  openStartupWindows(urlsFromArgv(process.argv))
  updateTray()
  bus.emit('APP_STARTED', {})
  log.info(`startup complete in ${Math.round(performance.now() - t0)} ms`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBrowserWindow({})
  })
})

import('./services/settings').then(({ onSettingChanged }) =>
  onSettingChanged((key) => {
    if (key === 'advanced.tray' || key === 'general.runInBackground') updateTray()
  })
)

app.on('window-all-closed', () => {
  if (getSetting('general.runInBackground') && tray) return
  app.quit()
})

let cleaned = false
app.on('before-quit', (e) => {
  setQuitting(true)
  if (cleaned) return
  e.preventDefault()
  cleaned = true
  ;(async () => {
    try {
      // Give renderers a moment to flush workspace state.
      for (const c of chromeContexts()) if (!c.win.isDestroyed()) c.win.webContents.send('evt:command:run', { id: 'internal.flush' })
      await new Promise((r) => setTimeout(r, 150))
      await clearOnExitIfEnabled()
      metaSet('session:cleanExit', '1')
    } catch (err) {
      log.error('shutdown cleanup failed', err)
    }
    app.quit()
  })()
})

app.on('will-quit', () => {
  closeDatabase()
  // Some pages (seen with Discord in a sidebar panel) keep the process alive
  // after every window closed. Everything is flushed by now, so force exit.
  setTimeout(() => app.exit(0), 3000).unref()
})

process.on('uncaughtException', (err) => log.error('uncaught exception', err))
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err))
