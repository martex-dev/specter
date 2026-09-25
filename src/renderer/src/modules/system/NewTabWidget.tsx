// New-tab card: CPU / RAM / GPU with sparklines. Only mounts (and therefore
// only keeps the poller alive) when newtab.showSystem is on.
import { Activity } from 'lucide-react'
import { Sparkline } from '../../components/ui'
import { useSetting } from '../../stores/settings'
import { runCommand } from '../../lib/commands'
import { Meter } from './charts'
import { cpuPct, fmtGB, fmtPct, memPct, primaryGpu, useMetrics } from './store'
import './system.css'

function Live() {
  const { latest, history } = useMetrics()
  const recent = history.slice(-45)
  const gpu = primaryGpu(latest)
  const rows = [
    { k: 'CPU', v: cpuPct(latest), s: recent.map((m) => cpuPct(m) ?? 0), sub: latest ? `${latest.cpu.perCore.length} threads${latest.cpu.utility?.total != null ? ' · utility' : ''}` : '' },
    { k: 'RAM', v: memPct(latest), s: recent.map((m) => memPct(m) ?? 0), sub: latest ? `${fmtGB(latest.mem.used)} / ${fmtGB(latest.mem.total, 0)}` : '' },
    ...(gpu
      ? [{ k: 'GPU', v: gpu.util, s: recent.map((m) => m.gpu?.[0]?.util).filter((x): x is number => typeof x === 'number'), sub: `${gpu.temp !== null ? gpu.temp + ' °C · ' : ''}${fmtGB(gpu.memUsed)} VRAM` }]
      : [])
  ]
  return (
    <div className="ntp-card sys-ntp" role="button" tabIndex={0} onClick={() => runCommand('system.openMonitor')} onKeyDown={(e) => e.key === 'Enter' && runCommand('system.openMonitor')}>
      <div className="ntp-card-h">
        <Activity size={13} className="muted" />
        <span className="label">System</span>
        <span className="spacer" />
        {latest && latest.gpu === null && <span className="dim" style={{ fontSize: 10.5 }}>GPU unavailable</span>}
      </div>
      {rows.map((r) => (
        <div key={r.k} className="sys-ntp-row">
          <span className="label">{r.k}</span>
          <b className="num">{fmtPct(r.v)}</b>
          <Meter value={r.v} />
          <Sparkline values={r.s} width={70} height={16} max={100} />
          <span className="dim sys-ntp-sub">{r.sub}</span>
        </div>
      ))}
    </div>
  )
}

export default function SystemNewTabWidget() {
  const show = useSetting('newtab.showSystem')
  return show ? <Live /> : null
}
