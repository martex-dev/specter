// RAM limiter: watches SPECTER's total private memory and, when it is above
// the user's limit, asks the owning window(s) to put background tabs to sleep
// (least recently used first). Every sleep is measured: SPECTER's total
// private memory right before, and again once the slept tabs' processes have
// exited. Nothing is estimated.
import { app } from 'electron'
import type { RamState, SleepLogEntry } from '@shared/modules/control'
import { json, metaGet, metaSet, uid } from '../../db'
import { broadcast, sendTo } from '../../ipc'
import { createLogger } from '../../logger'
import { getConfig } from './config'
import { excessKB, selectTabsToSleep, type SleepCandidate } from './logic'
import { attributeTabs, sample } from './metrics'
import { allTabs, ownerOf } from './tabs'

const log = createLogger('control')
const LOG_KEY = 'control:sleepLog'
const MAX_LOG = 60
const SOFT_MIN_IDLE_MS = 30_000

let entries: SleepLogEntry[] | null = null
const pending = new Map<string, (slept: string[]) => void>()
let queue: Promise<unknown> = Promise.resolve()
let timer: NodeJS.Timeout | null = null
let overStreak = 0
let lastAction = 0
let status = 'Off'
let lastOverKB = 0

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function sleepLog(): SleepLogEntry[] {
  if (!entries) {
    try {
      entries = json<SleepLogEntry[]>(metaGet(LOG_KEY), [])
    } catch {
      entries = []
    }
  }
  return entries
}

export function clearSleepLog(): void {
  entries = []
  persist()
}

function persist(): void {
  try {
    metaSet(LOG_KEY, JSON.stringify(sleepLog().slice(0, MAX_LOG)))
  } catch {
    /* ignore */
  }
}

export function sleepDone(requestId: string, slept: string[]): void {
  const fn = pending.get(requestId)
  pending.delete(requestId)
  fn?.(Array.isArray(slept) ? slept : [])
}

/** Sleeps the given tabs through their windows and measures what was released. Serialized. */
export function sleepTabs(tabIds: string[], reason: SleepLogEntry['reason']): Promise<SleepLogEntry | null> {
  const run = queue.then(() => doSleep(tabIds, reason))
  queue = run.catch(() => undefined)
  return run
}

async function doSleep(tabIds: string[], reason: SleepLogEntry['reason']): Promise<SleepLogEntry | null> {
  const reports = allTabs()
  const targets = reports.filter((r) => tabIds.includes(r.tabId) && !r.suspended && !r.internal && r.wcId !== null)
  if (!targets.length) return null
  const before = sample()
  const { usage, pids } = attributeTabs(reports, before)
  // Processes that should disappear: used by the targets and by no other live tab.
  const targetIds = new Set(targets.map((t) => t.tabId))
  const otherPids = new Set<number>()
  for (const [tabId, list] of pids) if (!targetIds.has(tabId)) list.forEach((p) => otherPids.add(p))
  const exiting = new Set<number>()
  for (const t of targets) for (const p of pids.get(t.tabId) ?? []) if (!otherPids.has(p)) exiting.add(p)

  // Ask each owning window to sleep its tabs.
  const byOwner = new Map<number, string[]>()
  for (const t of targets) {
    const o = ownerOf(t.tabId)
    if (o !== null) (byOwner.get(o) ?? byOwner.set(o, []).get(o)!).push(t.tabId)
  }
  const slept: string[] = []
  let timedOut = false
  await Promise.all(
    [...byOwner].map(
      ([owner, ids]) =>
        new Promise<void>((resolve) => {
          const requestId = uid('slp_')
          const to = setTimeout(() => {
            pending.delete(requestId)
            timedOut = true
            resolve()
          }, 6000)
          pending.set(requestId, (done) => {
            clearTimeout(to)
            slept.push(...done)
            resolve()
          })
          sendTo(owner, 'control:sleepRequest', { requestId, tabIds: ids })
        })
    )
  )
  if (!slept.length) {
    log.warn('sleep request produced no slept tabs', { reason, timedOut })
    return null
  }

  // Wait until the slept tabs' own processes have exited (or 4 s), then measure again.
  const t0 = Date.now()
  while (exiting.size && Date.now() - t0 < 4000) {
    const alive = new Set(app.getAppMetrics().map((m) => m.pid))
    if (![...exiting].some((p) => alive.has(p))) break
    await wait(200)
  }
  await wait(400)
  const after = sample()
  const sleptSet = new Set(slept)
  const entry: SleepLogEntry = {
    id: uid('sl_'),
    at: Date.now(),
    reason,
    tabs: targets.filter((t) => sleptSet.has(t.tabId)).map((t) => ({ tabId: t.tabId, title: t.title, url: t.url, memKB: usage.get(t.tabId)?.memKB ?? null })),
    beforeKB: before.totalKB,
    afterKB: after.totalKB,
    releasedKB: before.totalKB - after.totalKB,
    ms: after.at - before.at,
    note: timedOut ? 'A window did not confirm in time; measurement may be incomplete.' : exiting.size === 0 ? 'Slept tabs shared their processes with other tabs.' : undefined
  }
  const list = sleepLog()
  list.unshift(entry)
  if (list.length > MAX_LOG) list.length = MAX_LOG
  persist()
  broadcast('control:log', entry)
  log.info('slept tabs', { reason, tabs: entry.tabs.length, releasedKB: entry.releasedKB })
  return entry
}

async function tick(): Promise<void> {
  const cfg = getConfig().ram
  if (!cfg.enabled) return
  const s = sample()
  const over = excessKB(s.totalKB, cfg.limitMB)
  lastOverKB = over
  if (over <= 0) {
    overStreak = 0
    status = 'Under the limit'
    return
  }
  overStreak++
  if (!cfg.hard && overStreak < 2) {
    status = 'Above the limit — confirming'
    return
  }
  if (Date.now() - lastAction < (cfg.hard ? 3000 : 8000)) return
  const reports = allTabs()
  const { usage } = attributeTabs(reports, s)
  const candidates: SleepCandidate[] = reports.map((r) => ({
    tabId: r.tabId,
    visible: r.visible,
    suspended: r.suspended,
    internal: r.internal,
    live: r.wcId !== null,
    pinned: r.pinned,
    audible: r.audible,
    lastActive: r.lastActive,
    memKB: usage.get(r.tabId)?.memKB ?? 0
  }))
  const ids = selectTabsToSleep(candidates, over, { hard: cfg.hard, excludePinned: cfg.excludePinned, excludeAudible: cfg.excludeAudible, now: Date.now(), minIdleMs: SOFT_MIN_IDLE_MS })
  if (!ids.length) {
    status = cfg.hard
      ? 'Above the limit — every background tab is asleep; the rest is visible tabs and SPECTER’s own processes'
      : 'Above the limit — no eligible background tabs left (pinned, audible and recently used tabs are kept; enable Hard limit to include them)'
    return
  }
  lastAction = Date.now()
  status = `Sleeping ${ids.length} tab${ids.length === 1 ? '' : 's'}…`
  const entry = await sleepTabs(ids, 'limit')
  lastAction = Date.now()
  status = entry ? `Slept ${entry.tabs.length} tab${entry.tabs.length === 1 ? '' : 's'} (−${Math.round(entry.releasedKB / 1024)} MB measured) — re-checking` : 'Could not sleep the selected tabs — retrying'
}

export function reconcileRamLimiter(): void {
  const cfg = getConfig().ram
  if (timer) clearInterval(timer)
  timer = null
  overStreak = 0
  if (!cfg.enabled) {
    status = 'Off'
    lastOverKB = 0
    return
  }
  status = 'Watching'
  let busy = false
  const run = () => {
    if (busy) return
    busy = true
    tick()
      .catch((err) => log.warn('ram limiter tick failed', err))
      .finally(() => (busy = false))
  }
  timer = setInterval(run, cfg.hard ? 2000 : 4000)
  setTimeout(run, 300)
}

export function ramState(): RamState {
  const cfg = getConfig().ram
  return { enabled: cfg.enabled, limitKB: cfg.limitMB * 1024, overKB: lastOverKB, status }
}

export function stopRamLimiter(): void {
  if (timer) clearInterval(timer)
  timer = null
}
