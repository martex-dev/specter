// SPECTER main process entry.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray, crashReporter } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDatabase, closeDatabase, isDbOpen } from './db'
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
import { attachPrivacy, registerPrivacyIpc } from './services/privacy'
import { attachAdblock, initAdblock, registerAdblockIpc } from './services/adblock'
import { runShutdownCleanup } from './shutdown'
import { activeSession, ensureDefaultProfile, onProfileSwitch, registerProfilesIpc } from './services/profiles'
import { ensureDefaultWorkspaces, registerWorkspacesIpc } from './services/workspaces'
import { attachCertificateCapture, registerPageIpc } from './services/page'
import { attachVideoTools, registerVideoIpc } from './services/video'
import { registerFontInspectorIpc } from './services/fonts'
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
let dbError: unknown = null
function openStore(): void {
  openDatabase(join(app.getPath('userData'), 'specter.db'))
  loadSettings()
}
try {
  try {
    openStore()
  } catch (err) {
    closeDatabase()
    if (!/not a database|malformed|corrupt/i.test(String((err as Error)?.message ?? err))) throw err
    // A corrupt file would otherwise keep SPECTER from ever starting: set it aside (not deleted) and start fresh.
    const file = join(app.getPath('userData'), 'specter.db')
    const aside = `${file}.corrupt-${Date.now()}`
    log.error(`database is corrupt; moving it to ${aside}`, err)
    for (const ext of ['', '-wal', '-shm']) if (existsSync(file + ext)) renameSync(file + ext, aside + ext)
    openStore()
  }
  if (!getSetting('browser.hardwareAcceleration')) app.disableHardwareAcceleration()
  if (!getSetting('browser.smoothScrolling')) app.commandLine.appendSwitch('disable-smooth-scrolling')
} catch (err) {
  dbError = err
  log.error('failed to open database', err)
}

app.commandLine.appendSwitch('enable-features', 'CSSCustomHighlightAPI')

/** Web URLs and local files (file associations, "Open with", drag onto the exe) from the command line. */
function urlsFromArgv(argv: string[]): string[] {
  const out: string[] = []
  for (const a of argv.slice(1)) {
    if (/^(https?:\/\/|file:\/\/)/i.test(a)) out.push(a)
    // Drive or UNC path → file:// URL (a raw "C:\…" path is not loadable in a tab; spaces, "#" and non-ASCII need encoding).
    else if (/^([a-zA-Z]:\\|\\\\[^\\]+\\).+\.(html?|xhtml|pdf|svg|txt|json|png|jpe?g|gif|webp)$/i.test(a)) out.push(pathToFileURL(a).href)
  }
  return out
}

let startupDone: Promise<unknown> | null = null
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // A second launch during startup (double-clicking the icon twice) must wait for the
  // startup windows: before 'ready' creating a window throws, and before openStartupWindows
  // it would open an extra window on top of the restored session.
  app.on('second-instance', (_e, argv) => void (startupDone ?? app.whenReady()).then(() => onSecondInstance(argv), () => undefined))
}

function onSecondInstance(argv: string[]): void {
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
}

function attachSessionHandlers(): void {
  const ses = activeSession()
  attachPermissions(ses)
  attachPrivacy(ses)
  attachAdblock(ses)
  attachVideoTools(ses)
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
  registerAdblockIpc()
  registerVideoIpc()
  registerProfilesIpc()
  registerWorkspacesIpc()
  registerPageIpc()
  registerFontInspectorIpc()
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

/** Startup failed before any window opened: say so and exit instead of lingering invisibly (holding the single-instance lock). */
function fatalStartup(err: unknown): void {
  log.error('startup failed', err)
  if (BrowserWindow.getAllWindows().length) return
  const detail = String((err as Error)?.message ?? err)
  dialog.showErrorBox('SPECTER could not start', `${detail}\n\nProfile folder: ${app.getPath('userData')}`)
  app.exit(1)
}

startupDone = app.whenReady().then(async () => {
  if (dbError) return fatalStartup(dbError)
  const t0 = performance.now()
  // Present as plain Chrome: some sites (e.g. Google sign-in) refuse user agents that mention Electron.
  app.userAgentFallback = desktopUserAgent(app.userAgentFallback)
  Menu.setApplicationMenu(null)
  installGuestHardening()
  registerIpc()
  registerModules()
  initAdblock()
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
}).catch(fatalStartup)

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
  // Idempotent: when "Restart to update" already ran it (before spawning the installer) this resolves at once.
  runShutdownCleanup().finally(() => app.quit())
})

app.on('will-quit', () => {
  closeDatabase()
  // Some pages (seen with Discord in a sidebar panel) keep the process alive
  // after every window closed. Everything is flushed by now, so force exit.
  setTimeout(() => app.exit(0), 3000).unref()
})

process.on('uncaughtException', (err) => log.error('uncaught exception', err))
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err))
