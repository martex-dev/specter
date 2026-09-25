// specter://system — full system monitor. Sub-routes: /processes, /network, /performance.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Cpu, Gauge, MemoryStick } from 'lucide-react'
import type { PageProps } from '../../pages/registry'
import { Seg, Sparkline } from '../../components/ui'
import { useSetting } from '../../stores/settings'
import { newTab } from '../../stores/browser'
import { NetCard, Overview, SamplerFoot, useSystemInfo } from './Overview'
import Processes from './Processes'
import NetworkDiag from './NetworkDiag'
import { ModesView, SpecterDashboardView } from './Performance'
import { cpuPct, fmtGB, fmtPct, fmtRate, memPct, primaryGpu, useMetrics } from './store'
import './system.css'

type View = 'overview' | 'processes' | 'network' | 'performance'
const VIEWS: View[] = ['overview', 'processes', 'network', 'performance']

function toView(sub: string): View {
  const v = sub.split('/')[0] as View
  return VIEWS.includes(v) ? v : 'overview'
}

function QuickStats() {
  const { latest, history } = useMetrics()
  const mode = useSetting('performance.mode')
  const recent = history.slice(-60)
  const gpu = primaryGpu(latest)
  const spark = (get: (i: number) => number | null | undefined) =>
    recent.map((_, i) => get(i)).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v))
  const cards = [
    {
      id: 'cpu',
      icon: <Cpu size={13} />,
      label: 'CPU',
      v: fmtPct(cpuPct(latest)),
      s: latest ? (latest.cpu.utility?.total != null ? `utility · processor time ${fmtPct(latest.cpu.total)}` : 'processor time') : '—',
      spark: spark((i) => cpuPct(recent[i])),
      max: 100
    },
    {
      id: 'ram',
      icon: <MemoryStick size={13} />,
      label: 'Memory',
      v: fmtPct(memPct(latest)),
      s: latest ? `${fmtGB(latest.mem.used)} / ${fmtGB(latest.mem.total, 0)}` : '—',
      spark: spark((i) => memPct(recent[i])),
      max: 100
    },
    {
      id: 'gpu',
      icon: <Gauge size={13} />,
      label: 'GPU',
      v: gpu ? fmtPct(gpu.util) : latest ? 'Unavailable' : '—',
      s: gpu ? `${gpu.temp !== null ? gpu.temp + ' °C · ' : ''}VRAM ${fmtGB(gpu.memUsed)}` : 'no GPU telemetry source',
      spark: spark((i) => recent[i].gpu?.[0]?.util),
      max: 100
    },
    {
      id: 'net',
      icon: <ArrowDown size={13} />,
      label: 'Network',
      v: latest?.net ? fmtRate(latest.net.rxBps) : '—',
      s: latest?.net ? (
        <>
          <ArrowUp size={10} /> {fmtRate(latest.net.txBps)}
        </>
      ) : (
        'waiting for samples'
      ),
      spark: spark((i) => recent[i].net?.rxBps),
      max: undefined
    }
  ]
  if (mode === 'ml') cards.sort((a, b) => (a.id === 'gpu' ? -1 : b.id === 'gpu' ? 1 : 0))
  return (
    <div className="grid-4">
      {cards.map((c) => (
        <div key={c.id} className="card stat sys-stat">
          <div className="row">
            <span className="muted">{c.icon}</span>
            <span className="label grow">{c.label}</span>
            <Sparkline values={c.spark} width={64} height={18} max={c.max} />
          </div>
          <div className="v">{c.v}</div>
          <div className="s">{c.s}</div>
        </div>
      ))}
    </div>
  )
}

export default function SystemPage({ sub }: PageProps) {
  const [view, setView] = useState<View>(toView(sub))
  useEffect(() => setView(toView(sub)), [sub])
  const { latest, history, status } = useMetrics()
  const info = useSystemInfo()

  return (
    <div className="page wide sys-page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">System</div>
          <h1 className="page-title">Monitor</h1>
          <div className="page-sub">
            Live, local measurements of this computer{info ? ` · ${info.os} · ${info.arch}` : ''}. Nothing here leaves your machine unless you run a network check.
          </div>
        </div>
        <Seg<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'processes', label: 'Processes' },
            { value: 'network', label: 'Network' },
            { value: 'performance', label: 'Performance' }
          ]}
        />
      </div>

      {view === 'overview' && (
        <div className="col" style={{ gap: 14 }}>
          <QuickStats />
          <Overview latest={latest} history={history} status={status} />
        </div>
      )}
      {view === 'processes' && <Processes />}
      {view === 'network' && (
        <div className="col" style={{ gap: 14 }}>
          <NetCard latest={latest} history={history} status={status} />
          <div className="section-title" style={{ marginTop: 8 }}>
            Diagnostics <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· on demand, one request per check</span>
          </div>
          <NetworkDiag />
        </div>
      )}
      {view === 'performance' && (
        <div className="col" style={{ gap: 14 }}>
          <SpecterDashboardView history={history} latest={latest} />
          <div className="section-title" style={{ marginTop: 14 }}>
            Performance mode
            <button className="btn sm ghost" onClick={() => newTab('specter://settings/performance')} style={{ marginLeft: 'auto' }}>
              Telemetry refresh settings
            </button>
          </div>
          <ModesView />
        </div>
      )}
      <SamplerFoot status={status} latest={latest} />
    </div>
  )
}
