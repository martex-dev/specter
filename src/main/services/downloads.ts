import { app, shell, type DownloadItem, type Session } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadInfo, DownloadState } from '@shared/types'
import { all, get, run, uid } from '../db'
import { broadcast, handle } from '../ipc'
import { bus } from '../bus'
import { getSetting } from './settings'
import { notify } from './notifications'
import { activeSession } from './profiles'
import { createLogger } from '../logger'

const log = createLogger('downloads')
const live = new Map<string, { item: DownloadItem; info: DownloadInfo; lastBytes: number; lastTs: number; removed?: boolean }>()
const attached = new WeakSet<Session>()

type Row = {
  id: string
  url: string
  filename: string
  save_path: string
  mime: string
  total_bytes: number
  received_bytes: number
  state: DownloadState
  started_at: number
  ended_at: number | null
}

const fromRow = (r: Row): DownloadInfo => ({
  id: r.id,
  url: r.url,
  filename: r.filename,
  savePath: r.save_path,
  mime: r.mime,
  totalBytes: r.total_bytes,
  receivedBytes: r.received_bytes,
  state: r.state,
  startedAt: r.started_at,
  endedAt: r.ended_at ?? undefined,
  speed: 0,
  canResume: false
})

function persist(info: DownloadInfo): void {
  run(
    `INSERT INTO downloads(id, url, filename, save_path, mime, total_bytes, received_bytes, state, started_at, ended_at)
     VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET filename=excluded.filename, save_path=excluded.save_path,
     total_bytes=excluded.total_bytes, received_bytes=excluded.received_bytes, state=excluded.state, ended_at=excluded.ended_at`,
    info.id,
    info.url,
    info.filename,
    info.savePath,
    info.mime,
    info.totalBytes,
    info.receivedBytes,
    info.state,
    info.startedAt,
    info.endedAt ?? null
  )
}

export function downloadDirectory(): string {
  return getSetting('downloads.directory') || app.getPath('downloads')
}

function uniquePath(dir: string, filename: string): string {
  const cleaned = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'download'
  const dot = cleaned.lastIndexOf('.')
  // Truncate long names without cutting off the extension (the file would lose its type).
  const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : ''
  const base = (ext ? cleaned.slice(0, dot) : cleaned).slice(0, 200 - ext.length)
  let candidate = join(dir, base + ext)
  let i = 1
  const inUse = new Set([...live.values()].map((l) => l.info.savePath))
  while (existsSync(candidate) || inUse.has(candidate)) candidate = join(dir, `${base} (${i++})${ext}`)
  return candidate
}

export function attachDownloads(ses: Session): void {
  if (attached.has(ses)) return
  attached.add(ses)
  ses.on('will-download', (_event, item) => {
    const id = uid('dl_')
    if (!getSetting('downloads.askWhereToSave')) item.setSavePath(uniquePath(downloadDirectory(), item.getFilename()))
    const info: DownloadInfo = {
      id,
      url: item.getURL(),
      filename: item.getFilename(),
      savePath: item.getSavePath(),
      mime: item.getMimeType(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startedAt: Date.now(),
      speed: 0,
      canResume: item.canResume()
    }
    const entry = { item, info, lastBytes: 0, lastTs: Date.now(), removed: false }
    live.set(id, entry)
    persist(info)
    broadcast('downloads:changed', info)
    bus.emit('DOWNLOAD_STARTED', { id, filename: info.filename })
    log.info('download started', { id, url: info.url })

    let lastEmit = 0
    item.on('updated', (_e, state) => {
      const now = Date.now()
      const received = item.getReceivedBytes()
      const dt = (now - entry.lastTs) / 1000
      if (dt >= 0.5) {
        info.speed = Math.max(0, (received - entry.lastBytes) / dt)
        entry.lastBytes = received
        entry.lastTs = now
      }
      info.receivedBytes = received
      info.totalBytes = item.getTotalBytes()
      info.savePath = item.getSavePath()
      info.filename = info.savePath ? info.savePath.split(/[\\/]/).pop()! : item.getFilename()
      info.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      info.canResume = item.canResume()
      if (now - lastEmit > 250) {
        lastEmit = now
        broadcast('downloads:changed', { ...info })
      }
    })
    item.once('done', (_e, state) => {
      live.delete(id)
      // Removed from the list while running: don't bring the entry back as "cancelled".
      if (entry.removed) return
      info.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      info.receivedBytes = item.getReceivedBytes()
      info.totalBytes = item.getTotalBytes() || info.receivedBytes
      info.savePath = item.getSavePath()
      info.endedAt = Date.now()
      info.speed = 0
      info.canResume = false
      persist(info)
      broadcast('downloads:changed', { ...info })
      bus.emit('DOWNLOAD_FINISHED', { id, filename: info.filename, state: info.state })
      if (info.state === 'completed') notify({ category: 'downloads', title: 'Download complete', body: info.filename })
      else if (info.state === 'interrupted') notify({ category: 'downloads', title: 'Download failed', body: info.filename })
    })
  })
}

export function listDownloads(): DownloadInfo[] {
  const rows = all<Row>('SELECT * FROM downloads ORDER BY started_at DESC LIMIT 500').map(fromRow)
  return rows.map((r) => {
    const l = live.get(r.id)
    return l ? { ...l.info } : r
  })
}

export function activeDownloadCount(): number {
  return live.size
}

export function registerDownloadsIpc(): void {
  // Downloads still running when SPECTER last exited (or crashed) can never finish: don't leave them "in progress".
  run("UPDATE downloads SET state = 'interrupted', ended_at = COALESCE(ended_at, ?) WHERE state IN ('progressing', 'paused')", Date.now())
  handle('downloads:list', () => listDownloads())
  handle('downloads:pause', (_e, id) => live.get(id)?.item.pause())
  handle('downloads:resume', (_e, id) => {
    const l = live.get(id)
    if (l?.item.canResume()) l.item.resume()
  })
  handle('downloads:cancel', (_e, id) => live.get(id)?.item.cancel())
  handle('downloads:retry', (_e, id) => {
    const r = get<Row>('SELECT * FROM downloads WHERE id = ?', id)
    if (!r) return
    run('DELETE FROM downloads WHERE id = ?', id)
    // Through the active profile's session, whose will-download handler tracks it (there may be
    // no tab webContents at all, and the UI's own session has no download handler).
    activeSession().downloadURL(r.url)
  })
  handle('downloads:open', async (_e, id) => {
    const r = get<Row>('SELECT save_path FROM downloads WHERE id = ?', id)
    if (r && existsSync(r.save_path)) await shell.openPath(r.save_path)
  })
  handle('downloads:showInFolder', (_e, id) => {
    const r = get<Row>('SELECT save_path FROM downloads WHERE id = ?', id)
    if (r && existsSync(r.save_path)) shell.showItemInFolder(r.save_path)
    else shell.openPath(downloadDirectory())
  })
  handle('downloads:remove', (_e, id) => {
    const l = live.get(id)
    if (l) {
      l.removed = true
      l.item.cancel()
    }
    run('DELETE FROM downloads WHERE id = ?', id)
  })
  handle('downloads:openFolder', () => {
    shell.openPath(downloadDirectory())
  })
  handle('downloads:clearFinished', () => {
    run("DELETE FROM downloads WHERE state IN ('completed', 'cancelled', 'interrupted')")
  })
}
