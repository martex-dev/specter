// GX Control dock panel: limiters with live gauges, hot tabs killer, browser
// sounds and new tab wallpapers. Every number shown is measured by the main
// process (app.getAppMetrics); nothing is estimated.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Cpu, Flame, Gauge as GaugeIcon, ImageIcon, MemoryStick, Moon, Play, Trash2, Volume2, VolumeX, Wifi } from 'lucide-react'
import { CPU_RATES, heavyTabs, NET_PRESETS, ramLimitRange, type ControlConfig, type ControlStats, type SleepLogEntry, type SoundThemeId, type TabUsage } from '@shared/modules/control'
import { invoke } from '../../lib/ipc'
import { formatBytes, timeAgo } from '../../lib/format'
import { activateTab, findTab, newTab } from '../../stores/browser'
import { setSetting, useSetting } from '../../stores/settings'
import { toast } from '../../stores/ui'
import { Favicon, Switch } from '../../components/ui'
import { Gauge } from './Gauge'
import { patchConfig, panelMounted, setSection, useControl, type ControlSection } from './store'
import { audioPlaying, playSound } from './sound/engine'
import { resolveSoundTheme, SOUND_THEMES, type ConcreteSoundTheme } from './sound/schedule'
import { BUILTIN_WALLPAPERS, parseWallpaper } from './wallpaper/art'
import { useRootData, useWallpaperMotion, Wallpaper } from './wallpaper/Wallpaper'
import './control.css'

const gb = (kb: number) => kb / (1024 * 1024)
const fmtGB = (kb: number, d = 1) => `${gb(kb).toFixed(d)} GB`
const fmtMbps = (bps: number) => {
  const m = (bps * 8) / 1e6
  return m >= 10 ? m.toFixed(0) : m.toFixed(1)
}

const SECTIONS: { id: ControlSection; label: string; icon: typeof GaugeIcon }[] = [
  { id: 'limiters', label: 'Limiters', icon: GaugeIcon },
  { id: 'hot', label: 'Hot tabs', icon: Flame },
  { id: 'sound', label: 'Sound', icon: Volume2 },
  { id: 'wallpaper', label: 'Wallpaper', icon: ImageIcon }
]

export default function ControlPanel() {
  useEffect(() => panelMounted(), [])
  const section = useControl((s) => s.section)
  const config = useControl((s) => s.config)
  const stats = useControl((s) => s.stats)
  if (!config) return <div className="empty">Loading…</div>
  return (
    <div className="ctl">
      <nav className="ctl-nav" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} className={section === s.id ? 'on' : ''} onClick={() => setSection(s.id)}>
            <s.icon size={14} />
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="ctl-body">
        {section === 'limiters' && <Limiters config={config} stats={stats} />}
        {section === 'hot' && <HotTabs stats={stats} />}
        {section === 'sound' && <Sounds config={config} />}
        {section === 'wallpaper' && <Wallpapers config={config} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- shared bits

function Card({ icon, title, on, onToggle, children, badge }: { icon: ReactNode; title: string; on?: boolean; onToggle?: (v: boolean) => void; children?: ReactNode; badge?: ReactNode }) {
  return (
    <section className={'ctl-card' + (on === false ? ' off' : '')}>
      <header>
        <span className="ctl-card-icon">{icon}</span>
        <h4>{title}</h4>
        {badge}
        <span className="spacer" />
        {onToggle && <Switch on={!!on} onChange={onToggle} label={title} />}
      </header>
      {children}
    </section>
  )
}

function Toggle({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={'ctl-toggle' + (disabled ? ' disabled' : '')}>
      <div className="grow">
        <div>{label}</div>
        {hint && <div className="ctl-hint">{hint}</div>}
      </div>
      <Switch on={on} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}

function Chips<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="ctl-chips" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Range slider that updates locally while dragging and commits after a short pause. */
function Slider({ value, min, max, step, onCommit, format, disabled, ariaLabel }: { value: number; min: number; max: number; step: number; onCommit: (v: number) => void; format: (v: number) => ReactNode; disabled?: boolean; ariaLabel: string }) {
  const [local, setLocal] = useState(value)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => setLocal(value), [value])
  const pct = max > min ? ((local - min) / (max - min)) * 100 : 0
  return (
    <div className={'ctl-slider' + (disabled ? ' disabled' : '')}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{ ['--p' as string]: pct + '%' }}
        onChange={(e) => {
          const v = Number(e.target.value)
          setLocal(v)
          clearTimeout(timer.current)
          timer.current = window.setTimeout(() => onCommit(v), 250)
        }}
      />
      <b className="num">{format(local)}</b>
    </div>
  )
}

// ---------------------------------------------------------------- limiters

function Limiters({ config, stats }: { config: ControlConfig; stats: ControlStats | null }) {
  const log = useControl((s) => s.log)
  const [showAll, setShowAll] = useState(false)
  const ram = config.ram
  const sysKB = stats?.systemKB ?? 0
  const range = ramLimitRange(sysKB * 1024)
  const limitKB = ram.limitMB * 1024
  const total = stats?.totalKB ?? null
  const ramFrac = total === null ? null : ram.enabled ? total / limitKB : sysKB ? total / sysKB : null
  const over = ram.enabled && total !== null && total > limitKB
  const net = stats?.net
  const netMbps = net?.active ? (net.downBps * 8) / 1e6 : null
  const throttledTabs = stats?.tabs.filter((t) => t.throttled) ?? []
  const skippedTabs = stats?.tabs.filter((t) => !t.visible && !t.throttled && t.throttleSkip) ?? []
  const backgroundLive = stats?.tabs.filter((t) => !t.visible).length ?? 0

  return (
    <>
      <div className="ctl-cluster">
        <Gauge
          size={150}
          label="RAM"
          value={ramFrac}
          marker={!ram.enabled && sysKB ? limitKB / sysKB : undefined}
          state={over ? 'bad' : ramFrac !== null && ramFrac > 0.85 ? 'warn' : 'normal'}
          center={total === null ? '—' : formatBytes(total * 1024)}
          sub={ram.enabled ? `of ${fmtGB(limitKB)} limit` : sysKB ? `of ${fmtGB(sysKB, 0)} system` : 'measuring…'}
        />
        <div className="ctl-cluster-side">
          <Gauge size={96} label="CPU" value={stats ? stats.cpuPct / 100 : null} ticks={24} state={stats && stats.cpuPct > 60 ? 'warn' : 'normal'} center={stats ? `${stats.cpuPct.toFixed(stats.cpuPct < 10 ? 1 : 0)}%` : '—'} sub={stats ? `${stats.processes} proc` : undefined} />
          <Gauge size={96} label="NET" value={netMbps === null ? null : Math.min(1, Math.log10(1 + netMbps) / 2)} ticks={24} disabled={!net?.active} center={netMbps === null ? '∞' : fmtMbps(net!.downBps)} sub={netMbps === null ? 'no cap' : 'Mbps cap'} />
        </div>
      </div>
      <div className="ctl-foot-note">SPECTER only · all its processes · updated {stats ? new Date(stats.at).toLocaleTimeString() : '—'}</div>

      <Card icon={<MemoryStick size={15} />} title="RAM limiter" on={ram.enabled} onToggle={(v) => patchConfig({ ram: { enabled: v } })} badge={over ? <span className="badge bad">over</span> : null}>
        <Slider
          ariaLabel="RAM limit"
          value={Math.min(ram.limitMB, range.max)}
          min={range.min}
          max={range.max}
          step={range.step}
          disabled={!sysKB}
          format={(v) => `${(v / 1024).toFixed(v % 1024 ? 2 : 0)} GB`}
          onCommit={(v) => patchConfig({ ram: { limitMB: v } })}
        />
        <div className="ctl-scale">
          <span>1 GB</span>
          <span>{sysKB ? fmtGB(sysKB, 0) + ' installed' : ''}</span>
        </div>
        <Toggle label="Hard limit" hint="React on the first reading above the limit and also sleep pinned, audible and just-used background tabs." on={ram.hard} onChange={(v) => patchConfig({ ram: { hard: v } })} />
        <Toggle label="Keep pinned tabs awake" on={ram.excludePinned} disabled={ram.hard} onChange={(v) => patchConfig({ ram: { excludePinned: v } })} />
        <Toggle label="Keep tabs playing audio awake" on={ram.excludeAudible} disabled={ram.hard} onChange={(v) => patchConfig({ ram: { excludeAudible: v } })} />
        {ram.enabled && <div className={'ctl-status' + (over ? ' bad' : '')}>{stats?.ram.status ?? 'Watching'}</div>}
        <div className="ctl-log">
          <div className="row">
            <span className="label grow">Sleep log · measured</span>
            {log.length > 0 && (
              <button className="icon-btn sm" data-tip="Clear log" aria-label="Clear log" onClick={() => invoke('control:clearLog').then(() => useControl.setState({ log: [] }))}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
          {log.length === 0 && <div className="ctl-hint">Nothing slept yet. Entries show SPECTER’s total private memory right before and after the tabs’ processes exited.</div>}
          {(showAll ? log : log.slice(0, 4)).map((e) => (
            <LogRow key={e.id} e={e} />
          ))}
          {log.length > 4 && (
            <button className="btn sm ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show less' : `Show all ${log.length}`}
            </button>
          )}
        </div>
        <p className="ctl-note">Measures SPECTER’s total private memory across all its processes. Only background tabs are slept (least recently used first); visible tabs and SPECTER’s own interface, GPU and network processes keep running, so a very low limit may not be reachable.</p>
      </Card>

      <Card icon={<Wifi size={15} />} title="Network limiter" badge={net?.active ? <span className="badge accent">{fmtMbps(net.downBps)} Mbps</span> : null}>
        <Chips value={config.net.preset} options={NET_PRESETS.map((p) => ({ value: p.id, label: p.id === 'off' || p.id === 'custom' ? p.label : p.mbps }))} onChange={(v) => patchConfig({ net: { preset: v } })} />
        {config.net.preset === 'custom' && (
          <div className="ctl-custom">
            <NumberField label="Download" unit="Mbps" value={config.net.customDownMbps} onCommit={(v) => patchConfig({ net: { customDownMbps: v } })} />
            <NumberField label="Upload" unit="Mbps" value={config.net.customUpMbps} onCommit={(v) => patchConfig({ net: { customUpMbps: v } })} />
          </div>
        )}
        <div className="row ctl-inline">
          <span className="grow">Added latency</span>
          <Chips value={config.net.latencyMs} disabled={config.net.preset === 'off'} options={[0, 50, 150, 400].map((ms) => ({ value: ms, label: ms ? `${ms} ms` : 'none' }))} onChange={(v) => patchConfig({ net: { latencyMs: v } })} />
        </div>
        {net?.active && (
          <div className="ctl-status">
            Capping {net.guests ?? 0} open page{net.guests === 1 ? '' : 's'} at {fmtMbps(net.downBps)} Mbps down / {fmtMbps(net.upBps)} Mbps up{net.latencyMs ? ` · +${net.latencyMs} ms` : ''}
          </div>
        )}
        {net?.error && <div className="ctl-status bad">{net.error}</div>}
        <p className="ctl-note">Caps each web page SPECTER shows in this profile (tabs and web panels, including new ones) with Chromium’s DevTools network throttling. The cap is per page; other apps, Windows and SPECTER’s own background requests are not affected.</p>
      </Card>

      <Card icon={<Cpu size={15} />} title="CPU limiter · background tabs" on={config.cpu.enabled} onToggle={(v) => patchConfig({ cpu: { enabled: v } })} badge={config.cpu.enabled ? <span className="badge accent">{throttledTabs.length} throttled</span> : null}>
        <div className="row ctl-inline">
          <span className="grow">Slow down by</span>
          <Chips value={config.cpu.rate} options={CPU_RATES.map((r) => ({ value: r, label: `×${r}` }))} onChange={(v) => patchConfig({ cpu: { rate: v } })} />
        </div>
        {config.cpu.enabled && (
          <div className="ctl-tablist">
            {throttledTabs.map((t) => (
              <div key={t.tabId} className="ctl-mini-tab">
                <Favicon src={findTab(t.tabId)?.tab.favicon} url={t.url} size={12} />
                <span className="ellipsis grow">{t.title}</span>
                <span className="badge accent">×{config.cpu.rate}</span>
              </div>
            ))}
            {skippedTabs.map((t) => (
              <div key={t.tabId} className="ctl-mini-tab dim">
                <Favicon src={findTab(t.tabId)?.tab.favicon} url={t.url} size={12} />
                <span className="ellipsis grow">{t.title}</span>
                <span className="ctl-hint">{t.throttleSkip}</span>
              </div>
            ))}
            {!throttledTabs.length && !skippedTabs.length && <div className="ctl-hint">{backgroundLive ? 'Applying…' : 'No awake background tabs right now.'}</div>}
          </div>
        )}
        <p className="ctl-note">Throttles JavaScript and layout of tabs you can’t see through Chromium’s CPU throttling (DevTools protocol). Removed the moment a tab becomes visible; tabs with DevTools open are skipped.</p>
      </Card>
    </>
  )
}

function NumberField({ label, unit, value, onCommit }: { label: string; unit: string; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = () => {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) onCommit(n)
    else setV(String(value))
  }
  return (
    <label className="ctl-num">
      <span className="label">{label}</span>
      <span className="row">
        <input className="input" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        <span className="dim">{unit}</span>
      </span>
    </label>
  )
}

function LogRow({ e }: { e: SleepLogEntry }) {
  const good = e.releasedKB > 0
  return (
    <div className="ctl-log-row" title={e.tabs.map((t) => t.title).join('\n') + (e.note ? '\n\n' + e.note : '')}>
      <span className={'ctl-log-dot ' + e.reason} />
      <span className="grow ellipsis">
        {e.reason === 'limit' ? 'Limit' : e.reason === 'heavy' ? 'Heavy tabs' : 'Manual'} · {e.tabs.length} tab{e.tabs.length === 1 ? '' : 's'} · <span className="dim">{e.tabs.map((t) => t.title).join(', ')}</span>
      </span>
      <b className={'num ' + (good ? 'up' : 'dim')}>{good ? '−' + formatBytes(e.releasedKB * 1024) : formatBytes(Math.abs(e.releasedKB) * 1024) + (e.releasedKB < 0 ? ' more' : '')}</b>
      <span className="dim num ctl-log-time">{timeAgo(e.at)}</span>
    </div>
  )
}

// ---------------------------------------------------------------- hot tabs

async function sleepWithToast(ids: string[], reason: 'manual' | 'heavy'): Promise<void> {
  if (!ids.length) return
  try {
    const e = await invoke('control:sleepTabs', ids, reason)
    if (!e) toast({ kind: 'warn', title: 'Nothing was slept', body: 'The tab may already be asleep or not loaded.' })
    else toast({ kind: 'ok', title: `Slept ${e.tabs.length} tab${e.tabs.length === 1 ? '' : 's'}`, body: `SPECTER memory ${formatBytes(e.beforeKB * 1024)} → ${formatBytes(e.afterKB * 1024)} (measured over ${(e.ms / 1000).toFixed(1)} s)` })
  } catch (err) {
    toast({ kind: 'error', title: 'Could not sleep tabs', body: err instanceof Error ? err.message : String(err) })
  }
}

function HotTabs({ stats }: { stats: ControlStats | null }) {
  const [busy, setBusy] = useState(false)
  if (!stats) return <div className="empty">Measuring…</div>
  const tabs = stats.tabs
  const heavy = heavyTabs(tabs)
  const maxMem = Math.max(1, ...tabs.map((t) => (t.memKB ?? 0) + t.sharedKB))
  const tabsKB = tabs.reduce((a, t) => a + (t.memKB ?? 0), 0)
  return (
    <>
      <div className="ctl-hot-head">
        <div>
          <div className="ctl-big num">{formatBytes(tabsKB * 1024)}</div>
          <div className="ctl-hint">
            in {tabs.length} awake tab{tabs.length === 1 ? '' : 's'} · SPECTER total {formatBytes(stats.totalKB * 1024)}
          </div>
        </div>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={!heavy.length || busy}
          onClick={async () => {
            setBusy(true)
            await sleepWithToast(
              heavy.map((t) => t.tabId),
              'heavy'
            )
            setBusy(false)
          }}
          data-tip="Background tabs above 300 MB or 20% of a core"
        >
          <Moon size={13} /> Sleep {heavy.length || ''} heavy
        </button>
      </div>
      {tabs.length === 0 && <div className="empty">No awake web tabs.</div>}
      <div className="ctl-hot-list">
        {tabs.map((t) => (
          <HotRow key={t.tabId} t={t} maxMem={maxMem} heavy={heavy.includes(t)} />
        ))}
      </div>
      <p className="ctl-note">Memory is the private memory of the renderer processes each tab uses on its own (including out-of-process frames). Processes shared by several tabs are shown separately, never split by guess. CPU is % of one core over the last interval.</p>
    </>
  )
}

function HotRow({ t, maxMem, heavy }: { t: TabUsage; maxMem: number; heavy: boolean }) {
  const own = t.memKB ?? 0
  return (
    <div className={'ctl-hot' + (heavy ? ' heavy' : '')}>
      <Favicon src={findTab(t.tabId)?.tab.favicon} url={t.url} size={14} />
      <div className="grow" style={{ minWidth: 0 }}>
        <button className="ctl-hot-title ellipsis" onClick={() => activateTab(t.tabId)} title={t.url}>
          {t.title}
        </button>
        <div className="ctl-bar">
          <span style={{ width: `${(own / maxMem) * 100}%` }} />
          {t.sharedKB > 0 && <span className="shared" style={{ width: `${(t.sharedKB / maxMem) * 100}%` }} />}
        </div>
        <div className="ctl-hot-meta">
          <span className="num">{t.memKB === null ? 'Unavailable' : formatBytes(own * 1024)}</span>
          {t.sharedKB > 0 && <span className="dim">+ {formatBytes(t.sharedKB * 1024)} shared ×{t.sharedWith + 1}</span>}
          <span className={'num' + ((t.cpu ?? 0) >= 20 ? ' warn' : '')}>CPU {t.cpu === null ? '—' : t.cpu.toFixed(1) + '%'}</span>
          {t.visible && <span className="badge">visible</span>}
          {t.pinned && <span className="badge">pinned</span>}
          {t.audible && <span className="badge">audio</span>}
          {t.throttled && <span className="badge accent">throttled</span>}
        </div>
      </div>
      <button className="btn sm" disabled={t.visible} data-tip={t.visible ? 'Visible tabs can’t be slept' : 'Sleep this tab (measured)'} onClick={() => sleepWithToast([t.tabId], 'manual')}>
        <Moon size={12} /> Sleep
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- sounds

function Sounds({ config }: { config: ControlConfig }) {
  const s = config.sounds
  const visual = useRootData('data-theme')
  const effective = resolveSoundTheme(s.theme, visual)
  const [, tick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 2000)
    return () => clearInterval(i)
  }, [])
  const muted = s.enabled && s.autoMute && audioPlaying()
  const preview = (theme: ConcreteSoundTheme) => {
    playSound('tabOpen', { theme, force: true, volume: s.volume || 0.5 })
    setTimeout(() => playSound('notify', { theme, force: true, volume: s.volume || 0.5 }), 380)
  }
  const options: { id: SoundThemeId; name: string; blurb: string }[] = [
    { id: 'auto', name: 'Match theme', blurb: `Currently ${SOUND_THEMES.find((x) => x.id === resolveSoundTheme('auto', visual))?.name}` },
    ...SOUND_THEMES.map((t) => ({ id: t.id as SoundThemeId, name: t.name, blurb: `${t.blurb} · ${t.pairs}` }))
  ]
  return (
    <>
      <Card icon={s.enabled && !muted ? <Volume2 size={15} /> : <VolumeX size={15} />} title="Browser sounds" on={s.enabled} onToggle={(v) => patchConfig({ sounds: { enabled: v } })} badge={muted ? <span className="badge warn">muted · tab audio</span> : null}>
        <Slider ariaLabel="Volume" value={Math.round(s.volume * 100)} min={0} max={100} step={1} format={(v) => `${v}%`} onCommit={(v) => patchConfig({ sounds: { volume: v / 100 } })} />
        <div className="ctl-sound-grid">
          {options.map((o) => {
            const concrete = o.id === 'auto' ? effective : (o.id as ConcreteSoundTheme)
            return (
              <div key={o.id} className={'ctl-sound' + (s.theme === o.id ? ' on' : '')} role="radio" aria-checked={s.theme === o.id} tabIndex={0} onClick={() => patchConfig({ sounds: { theme: o.id } })} onKeyDown={(e) => e.key === 'Enter' && patchConfig({ sounds: { theme: o.id } })}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ctl-sound-name">{o.name}</div>
                  <div className="ctl-hint ellipsis">{o.blurb}</div>
                </div>
                <button
                  className="icon-btn sm"
                  aria-label={'Preview ' + o.name}
                  data-tip="Preview"
                  onClick={(e) => {
                    e.stopPropagation()
                    preview(concrete)
                  }}
                >
                  <Play size={12} />
                </button>
              </div>
            )
          })}
        </div>
        <Toggle label="Tab open / close" on={s.tabs} onChange={(v) => patchConfig({ sounds: { tabs: v } })} />
        <Toggle label="Notifications" hint="Plays in the focused SPECTER window." on={s.notifications} onChange={(v) => patchConfig({ sounds: { notifications: v } })} />
        <Toggle label="Clicks in SPECTER’s interface" hint="Buttons, toggles and lists — never inside web pages." on={s.clicks} onChange={(v) => patchConfig({ sounds: { clicks: v } })} />
        <Toggle label="Mute while a tab plays audio" on={s.autoMute} onChange={(v) => patchConfig({ sounds: { autoMute: v } })} />
        <p className="ctl-note">Synthesized live with Web Audio — no sound files. Off by default.</p>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------- wallpapers

function Wallpapers({ config }: { config: ControlConfig }) {
  const value = useSetting('appearance.wallpaper')
  const cur = parseWallpaper(value)
  const moving = useWallpaperMotion(true)
  const w = config.wallpaper
  const choose = (v: string) => setSetting('appearance.wallpaper', v)
  const pick = async () => {
    try {
      const path = await invoke('control:pickWallpaper')
      if (path) choose('file:' + path)
    } catch (err) {
      toast({ kind: 'error', title: 'Could not use that image', body: err instanceof Error ? err.message : String(err) })
    }
  }
  return (
    <Card icon={<ImageIcon size={15} />} title="New tab wallpaper">
      <div className="ctl-wp-grid">
        <button className={'ctl-wp-tile none' + (cur.kind === 'none' ? ' on' : '')} onClick={() => choose('')} aria-pressed={cur.kind === 'none'}>
          <span className="ctl-wp-thumb" />
          <span className="ctl-wp-name">None</span>
        </button>
        {BUILTIN_WALLPAPERS.map((b) => (
          <button key={b.id} className={'ctl-wp-tile' + (cur.kind === 'builtin' && cur.id === b.id ? ' on' : '')} onClick={() => choose('builtin:' + b.id)} aria-pressed={cur.kind === 'builtin' && cur.id === b.id}>
            <span className="ctl-wp-thumb">
              <Wallpaper value={'builtin:' + b.id} dim={0} animate={false} preview />
            </span>
            <span className="ctl-wp-name">
              {b.name}
              {b.animated && <span className="dim"> · animated</span>}
            </span>
          </button>
        ))}
        <button className={'ctl-wp-tile' + (cur.kind === 'file' ? ' on' : '')} onClick={pick} aria-pressed={cur.kind === 'file'}>
          <span className="ctl-wp-thumb">{cur.kind === 'file' ? <Wallpaper value={value} dim={0} animate={false} preview /> : <ImageIcon size={20} className="dim" />}</span>
          <span className="ctl-wp-name">{cur.kind === 'file' ? 'Your image · change…' : 'Your image…'}</span>
        </button>
      </div>
      <div className="row ctl-inline">
        <span className="grow">Dim</span>
      </div>
      <Slider ariaLabel="Wallpaper dim" value={Math.round(w.dim * 100)} min={0} max={85} step={1} format={(v) => `${v}%`} onCommit={(v) => patchConfig({ wallpaper: { dim: v / 100 } })} />
      <Toggle label="Animate" hint={moving ? 'Slow, low-cost motion on the new tab page only.' : 'Paused: reduced motion is on (SPECTER setting, performance mode or Windows).'} on={w.animate} onChange={(v) => patchConfig({ wallpaper: { animate: v } })} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => newTab('specter://newtab')}>
          Open a new tab to see it
        </button>
      </div>
      <p className="ctl-note">Built-in wallpapers are drawn live from the current theme’s colours. Your own image is copied into SPECTER’s data folder on this PC and never uploaded.</p>
    </Card>
  )
}
