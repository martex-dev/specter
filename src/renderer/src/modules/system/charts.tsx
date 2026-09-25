// Small SVG charts for the system monitor. They only ever plot real samples;
// gaps in sampling (poller stopped / slowed) are drawn as gaps, not bridged.
import type { SystemMetrics } from '@shared/modules/system'
import { level } from './store'

export interface Series {
  key: string
  color: string
  get: (m: SystemMetrics) => number | null | undefined
  fill?: boolean
}

const VB_W = 600

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

export function LineChart({
  history,
  series,
  max,
  minMax = 1,
  height = 64,
  windowMs: windowProp,
  formatMax,
  label
}: {
  history: SystemMetrics[]
  series: Series[]
  /** Fixed y maximum (e.g. 100 for %). Auto-scaled when omitted. */
  max?: number
  /** Floor for the auto-scaled maximum. */
  minMax?: number
  height?: number
  windowMs?: number
  formatMax?: (v: number) => string
  label?: string
}) {
  const end = history.length ? history[history.length - 1].ts : Date.now()
  // Window grows with the data we actually have: 1 min → 5 min.
  const span = history.length ? end - history[0].ts : 0
  const windowMs = windowProp ?? Math.min(5 * 60_000, Math.max(60_000, Math.ceil(span / 60_000) * 60_000))
  const start = end - windowMs
  const pts = history.filter((m) => m.ts >= start)
  let hi = max ?? 0
  if (max === undefined) {
    for (const m of pts)
      for (const s of series) {
        const v = s.get(m)
        if (v !== null && v !== undefined && v > hi) hi = v
      }
    hi = niceMax(Math.max(minMax, hi * 1.1))
  }
  const H = height
  const x = (ts: number) => ((ts - start) / windowMs) * VB_W
  const y = (v: number) => H - 1 - (Math.min(v, hi) / hi) * (H - 3)

  const paths = series.map((s) => {
    let d = ''
    let area = ''
    let segStart: number | null = null
    let lastX = 0
    let prevTs = 0
    for (const m of pts) {
      const v = s.get(m)
      const gap = prevTs && m.ts - prevTs > Math.max(3 * (m.intervalMs || 2000), 6000)
      prevTs = m.ts
      if (v === null || v === undefined || !Number.isFinite(v) || gap) {
        if (segStart !== null && s.fill) area += `L${lastX.toFixed(1)},${H} L${segStart.toFixed(1)},${H} Z `
        segStart = null
        if (v === null || v === undefined || !Number.isFinite(v)) continue
      }
      const px = x(m.ts)
      const py = y(v)
      if (segStart === null) {
        d += `M${px.toFixed(1)},${py.toFixed(1)} `
        if (s.fill) area += `M${px.toFixed(1)},${py.toFixed(1)} `
        segStart = px
      } else {
        d += `L${px.toFixed(1)},${py.toFixed(1)} `
        if (s.fill) area += `L${px.toFixed(1)},${py.toFixed(1)} `
      }
      lastX = px
    }
    if (segStart !== null && s.fill) area += `L${lastX.toFixed(1)},${H} L${segStart.toFixed(1)},${H} Z`
    return { s, d, area }
  })

  const mins = Math.round(windowMs / 60_000)
  return (
    <div className="sys-chart" style={{ height }} aria-label={label} role="img">
      <svg viewBox={`0 0 ${VB_W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={VB_W} y1={H - 1 - f * (H - 3)} y2={H - 1 - f * (H - 3)} className="sys-gridline" vectorEffect="non-scaling-stroke" />
        ))}
        {paths.map(({ s, area }) => s.fill && area && <path key={s.key + 'a'} d={area} fill={s.color} opacity={0.1} stroke="none" />)}
        {paths.map(({ s, d }) => d && <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <span className="sys-chart-max">{formatMax ? formatMax(hi) : hi}</span>
      <span className="sys-chart-x">−{mins} min</span>
      {pts.length < 2 && <span className="sys-chart-wait">Collecting samples…</span>}
    </div>
  )
}

export function Meter({ value, max = 100, className = '', title }: { value: number | null | undefined; max?: number; className?: string; title?: string }) {
  const p = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={'sys-meter ' + className} title={title}>
      <i className={level(p)} style={{ width: `${p}%` }} />
    </div>
  )
}

export function CoreGrid({ perCore, height = 44 }: { perCore: number[]; height?: number }) {
  return (
    <div className="sys-cores" style={{ height, gridTemplateColumns: `repeat(${Math.min(perCore.length, 32)}, minmax(0, 1fr))` }}>
      {perCore.map((v, i) => (
        <div key={i} className="sys-core" data-tip={`CPU ${i} · ${v.toFixed(0)}%`}>
          <i className={level(v)} style={{ height: `${Math.max(0, Math.min(100, v))}%` }} />
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { color: string; label: string; value?: string }[] }) {
  return (
    <div className="sys-legend">
      {items.map((i) => (
        <span key={i.label}>
          <b style={{ background: i.color }} />
          {i.label}
          {i.value !== undefined && <em>{i.value}</em>}
        </span>
      ))}
    </div>
  )
}
