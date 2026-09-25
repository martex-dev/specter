// Live machine overview used by both the side panel (compact) and the
// specter://system page. Every value is a real sample or "Unavailable".
import { useEffect, useState, type ReactNode } from 'react'
import { Cpu, Gauge, HardDrive, MemoryStick, Network, Thermometer } from 'lucide-react'
import type { GpuMetrics, SystemInfo, SystemMetrics, SystemStatus } from '@shared/modules/system'
import { invoke } from '../../lib/ipc'
import { formatBytes } from '../../lib/format'
import { useSetting } from '../../stores/settings'
import { CoreGrid, Legend, LineChart, Meter } from './charts'
import { cpuPct, fmtGB, fmtPct, fmtRate, memPct, perCorePct, REASON_LABEL } from './store'

const C_ACCENT = 'var(--accent)'
const C_INFO = 'var(--info)'

let infoCache: Promise<SystemInfo> | null = null
export function useSystemInfo(): SystemInfo | null {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => {
    infoCache ??= invoke('system:info').catch((e) => {
      infoCache = null
      throw e
    })
    let alive = true
    infoCache.then((i) => alive && setInfo(i)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return info
}

function Card({ icon, title, value, sub, children, className = '' }: { icon: ReactNode; title: string; value?: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={'card sys-card ' + className}>
      <div className="sys-card-h">
        <span className="sys-card-icon">{icon}</span>
        <span className="label">{title}</span>
        <span className="spacer" />
        {value !== undefined && <span className="sys-big num">{value}</span>}
      </div>
      {sub && <div className="sys-sub">{sub}</div>}
      {children}
    </section>
  )
}

export function Unavailable({ children }: { children: ReactNode }) {
  return (
    <div className="sys-unavail">
      <span className="badge">Unavailable</span>
      <span>{children}</span>
    </div>
  )
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="sys-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="num">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const na = <span className="dim">Unavailable</span>

export function CpuCard({ latest, history, info, compact }: { latest: SystemMetrics | null; history: SystemMetrics[]; info: SystemInfo | null; compact?: boolean }) {
  const { values: cores, kind } = perCorePct(latest)
  const hasUtil = history.some((m) => m.cpu.utility?.total != null)
  return (
    <Card
      icon={<Cpu size={14} />}
      title="CPU"
      value={fmtPct(cpuPct(latest))}
      sub={info ? `${info.cpuModel} · ${info.logicalCores} logical processors` : undefined}
    >
      <LineChart
        history={history}
        series={[
          ...(hasUtil ? [{ key: 'util', color: C_ACCENT, get: (m: SystemMetrics) => m.cpu.utility?.total, fill: true }] : []),
          { key: 'time', color: hasUtil ? 'var(--fg-3)' : C_ACCENT, get: (m: SystemMetrics) => m.cpu.total, fill: !hasUtil }
        ]}
        max={100}
        height={compact ? 48 : 70}
        formatMax={(v) => `${v}%`}
        label="CPU utilisation history"
      />
      {hasUtil && (
        <div data-tip="Utility is Windows’ frequency-scaled figure shown by Task Manager; processor time is the raw share of time the cores were busy (os.cpus). On turbo-boosting CPUs utility reads higher.">
          <Legend
            items={[
              { color: C_ACCENT, label: 'Utility (Task Manager)', value: fmtPct(latest?.cpu.utility?.total ?? null, 1) },
              { color: 'var(--fg-3)', label: 'Processor time', value: fmtPct(latest?.cpu.total ?? null, 1) }
            ]}
          />
        </div>
      )}
      {cores.length > 0 && (
        <>
          <div className="sys-row-label">
            <span className="label">Per core · {kind === 'utility' ? 'utility' : 'processor time'}</span>
            <span className="dim num">busiest {fmtPct(Math.max(...cores))}</span>
          </div>
          <CoreGrid perCore={cores} height={compact ? 30 : 44} />
        </>
      )}
      <div className="sys-foot" data-tip="Windows does not expose CPU package temperature to unprivileged apps without a kernel driver (e.g. LibreHardwareMonitor). SPECTER will not estimate it.">
        <Thermometer size={12} /> CPU temperature {na}
      </div>
    </Card>
  )
}

export function MemCard({ latest, history, compact }: { latest: SystemMetrics | null; history: SystemMetrics[]; compact?: boolean }) {
  const p = memPct(latest)
  return (
    <Card icon={<MemoryStick size={14} />} title="Memory" value={fmtPct(p)} sub={latest ? `${fmtGB(latest.mem.used)} of ${fmtGB(latest.mem.total, 0)} in use · ${fmtGB(latest.mem.total - latest.mem.used)} available` : undefined}>
      <LineChart history={history} series={[{ key: 'mem', color: C_INFO, get: (m) => (m.mem.total ? (m.mem.used / m.mem.total) * 100 : null), fill: true }]} max={100} height={compact ? 40 : 70} formatMax={(v) => `${v}%`} label="Memory history" />
    </Card>
  )
}

function OneGpu({ g, idx, history, compact }: { g: GpuMetrics; idx: number; history: SystemMetrics[]; compact?: boolean }) {
  const vramPct = g.memUsed !== null && g.memTotal ? (g.memUsed / g.memTotal) * 100 : null
  const pick = (m: SystemMetrics) => m.gpu?.find((x) => x.index === g.index) ?? null
  return (
    <div className={idx > 0 ? 'sys-gpu-more' : undefined}>
      <div className="sys-sub" style={{ marginTop: idx > 0 ? 10 : 0 }}>
        {g.name}
      </div>
      <LineChart
        history={history}
        series={[
          { key: 'util', color: C_ACCENT, get: (m) => pick(m)?.util, fill: true },
          { key: 'vram', color: C_INFO, get: (m) => {
              const x = pick(m)
              return x && x.memUsed !== null && x.memTotal ? (x.memUsed / x.memTotal) * 100 : null
            } }
        ]}
        max={100}
        height={compact ? 44 : 70}
        formatMax={(v) => `${v}%`}
        label="GPU history"
      />
      <Legend
        items={[
          { color: C_ACCENT, label: 'Utilisation', value: fmtPct(g.util) },
          { color: C_INFO, label: 'VRAM', value: fmtPct(vramPct) }
        ]}
      />
      <KV
        rows={[
          ['VRAM', g.memUsed !== null && g.memTotal !== null ? `${fmtGB(g.memUsed)} / ${fmtGB(g.memTotal, 0)}` : na],
          ['Temperature', g.temp !== null ? `${g.temp} °C` : na],
          ['Power', g.power !== null ? `${g.power.toFixed(1)} W${g.powerLimit !== null ? ` / ${g.powerLimit.toFixed(0)} W` : ''}` : na],
          ...(compact ? [] : ([['Fan', g.fan !== null ? `${g.fan}%` : na], ['Graphics clock', g.clockMHz !== null ? `${g.clockMHz} MHz` : na]] as [string, ReactNode][]))
        ]}
      />
    </div>
  )
}

export function GpuCard({ latest, history, status, info, compact }: { latest: SystemMetrics | null; history: SystemMetrics[]; status: SystemStatus | null; info: SystemInfo | null; compact?: boolean }) {
  const gpus = latest?.gpu ?? null
  const g0 = gpus?.[0]
  const detecting = !gpus && !status?.gpuError && !status?.gpuSource
  return (
    <Card icon={<Gauge size={14} />} title={gpus && gpus.length > 1 ? `GPU · ${gpus.length}` : 'GPU'} value={g0 ? fmtPct(g0.util) : undefined}>
      {gpus?.map((g, i) => <OneGpu key={g.index} g={g} idx={i} history={history} compact={compact} />)}
      {!gpus &&
        (detecting ? (
          <div className="sys-sub">Detecting GPU telemetry…</div>
        ) : (
          <Unavailable>
            {status?.gpuError ?? 'No recent sample from nvidia-smi.'}
            {info?.gpuAdapters.length ? (
              <>
                {' '}
                Adapters reported by Chromium: <b>{info.gpuAdapters.join(', ')}</b> (names only — no live metrics).
              </>
            ) : null}
          </Unavailable>
        ))}
      {gpus && <div className="sys-foot">Source: nvidia-smi</div>}
    </Card>
  )
}

export function NetCard({ latest, history, status, compact }: { latest: SystemMetrics | null; history: SystemMetrics[]; status: SystemStatus | null; compact?: boolean }) {
  const n = latest?.net ?? null
  const ifaces = (n?.interfaces ?? []).filter((i) => !i.virtual || i.rxBps || i.txBps)
  return (
    <Card icon={<Network size={14} />} title="Network" value={n ? <span className="sys-net-big">↓ {fmtRate(n.rxBps)}  ↑ {fmtRate(n.txBps)}</span> : undefined}>
      <LineChart
        history={history}
        series={[
          { key: 'rx', color: C_INFO, get: (m) => m.net?.rxBps, fill: true },
          { key: 'tx', color: C_ACCENT, get: (m) => m.net?.txBps }
        ]}
        minMax={16 * 1024}
        height={compact ? 44 : 70}
        formatMax={(v) => fmtRate(v)}
        label="Network throughput history"
      />
      <Legend items={[{ color: C_INFO, label: 'Download' }, { color: C_ACCENT, label: 'Upload' }]} />
      {!n && <div className="sys-sub">{status?.netError ? `Unavailable — ${status.netError}` : 'Waiting for the second sample…'}</div>}
      {!compact && ifaces.length > 0 && (
        <div className="sys-ifaces">
          {ifaces.map((i) => (
            <div key={i.name} className="sys-iface">
              <span className="ellipsis grow" title={i.name}>
                {i.name}
                {i.virtual && <span className="badge" style={{ marginLeft: 6 }} data-tip="Virtual adapter — excluded from totals to avoid double counting">virtual</span>}
              </span>
              <span className="num dim">↓ {fmtRate(i.rxBps)}</span>
              <span className="num dim">↑ {fmtRate(i.txBps)}</span>
            </div>
          ))}
        </div>
      )}
      {n && <div className="sys-foot">Source: {n.source === 'typeperf' ? 'Windows performance counters (typeperf), all physical adapters' : 'netstat -e byte counters, all adapters'}</div>}
    </Card>
  )
}

export function DisksCard({ latest }: { latest: SystemMetrics | null }) {
  const disks = latest?.disks ?? []
  return (
    <Card icon={<HardDrive size={14} />} title="Disks">
      {!disks.length && <div className="sys-sub">{latest ? 'Reading drive capacity…' : 'Waiting for first sample…'}</div>}
      {disks.map((d) => {
        const used = d.total - d.free
        const p = d.total ? (used / d.total) * 100 : 0
        return (
          <div key={d.mount} className="sys-disk">
            <div className="row">
              <b className="mono">{d.mount.replace(/\\$/, '')}</b>
              <span className="spacer" />
              <span className="num dim">
                {formatBytes(d.free)} free of {formatBytes(d.total)}
              </span>
            </div>
            <Meter value={p} />
          </div>
        )
      })}
      {disks.length > 0 && <div className="sys-foot">Capacity via fs.statfs · refreshed every 30 s</div>}
    </Card>
  )
}

export function SamplerFoot({ status, latest }: { status: SystemStatus | null; latest: SystemMetrics | null }) {
  if (!status) return null
  return (
    <div className="sys-sampler">
      <span>
        Sampling every <b className="num">{((latest?.intervalMs ?? status.intervalMs) / 1000).toFixed(1)} s</b> · {REASON_LABEL[status.reason] ?? status.reason}
      </span>
      <span data-tip="Synchronous main-process time per sample (average of the last 60 ticks). External helpers run asynchronously.">
        cost <b className="num">{status.avgTickMs.toFixed(2)} ms</b>/tick
      </span>
      {latest && <span>updated {new Date(latest.ts).toLocaleTimeString()}</span>}
    </div>
  )
}

/** Full overview; `compact` for the side panel. */
export function Overview({ latest, history, status, compact }: { latest: SystemMetrics | null; history: SystemMetrics[]; status: SystemStatus | null; compact?: boolean }) {
  const info = useSystemInfo()
  const mode = useSetting('performance.mode')
  const cpu = <CpuCard key="cpu" latest={latest} history={history} info={info} compact={compact} />
  const mem = <MemCard key="mem" latest={latest} history={history} compact={compact} />
  const gpu = <GpuCard key="gpu" latest={latest} history={history} status={status} info={info} compact={compact} />
  const net = <NetCard key="net" latest={latest} history={history} status={status} compact={compact} />
  const disks = <DisksCard key="disks" latest={latest} />
  if (compact) return <div className="sys-stack">{mode === 'ml' ? [gpu, cpu, mem, net, disks] : [cpu, mem, gpu, net, disks]}</div>
  return (
    <div className="sys-cols">
      <div className="sys-stack">{mode === 'ml' ? [gpu, cpu] : [cpu, gpu]}</div>
      <div className="sys-stack">{[mem, net, disks]}</div>
    </div>
  )
}
