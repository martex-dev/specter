import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, RefreshCw, Download, Copy } from 'lucide-react'
import type { DiagnosticCheck, AppMetricsEntry } from '@shared/types'
import { invoke } from '../lib/ipc'
import { formatBytes } from '../lib/format'
import { toast } from '../stores/ui'
import type { PageProps } from './registry'
import { METRIC_LABEL, summary } from '../lib/perf'

const ICON = {
  ok: <CheckCircle2 size={16} className="ok" />,
  warn: <AlertTriangle size={16} className="warn" />,
  error: <XCircle size={16} className="bad" />,
  unknown: <HelpCircle size={16} className="muted" />
}

export default function Diagnostics(_: PageProps) {
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null)
  const [procs, setProcs] = useState<AppMetricsEntry[]>([])
  const [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    try {
      setChecks(await invoke('diagnostics:run'))
      setProcs(await invoke('metrics:app'))
    } finally {
      setRunning(false)
    }
  }
  useEffect(() => {
    run()
    const i = setInterval(() => invoke('metrics:app').then(setProcs), 3000)
    return () => clearInterval(i)
  }, [])
  const total = procs.reduce((a, p) => a + p.memoryKB, 0)
  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">SPECTER Diagnostics</div>
          <h1 className="page-title">System health</h1>
          <div className="page-sub">Checks run locally. The export contains no URLs or browsing data.</div>
        </div>
        <button
          className="btn"
          onClick={() => {
            if (!checks) return
            invoke('app:clipboardWrite', checks.map((c) => `[${c.status.toUpperCase()}] ${c.label}: ${c.detail}`).join('\n'))
            toast({ kind: 'ok', title: 'Diagnostics copied' })
          }}
        >
          <Copy size={13} /> Copy
        </button>
        <button className="btn" onClick={() => invoke('diagnostics:export').then((p) => p && toast({ kind: 'ok', title: 'Report saved', body: p }))}>
          <Download size={13} /> Export
        </button>
        <button className="btn primary" onClick={run} disabled={running}>
          <RefreshCw size={13} className={running ? 'spin' : ''} /> Run again
        </button>
      </div>
      <div className="card setting-group">
        {!checks && <div className="empty">Running checks…</div>}
        {checks?.map((c, i) => (
          <div key={c.id + i} className="setting">
            {ICON[c.status]}
            <div className="st-text">
              <div className="st-title">{c.label}</div>
              <div className="st-desc selectable">{c.detail}</div>
            </div>
            <span className={'badge ' + (c.status === 'ok' ? 'ok' : c.status === 'warn' ? 'warn' : c.status === 'error' ? 'bad' : '')}>{c.status}</span>
          </div>
        ))}
      </div>
      <div className="section">
        <div className="section-title">Measured performance · this window, this session</div>
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Operation</th>
                <th style={{ textAlign: 'right' }}>Samples</th>
                <th style={{ textAlign: 'right' }}>Median</th>
                <th style={{ textAlign: 'right' }}>p95</th>
                <th style={{ textAlign: 'right' }}>Last</th>
              </tr>
            </thead>
            <tbody>
              {summary().length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No samples yet — open tabs, the palette or search to collect measurements.
                  </td>
                </tr>
              )}
              {summary().map((m) => (
                <tr key={m.metric}>
                  <td>{METRIC_LABEL[m.metric]}</td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {m.count}
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {m.median.toFixed(1)} ms
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {m.p95.toFixed(1)} ms
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {m.last.toFixed(1)} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="section">
        <div className="section-title">
          SPECTER processes <span className="badge">{procs.length}</span> <span className="muted" style={{ fontWeight: 400 }}>· {formatBytes(total * 1024)} private memory total</span>
        </div>
        <div className="card" style={{ maxHeight: 460, overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>PID</th>
                <th>Type</th>
                <th>Page</th>
                <th style={{ textAlign: 'right' }}>CPU</th>
                <th style={{ textAlign: 'right' }}>Memory</th>
              </tr>
            </thead>
            <tbody>
              {[...procs]
                .sort((a, b) => b.memoryKB - a.memoryKB)
                .map((p) => (
                  <tr key={p.pid}>
                    <td className="mono">{p.pid}</td>
                    <td>{p.type}</td>
                    <td className="ellipsis" style={{ maxWidth: 380 }}>
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
        </div>
      </div>
    </div>
  )
}
