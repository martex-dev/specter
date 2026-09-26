// GX-style Control: RAM / network / CPU limiters, hot tabs, sounds and
// wallpapers — main-process module entry.
//
// All limiters act on SPECTER itself: its own processes, its own tabs and the
// active profile's network session. Nothing here changes the OS or other apps.
import { app, BrowserWindow, webContents } from 'electron'
import type { ControlStats, TabUsage } from '@shared/modules/control'
import { broadcast, handle, sendTo, windowOf } from '../../ipc'
import { createLogger } from '../../logger'
import { registerDiagnostic } from '../../services/diagnostics'
import { getSetting, onSettingChanged } from '../../services/settings'
import { getConfig, onConfig, setConfig } from './config'
import { isThrottled, reconcileCpu, releaseAllCpu, throttledCount, throttleSkipReason } from './cpu'
import { attributeTabs, cores, sample, systemKB } from './metrics'
import { netState, reconcileNet, watchNewGuests } from './net'
import { clearSleepLog, ramState, reconcileRamLimiter, sleepDone, sleepLog, sleepTabs, stopRamLimiter } from './ram'
import { allTabs, onTabsChanged, setWindowTabs } from './tabs'
import { pickWallpaper, wallpaperData } from './wallpaper'

const log = createLogger('control')
const subscribers = new Set<number>()
let statsTimer: NodeJS.Timeout | null = null

function buildStats(): ControlStats {
  const s = sample()
  const reports = allTabs()
  const { usage, pids } = attributeTabs(reports, s)
  const tabs: TabUsage[] = reports
    .filter((r) => !r.suspended && !r.internal && r.wcId !== null)
    .map((r) => {
      const u = usage.get(r.tabId)
      return {
        tabId: r.tabId,
        title: r.title,
        url: r.url,
        visible: r.visible,
        pinned: r.pinned,
        audible: r.audible,
        lastActive: r.lastActive,
        memKB: u?.memKB ?? null,
        sharedKB: u?.sharedKB ?? 0,
        cpu: u?.cpu ?? null,
        pids: pids.get(r.tabId) ?? [],
        sharedWith: u?.sharedWith ?? 0,
        throttled: isThrottled(r.wcId),
        throttleSkip: throttleSkipReason(r.wcId)
      }
    })
    .sort((a, b) => (b.memKB ?? -1) - (a.memKB ?? -1))
  const n = cores()
  return {
    at: s.at,
    totalKB: s.totalKB,
    systemKB: systemKB(),
    cpuPct: Math.min(100, s.cpuSum / n),
    cores: n,
    processes: s.procs.size,
    tabs,
    ram: ramState(),
    net: netState(),
    cpuLimiter: { enabled: getConfig().cpu.enabled, rate: getConfig().cpu.rate, throttled: throttledCount() }
  }
}

function pushStats(): void {
  if (!subscribers.size) return
  let stats: ControlStats
  try {
    stats = buildStats()
  } catch (err) {
    log.warn('stats failed', err)
    return
  }
  for (const id of subscribers) sendTo(id, 'control:stats', stats)
}

function reschedule(): void {
  if (statsTimer) clearInterval(statsTimer)
  statsTimer = null
  if (!subscribers.size) return
  const ms = Math.max(1000, Number(getSetting('performance.hudPollMs')) || 2000)
  statsTimer = setInterval(pushStats, ms)
}

/** Senders that already have a 'destroyed' hook (one per webContents, not one per subscribe). */
const hookedSenders = new Set<number>()

function subscribe(senderId: number, on: boolean): void {
  const before = subscribers.size
  if (on && !subscribers.has(senderId)) {
    subscribers.add(senderId)
    if (!hookedSenders.has(senderId)) {
      hookedSenders.add(senderId)
      webContents.fromId(senderId)?.once('destroyed', () => {
        hookedSenders.delete(senderId)
        const had = subscribers.delete(senderId)
        reschedule()
        if (had) broadcast('control:watchers', subscribers.size)
      })
    }
    setTimeout(pushStats, 50)
  } else if (!on) {
    subscribers.delete(senderId)
  }
  reschedule()
  // Windows report their tabs while someone watches the stats — including a
  // popped-out panel, which has no tabs of its own.
  if (subscribers.size !== before) broadcast('control:watchers', subscribers.size)
}

function broadcastConfig(): void {
  const c = getConfig()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) sendTo(w.webContents.id, 'control:config', c)
}

export function register(): void {
  handle('control:getConfig', () => getConfig())
  handle('control:setConfig', (_e, patch) => setConfig(patch))
  handle('control:syncTabs', (e, tabs) => setWindowTabs(e.sender.id, tabs))
  handle('control:subscribe', (e, on) => subscribe(e.sender.id, !!on))
  handle('control:watchers', () => subscribers.size)
  handle('control:stats', () => buildStats())
  handle('control:log', () => sleepLog())
  handle('control:clearLog', () => clearSleepLog())
  handle('control:sleepTabs', (_e, tabIds, reason) => sleepTabs(Array.isArray(tabIds) ? tabIds.map(String) : [], reason === 'heavy' ? 'heavy' : 'manual'))
  handle('control:sleepDone', (_e, requestId, slept) => sleepDone(String(requestId), slept))
  handle('control:pickWallpaper', (e) => pickWallpaper(windowOf(e)))
  handle('control:wallpaperData', (_e, path) => wallpaperData(path))

  onConfig((c, prev) => {
    broadcastConfig()
    if (JSON.stringify(c.ram) !== JSON.stringify(prev.ram)) reconcileRamLimiter()
    if (JSON.stringify(c.net) !== JSON.stringify(prev.net)) void reconcileNet()
    if (JSON.stringify(c.cpu) !== JSON.stringify(prev.cpu)) void reconcileCpu(allTabs())
    setTimeout(pushStats, 100)
  })
  onTabsChanged(() => void reconcileCpu(allTabs()))
  onSettingChanged((key) => {
    if (key === 'general.activeProfile') setTimeout(() => void reconcileNet(), 500)
    if (key === 'performance.hudPollMs') reschedule()
  })

  // The network cap and RAM limiter resume at startup (Chromium keeps no emulation state).
  watchNewGuests()
  app.whenReady().then(() => {
    void reconcileNet()
    reconcileRamLimiter()
  })
  app.on('before-quit', () => {
    stopRamLimiter()
    void releaseAllCpu()
  })

  registerDiagnostic(() => {
    const c = getConfig()
    const n = netState()
    const parts = [
      c.ram.enabled ? `RAM limit ${(c.ram.limitMB / 1024).toFixed(1)} GB${c.ram.hard ? ' (hard)' : ''}` : 'RAM limiter off',
      n.active ? `network cap ${((n.downBps * 8) / 1e6).toFixed(1)} Mbps on ${n.guests ?? 0} page(s)` : n.error ? `network limiter error: ${n.error}` : 'network limiter off',
      c.cpu.enabled ? `CPU limiter ×${c.cpu.rate} on ${throttledCount()} tab(s)` : 'CPU limiter off'
    ]
    return { id: 'control', label: 'GX Control', status: n.error ? 'warn' : 'ok', detail: parts.join(' · ') }
  })
}
