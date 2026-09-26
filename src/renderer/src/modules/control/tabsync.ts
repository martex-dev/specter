// Reports this window's tabs to the main process (which owns the RAM / CPU
// limiters and the hot-tabs measurements) and performs sleep requests.
// Only runs while a limiter is enabled or the Control panel is open.
import type { TabReport } from '@shared/modules/control'
import { isInternal } from '@shared/url'
import { invoke, on } from '../../lib/ipc'
import { wcIdFor } from '../../lib/webviews'
import { findTab, suspendTab, useBrowser, visibleTabIds } from '../../stores/browser'
import { useControl } from './store'

let unsubBrowser: (() => void) | null = null
let safety: number | undefined
let debounce: number | undefined
let lastSent = ''
let lastVisible = ''

export function collectReports(): TabReport[] {
  const s = useBrowser.getState()
  const out: TabReport[] = []
  for (const ws of Object.values(s.open)) {
    const visible = new Set(ws.id === s.activeWsId ? visibleTabIds(ws) : [])
    for (const t of ws.tabs) {
      out.push({
        tabId: t.id,
        wcId: t.suspended ? null : wcIdFor(t.id),
        title: t.title || t.url,
        url: t.url,
        visible: visible.has(t.id),
        pinned: !!t.pinned,
        audible: !!t.audible && !t.muted,
        suspended: !!t.suspended,
        internal: isInternal(t.url),
        lastActive: t.lastActive
      })
    }
  }
  return out
}

function flush(force = false): void {
  clearTimeout(debounce)
  debounce = undefined
  const reports = collectReports()
  const digest = JSON.stringify(reports)
  if (!force && digest === lastSent) return
  lastSent = digest
  invoke('control:syncTabs', reports).catch(() => undefined)
}

function schedule(): void {
  const s = useBrowser.getState()
  const vis = Object.values(s.open)
    .map((ws) => (ws.id === s.activeWsId ? visibleTabIds(ws).join(',') : ''))
    .join('|')
  // Visibility changes are sent at once so a tab is un-throttled as soon as it is shown.
  if (vis !== lastVisible) {
    lastVisible = vis
    flush()
    return
  }
  if (debounce === undefined) debounce = window.setTimeout(() => flush(), 500)
}

function wanted(): boolean {
  const { config, panelOpen } = useControl.getState()
  return panelOpen > 0 || !!(config && (config.ram.enabled || config.cpu.enabled))
}

function update(): void {
  const want = wanted()
  if (want && !unsubBrowser) {
    unsubBrowser = useBrowser.subscribe(schedule)
    // Webviews become "ready" without a store change; re-check periodically (sends only on change).
    safety = window.setInterval(() => flush(), 4000)
    flush(true)
  } else if (!want && unsubBrowser) {
    unsubBrowser()
    unsubBrowser = null
    clearInterval(safety)
    clearTimeout(debounce)
    debounce = undefined
  }
}

async function handleSleep(requestId: string, tabIds: string[]): Promise<void> {
  const slept: string[] = []
  await Promise.all(
    tabIds.map(async (id) => {
      const f = findTab(id)
      if (!f || f.tab.suspended) return
      try {
        await suspendTab(id)
      } catch {
        /* ignore */
      }
      if (findTab(id)?.tab.suspended) slept.push(id)
    })
  )
  flush()
  await invoke('control:sleepDone', requestId, slept).catch(() => undefined)
}

export function startTabSync(): void {
  on('control:sleepRequest', (req) => void handleSleep(req.requestId, req.tabIds))
  useControl.subscribe(update)
  update()
}
