import { useEffect, useState } from 'react'
import { Brain, Cookie, Database, Download, FolderSearch, History, KeyRound, Shield, ShieldCheck, Trash2 } from 'lucide-react'
import type { BlockedRequest, ClearDataOptions, PrivacySummary } from '@shared/ipc'
import { invoke } from '../lib/ipc'
import { formatBytes, timeAgo } from '../lib/format'
import { setSetting, useSetting } from '../stores/settings'
import { toast } from '../stores/ui'
import { Switch } from '../components/ui'
import { newTab } from '../stores/browser'
import { confirmAction } from '../components/prompt'
import type { PageProps } from './registry'
import { isLoopbackUrl } from './pageLogic'

const RANGES = [
  { label: 'Last hour', ms: 3600_000 },
  { label: 'Last 24 hours', ms: 86400_000 },
  { label: 'Last 7 days', ms: 7 * 86400_000 },
  { label: 'All time', ms: 0 }
]

export default function Privacy(_: PageProps) {
  const [sum, setSum] = useState<PrivacySummary | null>(null)
  const [blocked, setBlocked] = useState<BlockedRequest[]>([])
  const [clear, setClear] = useState<ClearDataOptions>({ history: true, cookies: false, cache: true, storage: false, downloads: false, permissions: false })
  const [range, setRange] = useState(0)
  const blockTrackers = useSetting('privacy.blockTrackers')
  const gpc = useSetting('privacy.sendGPC')
  const https = useSetting('privacy.httpsUpgrade')
  const recordHistory = useSetting('privacy.recordHistory')
  const aiEnabled = useSetting('ai.enabled')
  const aiUrl = useSetting('ai.ollamaUrl')
  const roots = useSetting('developer.projectRoots')
  const remote = useSetting('search.remoteSuggestions')

  const load = () => {
    invoke('privacy:summary').then(setSum)
    invoke('privacy:blockedLog').then(setBlocked)
  }
  useEffect(() => {
    load()
    const i = setInterval(load, 5000)
    return () => clearInterval(i)
  }, [])

  const topHosts = Object.entries(blocked.reduce<Record<string, number>>((m, b) => ((m[b.host] = (m[b.host] ?? 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
  const localAi = isLoopbackUrl(aiUrl)
  const anyToClear = Object.values(clear).some(Boolean)

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">SPECTER Privacy Center</div>
          <h1 className="page-title">What stays on this computer</h1>
          <div className="page-sub">Real, current state — nothing here is a marketing claim.</div>
        </div>
      </div>

      <div className="grid-4">
        <Stat icon={<ShieldCheck size={14} />} label="Trackers blocked" value={sum ? sum.trackersBlockedSession.toLocaleString() : '—'} sub={`this session · list of ${sum?.blocklistSize ?? '—'} domains`} />
        <Stat icon={<Cookie size={14} />} label="Cookies stored" value={sum ? sum.cookieCount.toLocaleString() : '—'} sub="current profile" />
        <Stat icon={<History size={14} />} label="History entries" value={sum ? sum.historyEntries.toLocaleString() : '—'} sub={recordHistory ? 'recording' : 'recording paused'} />
        <Stat icon={<Database size={14} />} label="Cache" value={sum ? formatBytes(sum.cacheBytes) : '—'} sub={`${sum?.sitePermissions ?? 0} site permissions`} />
      </div>

      <div className="section">
        <div className="section-title">
          <Shield size={15} /> Protection
        </div>
        <div className="card setting-group">
          <PrivRow title="Tracker blocking" desc="Third-party requests to known ad/analytics domains are cancelled." on={blockTrackers} set={(v) => setSetting('privacy.blockTrackers', v)} />
          <PrivRow title="Global Privacy Control" desc="Sends Sec-GPC: 1 with every request." on={gpc} set={(v) => setSetting('privacy.sendGPC', v)} />
          <PrivRow title="HTTPS upgrade" desc="http:// navigations try HTTPS first." on={https} set={(v) => setSetting('privacy.httpsUpgrade', v)} />
          <PrivRow title="Record history" desc="Stored locally in SQLite, never uploaded." on={recordHistory} set={(v) => setSetting('privacy.recordHistory', v)} />
          <PrivRow title="Remote search suggestions" desc="When on, address-bar keystrokes are sent to your search engine." on={remote} set={(v) => setSetting('search.remoteSuggestions', v)} />
        </div>
      </div>

      <div className="section">
        <div className="section-title">Data flows</div>
        <div className="card setting-group">
          <Flow icon={<Brain size={15} />} title="AI context" state={!aiEnabled ? 'AI disabled — nothing is sent' : localAi ? `Local only (${aiUrl}) — prompts are processed on this computer` : `Remote server configured: ${aiUrl} — your context leaves this computer`} warn={aiEnabled && !localAi} />
          <Flow icon={<FolderSearch size={15} />} title="Local indexing" state={roots.length ? `Only folders you added: ${roots.join(', ')}` : 'No folders indexed. SPECTER never scans your disk on its own.'} />
          <Flow icon={<KeyRound size={15} />} title="Passwords" state="Not stored by SPECTER." />
          <Flow icon={<Download size={15} />} title="Downloads" state={`${sum?.downloads ?? 0} entries in the download list`} />
          <Flow icon={<Database size={15} />} title="Telemetry / analytics" state="None. SPECTER has no analytics or crash upload." />
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          <Trash2 size={15} /> Clear browsing data
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
            {(
              [
                ['history', 'History & recent searches'],
                ['cookies', 'Cookies'],
                ['cache', 'Cached files'],
                ['storage', 'Site storage (local storage, IndexedDB, service workers)'],
                ['downloads', 'Download list'],
                ['permissions', 'Site permissions']
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="row" style={{ fontSize: 12.5 }}>
                <input type="checkbox" checked={!!clear[k]} onChange={(e) => setClear({ ...clear, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <select className="select" value={range} onChange={(e) => setRange(Number(e.target.value))}>
              {RANGES.map((r, i) => (
                <option key={r.label} value={i}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="dim" style={{ fontSize: 11.5 }}>
              Time range applies to history and downloads; cookies, cache and storage are cleared entirely.
            </span>
            <span className="spacer" />
            <button
              className="btn danger solid"
              disabled={!anyToClear}
              onClick={async () => {
                const ms = RANGES[range].ms
                if (!(await confirmAction('Clear browsing data?', `${RANGES[range].label}. This cannot be undone${clear.cookies ? ' and signs you out of websites' : ''}.`, 'Clear data', true))) return
                await invoke('privacy:clear', { ...clear, since: ms ? Date.now() - ms : 0 })
                toast({ kind: 'ok', title: 'Browsing data cleared' })
                load()
              }}
            >
              Clear data
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Most blocked hosts · this session</div>
        <div className="card">
          {topHosts.length === 0 ? (
            <div className="empty">Nothing blocked yet this session.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Host</th>
                  <th style={{ width: 90 }}>Requests</th>
                  <th>Last seen on</th>
                  <th style={{ width: 110 }}>Blocked by</th>
                </tr>
              </thead>
              <tbody>
                {topHosts.map(([host, n]) => {
                  // The log arrives newest-first.
                  const last = blocked.find((b) => b.host === host)
                  return (
                    <tr key={host}>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {host}
                      </td>
                      <td className="num">{n}</td>
                      <td className="muted ellipsis" style={{ maxWidth: 360 }}>
                        {last ? `${new URL(last.tabUrl || 'about:blank').hostname || '—'} · ${timeAgo(last.ts)}` : ''}
                      </td>
                      <td className="muted">{last?.by === 'builtin' ? 'Tracker list' : 'Filter lists'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => newTab('specter://settings/privacy')}>
            Privacy settings & site permissions
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, label, value, sub }: { icon: JSX.Element; label: string; value: string; sub: string }) {
  return (
    <div className="card stat">
      <div className="label row" style={{ gap: 6 }}>
        {icon} {label}
      </div>
      <div className="v">{value}</div>
      <div className="s">{sub}</div>
    </div>
  )
}

function PrivRow({ title, desc, on, set }: { title: string; desc: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="setting">
      <div className="st-text">
        <div className="st-title">{title}</div>
        <div className="st-desc">{desc}</div>
      </div>
      <Switch on={on} onChange={set} label={title} />
    </div>
  )
}

function Flow({ icon, title, state, warn }: { icon: JSX.Element; title: string; state: string; warn?: boolean }) {
  return (
    <div className="setting">
      <span className="muted">{icon}</span>
      <div className="st-text">
        <div className="st-title">{title}</div>
        <div className="st-desc" style={warn ? { color: 'var(--warn)' } : undefined}>
          {state}
        </div>
      </div>
    </div>
  )
}
