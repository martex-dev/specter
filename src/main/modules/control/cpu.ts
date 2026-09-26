// CPU limiter for background tabs: Chromium's DevTools-protocol CPU throttling
// (Emulation.setCPUThrottlingRate) on tab guests that are not visible. It slows
// the page's main-thread JavaScript / layout by the chosen factor. Tabs with
// DevTools open, tabs another debugger client owns, and tabs sharing a renderer
// process with a visible tab (throttling is per process) are left alone.
import { webContents, type WebContents } from 'electron'
import type { TabReport } from '@shared/modules/control'
import { createLogger } from '../../logger'
import { getConfig } from './config'
import { acquire, heldIds, holds, onExternalDetach, releasePurpose, send } from './debug'
import { tabPids } from './metrics'

const log = createLogger('control')
const rates = new Map<number, number>()
const skipped = new Map<number, string>()
const hooked = new WeakSet<WebContents>()

export function isThrottled(wcId: number | null): boolean {
  return wcId !== null && holds(wcId, 'cpu')
}

export function throttleSkipReason(wcId: number | null): string | undefined {
  return wcId === null ? undefined : skipped.get(wcId)
}

export function throttledCount(): number {
  return heldIds('cpu').length
}

onExternalDetach((id) => rates.delete(id))

function hook(wc: WebContents): void {
  if (hooked.has(wc)) return
  hooked.add(wc)
  const id = wc.id
  wc.on('devtools-opened', () => {
    if (holds(id, 'cpu')) void release(id, 'DevTools open')
  })
  wc.once('destroyed', () => {
    rates.delete(id)
    skipped.delete(id)
  })
}

async function apply(wc: WebContents, rate: number): Promise<void> {
  if (holds(wc.id, 'cpu') && rates.get(wc.id) === rate) return
  hook(wc)
  if (!acquire(wc, 'cpu')) {
    skipped.set(wc.id, 'Another debugger is attached')
    return
  }
  await send(wc, 'Emulation.setCPUThrottlingRate', { rate })
  rates.set(wc.id, rate)
  skipped.delete(wc.id)
}

async function release(wcId: number, reason?: string): Promise<void> {
  if (reason) skipped.set(wcId, reason)
  else skipped.delete(wcId)
  if (!holds(wcId, 'cpu')) return
  rates.delete(wcId)
  const wc = webContents.fromId(wcId)
  if (wc && !wc.isDestroyed()) await send(wc, 'Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined)
  releasePurpose(wcId, 'cpu')
}

let running: Promise<void> = Promise.resolve()

/** Applies / removes throttling so it matches the current tab visibility and config. */
export function reconcileCpu(reports: TabReport[]): Promise<void> {
  running = running.then(() => doReconcile(reports)).catch((err) => log.warn('cpu limiter reconcile failed', err))
  return running
}

async function doReconcile(reports: TabReport[]): Promise<void> {
  const cfg = getConfig().cpu
  const want = new Set<number>()
  if (cfg.enabled) {
    const visiblePids = new Set<number>()
    for (const r of reports) if (r.visible && !r.suspended) tabPids(r.wcId).forEach((p) => visiblePids.add(p))
    for (const r of reports) {
      if (r.visible || r.suspended || r.internal || r.wcId === null) continue
      const wc = webContents.fromId(r.wcId)
      if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') continue
      if (wc.isDevToolsOpened()) {
        skipped.set(wc.id, 'DevTools open')
        continue
      }
      let pid = -1
      try {
        pid = wc.getOSProcessId()
      } catch {
        /* not ready */
      }
      if (pid > 0 && visiblePids.has(pid)) {
        skipped.set(wc.id, 'Shares a process with a visible tab')
        continue
      }
      want.add(r.wcId)
    }
  }
  // Un-throttle tabs that became visible / closed, or everything when disabled.
  for (const id of heldIds('cpu')) if (!want.has(id)) await release(id)
  for (const id of [...skipped.keys()]) {
    const r = reports.find((x) => x.wcId === id)
    if (!cfg.enabled || !r || r.visible || r.suspended) skipped.delete(id)
  }
  for (const id of want) {
    const wc = webContents.fromId(id)
    if (!wc || wc.isDestroyed()) continue
    try {
      await apply(wc, cfg.rate)
    } catch (err) {
      await release(id, 'Could not throttle: ' + (err instanceof Error ? err.message : String(err)))
    }
  }
}

export async function releaseAllCpu(): Promise<void> {
  for (const id of heldIds('cpu')) await release(id)
}
