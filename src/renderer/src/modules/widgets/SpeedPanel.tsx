// Speed test side panel — Cloudflare endpoints, gauge, history.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Info, Play, Square, Timer, Trash2, Waves } from 'lucide-react'
import type { SpeedProgress, SpeedResult } from '@shared/modules/widgets'
import { invoke, on } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { Sparkline, Switch } from '../../components/ui'
import { confirmAction } from '../../components/prompt'
import { newTab } from '../../stores/browser'
import { errorText } from './store'
import './widgets.css'

// Log-like gauge scale: 0 → 1000+ Mbps over a 240° arc.
const STOPS = [0, 5, 10, 25, 50, 100, 250, 500, 1000]
function gaugeFrac(mbps: number): number {
  if (!(mbps > 0)) return 0
  if (mbps >= STOPS[STOPS.length - 1]) return 1
  for (let i = 1; i < STOPS.length; i++) {
    if (mbps <= STOPS[i]) return (i - 1 + (mbps - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1])) / (STOPS.length - 1)
  }
  return 1
}

const SWEEP = 240
const START = -120 // degrees from 12 o'clock
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from)
  const [x2, y2] = polar(cx, cy, r, to)
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`
}

export function fmtMbps(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
}

function Gauge({ mbps, phase }: { mbps: number | null; phase: string }) {
  const f = gaugeFrac(mbps ?? 0)
  const end = START + SWEEP * f
  const color = phase === 'upload' ? 'var(--accent-2)' : 'var(--accent)'
  return (
    <svg className="wg-gauge" viewBox="0 0 200 170" role="img" aria-label={`${fmtMbps(mbps)} megabits per second`}>
      <defs>
        <linearGradient id="wg-gauge-g" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent-2)" />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
      </defs>
      <path d={arc(100, 100, 78, START, START + SWEEP)} className="wg-gauge-track" />
      {f > 0.002 && <path d={arc(100, 100, 78, START, end)} stroke="url(#wg-gauge-g)" className="wg-gauge-val" />}
      {STOPS.map((s, i) => {
        const deg = START + (SWEEP * i) / (STOPS.length - 1)
        const [x, y] = polar(100, 100, 60, deg)
        const [a1, b1] = polar(100, 100, 69, deg)
        const [a2, b2] = polar(100, 100, 73, deg)
        return (
          <g key={s}>
            <line x1={a1} y1={b1} x2={a2} y2={b2} className="wg-gauge-tick" />
            <text x={x} y={y + 3} textAnchor="middle" className="wg-gauge-lbl">
              {s >= 1000 ? '1G' : s}
            </text>
          </g>
        )
      })}
      <text x="100" y="108" textAnchor="middle" className="wg-gauge-num">
        {fmtMbps(mbps)}
      </text>
      <text x="100" y="126" textAnchor="middle" className="wg-gauge-unit">
        Mbps
      </text>
    </svg>
  )
}

const PHASE_LABEL: Record<SpeedProgress['phase'], string> = { latency: 'Measuring latency…', download: 'Testing download…', upload: 'Testing upload…', done: 'Complete', error: 'Stopped' }

export default function SpeedPanel() {
  const [running, setRunning] = useState(false)
  const [upload, setUpload] = useState(true)
  const [prog, setProg] = useState<SpeedProgress | null>(null)
  const [last, setLast] = useState<SpeedResult | null>(null)
  const [history, setHistory] = useState<SpeedResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadHistory = () =>
    invoke('widgets:speedHistory')
      .then((h) => {
        setHistory(h)
        setLast((l) => l ?? h[0] ?? null)
      })
      .catch(() => undefined)
  useEffect(() => {
    loadHistory()
    return on('widgets:speedProgress', (p) => setProg(p))
  }, [])

  const start = async () => {
    setRunning(true)
    setError(null)
    setProg({ phase: 'latency', progress: 0 })
    try {
      const r = await invoke('widgets:speedRun', { upload })
      setLast(r)
      if (r.error) setError(r.error)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setRunning(false)
      loadHistory()
    }
  }

  const phase = running ? (prog?.phase ?? 'latency') : 'done'
  const live = running ? (prog?.mbps ?? null) : (last?.downMbps ?? null)
  const latency = running ? prog?.latencyMs : last?.latencyMs
  const jit = running ? prog?.jitterMs : last?.jitterMs
  const down = running ? (prog?.phase === 'download' ? prog.mbps : prog?.downMbps) : last?.downMbps
  const up = running ? (prog?.phase === 'upload' ? prog.mbps : prog?.upMbps) : last?.upMbps
  const downs = history.filter((h) => h.downMbps !== null).map((h) => h.downMbps!).reverse()

  return (
    <div className="wg wg-speed">
      <div className="wg-pad">
        <div className="wg-notice">
          <Info size={13} />
          <span>
            Runs only when you press Start. Test traffic (up to about 65 MB) and your IP address go to <b>Cloudflare</b> (speed.cloudflare.com).{' '}
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              onClick={(e) => {
                e.preventDefault()
                newTab('https://www.cloudflare.com/privacypolicy/')
              }}
            >
              Privacy policy
            </a>
          </span>
        </div>
        <div className="wg-gauge-wrap">
          <Gauge mbps={live} phase={phase} />
          <div className="wg-gauge-phase">
            {running ? PHASE_LABEL[phase] : last ? `${last.error ? 'Last test stopped' : 'Last test'} · ${timeAgo(last.at)}${last.colo ? ` · via ${last.colo}` : ''}` : 'Ready'}
          </div>
          {running && (
            <div className="wg-progress">
              <span style={{ width: `${Math.round((prog?.progress ?? 0) * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="wg-speed-stats">
          <div>
            <span className="label">
              <Timer size={11} /> Ping
            </span>
            <b className="num">{latency !== undefined && latency !== null ? `${latency.toFixed(0)} ms` : '—'}</b>
          </div>
          <div>
            <span className="label">
              <Waves size={11} /> Jitter
            </span>
            <b className="num">{jit !== undefined && jit !== null ? `${jit.toFixed(1)} ms` : '—'}</b>
          </div>
          <div>
            <span className="label">
              <ArrowDown size={11} /> Down
            </span>
            <b className="num">{fmtMbps(down)}</b>
          </div>
          <div>
            <span className="label">
              <ArrowUp size={11} /> Up
            </span>
            <b className="num">{fmtMbps(up)}</b>
          </div>
        </div>
        <div className="wg-form-row" style={{ marginTop: 12 }}>
          <Switch on={upload} onChange={setUpload} disabled={running} label="Include upload test" />
          <span className="dim" style={{ fontSize: 12 }}>
            Include upload
          </span>
          <span className="spacer" />
          {running ? (
            <button className="btn sm" onClick={() => invoke('widgets:speedCancel').catch(() => undefined)}>
              <Square size={11} /> Cancel
            </button>
          ) : (
            <button className="btn primary" onClick={start}>
              <Play size={12} /> Start test
            </button>
          )}
        </div>
        {error && !running && <div className="wg-warn-line">{error}</div>}

        <div className="wg-sec-h">
          <span className="label">History</span>
          <span className="spacer" />
          {downs.length > 1 && <Sparkline values={downs} width={90} height={18} />}
          {history.length > 0 && (
            <button
              className="icon-btn sm"
              onClick={async () => {
                if (await confirmAction('Clear speed test history?', undefined, 'Clear', true)) {
                  await invoke('widgets:speedClear').catch(() => undefined)
                  setLast(null)
                  loadHistory()
                }
              }}
              aria-label="Clear history"
              data-tip="Clear history"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {history.length ? (
          <table className="wg-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Down</th>
                <th>Up</th>
                <th>Ping</th>
                <th>Server</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 15).map((h) => (
                <tr key={h.id} title={h.error ? h.error : new Date(h.at).toLocaleString()}>
                  <td>{timeAgo(h.at)}</td>
                  <td className="num">{fmtMbps(h.downMbps)}</td>
                  <td className="num">{fmtMbps(h.upMbps)}</td>
                  <td className="num">{h.latencyMs !== null ? h.latencyMs.toFixed(0) : '—'}</td>
                  <td className="mono">{h.colo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="wg-muted-row">No results yet.</div>
        )}
        <p className="wg-fine">Download and upload are the 90th percentile of per-request throughput (Mbit/s); ping is the median round trip minus Cloudflare’s processing time. Results are stored only on this device.</p>
      </div>
    </div>
  )
}
