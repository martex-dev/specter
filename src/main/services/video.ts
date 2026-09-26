// Video tools: SPECTER's built-in speed controller. A frame preload
// (src/preload/video.ts) runs in every web page's isolated world and does the
// work in the page; this service hands it its settings, remembers speeds per
// site (per profile) and relays speed commands from SPECTER's UI.
import { ipcMain, session as electronSession, webContents, type IpcMainEvent, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import type { VideoSpeedState } from '@shared/ipc'
import { SpeedMemory, clampSpeed, siteKey, videoKeyMap, type SiteSpeed, type VideoCommand, type VideoPageConfig } from '@shared/video'
import { all, registerMigrations, run } from '../db'
import { handle } from '../ipc'
import { createLogger } from '../logger'
import { getSetting, onSettingChanged } from './settings'
import { activeProfileId } from './profiles'

const log = createLogger('video')
const attached = new WeakSet<Session>()

registerMigrations('video', [
  `CREATE TABLE video_speeds (profile_id TEXT NOT NULL, site TEXT NOT NULL, rate REAL NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (profile_id, site));`
])

// ------------------------------------------------------------ site memory

let memory: { profile: string; m: SpeedMemory } | null = null

function mem(): SpeedMemory {
  const profile = activeProfileId()
  if (memory?.profile !== profile) {
    const rows = all<{ site: string; rate: number; updated_at: number }>('SELECT site, rate, updated_at FROM video_speeds WHERE profile_id = ?', profile)
    memory = { profile, m: new SpeedMemory(rows.map((r) => ({ site: r.site, rate: r.rate, updatedAt: r.updated_at }))) }
  }
  return memory.m
}

function remember(site: string | null, rate: number): void {
  if (!site || !getSetting('video.rememberSpeed')) return
  const now = Date.now()
  const { changed, dropped } = mem().set(site, rate, now)
  if (!changed) return
  const profile = activeProfileId()
  const stored = mem().get(site)
  if (stored === null) run('DELETE FROM video_speeds WHERE profile_id = ? AND site = ?', profile, site)
  else run('INSERT INTO video_speeds(profile_id, site, rate, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(profile_id, site) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at', profile, site, stored, now)
  for (const d of dropped) run('DELETE FROM video_speeds WHERE profile_id = ? AND site = ?', profile, d)
}

/** Forgets the speeds remembered since a time, with the browsing history of the same period. */
export function forgetVideoSpeedsSince(since: number): void {
  run('DELETE FROM video_speeds WHERE profile_id = ? AND updated_at >= ?', activeProfileId(), since)
  memory = null
}

/** Forgets one site's speed, or every site's. */
export function forgetVideoSpeeds(site: string | null): void {
  if (site === null) {
    mem().clear()
    run('DELETE FROM video_speeds WHERE profile_id = ?', activeProfileId())
  } else {
    mem().forget(site)
    run('DELETE FROM video_speeds WHERE profile_id = ? AND site = ?', activeProfileId(), site)
  }
}

export function rememberedVideoSpeeds(): SiteSpeed[] {
  return mem().list()
}

// ------------------------------------------------------------ page config

function pageConfig(url: string, withSiteSpeed: boolean): VideoPageConfig {
  const site = siteKey(url)
  const cfg: VideoPageConfig = {
    enabled: getSetting('video.enabled') && !(site && getSetting('video.disabledSites').includes(site)),
    keys: [...videoKeyMap(getSetting('video.keys')).entries()],
    step: getSetting('video.step'),
    preferred: clampSpeed(getSetting('video.preferredSpeed')),
    badge: getSetting('video.badge')
  }
  if (withSiteSpeed) cfg.siteSpeed = getSetting('video.rememberSpeed') ? mem().get(site) : null
  return cfg
}

/** Tab guests and their pop-ups (profile sessions) — the only senders the preload runs in. */
function fromGuest(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const s = e.sender
  if (s.isDestroyed() || s.session === electronSession.defaultSession) return false
  const t = s.getType()
  return (t === 'webview' || t === 'window') && (!e.senderFrame || !e.senderFrame.parent)
}

function pageUrl(e: IpcMainInvokeEvent | IpcMainEvent): string {
  try {
    return e.senderFrame?.url || e.sender.getURL()
  } catch {
    return e.sender.getURL()
  }
}

function pushConfig(): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed() || !attached.has(wc.session)) continue
    const t = wc.getType()
    if (t === 'webview' || t === 'window') wc.send('specter-video:config', pageConfig(wc.getURL(), false))
  }
}

// ------------------------------------------------------------ commands

let seq = 0
const pending = new Map<number, { wcId: number; resolve: (rate: number | null | undefined) => void }>()

/**
 * Runs a speed command in a tab through its video-tools preload. Resolves with
 * the new rate, null when the page has no media, or undefined when no preload
 * answered (e.g. a page SPECTER can't script) so the caller can fall back.
 */
export function videoCommand(wc: WebContents, action: VideoCommand, value?: number): Promise<number | null | undefined> {
  const id = ++seq
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(undefined)
    }, 500)
    pending.set(id, {
      wcId: wc.id,
      resolve: (rate) => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(rate)
      }
    })
    try {
      wc.send('specter-video:command', { id, action, value: value === undefined ? undefined : clampSpeed(value) })
    } catch {
      pending.get(id)?.resolve(undefined)
    }
  })
}

// ------------------------------------------------------------ setup

/** Registers the video-tools preload on a profile session. */
export function attachVideoTools(ses: Session): void {
  if (attached.has(ses)) return
  attached.add(ses)
  try {
    ses.registerPreloadScript({ type: 'frame', id: 'specter-video', filePath: join(__dirname, '../preload/video.js') })
  } catch (err) {
    log.warn('could not register the video tools preload', err)
  }
}

export function registerVideoIpc(): void {
  // Preload → main (raw channels: web pages' preloads can't use SPECTER's typed IPC).
  ipcMain.handle('specter-video:init', (e) => (fromGuest(e) ? pageConfig(pageUrl(e), true) : null))
  ipcMain.on('specter-video:speed', (e, rate: unknown) => {
    if (fromGuest(e) && typeof rate === 'number' && Number.isFinite(rate)) remember(siteKey(pageUrl(e)), rate)
  })
  ipcMain.on('specter-video:result', (e, id: unknown, rate: unknown) => {
    const p = typeof id === 'number' ? pending.get(id) : undefined
    if (!p || p.wcId !== e.sender.id || !fromGuest(e)) return
    p.resolve(typeof rate === 'number' && Number.isFinite(rate) ? clampSpeed(rate) : null)
  })

  // SPECTER's UI → main.
  handle('video:command', async (_e, wcId, action, value): Promise<VideoSpeedState> => {
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) return { rate: null, site: null }
    const rate = await videoCommand(wc, action, value)
    return { rate: rate ?? null, site: siteKey(wc.getURL()) }
  })
  handle('video:sites', () => rememberedVideoSpeeds())
  handle('video:forget', (_e, site) => forgetVideoSpeeds(site))

  onSettingChanged((key) => {
    if (key === 'video.enabled' || key === 'video.keys' || key === 'video.step' || key === 'video.preferredSpeed' || key === 'video.badge' || key === 'video.disabledSites') pushConfig()
  })
}
