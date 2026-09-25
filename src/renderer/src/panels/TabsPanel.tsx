// Tab sleeping dashboard: lifecycle of every tab with REAL memory numbers.
import { useEffect, useState } from 'react'
import { Moon, Sun, Zap } from 'lucide-react'
import { SUSPEND_MS, type SuspendAfter } from '@shared/settings'
import { invoke } from '../lib/ipc'
import { formatBytes, timeAgo } from '../lib/format'
import { wcIdFor } from '../lib/webviews'
import { activateTab, suspendAllBackground, suspendTab, tabLifecycle, useBrowser, visibleTabIds, wakeTab } from '../stores/browser'
import { setSetting, useSetting } from '../stores/settings'
import { Favicon } from '../components/ui'

export default function TabsPanel() {
  const st = useBrowser()
  const suspendAfter = useSetting('tabs.suspendAfter')
  const [mem, setMem] = useState<Record<string, number>>({})
  const [, tick] = useState(0)

  // Measure live tab memory (private bytes of each tab's renderer process).
  useEffect(() => {
    let alive = true
    const measure = async () => {
      const out: Record<string, number> = {}
      for (const ws of Object.values(useBrowser.getState().open))
        for (const t of ws.tabs) {
          const id = wcIdFor(t.id)
          if (id === null || t.suspended) continue
          const kb = await invoke('guest:pageMemory', id).catch(() => null)
          if (kb) out[t.id] = kb
        }
      if (alive) setMem(out)
    }
    measure()
    const i = setInterval(() => {
      measure()
      tick((n) => n + 1)
    }, 5000)
    return () => {
      alive = false
      clearInterval(i)
    }
  }, [])

  const all = Object.values(st.open).flatMap((ws) => ws.tabs.map((t) => ({ t, ws, visible: ws.id === st.activeWsId && visibleTabIds(ws).includes(t.id) })))
  const sleeping = all.filter((x) => x.t.suspended)
  const active = all.filter((x) => !x.t.suspended)
  const freedKB = sleeping.reduce((a, x) => a + (x.t.memoryReleasedKB ?? 0), 0)
  const measuredSleeping = sleeping.filter((x) => x.t.memoryReleasedKB).length
  const liveKB = Object.values(mem).reduce((a, b) => a + b, 0)

  return (
    <div style={{ padding: 12 }} className="col">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <Stat label="Active" value={String(active.length)} icon={<Zap size={13} />} />
        <Stat label="Sleeping" value={String(sleeping.length)} icon={<Moon size={13} />} />
        <Stat label="Live memory" value={liveKB ? formatBytes(liveKB * 1024) : '—'} />
      </div>
      <div className="card" style={{ padding: '10px 12px', fontSize: 12 }}>
        <div className="row">
          <span className="grow">Memory released by sleeping tabs</span>
          <b className="num">{freedKB ? formatBytes(freedKB * 1024) : '—'}</b>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.45 }}>
          Measured from each tab’s renderer process right before it slept ({measuredSleeping} of {sleeping.length} sleeping tabs measured; tabs restored lazily at startup were never loaded, so there is nothing to measure). Processes shared between tabs may overstate savings.
        </div>
      </div>
      <div className="row">
        <span className="label grow">Sleep inactive tabs after</span>
        <select className="select" value={suspendAfter} onChange={(e) => setSetting('tabs.suspendAfter', e.target.value as SuspendAfter)} style={{ height: 26 }}>
          <option value="never">Never</option>
          <option value="5m">5 minutes</option>
          <option value="15m">15 minutes</option>
          <option value="30m">30 minutes</option>
          <option value="1h">1 hour</option>
          <option value="auto">Automatic (20 min)</option>
        </select>
      </div>
      <button className="btn" onClick={suspendAllBackground}>
        <Moon size={13} /> Sleep all background tabs now
      </button>
      <div className="label" style={{ marginTop: 6 }}>
        Tabs
      </div>
      <div className="col" style={{ gap: 2 }}>
        {all.map(({ t, ws, visible }) => {
          const life = tabLifecycle(t, visible)
          return (
            <div key={t.id} className="row" style={{ height: 34, padding: '0 6px', borderRadius: 6, cursor: 'pointer' }} onClick={() => activateTab(t.id)}>
              <Favicon src={t.favicon} url={t.url} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontSize: 12, color: t.suspended ? 'var(--fg-2)' : undefined }}>
                  {t.title}
                </div>
                <div className="dim" style={{ fontSize: 10.5 }}>
                  {ws.name} · {timeAgo(t.lastActive)}
                </div>
              </div>
              <span className={'badge' + (life === 'active' ? ' ok' : life === 'suspended' ? '' : life === 'idle' ? ' warn' : '')}>{life}</span>
              <span className="mono muted" style={{ width: 62, textAlign: 'right', fontSize: 10.5 }}>
                {mem[t.id] ? formatBytes(mem[t.id] * 1024, 0) : t.memoryReleasedKB ? '−' + formatBytes(t.memoryReleasedKB * 1024, 0) : ''}
              </span>
              {t.suspended ? (
                <button
                  className="icon-btn sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    wakeTab(t.id)
                  }}
                  data-tip="Wake"
                  aria-label="Wake tab"
                >
                  <Sun size={12} />
                </button>
              ) : (
                <button
                  className="icon-btn sm"
                  disabled={visible}
                  onClick={(e) => {
                    e.stopPropagation()
                    suspendTab(t.id)
                  }}
                  data-tip="Sleep"
                  aria-label="Sleep tab"
                >
                  <Moon size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="dim" style={{ fontSize: 11 }}>
        Lifecycle: active → background → idle (after {isFinite(SUSPEND_MS[suspendAfter]) ? Math.round(SUSPEND_MS[suspendAfter] / 120000) + ' min' : '10 min'}) → sleeping. Pinned and audible tabs are
        excluded per your settings.
      </div>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: JSX.Element }) {
  return (
    <div className="card" style={{ padding: '10px 12px' }}>
      <div className="label row" style={{ gap: 5 }}>
        {icon}
        {label}
      </div>
      <div className="num" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
        {value}
      </div>
    </div>
  )
}
