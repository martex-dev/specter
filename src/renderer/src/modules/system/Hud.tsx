// Title-bar telemetry: CPU · RAM · GPU with micro bars. Clicking opens the
// system panel. In ML mode the GPU readout comes first.
import { Fragment, type ReactNode } from 'react'
import { useSetting } from '../../stores/settings'
import { toggleSidePanel } from '../../stores/ui'
import { cpuPct, fmtGB, fmtPct, level, memPct, perCorePct, primaryGpu, useMetrics } from './store'

function Bar({ v }: { v: number | null }) {
  return (
    <span className="hud-bar">
      <i className={'sys-hud-fill ' + level(v)} style={{ width: `${v === null ? 0 : Math.max(3, Math.min(100, v))}%` }} />
    </span>
  )
}

export default function SystemHud() {
  const { latest, status } = useMetrics()
  const mode = useSetting('performance.mode')
  const cpu = cpuPct(latest)
  const mem = memPct(latest)
  const gpu = primaryGpu(latest)
  const gpuUnavailable = latest !== null && latest.gpu === null
  const cores = perCorePct(latest).values
  const hottest = cores.length ? Math.max(...cores) : null
  const cpuTip = !latest
    ? 'CPU — waiting for first sample'
    : latest.cpu.utility?.total != null
      ? `CPU utility ${fmtPct(cpu, 1)} (as in Task Manager) · processor time ${fmtPct(latest.cpu.total, 1)} · busiest core ${fmtPct(hottest)}`
      : `CPU processor time ${fmtPct(cpu, 1)} · busiest core ${fmtPct(hottest)} · ${latest.cpu.perCore.length} logical processors`

  const items: { id: string; node: ReactNode }[] = [
    {
      id: 'cpu',
      node: (
        <button className="hud-item sys-hud" onClick={() => toggleSidePanel('system')} data-tip={cpuTip}>
          CPU <b>{fmtPct(cpu)}</b>
          <Bar v={cpu} />
        </button>
      )
    },
    {
      id: 'ram',
      node: (
        <button className="hud-item sys-hud" onClick={() => toggleSidePanel('system')} data-tip={latest ? `Memory ${fmtGB(latest.mem.used)} of ${fmtGB(latest.mem.total, 0)} in use` : 'Memory — waiting for first sample'}>
          RAM <b>{fmtPct(mem)}</b>
          <Bar v={mem} />
        </button>
      )
    }
  ]
  if (gpu) {
    items.push({
      id: 'gpu',
      node: (
        <button
          className="hud-item sys-hud"
          onClick={() => toggleSidePanel('system')}
          data-tip={`${gpu.name} · ${fmtPct(gpu.util)} util · VRAM ${fmtGB(gpu.memUsed)} / ${fmtGB(gpu.memTotal, 0)}${gpu.temp !== null ? ` · ${gpu.temp}°C` : ''}${gpu.power !== null ? ` · ${gpu.power.toFixed(0)} W` : ''}`}
        >
          GPU <b>{fmtPct(gpu.util)}</b>
          <Bar v={gpu.util} />
        </button>
      )
    })
  } else if (mode === 'ml' && gpuUnavailable) {
    items.push({
      id: 'gpu',
      node: (
        <button className="hud-item sys-hud" onClick={() => toggleSidePanel('system')} data-tip={`GPU telemetry unavailable${status?.gpuError ? ' — ' + status.gpuError : ''}`}>
          GPU <b className="dim">n/a</b>
        </button>
      )
    })
  }
  if (mode === 'ml') items.sort((a, b) => (a.id === 'gpu' ? -1 : b.id === 'gpu' ? 1 : 0))

  return (
    <>
      {items.map((it, i) => (
        <Fragment key={it.id}>
          {i > 0 && <span className="hud-sep sys-hud-sep" />}
          {it.node}
        </Fragment>
      ))}
    </>
  )
}
