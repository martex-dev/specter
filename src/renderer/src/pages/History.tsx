import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, Globe, Search, Trash2, X } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { hostname } from '@shared/url'
import { invoke } from '../lib/ipc'
import { activeTab, loadUrl, newTab, useBrowser } from '../stores/browser'
import { openMenu, toast } from '../stores/ui'
import { Favicon } from '../components/ui'
import { confirmAction } from '../components/prompt'
import type { PageProps } from './registry'
import { record } from '../lib/perf'

const RANGES = [
  { id: 'all', label: 'All time', ms: 0 },
  { id: 'today', label: 'Today', ms: -1 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 86400_000 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 86400_000 }
]

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export default function History({ query }: PageProps) {
  const [text, setText] = useState(query.get('q') ?? '')
  const [range, setRange] = useState('all')
  const [domain, setDomain] = useState('')
  const [wsFilter, setWsFilter] = useState('')
  const [rows, setRows] = useState<HistoryEntry[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [more, setMore] = useState(true)
  const [total, setTotal] = useState(0)
  const workspaces = useBrowser((s) => s.workspaces)
  const reqRef = useRef(0)

  const from = useMemo(() => {
    const r = RANGES.find((x) => x.id === range)!
    return r.ms === -1 ? startOfToday() : r.ms ? Date.now() - r.ms : undefined
  }, [range])

  const load = useCallback(
    async (append = false) => {
      const id = ++reqRef.current
      const t0 = performance.now()
      const res = await invoke('history:search', { text, from, domain: domain || undefined, workspaceId: wsFilter || undefined, limit: 300, offset: append ? rows.length : 0 })
      if (id !== reqRef.current) return
      record('historySearch', performance.now() - t0)
      setRows(append ? [...rows, ...res] : res)
      setMore(res.length === 300)
    },
    [text, from, domain, wsFilter, rows]
  )

  useEffect(() => {
    const t = setTimeout(() => load(false), 120)
    invoke('history:count').then(setTotal)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, from, domain, wsFilter])

  const byDay = useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>()
    for (const r of rows) {
      const k = new Date(r.visitedAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    return [...groups]
  }, [rows])

  const open = (url: string, bg = false) => {
    if (bg) newTab(url, { background: true })
    else {
      const t = activeTab()
      if (t) loadUrl(t.id, url)
    }
  }

  const deleteSelected = async () => {
    await invoke('history:delete', [...selected])
    setSelected(new Set())
    load(false)
  }

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Browser</div>
          <h1 className="page-title">History</h1>
          <div className="page-sub">{total.toLocaleString()} visits stored locally · full-text search</div>
        </div>
        <button
          className="btn"
          onClick={async () => {
            if (!(await confirmAction('Clear all browsing history?', 'This permanently deletes every history entry for this profile.', 'Clear history', true))) return
            await invoke('history:clear')
            toast({ kind: 'ok', title: 'History cleared' })
            load(false)
          }}
        >
          <Trash2 size={14} /> Clear all
        </button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, position: 'sticky', top: 0, background: 'var(--bg-1)', padding: '8px 0', zIndex: 2 }}>
        <div className="row grow" style={{ minWidth: 240, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--fg-3)' }} />
          <input className="input grow" style={{ paddingLeft: 30, height: 34 }} placeholder="Search history titles and URLs…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
        <select className="select" value={range} onChange={(e) => setRange(e.target.value)} style={{ height: 34 }} aria-label="Date range">
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="row" style={{ position: 'relative' }}>
          <Globe size={13} style={{ position: 'absolute', left: 10, color: 'var(--fg-3)' }} />
          <input className="input" style={{ paddingLeft: 28, height: 34, width: 170 }} placeholder="Domain" value={domain} onChange={(e) => setDomain(e.target.value.trim())} />
        </div>
        <select className="select" value={wsFilter} onChange={(e) => setWsFilter(e.target.value)} style={{ height: 34 }} aria-label="Workspace">
          <option value="">All workspaces</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {selected.size > 0 && (
          <button className="btn danger" onClick={deleteSelected}>
            <Trash2 size={13} /> Delete {selected.size}
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <div className="empty">
          <Calendar size={26} />
          {text || domain ? 'No history matches your filters.' : 'No browsing history yet.'}
        </div>
      )}
      {byDay.map(([day, items]) => (
        <div key={day} className="history-day">
          <h3 className="row">
            <span className="grow">{day}</span>
            <button
              className="btn sm ghost"
              onClick={async () => {
                const ts = items.map((i) => i.visitedAt)
                const n = await invoke('history:deleteRange', Math.min(...ts), Math.max(...ts))
                toast({ kind: 'ok', title: `Deleted ${n} entries` })
                load(false)
              }}
            >
              Delete day
            </button>
          </h3>
          {items.map((h) => (
            <div
              key={h.id}
              className={'history-item' + (selected.has(h.id) ? ' selected' : '')}
              onContextMenu={(e) => {
                e.preventDefault()
                openMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: 'Open', run: () => open(h.url) },
                    { label: 'Open in new tab', run: () => open(h.url, true) },
                    { label: 'Copy link', run: () => invoke('app:clipboardWrite', h.url) },
                    { separator: true },
                    { label: `More from ${hostname(h.url)}`, run: () => setDomain(hostname(h.url)) },
                    { label: 'Remove from history', danger: true, run: () => invoke('history:delete', [h.id]).then(() => load(false)) },
                    {
                      label: `Delete all from ${hostname(h.url)}`,
                      danger: true,
                      run: async () => {
                        const n = await invoke('history:deleteDomain', hostname(h.url))
                        toast({ kind: 'ok', title: `Deleted ${n} entries` })
                        load(false)
                      }
                    }
                  ]
                })
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(h.id)}
                onChange={(e) => {
                  const s = new Set(selected)
                  if (e.target.checked) s.add(h.id)
                  else s.delete(h.id)
                  setSelected(s)
                }}
                aria-label="Select"
              />
              <span className="time">{new Date(h.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <Favicon url={h.url} />
              <a
                className="ellipsis"
                style={{ color: 'var(--fg-0)', cursor: 'pointer', maxWidth: '55%' }}
                onClick={(e) => open(h.url, e.ctrlKey)}
                onAuxClick={(e) => e.button === 1 && open(h.url, true)}
                title={h.url}
              >
                {h.title || h.url}
              </a>
              <span className="host ellipsis grow">{hostname(h.url)}</span>
              <button className="icon-btn sm" onClick={() => invoke('history:delete', [h.id]).then(() => load(false))} aria-label="Remove" data-tip="Remove">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ))}
      {more && rows.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button className="btn" onClick={() => load(true)}>
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
