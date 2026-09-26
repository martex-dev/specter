// Local-only daily activity summary. Derived from history + open state;
// never uploaded, and can be turned off in Privacy settings.
import { useEffect, useState } from 'react'
import { Activity as ActivityIcon, Globe, Layers } from 'lucide-react'
import { invoke } from '../lib/ipc'
import { useBrowser } from '../stores/browser'
import { useSetting } from '../stores/settings'
import type { PageProps } from './registry'
import { fillDays } from './pageLogic'

export default function Activity(_: PageProps) {
  const enabled = useSetting('privacy.activityLog')
  const [days, setDays] = useState<{ day: string; visits: number; domains: number }[]>([])
  const [domains, setDomains] = useState<{ url: string; title: string; visits: number }[]>([])
  const open = useBrowser((s) => s.open)
  const workspaces = useBrowser((s) => s.workspaces)
  useEffect(() => {
    if (!enabled) return
    invoke('history:activity', Date.now() - 30 * 86400_000).then(setDays)
    invoke('history:topSites', 10).then(setDomains)
  }, [enabled])
  if (!enabled)
    return (
      <div className="page">
        <div className="empty">
          <ActivityIcon size={26} />
          Activity summary is turned off in Privacy settings.
        </div>
      </div>
    )
  const today = new Date().toLocaleDateString('sv-SE')
  const t = days.find((d) => d.day === today)
  const openTabs = Object.values(open).reduce((n, w) => n + w.tabs.length, 0)
  const usedToday = workspaces.filter((w) => new Date(w.updatedAt).toLocaleDateString('sv-SE') === today).length
  const max = Math.max(1, ...days.map((d) => d.visits))
  // SQL only returns days with visits; chart every day so gaps show as gaps.
  const chart = fillDays(days, 30, (day) => ({ day, visits: 0, domains: 0 }))
  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Local only</div>
          <h1 className="page-title">Today</h1>
          <div className="page-sub">Your own browsing summary, computed from local history. Nothing is tracked beyond what history already stores.</div>
        </div>
      </div>
      <div className="grid-4">
        <div className="card stat">
          <div className="label">Page visits today</div>
          <div className="v">{t?.visits ?? 0}</div>
        </div>
        <div className="card stat">
          <div className="label">Sites today</div>
          <div className="v">{t?.domains ?? 0}</div>
        </div>
        <div className="card stat">
          <div className="label">Open tabs</div>
          <div className="v">{openTabs}</div>
        </div>
        <div className="card stat">
          <div className="label">Workspaces used today</div>
          <div className="v">{usedToday}</div>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Last 30 days</div>
        <div className="card" style={{ padding: 16 }}>
          {days.length === 0 ? (
            <div className="muted">No history yet.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
              {chart.map((d) => (
                <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} data-tip={`${d.day}: ${d.visits} visits, ${d.domains} sites`}>
                  <div style={{ width: '100%', maxWidth: 18, height: Math.max(2, (d.visits / max) * 100), background: d.day === today ? 'var(--accent)' : 'var(--bg-4)', borderRadius: 3 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="grid-2 section">
        <div className="card" style={{ padding: 14 }}>
          <div className="section-title">
            <Globe size={14} /> Frequent sites · 30 days
          </div>
          {domains.map((d) => (
            <div key={d.url} className="row" style={{ height: 28, fontSize: 12.5 }}>
              <span className="ellipsis grow">{new URL(d.url).hostname.replace(/^www\./, '')}</span>
              <span className="mono muted">{d.visits}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="section-title">
            <Layers size={14} /> Workspaces
          </div>
          {workspaces.map((w) => (
            <div key={w.id} className="row" style={{ height: 28, fontSize: 12.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: w.color }} />
              <span className="ellipsis grow">{w.name}</span>
              <span className="mono muted">{(open[w.id]?.tabs ?? w.state.tabs).length} tabs</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
