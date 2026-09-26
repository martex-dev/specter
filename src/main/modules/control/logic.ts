// Pure decision logic for the Control module (unit-tested, no Electron imports).

export interface SleepCandidate {
  tabId: string
  visible: boolean
  suspended: boolean
  internal: boolean
  live: boolean
  pinned: boolean
  audible: boolean
  lastActive: number
  /** Private memory of processes only this tab uses, KB (0 when all its processes are shared). */
  memKB: number
}

export interface SelectOptions {
  hard: boolean
  excludePinned: boolean
  excludeAudible: boolean
  now: number
  /** Soft mode leaves tabs used within this window alone. */
  minIdleMs: number
}

/** Memory above the limit, KB (0 when under). */
export function excessKB(totalKB: number, limitMB: number): number {
  return Math.max(0, Math.round(totalKB - limitMB * 1024))
}

export function isSleepable(c: SleepCandidate, o: SelectOptions): boolean {
  if (c.visible || c.suspended || c.internal || !c.live) return false
  if (o.hard) return true
  if (c.pinned && o.excludePinned) return false
  if (c.audible && o.excludeAudible) return false
  if (o.now - c.lastActive < o.minIdleMs) return false
  return true
}

/**
 * Least-recently-used tabs to sleep so that (by their measured exclusive
 * memory) SPECTER gets back under the limit. Tabs whose processes are all
 * shared with other tabs free little when slept, so they are only used once
 * every tab with its own process has been taken. Returns every eligible tab
 * when even that isn't enough.
 */
export function selectTabsToSleep(candidates: SleepCandidate[], needKB: number, o: SelectOptions): string[] {
  if (needKB <= 0) return []
  const eligible = candidates.filter((c) => isSleepable(c, o)).sort((a, b) => a.lastActive - b.lastActive)
  const own = eligible.filter((c) => c.memKB > 0)
  const shared = eligible.filter((c) => c.memKB <= 0)
  const out: string[] = []
  let freed = 0
  for (const c of [...own, ...shared]) {
    if (freed >= needKB) break
    out.push(c.tabId)
    freed += c.memKB
  }
  return out
}

/** CPU % of one core between two cumulative CPU-seconds readings. */
export function cpuPercent(prevSec: number, curSec: number, dtMs: number): number {
  if (!(dtMs > 0) || curSec < prevSec) return 0
  return ((curSec - prevSec) / (dtMs / 1000)) * 100
}

export interface ProcSample {
  pid: number
  memKB: number
  cpu: number | null
}

export interface TabProcs {
  tabId: string
  pids: number[]
}

/**
 * Attributes processes to tabs. A process used by exactly one tab counts as
 * that tab's own memory / CPU; a process shared by several tabs (same-site
 * process reuse) is reported separately as shared and never split by guess.
 */
export function attribute(tabs: TabProcs[], procs: Map<number, ProcSample>): Map<string, { memKB: number | null; sharedKB: number; cpu: number | null; sharedWith: number }> {
  const users = new Map<number, Set<string>>()
  for (const t of tabs) for (const pid of t.pids) (users.get(pid) ?? users.set(pid, new Set()).get(pid)!).add(t.tabId)
  const out = new Map<string, { memKB: number | null; sharedKB: number; cpu: number | null; sharedWith: number }>()
  for (const t of tabs) {
    let mem: number | null = null
    let cpu: number | null = null
    let sharedKB = 0
    const others = new Set<string>()
    for (const pid of t.pids) {
      const p = procs.get(pid)
      if (!p) continue
      const u = users.get(pid)!
      if (u.size === 1) {
        mem = (mem ?? 0) + p.memKB
        if (p.cpu !== null) cpu = (cpu ?? 0) + p.cpu
      } else {
        sharedKB += p.memKB
        for (const o of u) if (o !== t.tabId) others.add(o)
      }
    }
    if (mem === null && sharedKB > 0) mem = 0
    out.set(t.tabId, { memKB: mem, sharedKB, cpu, sharedWith: others.size })
  }
  return out
}
