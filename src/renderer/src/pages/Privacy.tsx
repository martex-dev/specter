import { useEffect, useState } from 'react'
import { Brain, Cookie, Database, Download, FolderSearch, History, KeyRound, RefreshCw, Shield, ShieldBan, ShieldCheck, Trash2, X } from 'lucide-react'
import type { BlockedRequest, ClearDataOptions, PrivacySummary } from '@shared/ipc'
import { normalizeSiteHost, type AdblockStatus } from '@shared/adblock'
import { invoke, on } from '../lib/ipc'
import { setAdblockForSite } from '../lib/adblock'
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
        <Stat icon={<ShieldCheck size={14} />} label="Requests blocked" value={sum ? sum.trackersBlockedSession.toLocaleString() : '—'} sub="ads & trackers · this session" />
        <Stat icon={<Cookie size={14} />} label="Cookies stored" value={sum ? sum.cookieCount.toLocaleString() : '—'} sub="current profile" />
        <Stat icon={<History size={14} />} label="History entries" value={sum ? sum.historyEntries.toLocaleString() : '—'} sub={recordHistory ? 'recording' : 'recording paused'} />
        <Stat icon={<Database size={14} />} label="Cache" value={sum ? formatBytes(sum.cacheBytes) : '—'} sub={`${sum?.sitePermissions ?? 0} site permissions`} />
      </div>

      <div className="section">
        <div className="section-title">
          <Shield size={15} /> Protection
        </div>
        <div className="card setting-group">
          <PrivRow title="Built-in tracker list" desc={`Third-party requests to ${sum?.blocklistSize ?? 'about 200'} well-known ad/analytics domains are cancelled — works even before filter lists are downloaded.`} on={blockTrackers} set={(v) => setSetting('privacy.blockTrackers', v)} />
          <PrivRow title="Global Privacy Control" desc="Sends Sec-GPC: 1 with every request." on={gpc} set={(v) => setSetting('privacy.sendGPC', v)} />
          <PrivRow title="HTTPS upgrade" desc="http:// navigations try HTTPS first." on={https} set={(v) => setSetting('privacy.httpsUpgrade', v)} />
          <PrivRow title="Record history" desc="Stored locally in SQLite, never uploaded." on={recordHistory} set={(v) => setSetting('privacy.recordHistory', v)} />
          <PrivRow title="Remote search suggestions" desc="When on, address-bar keystrokes are sent to your search engine." on={remote} set={(v) => setSetting('search.remoteSuggestions', v)} />
        </div>
      </div>

      <AdblockSection />

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

function AdblockSection() {
  const [st, setSt] = useState<AdblockStatus | null>(null)
  const enabled = useSetting('privacy.adblock')
  const lists = useSetting('privacy.adblockLists')
  const custom = useSetting('privacy.adblockCustomFilters')
  const [draft, setDraft] = useState(custom)
  const [site, setSite] = useState('')
  useEffect(() => {
    invoke('adblock:status').then(setSt)
    return on('adblock:status', setSt)
  }, [])
  useEffect(() => setDraft(custom), [custom])

  const toggleList = (id: string, v: boolean) => setSetting('privacy.adblockLists', v ? [...new Set([...lists, id])] : lists.filter((x) => x !== id))
  const addSite = async () => {
    const host = normalizeSiteHost(site)
    if (!host) return toast({ kind: 'error', title: 'Not a valid site', body: 'Enter a host such as example.com' })
    await setAdblockForSite(host, false)
    setSite('')
  }
  const state = !enabled
    ? 'Off — ads are not filtered'
    : st?.updating
      ? st.ready
        ? 'Updating filter lists…'
        : 'Downloading filter lists for the first time…'
      : st?.ready
        ? `Active · ${(st.rules + st.customRules).toLocaleString()} rules${st.lastUpdated ? ` · lists updated ${timeAgo(st.lastUpdated)}` : ''} · ${st.blockedSession.toLocaleString()} blocked this session`
        : 'Not loaded yet'

  return (
    <div className="section">
      <div className="section-title">
        <ShieldBan size={15} /> Ad blocker
      </div>
      <div className="card setting-group">
        <div className="setting">
          <div className="st-text">
            <div className="st-title">Block ads, trackers and malware</div>
            <div className="st-desc">
              {state}
              {enabled && st?.error && <div style={{ color: 'var(--warn)', marginTop: 3 }}>{st.error}</div>}
            </div>
          </div>
          <button className="btn sm" disabled={!enabled || st?.updating} onClick={() => invoke('adblock:update').then(setSt)}>
            <RefreshCw size={12} /> Update now
          </button>
          <Switch on={enabled} onChange={(v) => setSetting('privacy.adblock', v)} label="Ad blocker" />
        </div>
        {(st?.lists ?? []).map((l) => (
          <div key={l.id} className="setting" style={enabled ? undefined : { opacity: 0.55 }}>
            <div className="st-text">
              <div className="st-title">
                {l.name} {l.enabled && l.rules > 0 && <span className="badge">{l.rules.toLocaleString()} rules</span>}
              </div>
              <div className="st-desc">{l.desc}</div>
            </div>
            <Switch on={lists.includes(l.id)} disabled={!enabled} onChange={(v) => toggleList(l.id, v)} label={l.name} />
          </div>
        ))}
        <div className="setting" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
          <div className="st-text">
            <div className="st-title">My filters</div>
            <div className="st-desc">
              One rule per line in uBlock Origin / Adblock Plus syntax — <span className="mono">||ads.example.com^</span> blocks a host, <span className="mono">example.com##.banner</span> hides an element, <span className="mono">@@||example.com^</span> allows one.
            </div>
          </div>
          <textarea className="textarea mono" rows={5} style={{ width: '100%', fontSize: 12 }} spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="! comments start with !" aria-label="My filters" />
          <div className="row" style={{ width: '100%' }}>
            <span className="dim" style={{ fontSize: 11.5 }}>{st ? `${st.customRules} rule${st.customRules === 1 ? '' : 's'} saved` : ''}</span>
            <span className="spacer" />
            <button className="btn sm" disabled={draft === custom} onClick={() => setDraft(custom)}>
              Revert
            </button>
            <button className="btn sm solid" disabled={draft === custom} onClick={() => setSetting('privacy.adblockCustomFilters', draft).then(() => toast({ kind: 'ok', title: 'Filters saved', body: 'Reload pages to apply.', ttl: 2500 }))}>
              Save filters
            </button>
          </div>
        </div>
        <div className="setting" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
          <div className="st-text">
            <div className="st-title">Sites where the ad blocker is off</div>
            <div className="st-desc">Includes their subdomains. You can also switch a site from the lock icon in the address bar.</div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {(st?.allowlist ?? []).length === 0 && <span className="dim" style={{ fontSize: 12 }}>None — ads are blocked everywhere.</span>}
            {(st?.allowlist ?? []).map((h) => (
              <span key={h} className="badge" style={{ gap: 4 }}>
                {h}
                <button className="icon-btn sm" style={{ width: 16, height: 16 }} onClick={() => setAdblockForSite(h, true)} aria-label={`Turn the ad blocker back on for ${h}`}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="row" style={{ width: '100%', maxWidth: 420 }}>
            <input className="input grow" value={site} onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSite()} placeholder="example.com" aria-label="Site to exclude" />
            <button className="btn sm" disabled={!site.trim()} onClick={addSite}>
              Add site
            </button>
          </div>
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
