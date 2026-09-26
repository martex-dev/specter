// Window management: browser windows, pop-out tool panels, window sessions
// (which workspaces each window shows) and startup restoration.
import { app, BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import type { InitialSession } from '@shared/ipc'
import { all, get, json, metaGet, metaSet, run } from './db'
import { broadcast, handle, sendTo, trustWebContents, untrustWebContents } from './ipc'
import { createLogger } from './logger'
import { getSetting } from './services/settings'
import { activeProfile, activeProfileId } from './services/profiles'
import { createWorkspace, emptyState, getWorkspace, listWorkspaces, saveWorkspaceState, snapshotWorkspace } from './services/workspaces'

const log = createLogger('windows')

interface WindowCtx {
  win: BrowserWindow
  rowId: number | null
  openWorkspaceIds: string[]
  activeWorkspaceId: string
  initialUrls: string[]
  restorePrompt?: InitialSession['restorePrompt']
  popoutPanel?: string
  focusedGuest: { wcId: number; url: string; title: string } | null
}

const contexts = new Map<number, WindowCtx>() // keyed by chrome webContents id
let pendingRestore: { windows: SessionRow[]; snapshots: Map<string, string>; crashed: boolean } | null = null
let quitting = false
let lastFocusedChromeId: number | null = null

type SessionRow = { id: number; profile_id: string; open_workspaces: string; active_workspace: string; bounds: string | null; maximized: number; updated_at: number }

export function setQuitting(v: boolean): void {
  quitting = v
}

export function isQuitting(): boolean {
  return quitting
}

export function chromeContexts(): WindowCtx[] {
  return [...contexts.values()]
}

export function ctxForSender(senderId: number): WindowCtx | undefined {
  return contexts.get(senderId)
}

export function lastFocusedCtx(): WindowCtx | undefined {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) {
    const c = contexts.get(focused.webContents.id)
    if (c && !c.popoutPanel) return c
  }
  if (lastFocusedChromeId !== null) {
    const c = contexts.get(lastFocusedChromeId)
    if (c) return c
  }
  return [...contexts.values()].find((c) => !c.popoutPanel)
}

function rendererUrl(hash = ''): { url?: string; file?: string; hash: string } {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) return { url: process.env['ELECTRON_RENDERER_URL'] + (hash ? '#' + hash : ''), hash }
  return { file: join(__dirname, '../renderer/index.html'), hash }
}

export function themeColors(): { bg: string; fg: string } {
  // Pre-paint colour before the UI applies the full theme (avoids a flash).
  const theme = String(getSetting('appearance.theme'))
  if (theme === 'paper' || theme === 'light' || theme === 'minimal') return { bg: '#efe9dd', fg: '#1d1a14' }
  if (theme === 'brutal') return { bg: '#e8e4da', fg: '#000000' }
  if (theme === 'retro') return { bg: '#1084d0', fg: '#ffffff' }
  if (theme === 'holo') return { bg: '#eceef7', fg: '#15142b' }
  const map: Record<string, string> = { specter: '#0c0d10', neon: '#070709', aurora: '#070b17', terminal: '#020402', synthwave: '#12041f', blueprint: '#0b2a4a', glitch: '#050505' }
  return { bg: map[theme] ?? '#0c0d10', fg: '#c9ccd4' }
}

export const TITLEBAR_HEIGHT = 40

function defaultBounds(): Electron.Rectangle {
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(1600, Math.round(area.width * 0.86))
  const height = Math.min(1000, Math.round(area.height * 0.88))
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height }
}

function boundsVisible(b: Electron.Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 20 && b.y < a.y + a.height - 100
  })
}

export function createBrowserWindow(opts: {
  workspaceIds?: string[]
  activeWorkspaceId?: string
  urls?: string[]
  bounds?: Electron.Rectangle | null
  maximized?: boolean
  restorePrompt?: InitialSession['restorePrompt']
  reuseRowId?: number
}): BrowserWindow {
  const workspaces = listWorkspaces()
  const alreadyOpen = new Set(chromeContexts().flatMap((c) => c.openWorkspaceIds))
  let wsIds = (opts.workspaceIds ?? []).filter((id) => workspaces.some((w) => w.id === id))
  if (!wsIds.length) {
    // A workspace belongs to one window. When every workspace is already shown (e.g. only one
    // exists), give the new window its own instead of sharing: two windows saving the same
    // workspace overwrite each other's tabs.
    let free = workspaces.find((w) => !alreadyOpen.has(w.id))
    if (!free) {
      free = createWorkspace({ name: `Workspace ${workspaces.length + 1}` })
      broadcast('workspaces:changed', { id: free.id })
    }
    wsIds = [free.id]
  }
  const active = opts.activeWorkspaceId && wsIds.includes(opts.activeWorkspaceId) ? opts.activeWorkspaceId : wsIds[0]

  let bounds = opts.bounds && boundsVisible(opts.bounds) ? opts.bounds : defaultBounds()
  if (!opts.bounds && contexts.size) {
    const last = lastFocusedCtx()?.win.getBounds()
    if (last) bounds = { ...last, x: last.x + 28, y: last.y + 28 }
  }
  const colors = themeColors()
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 560,
    minHeight: 380,
    show: false,
    title: 'SPECTER',
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: TITLEBAR_HEIGHT },
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  const wcId = win.webContents.id
  trustWebContents(wcId)
  // The last closed window's row is kept for restore. If SPECTER kept running (tray /
  // run in background) and a new window opens, that row is stale: it would be restored
  // next launch as an extra window showing the same workspace.
  if (!opts.reuseRowId && !chromeContexts().some((c) => !c.popoutPanel)) run('DELETE FROM window_sessions WHERE profile_id = ?', activeProfileId())
  const ctx: WindowCtx = {
    win,
    rowId: null,
    openWorkspaceIds: wsIds,
    activeWorkspaceId: active,
    initialUrls: opts.urls ?? [],
    restorePrompt: opts.restorePrompt,
    focusedGuest: null
  }
  contexts.set(wcId, ctx)

  if (opts.reuseRowId) ctx.rowId = opts.reuseRowId
  else {
    ctx.rowId = run(
      'INSERT INTO window_sessions(profile_id, open_workspaces, active_workspace, bounds, maximized, updated_at) VALUES(?,?,?,?,?,?)',
      activeProfileId(),
      JSON.stringify(wsIds),
      active,
      JSON.stringify(bounds),
      opts.maximized ? 1 : 0,
      Date.now()
    ).lastInsertRowid
  }

  hardenChrome(win)
  wireWindowEvents(win, ctx)

  const target = rendererUrl()
  if (target.url) win.loadURL(target.url)
  else win.loadFile(target.file!)

  win.once('ready-to-show', () => {
    if (opts.maximized) win.maximize()
    win.show()
  })
  return win
}

export function createPopoutWindow(panel: string, alwaysOnTop?: boolean): BrowserWindow {
  const existing = chromeContexts().find((c) => c.popoutPanel === panel)
  if (existing) {
    if (alwaysOnTop !== undefined) existing.win.setAlwaysOnTop(alwaysOnTop, 'floating')
    else existing.win.focus()
    return existing.win
  }
  const colors = themeColors()
  const parentBounds = lastFocusedCtx()?.win.getBounds() ?? defaultBounds()
  const win = new BrowserWindow({
    width: 440,
    height: 640,
    x: parentBounds.x + parentBounds.width - 470,
    y: parentBounds.y + 90,
    minWidth: 280,
    minHeight: 200,
    show: false,
    alwaysOnTop: !!alwaysOnTop,
    title: 'SPECTER — ' + panel,
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: 32 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  })
  trustWebContents(win.webContents.id)
  contexts.set(win.webContents.id, {
    win,
    rowId: null,
    openWorkspaceIds: [],
    activeWorkspaceId: '',
    initialUrls: [],
    popoutPanel: panel,
    focusedGuest: null
  })
  hardenChrome(win)
  const id = win.webContents.id
  win.on('closed', () => {
    contexts.delete(id)
    untrustWebContents(id)
  })
  const target = rendererUrl('panel=' + encodeURIComponent(panel))
  if (target.url) win.loadURL(target.url)
  else win.loadFile(target.file!, { hash: target.hash })
  win.once('ready-to-show', () => win.show())
  return win
}

/** The chrome renderer must never navigate or open windows itself. */
function hardenChrome(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\u0000')) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('before-input-event', (_e, input) => {
    // Chrome devtools for debugging SPECTER itself.
    if (input.type === 'keyDown' && input.control && input.shift && input.alt && input.key.toLowerCase() === 'i') win.webContents.openDevTools({ mode: 'detach' })
  })
}

function wireWindowEvents(win: BrowserWindow, ctx: WindowCtx): void {
  const wcId = win.webContents.id
  let boundsTimer: NodeJS.Timeout | null = null
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || !ctx.rowId) return
      const b = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
      run('UPDATE window_sessions SET bounds = ?, maximized = ?, updated_at = ? WHERE id = ?', JSON.stringify(b), win.isMaximized() ? 1 : 0, Date.now(), ctx.rowId)
    }, 500)
  }
  win.on('move', saveBounds)
  win.on('resize', saveBounds)
  const pushState = () => {
    if (!win.isDestroyed()) sendTo(wcId, 'window:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() })
  }
  win.on('maximize', () => (pushState(), saveBounds()))
  win.on('unmaximize', () => (pushState(), saveBounds()))
  win.on('enter-full-screen', pushState)
  win.on('leave-full-screen', pushState)
  win.on('focus', () => {
    lastFocusedChromeId = wcId
    pushState()
  })
  win.on('blur', pushState)
  // Mouse back/forward buttons on Windows.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') sendTo(wcId, 'command:run', { id: 'browser.back' })
    if (cmd === 'browser-forward') sendTo(wcId, 'command:run', { id: 'browser.forward' })
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('chrome renderer gone', details)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) setTimeout(() => !win.isDestroyed() && win.webContents.reload(), 500)
  })
  win.on('close', () => {
    const chromeWindows = chromeContexts().filter((c) => !c.popoutPanel)
    // Closing one of several windows forgets that window; the last window is kept for restore.
    if (!quitting && chromeWindows.length > 1 && ctx.rowId) run('DELETE FROM window_sessions WHERE id = ?', ctx.rowId)
  })
  win.on('closed', () => {
    contexts.delete(wcId)
    untrustWebContents(wcId)
    if (lastFocusedChromeId === wcId) lastFocusedChromeId = null
  })
}

/** Decides what to open at startup and opens the windows. */
export function openStartupWindows(cliUrls: string[]): void {
  const crashed = metaGet('session:cleanExit') === '0'
  metaSet('session:cleanExit', '0')
  const rows = all<SessionRow>('SELECT * FROM window_sessions WHERE profile_id = ? ORDER BY id', activeProfileId())
  const startup = getSetting('general.startup')
  run('DELETE FROM window_sessions WHERE profile_id = ?', activeProfileId())
  const tabTotal = (ids: string[]) => ids.reduce((n, id) => n + (getWorkspace(id)?.state.tabs.filter((t) => t.url !== 'specter://newtab').length ?? 0), 0)
  const hadContent = rows.some((r) => tabTotal(json<string[]>(r.open_workspaces, [])) > 0)

  if (rows.length && (startup === 'restore' || crashed)) {
    log.info(`restoring ${rows.length} window(s)${crashed ? ' after unclean exit' : ''}`)
    rows.forEach((r, i) =>
      createBrowserWindow({
        workspaceIds: json<string[]>(r.open_workspaces, []),
        activeWorkspaceId: r.active_workspace,
        bounds: json<Electron.Rectangle | null>(r.bounds, null),
        maximized: !!r.maximized,
        urls: i === 0 ? cliUrls : [],
        restorePrompt: crashed && i === 0 ? { workspaceCount: 0, tabCount: 0, crashed: true } : undefined
      })
    )
    return
  }

  if (startup === 'workspace') {
    const wsId = getSetting('general.startupWorkspace')
    const first = rows[0]
    createBrowserWindow({ workspaceIds: wsId ? [wsId] : [], bounds: first ? json(first.bounds, null) : null, maximized: !!first?.maximized, urls: cliUrls })
    return
  }

  // 'newtab' / 'nothing': snapshot what was open so it can be restored, then start clean.
  const first = rows[0]
  const openIds = [...new Set(rows.flatMap((r) => json<string[]>(r.open_workspaces, [])))]
  const snapshots = new Map<string, string>()
  for (const id of openIds) {
    const ws = getWorkspace(id)
    if (!ws || !ws.state.tabs.some((t) => t.url !== 'specter://newtab')) continue
    const snap = snapshotWorkspace(id, 'Session before restart · ' + new Date().toLocaleString())
    if (snap) snapshots.set(id, snap.id)
  }
  const startWs = first?.active_workspace && getWorkspace(first.active_workspace) ? first.active_workspace : listWorkspaces()[0].id
  if (snapshots.size) saveWorkspaceState(startWs, emptyState())
  pendingRestore = hadContent && startup === 'newtab' ? { windows: rows, snapshots, crashed: false } : null
  createBrowserWindow({
    workspaceIds: [startWs],
    bounds: first ? json(first.bounds, null) : null,
    maximized: !!first?.maximized,
    urls: cliUrls,
    restorePrompt: pendingRestore ? { workspaceCount: snapshots.size, tabCount: tabTotal(openIds), crashed: false } : undefined
  })
}

function initialFor(ctx: WindowCtx): InitialSession {
  return {
    windowId: ctx.win.id,
    profile: activeProfile(),
    workspaces: listWorkspaces(),
    openWorkspaceIds: ctx.openWorkspaceIds,
    activeWorkspaceId: ctx.activeWorkspaceId,
    restorePrompt: ctx.restorePrompt,
    initialUrls: ctx.initialUrls,
    isPopoutPanel: ctx.popoutPanel
  }
}

export function registerWindowIpc(): void {
  handle('session:initial', (e) => {
    const ctx = contexts.get(e.sender.id)
    if (!ctx) throw new Error('Unknown window')
    const init = initialFor(ctx)
    ctx.initialUrls = [] // only once (renderer reloads must not duplicate tabs)
    return init
  })
  handle('session:update', (e, s) => {
    const ctx = contexts.get(e.sender.id)
    if (!ctx) return
    ctx.openWorkspaceIds = s.openWorkspaceIds
    ctx.activeWorkspaceId = s.activeWorkspaceId
    if (ctx.rowId) run('UPDATE window_sessions SET open_workspaces = ?, active_workspace = ?, updated_at = ? WHERE id = ?', JSON.stringify(s.openWorkspaceIds), s.activeWorkspaceId, Date.now(), ctx.rowId)
  })
  handle('session:restoreChoice', (e, choice) => {
    const ctx = contexts.get(e.sender.id)
    if (!ctx) throw new Error('Unknown window')
    // Already answered (e.g. a double click on "Restore everything"): a second pass would re-open
    // the other windows again and make the renderer rebuild its tabs. Rejecting leaves the UI as is.
    if (!pendingRestore && choice !== 'clean') throw new Error('The previous session was already restored')
    ctx.restorePrompt = undefined
    const pr = pendingRestore
    pendingRestore = null
    if (pr && choice !== 'clean') {
      const restoreIds = choice === 'all' ? [...pr.snapshots.keys()] : [choice.workspaceId]
      for (const id of restoreIds) {
        const snapId = pr.snapshots.get(id)
        const snap = snapId ? get<{ state: string }>('SELECT state FROM workspace_snapshots WHERE id = ?', snapId) : undefined
        if (snap) saveWorkspaceState(id, json(snap.state, emptyState()))
      }
      if (choice === 'all') {
        const firstRow = pr.windows[0]
        ctx.openWorkspaceIds = json<string[]>(firstRow?.open_workspaces, ctx.openWorkspaceIds)
        ctx.activeWorkspaceId = firstRow?.active_workspace ?? ctx.activeWorkspaceId
        pr.windows.slice(1).forEach((r) =>
          createBrowserWindow({ workspaceIds: json(r.open_workspaces, []), activeWorkspaceId: r.active_workspace, bounds: json(r.bounds, null), maximized: !!r.maximized })
        )
      } else {
        ctx.openWorkspaceIds = [choice.workspaceId]
        ctx.activeWorkspaceId = choice.workspaceId
      }
    }
    return initialFor(ctx)
  })

  handle('window:new', (_e, req) => {
    if (req.panel) return createPopoutWindow(req.panel).id
    if (req.workspaceId) {
      const owner = chromeContexts().find((c) => c.openWorkspaceIds.includes(req.workspaceId!))
      if (owner) {
        owner.win.focus()
        if (req.url) sendTo(owner.win.webContents.id, 'command:run', { id: 'browser.openUrl', args: { url: req.url, workspaceId: req.workspaceId } })
        return owner.win.id
      }
    }
    return createBrowserWindow({ workspaceIds: req.workspaceId ? [req.workspaceId] : [], urls: req.url ? [req.url] : [] }).id
  })
  handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  handle('window:toggleMaximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  handle('window:toggleFullscreen', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w) w.setFullScreen(!w.isFullScreen())
  })
  handle('window:setTitleBarOverlay', (e, o) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    try {
      w?.setTitleBarOverlay(o)
      w?.setBackgroundColor(o.color)
    } catch {
      /* not supported on this platform */
    }
    nativeTheme.themeSource = /^#(f|e)/i.test(o.color) ? 'light' : 'dark'
  })
  handle('window:popout', (_e, panel, o) => {
    createPopoutWindow(panel, o?.alwaysOnTop)
  })
  handle('window:list', (e) =>
    chromeContexts()
      .filter((c) => !c.popoutPanel)
      .map((c) => ({ id: c.win.id, title: c.win.getTitle(), focused: c.win.webContents.id === e.sender.id }))
  )
  handle('window:ownerOf', (_e, wsId) => chromeContexts().find((c) => c.openWorkspaceIds.includes(wsId))?.win.id ?? null)
  handle('window:focus', (_e, id) => {
    const w = BrowserWindow.fromId(id)
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })
  handle('window:mergeInto', async (e) => {
    const target = contexts.get(e.sender.id)
    if (!target || target.popoutPanel) return 0
    const others = chromeContexts().filter((c) => c !== target && !c.popoutPanel)
    // Ask the other windows to persist their state, then adopt their workspaces.
    for (const c of others) sendTo(c.win.webContents.id, 'command:run', { id: 'internal.flush' })
    await new Promise((r) => setTimeout(r, 200))
    const ids = [...new Set(others.flatMap((c) => c.openWorkspaceIds))].filter((id) => !target.openWorkspaceIds.includes(id))
    for (const c of others) {
      if (c.rowId) run('DELETE FROM window_sessions WHERE id = ?', c.rowId)
      c.rowId = null
      c.openWorkspaceIds = []
      c.win.destroy()
    }
    sendTo(target.win.webContents.id, 'command:run', { id: 'internal.openWorkspaces', args: { ids } })
    return others.length
  })
  handle('window:setTitle', (e, title) => BrowserWindow.fromWebContents(e.sender)?.setTitle(title ? `${title} — SPECTER` : 'SPECTER'))
}
