export function formatBytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return '—'
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts
  if (d < 45_000) return 'just now'
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`
  if (d < 7 * 86_400_000) return `${Math.round(d / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString()
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatNumber(n: number | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return new Intl.NumberFormat(undefined, opts).format(n)
}

export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 8
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits }).format(n)
}

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

export function pct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  // Sign follows the displayed value: 0 and values that round to zero show no sign ("0.00%").
  const r = Number(n.toFixed(digits))
  return `${r > 0 ? '+' : ''}${(r === 0 ? 0 : r).toFixed(digits)}%`
}

export function faviconFallback(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 1).toUpperCase()
  } catch {
    return '•'
  }
}
