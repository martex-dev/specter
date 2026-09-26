// GX-style circular gauge: 270° arc with tick ring, theme-gradient fill and an
// optional marker (e.g. the RAM limit). Colours come from CSS variables only.
import { useId, type ReactNode } from 'react'

const START = 135 // degrees, clockwise from +x axis
const SWEEP = 270

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from)
  const [x2, y2] = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

export function Gauge({
  value,
  size = 132,
  label,
  center,
  sub,
  state = 'normal',
  marker,
  ticks = 36,
  disabled
}: {
  /** 0..1 (values above 1 are drawn full and flagged). */
  value: number | null
  size?: number
  label: string
  center: ReactNode
  sub?: ReactNode
  state?: 'normal' | 'warn' | 'bad'
  /** 0..1 position of a marker notch. */
  marker?: number
  ticks?: number
  disabled?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const c = 50
  const r = 40
  const v = value === null ? 0 : Math.max(0, Math.min(1, value))
  const end = START + SWEEP * v
  const tickEls = []
  for (let i = 0; i <= ticks; i++) {
    const deg = START + (SWEEP * i) / ticks
    const major = i % 6 === 0
    const [x1, y1] = polar(c, c, 48.5, deg)
    const [x2, y2] = polar(c, c, major ? 45 : 46.5, deg)
    const lit = value !== null && i / ticks <= v
    tickEls.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={'g-tick' + (major ? ' major' : '') + (lit ? ' lit' : '')} />)
  }
  const mk = marker !== undefined ? polar(c, c, r, START + SWEEP * Math.max(0, Math.min(1, marker))) : null
  const mkOuter = marker !== undefined ? polar(c, c, r + 7, START + SWEEP * Math.max(0, Math.min(1, marker))) : null
  return (
    <div className={'ctl-gauge ' + state + (disabled ? ' disabled' : '')} style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(v * 100)}>
      <svg viewBox="0 0 100 100">
        <defs>
          <linearGradient id={'g' + id} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" className="g-stop-a" />
            <stop offset="1" className="g-stop-b" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={33} className="g-inner" />
        {tickEls}
        <path d={arc(c, c, r, START, START + SWEEP)} className="g-track" />
        {value !== null && v > 0.002 && <path d={arc(c, c, r, START, Math.max(START + 0.5, end))} className="g-fill" stroke={`url(#g${id})`} />}
        {mk && mkOuter && <line x1={mk[0]} y1={mk[1]} x2={mkOuter[0]} y2={mkOuter[1]} className="g-marker" />}
      </svg>
      <div className="g-center">
        <span className="g-label">{label}</span>
        <span className="g-value">{center}</span>
        {sub && <span className="g-sub">{sub}</span>}
      </div>
    </div>
  )
}
