// Lightweight, real performance measurements shown in Diagnostics.
// Nothing is estimated: every sample is a measured duration in this session.
export type Metric = 'startup' | 'tabCreate' | 'paletteOpen' | 'omniboxSuggest' | 'historySearch' | 'workspaceSwitch'

const samples = new Map<Metric, number[]>()
const pending = new Map<string, number>()

export function record(metric: Metric, ms: number): void {
  const list = samples.get(metric) ?? []
  list.push(ms)
  if (list.length > 100) list.shift()
  samples.set(metric, list)
}

/** Starts a timer identified by key; `end` records the elapsed time. */
export function begin(key: string): void {
  pending.set(key, performance.now())
}

export function end(key: string, metric: Metric): void {
  const t0 = pending.get(key)
  if (t0 === undefined) return
  pending.delete(key)
  record(metric, performance.now() - t0)
}

export function summary(): { metric: Metric; count: number; median: number; p95: number; last: number }[] {
  const out: { metric: Metric; count: number; median: number; p95: number; last: number }[] = []
  for (const [metric, list] of samples) {
    if (!list.length) continue
    const sorted = [...list].sort((a, b) => a - b)
    out.push({ metric, count: list.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], last: list[list.length - 1] })
  }
  return out
}

export const METRIC_LABEL: Record<Metric, string> = {
  startup: 'Interface startup (navigation start → first render)',
  tabCreate: 'New tab → page DOM ready',
  paletteOpen: 'Command palette open → rendered',
  omniboxSuggest: 'Address-bar suggestions computed',
  historySearch: 'History search round-trip',
  workspaceSwitch: 'Workspace switch'
}
