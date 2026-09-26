// Read-only process viewer (tasklist, on demand). SPECTER never terminates
// or modifies other processes.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, FolderOpen, RefreshCw, Search } from 'lucide-react'
import type { ProcessList, ProcessRow } from '@shared/modules/system'
import { invoke } from '../../lib/ipc'
import { formatBytes } from '../../lib/format'
import { toast } from '../../stores/ui'
import { Switch } from '../../components/ui'

type SortKey = 'memory' | 'name' | 'pid'
interface Row extends ProcessRow {
  count: number
}

const LIMIT = 400

export default function Processes({ compact }: { compact?: boolean }) {
  const [data, setData] = useState<ProcessList | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('memory')
  const [desc, setDesc] = useState(true)
  const [group, setGroup] = useState(false)
  const [auto, setAuto] = useState(false)
  const [revealing, setRevealing] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await invoke('system:processes'))
    } catch (err) {
      setData({ ts: Date.now(), items: [], tookMs: 0, error: String((err as Error)?.message ?? err) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (!auto) return
    const i = setInterval(load, 5000)
    return () => clearInterval(i)
  }, [auto, load])

  const rows = useMemo<Row[]>(() => {
    const items = data?.items ?? []
    let list: Row[]
    if (group) {
      const by = new Map<string, Row>()
      for (const p of items) {
        const k = p.name.toLowerCase()
        const r = by.get(k)
        if (r) {
          r.memKB += p.memKB
          r.count++
          r.specter ||= p.specter
        } else by.set(k, { ...p, count: 1 })
      }
      list = [...by.values()]
    } else list = items.map((p) => ({ ...p, count: 1 }))
    const q = filter.trim().toLowerCase()
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid) === q)
    const dir = desc ? -1 : 1
    // In grouped mode the second column shows the process count, so it sorts by count.
    list.sort((a, b) => (sort === 'memory' ? (a.memKB - b.memKB) * dir : sort === 'pid' ? (group ? a.count - b.count || a.pid - b.pid : a.pid - b.pid) * dir : a.name.localeCompare(b.name) * dir))
    return list
  }, [data, filter, sort, desc, group])

  const totalKB = (data?.items ?? []).reduce((a, p) => a + p.memKB, 0)
  const specterKB = (data?.items ?? []).filter((p) => p.specter).reduce((a, p) => a + p.memKB, 0)

  const setSortKey = (k: SortKey) => {
    if (sort === k) setDesc(!desc)
    else {
      setSort(k)
      setDesc(k === 'memory')
    }
  }
  const arrow = (k: SortKey) => (sort === k ? desc ? <ArrowDown size={10} /> : <ArrowUp size={10} /> : null)

  const reveal = async (p: Row) => {
    setRevealing(p.pid)
    try {
      const r = await invoke('system:revealProcess', p.pid)
      if (!r.ok) toast({ kind: 'warn', title: `Can’t open location of ${p.name}`, body: r.error })
    } catch (err) {
      toast({ kind: 'error', title: 'Open file location failed', body: String((err as Error)?.message ?? err) })
    } finally {
      setRevealing(null)
    }
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row sys-toolbar">
        <div className="sys-search">
          <Search size={13} className="muted" />
          <input className="input" placeholder="Filter by name or PID" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter processes" />
        </div>
        <label className="row sys-toggle" data-tip="Combine processes with the same image name">
          <Switch on={group} onChange={setGroup} label="Group by name" /> Group
        </label>
        {!compact && (
          <label className="row sys-toggle" data-tip="Re-run tasklist every 5 seconds while this view is open">
            <Switch on={auto} onChange={setAuto} label="Auto refresh" /> Auto
          </label>
        )}
        <button className="btn sm" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>
      <div className="sys-sub">
        {data ? (
          <>
            <b className="num">{data.items.length}</b> processes · <b className="num">{formatBytes(totalKB * 1024)}</b> working set · SPECTER <b className="num">{formatBytes(specterKB * 1024)}</b> · tasklist took {data.tookMs} ms · {new Date(data.ts).toLocaleTimeString()}
          </>
        ) : (
          'Reading process list…'
        )}
      </div>
      {data?.error && <div className="sys-unavail"><span className="badge warn">Error</span><span>{data.error}</span></div>}
      <div className="card sys-proc-table" style={{ maxHeight: compact ? 'none' : 560 }}>
        <table className="table">
          <thead>
            <tr>
              <th className="sys-th" onClick={() => setSortKey('name')}>Name {arrow('name')}</th>
              {!compact && <th className="sys-th" onClick={() => setSortKey('pid')} style={{ width: 80 }}>{group ? 'Count' : 'PID'} {arrow('pid')}</th>}
              <th className="sys-th" onClick={() => setSortKey('memory')} style={{ textAlign: 'right', width: 110 }}>Memory {arrow('memory')}</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, LIMIT).map((p) => (
              <tr key={group ? p.name.toLowerCase() : p.pid}>
                <td className="ellipsis" style={{ maxWidth: compact ? 170 : 420 }} title={p.name}>
                  {p.name}
                  {p.specter && <span className="badge accent" style={{ marginLeft: 6 }}>specter</span>}
                  {compact && !group && <span className="dim mono" style={{ marginLeft: 6, fontSize: 10.5 }}>{p.pid}</span>}
                  {group && p.count > 1 && <span className="dim mono" style={{ marginLeft: 6, fontSize: 10.5 }}>×{p.count}</span>}
                </td>
                {!compact && <td className="mono dim">{group ? p.count : p.pid}</td>}
                <td className="num" style={{ textAlign: 'right' }}>
                  {formatBytes(p.memKB * 1024)}
                </td>
                <td>
                  <button className="icon-btn sm" disabled={group || revealing === p.pid || p.pid <= 4} onClick={() => reveal(p)} data-tip={group ? 'Ungroup to open a specific process' : 'Open file location'} aria-label="Open file location">
                    <FolderOpen size={12} className={revealing === p.pid ? 'spin' : ''} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > LIMIT && <div className="empty">Showing {LIMIT} of {rows.length} — refine the filter.</div>}
        {data && !rows.length && !data.error && <div className="empty">No matching processes.</div>}
      </div>
      <div className="sys-foot">Read-only view from <span className="mono">tasklist</span>. Memory is the working set. SPECTER never ends or modifies other processes.</div>
    </div>
  )
}
