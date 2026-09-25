// SPECTER's own footprint (processes, CPU, memory, tabs) and an honest
// explanation of what each performance mode changes.
import { useEffect, useMemo, useState } from 'react'
import { Moon, RefreshCw, Zap } from 'lucide-react'
import type { PerformanceMode } from '@shared/settings'
import type { SpecterDashboard, SystemMetrics } from '@shared/modules/system'
import { invoke } from '../../lib/ipc'
import { formatBytes, formatDuration } from '../../lib/format'
import { setPerformanceMode } from '../../commands/core'
import { suspendAllBackground, useBrowser } from '../../stores/browser'
import { useSetting } from '../../stores/settings'
import { toggleSidePanel } from '../../stores/ui'
import { LineChart } from './charts'
import { fmtPct } from './store'

function useTabCounts(): { active: number; sleeping: number; workspaces: number } {
  const key = useBrowser((s) => {
    let a = 0
    let z = 0
    for (const ws of Object.values(s.open))
      for (const t of ws.tabs) {
        if (t.suspended) z++
        else a++
      }
    return `${a}:${z}:${Object.keys(s.open).length}`
  })
  const [active, sleeping, workspaces] = key.split(':').map(Number)
  return { active, sleeping, workspaces }
}

export function SpecterDashboardView({ history, latest }: { history: SystemMetrics[]; latest: SystemMetrics | null }) {
  const [dash, setDash] = useState<SpecterDashboard | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const tabs = useTabCounts()

  useEffect(() => {
    let alive = true
    const load = () =>
      invoke('system:specter')
        .then((d) => alive && (setDash(d), setErr(null)))
        .catch((e) => alive && setErr(String(e?.message ?? e)))
    load()
    const i = setInterval(load, 4000)
    return () => {
      alive = false
      clearInterval(i)
    }
  }, [])

  const byType = useMemo(() => {
    const m = new Map<string, { n: number; kb: number }>()
    for (const p of dash?.processes ?? []) {
      const r = m.get(p.type) ?? { n: 0, kb: 0 }
      r.n++
      r.kb += p.memoryKB
      m.set(p.type, r)
    }
    return [...m.entries()].sort((a, b) => b[1].kb - a[1].kb)
  }, [dash])

  const s = latest?.specter
  const memPctOfMachine = s && latest ? ((s.memKB * 1024) / latest.mem.total) * 100 : null

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="grid-4">
        <div className="card stat">
          <div className="label">SPECTER CPU</div>
          <div className="v">{fmtPct(s?.cpu ?? null, 1)}</div>
          <div className="s">of total machine CPU</div>
        </div>
        <div className="card stat">
          <div className="label">SPECTER memory</div>
          <div className="v">{s ? formatBytes(s.memKB * 1024) : '—'}</div>
          <div className="s">private · {fmtPct(memPctOfMachine, 1)} of RAM</div>
        </div>
        <div className="card stat">
          <div className="label">Processes</div>
          <div className="v">{dash?.processes.length ?? s?.processes ?? '—'}</div>
          <div className="s">{byType.map(([t, r]) => `${r.n} ${t}`).join(' · ') || '—'}</div>
        </div>
        <div className="card stat">
          <div className="label">Tabs (this window)</div>
          <div className="v">
            <Zap size={15} className="muted" /> {tabs.active} <Moon size={15} className="muted" style={{ marginLeft: 6 }} /> {tabs.sleeping}
          </div>
          <div className="s">
            active · sleeping · {tabs.workspaces} open workspace{tabs.workspaces === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <section className="card sys-card">
          <div className="sys-card-h">
            <span className="label">SPECTER CPU · % of machine</span>
          </div>
          <LineChart history={history} series={[{ key: 's', color: 'var(--accent)', get: (m) => m.specter.cpu, fill: true }]} minMax={5} formatMax={(v) => `${v}%`} label="SPECTER CPU history" />
        </section>
        <section className="card sys-card">
          <div className="sys-card-h">
            <span className="label">SPECTER memory</span>
          </div>
          <LineChart history={history} series={[{ key: 's', color: 'var(--info)', get: (m) => m.specter.memKB * 1024, fill: true }]} minMax={256 * 1048576} formatMax={(v) => formatBytes(v, 0)} label="SPECTER memory history" />
        </section>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={suspendAllBackground} data-tip="Unloads every background tab in this window (they reload when you open them)">
          <Moon size={12} /> Sleep background tabs
        </button>
        <button className="btn sm ghost" onClick={() => toggleSidePanel('tabs')}>
          Tabs & memory panel
        </button>
        <span className="spacer" />
        {dash && (
          <span className="dim" style={{ fontSize: 11.5 }}>
            SPECTER uptime {formatDuration(dash.uptimeSec)} · <RefreshCw size={10} /> every 4 s
          </span>
        )}
      </div>

      {err && <div className="sys-unavail"><span className="badge warn">Error</span><span>{err}</span></div>}
      <div className="card" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>PID</th>
              <th style={{ width: 110 }}>Type</th>
              <th>Page / role</th>
              <th style={{ textAlign: 'right', width: 110 }} data-tip="Share of one logical processor since the previous measurement">CPU (1 core)</th>
              <th style={{ textAlign: 'right', width: 110 }}>Memory</th>
            </tr>
          </thead>
          <tbody>
            {[...(dash?.processes ?? [])]
              .sort((a, b) => b.memoryKB - a.memoryKB)
              .map((p) => (
                <tr key={p.pid}>
                  <td className="mono dim">{p.pid}</td>
                  <td>{p.type}</td>
                  <td className="ellipsis" style={{ maxWidth: 380 }} title={p.url}>
                    {p.title || p.name || p.url || '—'}
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {p.cpu.toFixed(1)}%
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {formatBytes(p.memoryKB * 1024)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!dash && !err && <div className="empty">Reading SPECTER processes…</div>}
      </div>
    </div>
  )
}

const MODES: { id: PerformanceMode; label: string; tabs: string; motion: string; telemetry: string; hud: string }[] = [
  { id: 'normal', label: 'Normal', tabs: 'Your “sleep inactive tabs” setting', motion: 'Your motion setting', telemetry: 'Telemetry refresh setting', hud: 'CPU · RAM · GPU' },
  { id: 'coding', label: 'Coding', tabs: 'Stay awake twice as long before sleeping', motion: 'Same as Normal', telemetry: 'Same as Normal', hud: 'Same as Normal' },
  { id: 'ml', label: 'ML', tabs: 'Same as Normal', motion: 'Reduced (when motion is “Full”)', telemetry: 'Same as Normal', hud: 'GPU first; GPU card first in the monitor' },
  { id: 'research', label: 'Research', tabs: 'Stay awake twice as long before sleeping', motion: 'Same as Normal', telemetry: 'Same as Normal', hud: 'Same as Normal' },
  { id: 'trading', label: 'Trading', tabs: 'Finance / trading pages never sleep', motion: 'Same as Normal', telemetry: 'Same as Normal', hud: 'Same as Normal' },
  { id: 'gaming', label: 'Gaming', tabs: 'Background tabs sleep after ≤ 5 min (≤ 2.5 min in inactive workspaces)', motion: 'Reduced (when motion is “Full”)', telemetry: '2.5× slower, at least every 5 s', hud: 'Same as Normal' },
  { id: 'battery', label: 'Battery', tabs: 'Background tabs sleep after ≤ 5 min (≤ 2.5 min in inactive workspaces)', motion: 'Reduced (when motion is “Full”)', telemetry: '2.5× slower, at least every 5 s', hud: 'Same as Normal' }
]

export function ModesView() {
  const mode = useSetting('performance.mode')
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="sys-sub" style={{ maxWidth: 760, lineHeight: 1.55 }}>
        Performance modes only change how <b>SPECTER itself</b> behaves. They do <b>not</b> change the Windows power plan, process priorities, CPU/GPU clocks, driver settings or other applications. Modes marked “Same as Normal” currently change nothing in the browser core or this monitor; other SPECTER modules may read the mode to adjust their own background work.
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="table sys-modes">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Mode</th>
              <th>Tab sleeping</th>
              <th>Animations</th>
              <th>System telemetry</th>
              <th>HUD</th>
            </tr>
          </thead>
          <tbody>
            {MODES.map((m) => (
              <tr key={m.id} className={mode === m.id ? 'on' : undefined}>
                <td>
                  <button className={'btn sm ' + (mode === m.id ? 'primary' : 'ghost')} onClick={() => mode !== m.id && setPerformanceMode(m.id)} aria-pressed={mode === m.id}>
                    {m.label}
                  </button>
                </td>
                <td className={m.tabs === 'Same as Normal' ? 'dim' : undefined}>{m.tabs}</td>
                <td className={m.motion === 'Same as Normal' ? 'dim' : undefined}>{m.motion}</td>
                <td className={m.telemetry === 'Same as Normal' ? 'dim' : undefined}>{m.telemetry}</td>
                <td className={m.hud === 'Same as Normal' ? 'dim' : undefined}>{m.hud}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sys-foot">
        In every mode, telemetry also slows down automatically while no SPECTER window is focused (≥ 4 s) or all are minimised (≥ 10 s), and stops completely when nothing on screen shows it.
      </div>
    </div>
  )
}
