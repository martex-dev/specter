import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Bell,
  Bot,
  Brush,
  CandlestickChart,
  Code2,
  Database,
  FlaskConical,
  Gauge,
  Globe,
  Info,
  Keyboard,
  Layers,
  Lock,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Users,
  Puzzle,
  RotateCcw,
  Trash2,
  Plus
} from 'lucide-react'
import { SEARCH_ENGINES, type SettingKey, type Settings as SettingsT } from '@shared/settings'
import { DEFAULT_KEYBINDINGS, eventToAccelerator, normalizeAccelerator, resolveBindings } from '@shared/keys'
import type { AppInfo } from '@shared/ipc'
import type { Profile } from '@shared/types'
import { invoke, invokeRaw } from '../lib/ipc'
import { ThemeGallery } from '../components/ThemeGallery'
import { THEMES } from '../lib/themes'
import { listCommands, getCommand } from '../lib/commands'
import { settingsSections } from '../lib/registry'
import { WORKSPACE_COLORS } from '../lib/icons'
import { loadUrl, useBrowser } from '../stores/browser'
import { getSetting, setSetting, useSetting } from '../stores/settings'
import { toast } from '../stores/ui'
import { checkForUpdatesNow, installUpdate, useUpdates } from '../stores/updates'
import { describeUpdateState } from '@shared/updates'
import { Kbd, Seg, Switch } from '../components/ui'
import { confirmAction, promptText } from '../components/prompt'
import type { PageProps } from './registry'

// ---------------------------------------------------------------- primitives

export function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="st-text">
        <div className="st-title">{title}</div>
        {desc && <div className="st-desc">{desc}</div>}
      </div>
      {children}
    </div>
  )
}

export function Toggle({ k, title, desc }: { k: SettingKey; title: ReactNode; desc?: ReactNode }) {
  const v = useSetting(k) as boolean
  return (
    <Row title={title} desc={desc}>
      <Switch on={!!v} onChange={(x) => setSetting(k, x as never)} label={typeof title === 'string' ? title : undefined} />
    </Row>
  )
}

export function Choice<K extends SettingKey>({ k, title, desc, options }: { k: K; title: ReactNode; desc?: ReactNode; options: { value: string; label: string }[] }) {
  const v = useSetting(k) as unknown as string
  return (
    <Row title={title} desc={desc}>
      <select className="select" value={String(v)} onChange={(e) => setSetting(k, (typeof v === 'number' ? Number(e.target.value) : e.target.value) as never)} style={{ minWidth: 180 }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  )
}

export function TextSetting({ k, title, desc, placeholder, width = 260 }: { k: SettingKey; title: ReactNode; desc?: ReactNode; placeholder?: string; width?: number }) {
  const v = useSetting(k) as unknown as string
  const [draft, setDraft] = useState(v)
  useEffect(() => setDraft(v), [v])
  return (
    <Row title={title} desc={desc}>
      <input className="input" style={{ width }} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== v && setSetting(k, draft as never)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </Row>
  )
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="setting-group-title">{title}</div>
      <div className="card setting-group">{children}</div>
    </>
  )
}

// ---------------------------------------------------------------- sections

function General() {
  const workspaces = useBrowser((s) => s.workspaces)
  const startup = useSetting('general.startup')
  return (
    <>
      <Group title="Startup">
        <Choice
          k="general.startup"
          title="When SPECTER starts"
          options={[
            { value: 'restore', label: 'Open previous session' },
            { value: 'newtab', label: 'Open a new tab (offer to restore)' },
            { value: 'workspace', label: 'Open a specific workspace' },
            { value: 'nothing', label: 'Blank new tab' }
          ]}
        />
        {startup === 'workspace' && <Choice k="general.startupWorkspace" title="Startup workspace" options={workspaces.map((w) => ({ value: w.id, label: w.name }))} />}
        <TextSetting k="general.homepage" title="Home page" desc="Used by the Home button. specter://newtab for the new tab page." />
      </Group>
      <Group title="Background">
        <Toggle k="general.runInBackground" title="Keep running in background" desc="Keeps SPECTER in the system tray after the last window closes so alerts, downloads and notifications continue." />
        <Toggle k="advanced.tray" title="Show tray icon" />
      </Group>
      <Group title="Default browser">
        <Row title="Make SPECTER your default browser" desc="Registers SPECTER for web links and opens Windows Default Apps, where Windows requires you to confirm the choice.">
          <button className="btn" onClick={() => invoke('app:setDefaultBrowser')}>
            Open Default Apps
          </button>
        </Row>
      </Group>
    </>
  )
}

function Appearance() {
  return (
    <>
      <div className="setting-group-title">Themes</div>
      <ThemeGallery />
      <AutoThemeGroup />
      <Group title="Typography & layout">
        <TextSetting k="appearance.fontFamily" title="Interface font" desc="Leave empty for the theme’s own font." placeholder="e.g. Inter, 'IBM Plex Sans'" />
        <Choice k="appearance.density" title="Density" options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
        <Toggle k="appearance.showBookmarksBar" title="Show bookmarks bar" />
        <Toggle k="appearance.showSideRail" title="Show sidebar" desc="The dock of apps, widgets and tools." />
        <Toggle k="appearance.showStatusBar" title="Show status bar" />
        <Toggle k="appearance.showHud" title="Show title-bar telemetry (HUD)" desc="Compact readouts: tabs, trackers blocked, and optional system / market / AI indicators." />
      </Group>
      <Group title="Motion">
        <Choice
          k="appearance.motion"
          title="Animations"
          desc="ML, Gaming and Battery performance modes automatically reduce animations."
          options={[
            { value: 'full', label: 'Full' },
            { value: 'reduced', label: 'Reduced' },
            { value: 'off', label: 'Off' }
          ]}
        />
      </Group>
    </>
  )
}

function AutoThemeGroup() {
  const auto = useSetting('appearance.auto')
  const set = (patch: Partial<typeof auto>) => setSetting('appearance.auto', { ...auto, ...patch })
  const themeSelect = (value: string, onChange: (v: string) => void) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
  return (
    <Group title="Automatic theme">
      <Row title="Switch themes automatically" desc="Follow Windows’ light/dark mode, or change at set times of day.">
        <Seg
          value={auto.mode}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'system', label: 'Follow Windows' },
            { value: 'schedule', label: 'Schedule' }
          ]}
          onChange={(v) => set({ mode: v as typeof auto.mode })}
        />
      </Row>
      {auto.mode !== 'off' && (
        <>
          <Row title={auto.mode === 'system' ? 'Light mode theme' : 'Day theme'}>{themeSelect(auto.dayTheme, (v) => set({ dayTheme: v as never }))}</Row>
          <Row title={auto.mode === 'system' ? 'Dark mode theme' : 'Night theme'}>{themeSelect(auto.nightTheme, (v) => set({ nightTheme: v as never }))}</Row>
        </>
      )}
      {auto.mode === 'schedule' && (
        <Row title="Day starts / night starts">
          <div className="row">
            <input className="input" type="time" value={auto.dayStart} onChange={(e) => set({ dayStart: e.target.value })} />
            <input className="input" type="time" value={auto.nightStart} onChange={(e) => set({ nightStart: e.target.value })} />
          </div>
        </Row>
      )}
    </Group>
  )
}

function BrowserSection() {
  return (
    <>
      <Group title="Tabs">
        <Choice
          k="tabs.suspendAfter"
          title="Sleep inactive tabs after"
          desc="Sleeping tabs release their renderer process. URL, title and scroll position are restored when you return; unsaved form input may be lost."
          options={[
            { value: 'never', label: 'Never' },
            { value: '5m', label: '5 minutes' },
            { value: '15m', label: '15 minutes' },
            { value: '30m', label: '30 minutes' },
            { value: '1h', label: '1 hour' },
            { value: 'auto', label: 'Automatic' }
          ]}
        />
        <Toggle k="tabs.suspendExcludePinned" title="Never sleep pinned tabs" />
        <Toggle k="tabs.suspendExcludeAudible" title="Never sleep tabs playing audio" />
        <Toggle k="workspaces.suspendInactive" title="Sleep tabs in inactive workspaces sooner" desc="Uses half the timeout for workspaces you are not looking at." />
        <Choice k="tabs.newTabPosition" title="Open new tabs" options={[{ value: 'afterActive', label: 'Next to the current tab' }, { value: 'end', label: 'At the end' }]} />
        <Toggle k="tabs.showPreviews" title="Tab hover previews" desc="Shows a live thumbnail and memory usage when hovering a tab." />
        <Toggle k="tabs.closeOnDoubleClick" title="Double-click a tab to close it" />
      </Group>
      <Group title="Pages">
        <Toggle k="browser.spellcheck" title="Spell check" />
        <Toggle k="browser.smoothScrolling" title="Smooth scrolling" desc="Requires restart." />
        <Toggle k="browser.hardwareAcceleration" title="Hardware acceleration" desc="Uses the GPU for rendering and video. Requires restart." />
      </Group>
      <Group title="Downloads">
        <DownloadDir />
        <Toggle k="downloads.askWhereToSave" title="Ask where to save each file" />
      </Group>
    </>
  )
}

function DownloadDir() {
  const dir = useSetting('downloads.directory')
  return (
    <Row title="Download location" desc={dir || 'System Downloads folder'}>
      <div className="row">
        {dir && (
          <button className="btn ghost" onClick={() => setSetting('downloads.directory', '')}>
            Reset
          </button>
        )}
        <button
          className="btn"
          onClick={async () => {
            const p = await invoke('app:pickFolder', 'Download location')
            if (p) setSetting('downloads.directory', p)
          }}
        >
          Change…
        </button>
      </div>
    </Row>
  )
}

function SearchSection() {
  const engine = useSetting('search.engine')
  return (
    <>
      <Group title="Search engine">
        <Choice k="search.engine" title="Default search engine" options={[...SEARCH_ENGINES.map((e) => ({ value: e.id, label: e.name })), { value: 'custom', label: 'Custom…' }]} />
        {engine === 'custom' && <TextSetting k="search.customTemplate" title="Custom search URL" desc="Use %s where the query goes." placeholder="https://example.com/search?q=%s" width={340} />}
        <Toggle k="search.remoteSuggestions" title="Remote search suggestions" desc="Sends what you type in the address bar to your search engine (DuckDuckGo, Google or Bing only). Local suggestions from history, bookmarks, tabs and commands always work offline." />
      </Group>
      <Group title="History">
        <Toggle k="search.keepHistory" title="Remember recent searches" />
        <Row title="Clear recent searches">
          <button className="btn" onClick={() => invoke('searches:clear').then(() => toast({ kind: 'ok', title: 'Recent searches cleared' }))}>
            Clear
          </button>
        </Row>
      </Group>
    </>
  )
}

function PrivacySection() {
  return (
    <>
      <Group title="Tracking">
        <Toggle k="privacy.blockTrackers" title="Block known trackers" desc="Blocks third-party requests to a built-in list of advertising and analytics domains. See the Privacy Center for what was blocked." />
        <Toggle k="privacy.sendGPC" title="Send Global Privacy Control signal" desc="Sec-GPC: 1 — a legally recognised opt-out in some regions." />
        <Toggle k="privacy.sendDNT" title="Send Do Not Track" desc="Most sites ignore it and it adds a fingerprinting bit." />
        <Toggle k="privacy.blockThirdPartyCookies" title="Block third-party cookies" desc="Approximation: strips cookies on requests to a different registrable domain than the page. May break some sign-ins and embeds." />
        <Toggle k="privacy.httpsUpgrade" title="Upgrade connections to HTTPS" desc="Tries HTTPS first for http:// addresses and falls back to HTTP if the site doesn’t support it." />
      </Group>
      <Group title="Local data">
        <Toggle k="privacy.recordHistory" title="Record browsing history" />
        <Toggle k="privacy.activityLog" title="Local activity summary" desc="Used only for your Daily Activity page. Never leaves this computer." />
        <Toggle k="privacy.clearOnExit" title="Clear cookies, cache and history on exit" />
        <Row title="Clear browsing data" desc="Choose what to clear in the Privacy Center.">
          <button className="btn" onClick={() => document.dispatchEvent(new CustomEvent('specter:open-url', { detail: 'specter://privacy' }))}>
            Open Privacy Center
          </button>
        </Row>
      </Group>
      <SitePermissions />
    </>
  )
}

function SitePermissions() {
  const [list, setList] = useState<{ origin: string; permission: string; decision: string }[]>([])
  const load = () => invoke('permissions:list').then(setList)
  useEffect(() => {
    load()
  }, [])
  const byOrigin = useMemo(() => {
    const m = new Map<string, typeof list>()
    for (const p of list) m.set(p.origin, [...(m.get(p.origin) ?? []), p])
    return [...m]
  }, [list])
  return (
    <Group title="Site permissions">
      {byOrigin.length === 0 && <div className="muted" style={{ padding: '14px 0' }}>No site-specific permissions yet. Sites ask when they need your camera, microphone, location or notifications.</div>}
      {byOrigin.map(([origin, perms]) => (
        <Row key={origin} title={origin} desc={perms.map((p) => `${p.permission}: ${p.decision}`).join(' · ')}>
          <button className="btn sm" onClick={() => invoke('permissions:remove', origin).then(load)}>
            Reset
          </button>
        </Row>
      ))}
    </Group>
  )
}

function SecuritySection() {
  return (
    <Group title="Security">
      <Row title="Security dashboard" desc="Live view of sandboxing, isolation and permission state.">
        <button className="btn" onClick={() => document.dispatchEvent(new CustomEvent('specter:open-url', { detail: 'specter://security' }))}>
          Open
        </button>
      </Row>
      <Row title="Passwords" desc="SPECTER does not store passwords in v1. Use a dedicated password manager (desktop app) — it will work with SPECTER’s pages normally.">
        <span className="badge">Not stored</span>
      </Row>
    </Group>
  )
}

function WorkspacesSection() {
  return (
    <Group title="Workspaces">
      <Row title="Manage workspaces and snapshots">
        <button className="btn" onClick={() => document.dispatchEvent(new CustomEvent('specter:open-url', { detail: 'specter://workspaces' }))}>
          Open manager
        </button>
      </Row>
      <Toggle k="workspaces.suspendInactive" title="Sleep tabs in inactive workspaces sooner" />
    </Group>
  )
}

function AISection() {
  const models = useAiModels()
  return (
    <Group title="Local AI">
      <Toggle k="ai.enabled" title="Enable AI features" desc="AI is optional. When disabled, no AI UI appears and nothing is sent anywhere." />
      <Choice k="ai.provider" title="Provider" options={[{ value: 'ollama', label: 'Ollama (local)' }, { value: 'disabled', label: 'Disabled' }]} />
      <TextSetting k="ai.ollamaUrl" title="Ollama address" desc="Only local / LAN addresses are recommended — prompts are sent to this server." />
      <Row title="Chat model" desc={models ? `${models.length} models installed` : 'Ollama offline — models unavailable'}>
        <select className="select" value={getSetting('ai.model')} onChange={(e) => setSetting('ai.model', e.target.value)} style={{ minWidth: 200 }} disabled={!models?.length}>
          <option value="">Automatic (first available)</option>
          {(models ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Row>
      <TextSetting k="ai.embeddingModel" title="Embedding model" desc="Used for optional semantic search over your local knowledge base." />
      <Row title="Temperature" desc="Lower is more focused, higher more creative.">
        <TemperatureSlider />
      </Row>
      <AIPermissions />
    </Group>
  )
}

function TemperatureSlider() {
  const t = useSetting('ai.temperature')
  return (
    <div className="row">
      <input type="range" min={0} max={1.5} step={0.05} value={t} onChange={(e) => setSetting('ai.temperature', Number(e.target.value))} />
      <span className="mono" style={{ width: 34 }}>
        {t.toFixed(2)}
      </span>
    </div>
  )
}

function AIPermissions() {
  const perms = useSetting('ai.permissions')
  const all: { id: 'read' | 'suggest' | 'write' | 'execute'; label: string; desc: string }[] = [
    { id: 'read', label: 'Read', desc: 'Read the context you explicitly attach (page, selection, notes).' },
    { id: 'suggest', label: 'Suggest', desc: 'Propose actions and edits that you apply yourself.' },
    { id: 'write', label: 'Write', desc: 'Create notes / research entries after you confirm.' },
    { id: 'execute', label: 'Execute', desc: 'Run terminal commands — always shown and confirmed first.' }
  ]
  return (
    <>
      {all.map((p) => (
        <Row key={p.id} title={`AI permission: ${p.label}`} desc={p.desc}>
          <Switch on={perms.includes(p.id)} onChange={(v) => setSetting('ai.permissions', v ? [...perms, p.id] : perms.filter((x) => x !== p.id))} />
        </Row>
      ))}
    </>
  )
}

function useAiModels(): string[] | null {
  const [m, setM] = useState<string[] | null>(null)
  useEffect(() => {
    invokeRaw<{ running: boolean; models: string[] }>('ai:status')
      .then((s) => setM(s?.running ? s.models : null))
      .catch(() => setM(null))
  }, [])
  return m
}

function MarketsSection() {
  return (
    <Group title="Markets">
      <Toggle k="markets.enabled" title="Enable market tools" desc="Watchlists, charts, alerts, portfolio and paper trading using free public data. Off = no market requests at all." />
      <Choice
        k="markets.provider"
        title="Data provider"
        desc="All providers are free public APIs; availability can vary by region."
        options={[
          { value: 'binance', label: 'Binance (public API)' },
          { value: 'coinbase', label: 'Coinbase Exchange (public API)' },
          { value: 'coingecko', label: 'CoinGecko (free API)' }
        ]}
      />
      <TextSetting k="markets.quote" title="Quote currency" desc="For exchange pairs, e.g. USDT or USD." width={120} />
      <Toggle k="markets.showTickerInHud" title="Show ticker in the title bar" />
      <TickerSymbols />
    </Group>
  )
}

function TickerSymbols() {
  const syms = useSetting('markets.tickerSymbols')
  return (
    <Row title="Ticker symbols" desc="Shown in the HUD and on the new tab page.">
      <input className="input" style={{ width: 240 }} defaultValue={syms.join(', ')} onBlur={(e) => setSetting('markets.tickerSymbols', e.target.value.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 12))} />
    </Row>
  )
}

function ResearchSection() {
  return (
    <Group title="Research & knowledge">
      <Toggle k="research.indexPages" title="Index saved pages for local search" desc="Only pages you explicitly save are indexed. Never automatic." />
      <Toggle k="knowledge.semanticSearch" title="Semantic search (local embeddings)" desc="Requires Ollama with an embedding model. Falls back to keyword search." />
    </Group>
  )
}

function DeveloperSection() {
  const roots = useSetting('developer.projectRoots')
  return (
    <Group title="Developer">
      <Toggle k="developer.enabled" title="Enable developer tools" desc="Project explorer, Git, terminal and the developer toolkit." />
      <Choice k="developer.shell" title="Terminal shell" options={[{ value: 'powershell', label: 'PowerShell' }, { value: 'cmd', label: 'Command Prompt' }, { value: 'wsl', label: 'WSL' }]} />
      <Row title="Project folders" desc={roots.length ? roots.join(' · ') : 'SPECTER never indexes your disk automatically — add folders explicitly.'}>
        <div className="row">
          {roots.length > 0 && (
            <button className="btn ghost" onClick={() => setSetting('developer.projectRoots', [])}>
              Clear
            </button>
          )}
          <button
            className="btn"
            onClick={async () => {
              const p = await invoke('app:pickFolder', 'Add project folder')
              if (p && !roots.includes(p)) setSetting('developer.projectRoots', [...roots, p])
            }}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </Row>
    </Group>
  )
}

function PerformanceSection() {
  return (
    <>
      <Group title="Performance mode">
        <Choice
          k="performance.mode"
          title="Mode"
          desc="Adjusts SPECTER’s own behaviour (tab sleeping, polling, animations, background work). It does not change OS or GPU settings."
          options={['normal', 'coding', 'ml', 'research', 'trading', 'gaming', 'battery'].map((m) => ({ value: m, label: m === 'ml' ? 'ML' : m[0].toUpperCase() + m.slice(1) }))}
        />
        <Choice
          k="performance.hudPollMs"
          title="Telemetry refresh"
          options={[
            { value: '1000', label: 'Every second' },
            { value: '2000', label: 'Every 2 seconds' },
            { value: '5000', label: 'Every 5 seconds' },
            { value: '10000', label: 'Every 10 seconds' }
          ]}
        />
      </Group>
    </>
  )
}

function NotificationsSection() {
  const cats = useSetting('notifications.categories')
  return (
    <Group title="Notifications">
      <Toggle k="notifications.enabled" title="Desktop notifications" desc="Shown when SPECTER is in the background. Everything is also listed in the notification center." />
      {Object.keys(cats).map((c) => (
        <Row key={c} title={c[0].toUpperCase() + c.slice(1)}>
          <Switch on={cats[c] !== false} onChange={(v) => setSetting('notifications.categories', { ...cats, [c]: v })} />
        </Row>
      ))}
    </Group>
  )
}

function KeyboardSection() {
  const overrides = useSetting('keyboard.bindings')
  const bindings = resolveBindings(overrides)
  const [recording, setRecording] = useState<string | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(null)
      const acc = eventToAccelerator({ key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey })
      if (!acc) return
      const clash = Object.entries(bindings).find(([id, a]) => a === acc && id !== recording)
      const next = { ...overrides, [recording]: acc }
      if (clash) next[clash[0]] = ''
      setSetting('keyboard.bindings', next)
      if (clash) toast({ kind: 'warn', title: `${acc} was assigned to ${getCommand(clash[0])?.title ?? clash[0]}`, body: 'That shortcut has been cleared.' })
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, bindings, overrides])
  const ids = [...new Set([...Object.keys(DEFAULT_KEYBINDINGS), ...listCommands().map((c) => c.id)])]
  const rows = ids
    .map((id) => ({ id, cmd: getCommand(id), acc: bindings[id] }))
    .filter((r) => r.cmd && (!q || (r.cmd.title + ' ' + r.id + ' ' + (r.acc ?? '')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.cmd!.category + a.cmd!.title).localeCompare(b.cmd!.category + b.cmd!.title))
  return (
    <>
      <div className="row" style={{ margin: '4px 0 10px' }}>
        <input className="input grow" placeholder="Search shortcuts…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          className="btn"
          onClick={async () => {
            if (await confirmAction('Reset all keyboard shortcuts?')) setSetting('keyboard.bindings', {})
          }}
        >
          <RotateCcw size={13} /> Reset all
        </button>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Command</th>
              <th>Category</th>
              <th style={{ width: 200 }}>Shortcut</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.cmd!.title}</td>
                <td className="muted">{r.cmd!.category}</td>
                <td>
                  <button className="btn sm" style={{ minWidth: 150, justifyContent: 'flex-start' }} onClick={() => setRecording(r.id)}>
                    {recording === r.id ? <span className="accent">Press keys… (Esc cancels)</span> : r.acc ? <Kbd keys={r.acc} /> : <span className="dim">Not set</span>}
                  </button>
                </td>
                <td>
                  {overrides[r.id] !== undefined && (
                    <button
                      className="icon-btn sm"
                      onClick={() => {
                        const next = { ...overrides }
                        delete next[r.id]
                        setSetting('keyboard.bindings', next)
                      }}
                      data-tip="Reset to default"
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
        Shortcuts work in SPECTER’s interface and inside web pages. {normalizeAccelerator('ctrl+shift+k')} style chords are recommended.
      </div>
    </>
  )
}

function StorageSection() {
  return (
    <>
      <Group title="Import / export">
        <Row title="Settings" desc="Export or import all SPECTER settings as JSON.">
          <div className="row">
            <button className="btn" onClick={() => invoke('settings:export').then((p) => p && toast({ kind: 'ok', title: 'Settings exported', body: p }))}>
              Export
            </button>
            <button className="btn" onClick={() => invoke('settings:import').then((ok) => ok && toast({ kind: 'ok', title: 'Settings imported' }))}>
              Import
            </button>
          </div>
        </Row>
        <Row title="Bookmarks" desc="Standard HTML bookmarks file, compatible with every browser.">
          <div className="row">
            <button className="btn" onClick={() => invoke('bookmarks:exportHtml').then((p) => p && toast({ kind: 'ok', title: 'Exported', body: p }))}>
              Export
            </button>
            <button className="btn" onClick={() => invoke('bookmarks:importHtml').then((n) => toast({ kind: 'ok', title: `Imported ${n} bookmarks` }))}>
              Import
            </button>
          </div>
        </Row>
        <ImportBrowsers />
      </Group>
      <Group title="Reset">
        <Row title="Reset all settings" desc="Restores defaults. Does not delete history, bookmarks or workspaces.">
          <button
            className="btn danger"
            onClick={async () => {
              if (await confirmAction('Reset all settings to defaults?', undefined, 'Reset', true)) {
                await invoke('settings:reset', undefined)
                toast({ kind: 'ok', title: 'Settings reset' })
              }
            }}
          >
            Reset
          </button>
        </Row>
      </Group>
    </>
  )
}

function ImportBrowsers() {
  const [sources, setSources] = useState<Awaited<ReturnType<typeof invoke<'import:sources'>>>>([])
  useEffect(() => {
    invoke('import:sources').then(setSources)
  }, [])
  return (
    <Row title="Import from another browser" desc={sources.length ? `Found: ${sources.map((s) => s.name).join(', ')}` : 'No supported browsers found on this PC.'}>
      <select
        className="select"
        value=""
        disabled={!sources.length}
        onChange={async (e) => {
          const [id, path] = e.target.value.split('|')
          if (!id) return
          const r = await invoke('import:run', id as never, path, { bookmarks: true, history: true })
          toast({ kind: r.errors.length ? 'warn' : 'ok', title: `Imported ${r.bookmarks} bookmarks, ${r.history} history entries`, body: r.errors.join('\n') || undefined })
        }}
      >
        <option value="">Choose browser…</option>
        {sources.flatMap((s) =>
          s.profiles.map((p) => (
            <option key={s.id + p.path} value={s.id + '|' + p.path}>
              {s.name} — {p.name}
            </option>
          ))
        )}
      </select>
    </Row>
  )
}

function ProfilesSection() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const current = useBrowser((s) => s.profile)
  const load = () => invoke('profiles:list').then(setProfiles)
  useEffect(() => {
    load()
  }, [])
  return (
    <Group title="Profiles">
      <div className="muted" style={{ fontSize: 12, padding: '12px 0 6px', lineHeight: 1.5 }}>
        Each profile has isolated cookies, site storage, cache, history, bookmarks and workspaces. Switching profile reopens SPECTER’s windows.
      </div>
      {profiles.map((p) => (
        <Row key={p.id} title={<span className="row">{<span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color }} />} {p.name}</span>} desc={p.id === current?.id ? 'Current profile' : `Created ${new Date(p.createdAt).toLocaleDateString()}`}>
          <div className="row">
            {p.id !== current?.id && (
              <button className="btn sm" onClick={() => invoke('profiles:openWindow', p.id)}>
                Switch
              </button>
            )}
            {p.id !== 'default' && p.id !== current?.id && (
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (await confirmAction(`Delete profile “${p.name}”?`, 'All its cookies, history, bookmarks and workspaces are deleted.', 'Delete', true)) {
                    await invoke('profiles:delete', p.id)
                    load()
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </Row>
      ))}
      <Row title="Add profile">
        <button
          className="btn"
          onClick={async () => {
            const name = await promptText({ title: 'New profile', placeholder: 'Profile name' })
            if (name?.trim()) {
              await invoke('profiles:create', name.trim(), WORKSPACE_COLORS[profiles.length % WORKSPACE_COLORS.length])
              load()
            }
          }}
        >
          <Plus size={13} /> Add
        </button>
      </Row>
    </Group>
  )
}

function ExtensionsSection() {
  const [list, setList] = useState<{ id: string; name: string; version: string; path: string }[]>([])
  const load = () => invoke('extensions:list').then(setList)
  useEffect(() => {
    load()
  }, [])
  return (
    <Group title="Extensions (experimental)">
      <div className="muted" style={{ fontSize: 12, padding: '12px 0 6px', lineHeight: 1.5 }}>
        Electron supports a subset of the Chrome extension APIs (e.g. content scripts, some background features). Many store extensions will not work fully. Load only extensions you trust — they can read the pages you visit.
      </div>
      {list.map((x) => (
        <Row key={x.id} title={`${x.name} ${x.version}`} desc={x.path}>
          <button className="btn sm danger" onClick={() => invoke('extensions:remove', x.id).then(load)}>
            Remove
          </button>
        </Row>
      ))}
      <Row title="Load unpacked extension" desc="Select a folder containing manifest.json.">
        <button className="btn" onClick={() => invoke('extensions:load').then((r) => r && (toast({ kind: 'ok', title: `Loaded ${r.name}` }), load())).catch((e) => toast({ kind: 'error', title: 'Could not load extension', body: String(e.message ?? e) }))}>
          Load…
        </button>
      </Row>
    </Group>
  )
}

function AdvancedSection() {
  return (
    <>
      <Group title="Advanced">
        <Toggle k="advanced.experimental" title="Experimental features" desc="Shows features that are still being built. They are clearly labelled." />
        <Choice k="advanced.logLevel" title="Log level" options={['debug', 'info', 'warn', 'error'].map((l) => ({ value: l, label: l.toUpperCase() }))} />
        <Row title="Logs" desc="Structured log viewer for debugging SPECTER itself.">
          <button className="btn" onClick={() => document.dispatchEvent(new CustomEvent('specter:open-url', { detail: 'specter://logs' }))}>
            Open logs
          </button>
        </Row>
        <Row title="Diagnostics">
          <button className="btn" onClick={() => document.dispatchEvent(new CustomEvent('specter:open-url', { detail: 'specter://diagnostics' }))}>
            Run diagnostics
          </button>
        </Row>
        <Row title="Restart SPECTER" desc="Applies settings that need a restart (hardware acceleration, smooth scrolling).">
          <button className="btn" onClick={() => invoke('app:relaunch')}>
            Restart
          </button>
        </Row>
      </Group>
    </>
  )
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    invoke('app:info').then(setInfo)
  }, [])
  return (
    <Group title="About SPECTER">
      <div style={{ padding: '16px 0' }}>
        <div style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.3em', fontSize: 16 }}>SPECTER</div>
        <div className="muted" style={{ marginTop: 4 }}>
          The Power Browser · version {info?.version}
        </div>
      </div>
      {info && (
        <>
          <Row title="Chromium">{info.chrome}</Row>
          <Row title="Electron">{info.electron}</Row>
          <Row title="Node.js">{info.node}</Row>
          <Row title="V8">{info.v8}</Row>
          <Row title="Platform">
            {info.platform} {info.arch}
          </Row>
          <Row title="Profile data">
            <span className="mono selectable" style={{ fontSize: 11 }}>
              {info.userData}
            </span>
          </Row>
        </>
      )}
      <UpdatesRows />
      <Row title="License" desc="SPECTER is MIT licensed. Third-party licenses are listed in THIRD_PARTY_LICENSES.md.">
        <span className="badge">MIT</span>
      </Row>
    </Group>
  )
}

const RELEASES_URL = 'https://github.com/martex-dev/specter/releases'
const openUrl = (url: string) => document.dispatchEvent(new CustomEvent('specter:open-url', { detail: url }))

function UpdatesRows() {
  const st = useUpdates((u) => u.s)
  const [busy, setBusy] = useState(false)
  if (!st) return null
  const installed = st.mode === 'nsis'
  const dev = st.mode === 'dev'
  const statusClass = st.phase === 'error' ? 'bad' : st.phase === 'ready' || st.phase === 'up-to-date' ? 'ok' : undefined
  const checking = busy || st.phase === 'checking'
  const last = st.lastCheck ? `Last checked ${new Date(st.lastCheck).toLocaleString()}.` : null
  return (
    <>
      <Row title="Version">
        <span className="mono selectable">{st.current}</span>
      </Row>
      <Row
        title="Updates"
        desc={
          <>
            <span className={statusClass} role="status">
              {describeUpdateState(st)}
            </span>
            {st.error && (st.phase === 'error' || st.phase === 'ready') && (
              <span className="mono selectable" style={{ display: 'block', fontSize: 11, marginTop: 4, wordBreak: 'break-word' }}>
                {st.error}
              </span>
            )}
            {st.phase === 'downloading' && (
              <span style={{ display: 'block', height: 4, borderRadius: 2, background: 'var(--bg-3)', marginTop: 6, overflow: 'hidden', maxWidth: 320 }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.floor(st.progress?.percent ?? 0)}%`, background: 'var(--accent)', transition: 'width .3s' }} />
              </span>
            )}
            {last && st.phase !== 'checking' && <span style={{ display: 'block', marginTop: 2 }} className="dim">{last}</span>}
          </>
        }
      >
        <div className="row">
          {st.phase === 'ready' && (
            <button className="btn primary" onClick={() => installUpdate()}>
              Restart to update
            </button>
          )}
          {!installed && st.phase === 'available' && st.releaseUrl && (
            <button className="btn primary" onClick={() => openUrl(st.releaseUrl!)}>
              View release
            </button>
          )}
          <button
            className="btn"
            disabled={dev || checking || st.phase === 'downloading' || st.phase === 'installing'}
            onClick={async () => {
              setBusy(true)
              try {
                await checkForUpdatesNow()
              } finally {
                setBusy(false)
              }
            }}
          >
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </Row>
      {installed && (
        <Toggle
          k="advanced.autoUpdate"
          title="Update SPECTER automatically"
          desc="Checks 30 seconds after start and every 6 hours, downloads new versions in the background and installs them when you restart or quit SPECTER. When off, nothing is checked until you press Check now."
        />
      )}
      {!installed && !dev && (
        <>
          <Toggle
            k="advanced.checkUpdates"
            title="Check for new releases daily"
            desc={st.mode === 'portable' ? 'The portable build can’t replace itself: SPECTER tells you when a release is out and you download it yourself.' : 'This copy wasn’t installed with the SPECTER installer, so it can only tell you about new releases.'}
          />
          <TextSetting k="advanced.updateRepo" title="Release repository" desc="GitHub owner/repo that publishes SPECTER releases. Leave empty to never check." placeholder="owner/repo" />
        </>
      )}
      {dev && (
        <Row title="Development build" desc="Automatic updates only run in the installed Windows build. Nothing is checked or downloaded here.">
          <span className="badge">dev</span>
        </Row>
      )}
      <Row title="Release notes" desc={st.latest && st.releaseUrl && st.latest !== st.current ? `What’s new in SPECTER ${st.latest}.` : 'Changes in every SPECTER release.'}>
        <button className="btn" onClick={() => openUrl(st.latest && st.releaseUrl && st.latest !== st.current ? st.releaseUrl : RELEASES_URL)}>
          Open
        </button>
      </Row>
      <Row
        title="Update privacy"
        desc={
          installed || dev
            ? 'Update checks contact github.com (and GitHub’s download servers when an update is downloaded) in a separate network session without your cookies. Only the latest SPECTER release information is requested — no browsing data, history or identifiers are sent.'
            : 'Checks contact api.github.com and request only the latest release of the repository above — no browsing data, history or identifiers are sent.'
        }
      >
        <span className="badge">github.com</span>
      </Row>
    </>
  )
}

// ---------------------------------------------------------------- page

const CORE_SECTIONS: { id: string; title: string; icon: typeof Settings2; C: () => JSX.Element }[] = [
  { id: 'general', title: 'General', icon: Settings2, C: General },
  { id: 'appearance', title: 'Appearance', icon: Brush, C: Appearance },
  { id: 'browser', title: 'Browser & tabs', icon: Globe, C: BrowserSection },
  { id: 'search', title: 'Search', icon: Search, C: SearchSection },
  { id: 'privacy', title: 'Privacy', icon: Shield, C: PrivacySection },
  { id: 'security', title: 'Security', icon: Lock, C: SecuritySection },
  { id: 'profiles', title: 'Profiles', icon: Users, C: ProfilesSection },
  { id: 'ai', title: 'AI', icon: Bot, C: AISection },
  { id: 'workspaces', title: 'Workspaces', icon: Layers, C: WorkspacesSection },
  { id: 'research', title: 'Research', icon: FlaskConical, C: ResearchSection },
  { id: 'markets', title: 'Markets', icon: CandlestickChart, C: MarketsSection },
  { id: 'developer', title: 'Developer', icon: Code2, C: DeveloperSection },
  { id: 'performance', title: 'Performance', icon: Gauge, C: PerformanceSection },
  { id: 'notifications', title: 'Notifications', icon: Bell, C: NotificationsSection },
  { id: 'keyboard', title: 'Keyboard', icon: Keyboard, C: KeyboardSection },
  { id: 'extensions', title: 'Extensions', icon: Puzzle, C: ExtensionsSection },
  { id: 'storage', title: 'Storage & import', icon: Database, C: StorageSection },
  { id: 'advanced', title: 'Advanced', icon: SlidersHorizontal, C: AdvancedSection },
  { id: 'about', title: 'About', icon: Info, C: About }
]

export default function SettingsPage({ tabId, sub }: PageProps) {
  const extra = useSyncExternalStore(settingsSections.subscribe, () => settingsSections.list())
  const sections = [...CORE_SECTIONS, ...extra.map((e) => ({ id: e.id, title: e.title, icon: e.icon as typeof Settings2, C: e.component as () => JSX.Element }))]
  const active = sections.find((s) => s.id === sub) ?? sections[0]
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const open = (e: Event) => {
      const url = (e as CustomEvent<string>).detail
      import('../stores/browser').then((m) => m.newTab(url))
    }
    document.addEventListener('specter:open-url', open)
    return () => document.removeEventListener('specter:open-url', open)
  }, [])

  const shown = filter ? sections.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase())) : sections
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <div style={{ padding: '0 10px 14px' }}>
          <div className="page-kicker">SPECTER</div>
          <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-display)' }}>Settings</div>
        </div>
        <input className="input" style={{ width: '100%', marginBottom: 10 }} placeholder="Find a section…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {shown.map((s) => (
          <button key={s.id} className={'nav-item' + (s.id === active.id ? ' on' : '')} onClick={() => loadUrl(tabId, 'specter://settings/' + s.id)}>
            <s.icon size={15} /> {s.title}
          </button>
        ))}
        <div className="dim" style={{ fontSize: 10.5, padding: '16px 10px' }}>
          Settings save instantly.
        </div>
      </nav>
      <div className="settings-body">
        <h1 className="page-title" style={{ marginBottom: 4 }}>
          {active.title}
        </h1>
        <active.C />
      </div>
    </div>
  )
}

export type { SettingsT }
