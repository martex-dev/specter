import { useEffect, useMemo, useRef, useState } from 'react'
import { History, Moon, Search, Volume2, X } from 'lucide-react'
import type { ClosedTab } from '@shared/types'
import { fuzzyBest } from '@shared/fuzzy'
import { invoke } from '../lib/ipc'
import { timeAgo } from '../lib/format'
import { activateTab, closeTab, newTab, useBrowser, type RuntimeTab } from '../stores/browser'
import { closeOverlay } from '../stores/ui'
import { Favicon, Kbd } from '../components/ui'

type Row = { kind: 'tab'; tab: RuntimeTab; ws: string; wsColor: string; active: boolean } | { kind: 'closed'; closed: ClosedTab }

export function TabSearch() {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [closed, setClosed] = useState<ClosedTab[]>([])
  const open = useBrowser((s) => s.open)
  const activeWsId = useBrowser((s) => s.activeWsId)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    invoke('session:closedTabs', 25).then(setClosed).catch(() => undefined)
  }, [])

  const rows = useMemo<Row[]>(() => {
    const tabs: (Row & { score: number })[] = []
    for (const ws of Object.values(open)) {
      for (const t of ws.tabs) {
        const s = q ? fuzzyBest(q, [t.title, t.url, t.note, ws.name]) : ws.id === activeWsId ? 1000 - ws.tabs.indexOf(t) : 500 - ws.tabs.indexOf(t)
        if (s !== null) tabs.push({ kind: 'tab', tab: t, ws: ws.name, wsColor: ws.color, active: ws.id === activeWsId && ws.activeTabId === t.id, score: s })
      }
    }
    tabs.sort((a, b) => b.score - a.score)
    const cl = closed.filter((c) => !q || fuzzyBest(q, [c.title, c.url]) !== null).slice(0, q ? 10 : 6)
    return [...tabs, ...cl.map((c) => ({ kind: 'closed' as const, closed: c }))]
  }, [q, open, activeWsId, closed])

  useEffect(() => setSel(0), [q])
  // Closing tabs from the list shrinks it; keep the selection on a row.
  useEffect(() => setSel((s) => Math.min(s, Math.max(0, rows.length - 1))), [rows.length])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const exec = (r: Row | undefined) => {
    if (!r) return
    closeOverlay()
    if (r.kind === 'tab') activateTab(r.tab.id)
    else newTab(r.closed.url)
  }

  const total = Object.values(open).reduce((n, w) => n + w.tabs.length, 0)
  let seenClosedHeader = false

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className="palette pop" role="dialog" aria-label="Search tabs">
        <div className="palette-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            className="palette-input"
            value={q}
            placeholder={`Search ${total} open tabs and recently closed…`}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(rows.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') exec(rows[sel])
              else if (e.key === 'Escape') closeOverlay()
              else if (e.key === 'Delete' || (e.key === 'Backspace' && e.ctrlKey)) {
                const r = rows[sel]
                if (r?.kind === 'tab') {
                  e.preventDefault()
                  closeTab(r.tab.id)
                }
              }
            }}
          />
          <Kbd keys="Escape" />
        </div>
        <div className="palette-list" ref={listRef}>
          {rows.length === 0 && <div className="empty">No tabs match</div>}
          {rows.map((r, i) => {
            if (r.kind === 'closed') {
              const header = !seenClosedHeader
              seenClosedHeader = true
              return (
                <div key={'c' + r.closed.id}>
                  {header && <div className="palette-group label">Recently closed</div>}
                  <div className={'palette-item' + (i === sel ? ' sel' : '')} onMouseMove={() => setSel(i)} onClick={() => exec(r)}>
                    <span className="pi-icon">
                      <History size={14} />
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis">{r.closed.title || r.closed.url}</div>
                      <div className="pi-sub ellipsis">
                        {r.closed.url.replace(/^https?:\/\//, '')} · closed {timeAgo(r.closed.closedAt)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
            const t = r.tab
            return (
              <div key={t.id} className={'palette-item' + (i === sel ? ' sel' : '')} onMouseMove={() => setSel(i)} onClick={() => exec(r)}>
                <span className="pi-icon">
                  <Favicon src={t.favicon} url={t.url} />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis">{t.title || t.url}</div>
                  <div className="pi-sub ellipsis">{t.url.replace(/^https?:\/\//, '')}</div>
                </div>
                {t.audible && <Volume2 size={13} className="muted" />}
                {t.suspended && <Moon size={13} className="muted" />}
                {r.active && <span className="badge accent">Current</span>}
                <span className="badge" style={{ borderColor: r.wsColor + '55', color: r.wsColor }}>
                  {r.ws}
                </span>
                <button
                  className="icon-btn sm"
                  // Keep focus in the search field: the button disappears with its
                  // row, and keyboard navigation (Escape, arrows) lives on the input.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                  aria-label="Close tab"
                  data-tip="Close tab"
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd keys="Enter" /> switch
          </span>
          <span>
            <Kbd keys="Delete" /> close tab
          </span>
          <span className="spacer" />
          <span>{total} open tabs</span>
        </div>
      </div>
    </div>
  )
}
