// System monitor — main-process module entry.
//
// Data sources (all local, no admin rights needed):
//   CPU        os.cpus() time deltas (total + per logical core)
//   RAM        os.totalmem() / os.freemem()
//   GPU        long-lived `nvidia-smi --query-gpu … -lms <interval>` (NVIDIA only)
//   Network    long-lived `typeperf` (PDH, 64-bit, per interface) → fallback `netstat -e` diffs
//   Disks      fs.statfs on existing drive roots (refreshed every 30 s)
//   SPECTER    app.getAppMetrics() cumulative CPU time deltas + private bytes
//   Processes  `tasklist /FO CSV /NH` — on demand only
import { app, BrowserWindow } from 'electron'
import os from 'node:os'
import type { SystemInfo } from '@shared/modules/system'
import { bus } from '../../bus'
import { handle } from '../../ipc'
import { createLogger } from '../../logger'
import { metricsSnapshot } from '../../services/app'
import { registerDiagnostic } from '../../services/diagnostics'
import { getSetting, onSettingChanged } from '../../services/settings'
import { netDiag } from './netdiag'
import { listProcesses, revealProcess } from './processes'
import { gpuSource, recentHistory, reschedule, shutdown, status, subscribe, unsubscribe } from './service'

const log = createLogger('system')

let gpuAdapters: Promise<string[]> | null = null
function chromiumGpuNames(): Promise<string[]> {
  gpuAdapters ??= Promise.race([
    app.getGPUInfo('complete').then((info) => {
      const devices = ((info as { gpuDevice?: { deviceString?: string; active?: boolean }[] })?.gpuDevice ?? []).filter((d) => d.deviceString)
      return [...new Set(devices.map((d) => String(d.deviceString)))]
    }),
    new Promise<string[]>((r) => setTimeout(() => r([]), 5000))
  ]).catch(() => [])
  return gpuAdapters
}

async function systemInfo(): Promise<SystemInfo> {
  const cpus = os.cpus()
  await gpuSource.probe()
  return {
    cpuModel: cpus[0]?.model?.trim() ?? 'Unknown CPU',
    logicalCores: cpus.length,
    cpuSpeedMHz: cpus[0]?.speed ?? 0,
    totalMem: os.totalmem(),
    os: `${os.version()} (${os.release()})`,
    arch: os.arch(),
    uptimeSec: Math.round(os.uptime()),
    gpuAdapters: await chromiumGpuNames(),
    nvidiaSmiPath: gpuSource.path ?? null
  }
}

function watchWindow(w: BrowserWindow): void {
  for (const ev of ['minimize', 'restore', 'show', 'hide'] as const) w.on(ev as 'show', () => reschedule())
}

export function register(): void {
  handle('system:subscribe', (e, clientId) => subscribe(e.sender, clientId))
  handle('system:unsubscribe', (e, clientId) => unsubscribe(e.sender.id, clientId))
  handle('system:history', () => recentHistory())
  handle('system:status', () => status())
  handle('system:info', () => systemInfo())
  handle('system:processes', () => listProcesses())
  handle('system:revealProcess', (_e, pid) => revealProcess(Number(pid)))
  handle('system:specter', () => ({
    ts: Date.now(),
    processes: metricsSnapshot(),
    logicalCores: os.availableParallelism?.() ?? os.cpus().length,
    totalMem: os.totalmem(),
    uptimeSec: Math.round(process.uptime())
  }))
  handle('system:netDiag', (_e, req) => netDiag(req))

  // Performance mode → event bus + poll interval; poll setting → interval.
  let lastMode = String(getSetting('performance.mode'))
  onSettingChanged((key, value) => {
    if (key === 'performance.mode') {
      const mode = String(value)
      if (mode !== lastMode) {
        lastMode = mode
        bus.emit('SYSTEM_MODE_CHANGED', { mode })
        log.info(`performance mode → ${mode}`)
      }
      reschedule()
    } else if (key === 'performance.hudPollMs') reschedule()
  })

  // Focus / visibility changes adjust the interval immediately.
  app.on('browser-window-focus', () => reschedule())
  app.on('browser-window-blur', () => setTimeout(reschedule, 50))
  app.on('browser-window-created', (_e, w) => watchWindow(w))
  for (const w of BrowserWindow.getAllWindows()) watchWindow(w)
  app.on('will-quit', () => shutdown())

  registerDiagnostic(async () => {
    const r = await gpuSource.oneShot()
    return {
      id: 'system-gpu',
      label: 'GPU telemetry (nvidia-smi)',
      status: r.ok ? 'ok' : 'unknown',
      detail: r.ok ? r.detail : `Unavailable — ${r.detail}. GPU utilisation, VRAM, temperature and power are shown as “Unavailable”.`
    }
  })
  registerDiagnostic(() => {
    const s = status()
    const age = s.lastSampleTs ? Date.now() - s.lastSampleTs : null
    const stale = s.running && age !== null && age > s.intervalMs * 3 + 2000
    return {
      id: 'system-metrics',
      label: 'System metrics service',
      status: stale ? 'warn' : 'ok',
      detail: s.running
        ? `Polling every ${s.intervalMs} ms (${s.reason}) for ${s.subscribers} client(s) · ${s.ticks} ticks · avg ${s.avgTickMs.toFixed(2)} ms/tick (max ${s.maxTickMs.toFixed(2)}) on the main thread · last sample ${age === null ? 'never' : Math.round(age / 100) / 10 + ' s ago'} · network: ${s.netSource ?? 'unavailable'}${s.netError ? ' (' + s.netError + ')' : ''}`
        : `Idle (nothing visible needs metrics) · ${s.ticks} ticks so far${s.ticks ? ` · avg ${s.avgTickMs.toFixed(2)} ms/tick` : ''} · network source: ${s.netSource ?? 'not started'}`
    }
  })
}
