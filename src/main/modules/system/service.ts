// Metrics service: one poller for the whole app, running only while at least
// one renderer client is subscribed. Samples are pushed as `system:metrics`
// to subscribed webContents only.
import { app, BrowserWindow, webContents } from 'electron'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import type { PollReason, SpecterUsage, SystemMetrics, SystemStatus } from '@shared/modules/system'
import { sendTo } from '../../ipc'
import { createLogger } from '../../logger'
import { getSetting } from '../../services/settings'
import { cpuUsage, effectiveInterval, type CpuTimes } from './parsers'
import { Disks, PerfCounters, NvidiaSmi } from './sources'

const log = createLogger('system')
const HISTORY_MAX = 300

export const gpuSource = new NvidiaSmi()
const counters = new PerfCounters()
const disks = new Disks()

const subs = new Map<number, Set<string>>()
const watched = new Set<number>()
const history: SystemMetrics[] = []

let timer: NodeJS.Timeout | null = null
let running = false
let currentInterval = 0
let currentReason: PollReason = 'normal'
let helperInterval = 0
let helperRetime: NodeJS.Timeout | null = null
let prevCpu: CpuTimes[] | null = null
let prevCpuAt = 0
let prevSpecter: { t: number; perPid: Map<number, number> } | null = null
let ticks = 0
const tickCosts: number[] = []
const phase = { cpu: 0, other: 0, specter: 0, send: 0 }
let lastSampleTs: number | null = null
let nextTickAt = 0

function subscriberCount(): number {
  let n = 0
  for (const s of subs.values()) n += s.size
  return n
}

function baseInterval(): number {
  const v = Number(getSetting('performance.hudPollMs'))
  return Number.isFinite(v) && v > 0 ? v : 2000
}

function windowState(): { visible: number; focused: number } {
  let visible = 0
  let focused = 0
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || !w.isVisible() || w.isMinimized()) continue
    visible++
    // A pinned (always-on-top) popout counts as "being looked at".
    if (w.isFocused() || w.isAlwaysOnTop()) focused++
  }
  return { visible, focused }
}

function computeInterval(): { ms: number; reason: PollReason } {
  return effectiveInterval(baseInterval(), String(getSetting('performance.mode')), windowState())
}

// ---------------------------------------------------------------- sampling

let lastCpu: { total: number; perCore: number[] } | null = null

function readCpu(): { total: number; perCore: number[] } {
  const cur = os.cpus().map((c) => c.times)
  const now = Date.now()
  if (prevCpu && now - prevCpuAt > 200) {
    const u = cpuUsage(prevCpu, cur)
    if (u) lastCpu = u
  }
  if (!prevCpu || now - prevCpuAt > 200) {
    prevCpu = cur
    prevCpuAt = now
  }
  // Only reachable before the first real delta (the first tick is ≥1 s after priming).
  return lastCpu ?? { total: 0, perCore: cur.map(() => 0) }
}

function readSpecter(now: number): SpecterUsage {
  const metrics = app.getAppMetrics()
  let memKB = 0
  let cpuSec = 0
  let fallbackPct = 0
  let haveCumulative = true
  const perPid = new Map<number, number>()
  for (const m of metrics) {
    memKB += m.memory.privateBytes ?? m.memory.workingSetSize
    const cum = m.cpu.cumulativeCPUUsage
    if (typeof cum === 'number') {
      perPid.set(m.pid, cum)
      const prev = prevSpecter?.perPid.get(m.pid)
      if (prev !== undefined && cum >= prev) cpuSec += cum - prev
    } else {
      haveCumulative = false
      fallbackPct += m.cpu.percentCPUUsage
    }
  }
  const cores = os.availableParallelism?.() ?? os.cpus().length
  let cpu = 0
  if (haveCumulative && prevSpecter) {
    const dt = (now - prevSpecter.t) / 1000
    // cumulativeCPUUsage is CPU-seconds; normalise to the whole machine (all cores).
    if (dt > 0) cpu = Math.min(100, (cpuSec / (dt * cores)) * 100)
  } else if (!haveCumulative) {
    // percentCPUUsage is relative to one core.
    cpu = Math.min(100, fallbackPct / cores)
  }
  prevSpecter = { t: now, perPid }
  return { cpu: Math.round(cpu * 10) / 10, memKB, processes: metrics.length }
}

function tick(): void {
  timer = null
  if (!running) return
  const t0 = performance.now()
  const now = Date.now()
  let sample: SystemMetrics | null = null
  try {
    const cpu = { ...readCpu(), utility: counters.cpuUtility(now) }
    const t1 = performance.now()
    const total = os.totalmem()
    const mem = { total, used: Math.max(0, total - os.freemem()) }
    counters.tick()
    const gpu = gpuSource.sample(now)
    const disksNow = disks.sample(now)
    const net = counters.sample(now)
    const t2 = performance.now()
    const specter = readSpecter(now)
    const t3 = performance.now()
    sample = { ts: now, intervalMs: currentInterval, cpu, mem, gpu, disks: disksNow, net, specter }
    history.push(sample)
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
    lastSampleTs = now
    for (const [wcId, set] of subs) if (set.size) sendTo(wcId, 'system:metrics', sample)
    const t4 = performance.now()
    phase.cpu += t1 - t0
    phase.other += t2 - t1
    phase.specter += t3 - t2
    phase.send += t4 - t3
  } catch (err) {
    log.error('metrics tick failed', err)
  }
  const cost = performance.now() - t0
  tickCosts.push(cost)
  if (tickCosts.length > 60) tickCosts.shift()
  ticks++
  if (ticks % 30 === 0) {
    const s = costStats()
    const f = (v: number) => (v / 30).toFixed(2)
    log.debug(
      `poller: avg ${s.avg.toFixed(2)} ms/tick (max ${s.max.toFixed(2)}) over last ${tickCosts.length} ticks · os.cpus ${f(phase.cpu)} · mem/gpu/net/disk ${f(phase.other)} · getAppMetrics ${f(phase.specter)} · send ${f(phase.send)} · interval ${currentInterval} ms (${currentReason})`
    )
    phase.cpu = phase.other = phase.specter = phase.send = 0
  }
  schedule()
}

function costStats(): { avg: number; max: number } {
  if (!tickCosts.length) return { avg: 0, max: 0 }
  let sum = 0
  let max = 0
  for (const c of tickCosts) {
    sum += c
    if (c > max) max = c
  }
  return { avg: sum / tickCosts.length, max }
}

function schedule(): void {
  if (!running) return
  const { ms, reason } = computeInterval()
  currentInterval = ms
  currentReason = reason
  retimeHelpers(ms)
  if (timer) clearTimeout(timer)
  nextTickAt = Date.now() + ms
  timer = setTimeout(tick, ms)
}

/** Long-lived helpers follow the effective interval; debounced so focus flapping doesn't respawn them. */
function retimeHelpers(ms: number): void {
  if (ms === helperInterval) {
    if (helperRetime) clearTimeout(helperRetime)
    helperRetime = null
    return
  }
  const apply = () => {
    helperRetime = null
    if (!running) return
    helperInterval = ms
    void gpuSource.start(ms)
    counters.start(ms)
  }
  if (!helperInterval) return apply()
  if (helperRetime) clearTimeout(helperRetime)
  helperRetime = setTimeout(apply, 4000)
}

function start(): void {
  if (running) return
  running = true
  log.info('metrics poller started')
  helperInterval = 0
  prevSpecter = null
  lastCpu = null
  // Prime CPU counters so the first pushed sample already has a real delta.
  prevCpu = os.cpus().map((c) => c.times)
  prevCpuAt = Date.now()
  readSpecter(Date.now())
  const { ms, reason } = computeInterval()
  currentInterval = ms
  currentReason = reason
  retimeHelpers(ms)
  nextTickAt = Date.now() + Math.min(ms, 1000)
  timer = setTimeout(tick, Math.min(ms, 1000))
}

function stop(): void {
  if (!running) return
  running = false
  if (timer) clearTimeout(timer)
  if (helperRetime) clearTimeout(helperRetime)
  timer = null
  helperRetime = null
  helperInterval = 0
  gpuSource.stop()
  counters.stop()
  const s = costStats()
  log.info(`metrics poller stopped after ${ticks} ticks · avg ${s.avg.toFixed(2)} ms/tick`)
}

/** Re-evaluate the interval now (settings / focus changed). Ticks sooner if the new interval is shorter. */
export function reschedule(): void {
  if (!running) return
  const { ms } = computeInterval()
  if (ms === currentInterval) return
  const remaining = nextTickAt - Date.now()
  if (ms < currentInterval && remaining > 400) {
    if (timer) clearTimeout(timer)
    currentInterval = ms
    const wait = Math.max(250, Math.min(remaining, 500))
    nextTickAt = Date.now() + wait
    timer = setTimeout(tick, wait)
  } else if (ms > currentInterval) {
    // Slow down from the next tick on.
    schedule()
  }
}

// ---------------------------------------------------------------- subscriptions

function watch(wc: Electron.WebContents): void {
  if (watched.has(wc.id)) return
  watched.add(wc.id)
  const id = wc.id
  const drop = () => {
    if (subs.delete(id)) update()
  }
  wc.once('destroyed', () => {
    watched.delete(id)
    drop()
  })
  wc.on('render-process-gone', drop)
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) drop()
  })
}

function update(): void {
  if (subscriberCount() > 0) start()
  else stop()
}

export function subscribe(wc: Electron.WebContents, clientId: string): SystemStatus {
  watch(wc)
  const set = subs.get(wc.id) ?? new Set<string>()
  set.add(String(clientId).slice(0, 80))
  subs.set(wc.id, set)
  update()
  return status()
}

export function unsubscribe(wcId: number, clientId: string): void {
  const set = subs.get(wcId)
  if (!set) return
  set.delete(String(clientId).slice(0, 80))
  if (!set.size) subs.delete(wcId)
  update()
}

export function recentHistory(): SystemMetrics[] {
  return history.slice()
}

export function status(): SystemStatus {
  const s = costStats()
  // Prune subscribers whose webContents vanished without events (defensive).
  for (const id of [...subs.keys()]) if (!webContents.fromId(id)) subs.delete(id)
  return {
    running,
    subscribers: subscriberCount(),
    baseIntervalMs: baseInterval(),
    intervalMs: running ? currentInterval : computeInterval().ms,
    reason: running ? currentReason : computeInterval().reason,
    mode: String(getSetting('performance.mode')),
    ticks,
    avgTickMs: Math.round(s.avg * 1000) / 1000,
    maxTickMs: Math.round(s.max * 1000) / 1000,
    lastSampleTs,
    gpuSource: gpuSource.path ? 'nvidia-smi' : null,
    gpuError: gpuSource.error,
    netSource: counters.source,
    netError: counters.error
  }
}

export function shutdown(): void {
  subs.clear()
  stop()
}
