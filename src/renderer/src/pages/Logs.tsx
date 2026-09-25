import { useEffect, useMemo, useState } from 'react'
import { Pause, Play, Trash2 } from 'lucide-react'
import type { LogEntry } from '@shared/types'
import { invoke } from '../lib/ipc'
import type { PageProps } from './registry'

const LEVEL_CLS: Record<LogEntry['level'], string> = { debug: 'dim', info: '', warn: 'warn', error: 'bad' }

export default function Logs(_: PageProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [level, setLevel] = useState<'all' | LogEntry['level']>('all')
  const [q, setQ] = useState('')
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const load = () => invoke('logs:list', 1500).then(setLogs)
    load()
    const i = setInterval(load, 1500)
    return () => clearInterval(i)
  }, [paused])
  const shown = useMemo(() => {
    const order = { debug: 0, info: 1, warn: 2, error: 3 }
    return logs.filter((l) => (level === 'all' || order[l.level] >= order[level]) && (!q || (l.scope + ' ' + l.message).toLowerCase().includes(q.toLowerCase()))).reverse()
  }, [logs, level, q])
  return (
    <div className="page wide">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Developer</div>
          <h1 className="page-title">Log viewer</h1>
          <div className="page-sub">Structured logs from SPECTER’s main process (last 2,000 entries in memory; full log on disk in the profile’s logs folder).</div>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input grow" placeholder="Filter by scope or message…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {(['all', 'debug', 'info', 'warn', 'error'] as const).map((l) => (
            <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setPaused(!paused)}>
          {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn" onClick={() => invoke('logs:clear').then(() => setLogs([]))}>
          <Trash2 size={13} /> Clear
        </button>
      </div>
      <div className="card mono selectable" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '8px 12px', maxHeight: 'calc(100vh - 260px)', overflow: 'auto' }}>
        {shown.length === 0 && <div className="muted">No log entries.</div>}
        {shown.map((l, i) => (
          <div key={i} className={LEVEL_CLS[l.level]} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <span className="dim">{new Date(l.ts).toLocaleTimeString()}</span> <b style={{ fontWeight: 500 }}>{l.level.toUpperCase().padEnd(5)}</b> <span className="accent">[{l.scope}]</span> {l.message}
            {l.data !== undefined && <span className="dim"> {JSON.stringify(l.data).slice(0, 400)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
