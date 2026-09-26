// Real measurements of SPECTER's own processes and per-tab attribution.
//
// Memory: Windows private bytes of every SPECTER process (app.getAppMetrics()).
// CPU: deltas of each process's cumulative CPU seconds, computed here so other
// callers of getAppMetrics() (which resets percentCPUUsage) don't disturb it.
import { app, webContents } from 'electron'
import os from 'node:os'
import type { TabReport } from '@shared/modules/control'
import { attribute, cpuPercent, type ProcSample } from './logic'

export interface Sample {
  at: number
  totalKB: number
  /** Sum of per-process CPU, % of one core. */
  cpuSum: number
  procs: Map<number, ProcSample>
}

const prevCpu = new Map<string, { sec: number; at: number }>()

export function sample(): Sample {
  const at = Date.now()
  const procs = new Map<number, ProcSample>()
  let totalKB = 0
  let cpuSum = 0
  const seen = new Set<string>()
  for (const m of app.getAppMetrics()) {
    const memKB = m.memory.privateBytes ?? m.memory.workingSetSize
    totalKB += memKB
    const key = `${m.pid}:${m.creationTime}`
    seen.add(key)
    let cpu: number | null = null
    const cum = m.cpu.cumulativeCPUUsage
    if (typeof cum === 'number') {
      const prev = prevCpu.get(key)
      if (prev) cpu = cpuPercent(prev.sec, cum, at - prev.at)
      prevCpu.set(key, { sec: cum, at })
    } else {
      cpu = m.cpu.percentCPUUsage
    }
    if (cpu !== null) cpuSum += cpu
    procs.set(m.pid, { pid: m.pid, memKB, cpu })
  }
  for (const k of prevCpu.keys()) if (!seen.has(k)) prevCpu.delete(k)
  return { at, totalKB, cpuSum, procs }
}

/** All renderer processes a tab uses: its main frame plus out-of-process iframes. */
export function tabPids(wcId: number | null): number[] {
  if (wcId === null) return []
  const wc = webContents.fromId(wcId)
  if (!wc || wc.isDestroyed()) return []
  const pids = new Set<number>()
  try {
    const main = wc.getOSProcessId()
    if (main > 0) pids.add(main)
  } catch {
    /* not ready */
  }
  try {
    for (const f of wc.mainFrame?.framesInSubtree ?? []) {
      try {
        if (f.osProcessId > 0) pids.add(f.osProcessId)
      } catch {
        /* frame detached */
      }
    }
  } catch {
    /* no frames */
  }
  return [...pids]
}

export function attributeTabs(reports: TabReport[], s: Sample) {
  const live = reports.filter((r) => !r.suspended && r.wcId !== null)
  const tabProcs = live.map((r) => ({ tabId: r.tabId, pids: tabPids(r.wcId) }))
  const usage = attribute(tabProcs, s.procs)
  return { usage, pids: new Map(tabProcs.map((t) => [t.tabId, t.pids])) }
}

export const cores = (): number => Math.max(1, os.cpus().length)
export const systemKB = (): number => Math.round(os.totalmem() / 1024)
