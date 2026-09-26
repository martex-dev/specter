// Application-level IPC: info, shell helpers, clipboard, dialogs, metrics,
// logs, extensions.
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, session, shell, webContents } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { handle, windowOf } from '../ipc'
import { clearLogs, logEntries, rawLog } from '../logger'
import type { AppMetricsEntry } from '@shared/types'
import { IPC_DOMAINS } from '@shared/ipc'
import { activeSession } from './profiles'
import { installUpdate, isUpdateReady } from './updates'
import { all, run } from '../db'
import { registerMigrations } from '../db'
import { createLogger } from '../logger'

const log = createLogger('app')

registerMigrations('extensions', [`CREATE TABLE extensions (path TEXT PRIMARY KEY, added_at INTEGER NOT NULL);`])

export async function writeImageToClipboard(png: Buffer): Promise<void> {
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
}

export function metricsSnapshot(): AppMetricsEntry[] {
  const byPid = new Map<number, { wcId: number; url: string; title: string; type: string }[]>()
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue
    try {
      const pid = wc.getOSProcessId()
      const list = byPid.get(pid) ?? []
      list.push({ wcId: wc.id, url: wc.getURL(), title: wc.getTitle(), type: wc.getType() })
      byPid.set(pid, list)
    } catch {
      /* process not ready */
    }
  }
  return app.getAppMetrics().map((m) => {
    const owners = byPid.get(m.pid)
    const first = owners?.[0]
    return {
      pid: m.pid,
      type: m.type,
      name: m.name ?? m.serviceName,
      cpu: m.cpu.percentCPUUsage,
      memoryKB: m.memory.privateBytes ?? m.memory.workingSetSize,
      webContentsId: first?.wcId,
      url: first?.type === 'webview' ? first.url : first ? 'SPECTER interface' : undefined,
      title: owners && owners.length > 1 ? `${first?.title} (+${owners.length - 1} more)` : first?.title
    }
  })
}

export async function loadStoredExtensions(): Promise<void> {
  for (const r of all<{ path: string }>('SELECT path FROM extensions')) {
    if (!existsSync(r.path)) continue
    try {
      await activeSession().extensions.loadExtension(r.path, { allowFileAccess: false })
    } catch (err) {
      log.warn('failed to load extension ' + r.path, err)
    }
  }
}

export function registerAppIpc(): void {
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    isPackaged: app.isPackaged,
    gpuEnabled: app.isHardwareAccelerationEnabled()
  }))
  handle('app:quit', () => app.quit())
  handle('app:relaunch', () => {
    // A downloaded update installs on restart; the installer relaunches SPECTER itself
    // (app.relaunch() here would start the old build just before the installer replaces it).
    if (isUpdateReady()) return installUpdate()
    app.relaunch()
    app.quit()
  })
  handle('app:openExternal', (_e, url) => {
    if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url)
  })
  handle('app:showItemInFolder', (_e, path) => {
    if (existsSync(path)) shell.showItemInFolder(path)
  })
  handle('app:openPath', (_e, path) => shell.openPath(path))
  handle('app:clipboardWrite', (_e, text) => clipboard.writeText(text))
  handle('app:clipboardWriteImage', (_e, dataUrl) => writeImageToClipboard(nativeImage.createFromDataURL(dataUrl).toPNG()))
  handle('app:clipboardRead', () => clipboard.readText())
  handle('app:pickFolder', async (e, title) => {
    const win = windowOf(e)
    const opts = { title: title ?? 'Select folder', properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle('app:pickFile', async (e, filters) => {
    const win = windowOf(e)
    const opts = { properties: ['openFile' as const], filters }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle('app:readTextFile', (_e, path) => {
    const st = statSync(path)
    if (st.size > 20 * 1024 * 1024) throw new Error('File is larger than 20 MB')
    return readFileSync(path, 'utf8')
  })
  handle('app:saveFile', async (e, defaultName, content) => {
    const win = windowOf(e) ?? BrowserWindow.getFocusedWindow()
    const opts = { defaultPath: defaultName }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, content)
    return r.filePath
  })
  handle('app:gpuInfo', () => app.getGPUInfo('basic'))
  handle('app:setDefaultBrowser', async () => {
    // Registers the protocol handlers; Windows 10/11 then requires the user to confirm in Default Apps.
    app.setAsDefaultProtocolClient('http')
    app.setAsDefaultProtocolClient('https')
    await shell.openExternal('ms-settings:defaultapps')
  })

  handle('metrics:app', () => metricsSnapshot())
  handle('app:securityState', async () => {
    // Behavioural probes: ask each page whether Node.js or SPECTER's bridge is reachable.
    const probe = async (wc: Electron.WebContents): Promise<{ node: boolean; bridge: boolean } | null> => {
      try {
        return await Promise.race([
          wc.executeJavaScript(`({ node: typeof require !== 'undefined' || typeof process !== 'undefined', bridge: typeof window.specter !== 'undefined' })`),
          new Promise<null>((r) => setTimeout(() => r(null), 800))
        ])
      } catch {
        return null
      }
    }
    const chrome: { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean; webSecurity: boolean }[] = []
    const guests = { count: 0, sandboxed: 0, isolated: 0, nodeIntegration: 0, webSecurityOff: 0 }
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue
      if (wc.getType() === 'webview') {
        const r = await probe(wc)
        if (!r) continue
        guests.count++
        if (!r.node) guests.sandboxed++
        else guests.nodeIntegration++
        if (!r.bridge) guests.isolated++
      } else if (wc.getType() === 'window') {
        const r = await probe(wc)
        if (!r) continue
        // Interface windows are created with sandbox + contextIsolation; the probe verifies no Node.js leaks in.
        chrome.push({ sandbox: !r.node, contextIsolation: true, nodeIntegration: r.node, webSecurity: true })
      }
    }
    const exts = activeSession().extensions.getAllExtensions()
    const perms = all<{ decision: string; c: number }>('SELECT decision, COUNT(*) AS c FROM permissions GROUP BY decision')
    return {
      chrome,
      guests,
      extensions: { count: exts.length, names: exts.map((e) => e.name) },
      sitePermissions: { allow: perms.find((p) => p.decision === 'allow')?.c ?? 0, deny: perms.find((p) => p.decision === 'deny')?.c ?? 0 },
      ipcDomains: IPC_DOMAINS.length,
      electron: process.versions.electron,
      chromium: process.versions.chrome
    }
  })
  handle('logs:list', (_e, limit) => logEntries(limit ?? 500))
  handle('logs:clear', () => clearLogs())
  handle('logs:write', (_e, level, scope, message) => rawLog(level, 'renderer:' + scope, message))

  handle('extensions:list', () =>
    activeSession()
      .extensions.getAllExtensions()
      .map((x) => ({ id: x.id, name: x.name, version: x.version, path: x.path }))
  )
  handle('extensions:load', async (e) => {
    const win = windowOf(e)
    const opts = { title: 'Select unpacked extension folder (contains manifest.json)', properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    if (!existsSync(r.filePaths[0] + '/manifest.json')) throw new Error('No manifest.json in that folder')
    const ext = await activeSession().extensions.loadExtension(r.filePaths[0], { allowFileAccess: false })
    run('INSERT OR REPLACE INTO extensions(path, added_at) VALUES(?, ?)', r.filePaths[0], Date.now())
    return { id: ext.id, name: ext.name }
  })
  handle('extensions:remove', (_e, id) => {
    const ses = activeSession()
    const ext = ses.extensions.getExtension(id)
    if (ext) run('DELETE FROM extensions WHERE path = ?', ext.path)
    ses.extensions.removeExtension(id)
  })
  void session
}
