// Dashboard widgets: built-ins plus every new-tab widget contributed by other modules.
import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from 'react'
import { Activity, CheckSquare, Clock3, Download, Link2, Music, Plus, Trash2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AutomationRun, PluginInfo, TaskItem, WidgetSize } from '@shared/modules/automation'
import { invoke, on } from '../../lib/ipc'
import { newTabWidgets } from '../../lib/registry'
import { timeAgo } from '../../lib/format'
import { Favicon } from '../../components/ui'
import { newTab } from '../../stores/browser'
import { useSetting } from '../../stores/settings'
import { useDownloads } from '../../panels/DownloadsPanel'
import { MediaList } from './media'
import { openPage } from './util'

export interface WidgetProps {
  size: WidgetSize
}

export interface DashboardWidgetDef {
  id: string
  title: string
  icon: LucideIcon
  description: string
  defaultSize: WidgetSize
  component: ComponentType<WidgetProps>
}

/** Reads and writes a persisted (SQLite) widget value, live across windows. */
export function useStored<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(fallback)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () =>
      invoke('widgets:get', key)
        .then((v) => {
          if (!alive) return
          if (v !== null && v !== undefined) setValue(v as T)
          setLoaded(true)
        })
        .catch(() => alive && setLoaded(true))
    load()
    const off = on('widgets:changed', (e) => e.key === key && load())
    return () => {
      alive = false
      off()
    }
  }, [key])
  const save = (v: T) => {
    setValue(v)
    invoke('widgets:set', key, v).catch(() => undefined)
  }
  return [value, save, loaded]
}

// ---------------------------------------------------------------- clock

function zoneLabel(tz: string): string {
  return tz.split('/').pop()!.replace(/_/g, ' ')
}

function ClockWidget({ size }: WidgetProps) {
  const [now, setNow] = useState(Date.now())
  const [cfg, setCfg] = useStored<{ tz: string }>('widget:clock', { tz: 'America/New_York' })
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone')
    } catch {
      return ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo']
    }
  }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const d = new Date(now)
  let second = ''
  let secondDate = ''
  try {
    second = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: cfg.tz })
    secondDate = d.toLocaleDateString([], { weekday: 'short', timeZone: cfg.tz })
  } catch {
    second = 'Invalid zone'
  }
  return (
    <div className="aw-clock">
      <div className="aw-clock-main num">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: size === 's' ? undefined : '2-digit' })}</div>
      <div className="dim" style={{ fontSize: 12 }}>
        {d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </div>
      <div className="row aw-clock-second">
        <span className="num" style={{ fontSize: 17, color: 'var(--fg-0)' }}>
          {second}
        </span>
        <span className="dim" style={{ fontSize: 11.5 }}>
          {secondDate} · {zoneLabel(cfg.tz)}
        </span>
        <span className="spacer" />
        <select className="select" style={{ height: 24, fontSize: 11, maxWidth: 140 }} value={cfg.tz} onChange={(e) => setCfg({ tz: e.target.value })} aria-label="Second time zone">
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- tasks

function TasksWidget({ size }: WidgetProps) {
  const [tasks, setTasks, loaded] = useStored<TaskItem[]>('widget:tasks', [])
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (!t) return
    setTasks([...tasks, { id: 't' + Date.now().toString(36), text: t.slice(0, 300), done: false, createdAt: Date.now() }])
    setText('')
  }
  const open = tasks.filter((t) => !t.done).length
  return (
    <div className="col" style={{ gap: 6 }}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task…" aria-label="New task" />
        <button className="icon-btn sm" type="submit" aria-label="Add task" disabled={!text.trim()}>
          <Plus size={14} />
        </button>
      </form>
      <div className="aw-scroll" style={{ maxHeight: size === 'l' ? 360 : 220 }}>
        {loaded && tasks.length === 0 && <div className="dim" style={{ fontSize: 12, padding: '8px 2px' }}>No tasks. Everything is done.</div>}
        {tasks.map((t) => (
          <label key={t.id} className="aw-task">
            <input type="checkbox" checked={t.done} onChange={() => setTasks(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} />
            <span className={'grow' + (t.done ? ' dim' : '')} style={{ textDecoration: t.done ? 'line-through' : undefined }}>
              {t.text}
            </span>
            <button className="icon-btn sm aw-task-x" onClick={(e) => (e.preventDefault(), setTasks(tasks.filter((x) => x.id !== t.id)))} aria-label="Remove task">
              <X size={12} />
            </button>
          </label>
        ))}
      </div>
      {tasks.length > 0 && (
        <div className="row dim" style={{ fontSize: 11 }}>
          {open} open · {tasks.length - open} done
          <span className="spacer" />
          {tasks.length - open > 0 && (
            <button className="btn sm ghost" onClick={() => setTasks(tasks.filter((t) => !t.done))}>
              <Trash2 size={12} /> Clear done
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- downloads

function DownloadsWidget({ size }: WidgetProps) {
  const list = useDownloads()
  const shown = list.slice(0, size === 'l' ? 10 : 5)
  if (!shown.length) return <div className="dim" style={{ fontSize: 12 }}>No downloads yet.</div>
  return (
    <div className="col" style={{ gap: 0 }}>
      {shown.map((d) => {
        const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : null
        return (
          <div key={d.id} className="list-row" onClick={() => (d.state === 'completed' ? invoke('downloads:open', d.id) : openPage('specter://downloads'))} title={d.savePath}>
            <Download size={13} className="muted" />
            <span className="ellipsis grow">{d.filename}</span>
            <span className="dim mono" style={{ fontSize: 10.5 }}>
              {d.state === 'progressing' ? `${pct ?? '…'}%` : d.state === 'completed' ? timeAgo(d.endedAt ?? d.startedAt) : d.state}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- quick links

function usePluginLinks(): { title: string; url: string; plugin: string }[] {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  useEffect(() => {
    const load = () => invoke('plugins:list').then(setPlugins).catch(() => undefined)
    load()
    return on('plugins:changed', load)
  }, [])
  return plugins.flatMap((p) => (p.enabled && p.manifest ? (p.manifest.ui?.quickLinks ?? []).map((l) => ({ ...l, plugin: p.manifest!.name })) : []))
}

function QuickLinksWidget({ size }: WidgetProps) {
  const links = useSetting('newtab.quickLinks')
  const pluginLinks = usePluginLinks()
  const all = [...links.map((l) => ({ title: l.title, url: l.url, plugin: '' })), ...pluginLinks]
  if (!all.length) return <div className="dim" style={{ fontSize: 12 }}>No quick links. Add shortcuts on the new tab page or enable a plugin with links.</div>
  return (
    <div className="aw-links" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size === 's' ? 120 : 140}px, 1fr))` }}>
      {all.map((l, i) => (
        <button key={l.url + i} className="aw-link" onClick={() => newTab(l.url)} title={l.plugin ? `${l.url} · from ${l.plugin}` : l.url}>
          <Favicon url={l.url} size={14} />
          <span className="ellipsis">{l.title}</span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- automation activity

function AutomationsWidget({ size }: WidgetProps) {
  const [runs, setRuns] = useState<AutomationRun[]>([])
  useEffect(() => {
    const load = () => invoke('automation:runs', 12).then(setRuns).catch(() => undefined)
    load()
    return on('automation:changed', (c) => c.runs && load())
  }, [])
  if (!runs.length)
    return (
      <div className="dim" style={{ fontSize: 12 }}>
        No automation runs yet.{' '}
        <a href="#" onClick={(e) => (e.preventDefault(), openPage('specter://automations'))}>
          Create an automation
        </a>
      </div>
    )
  return (
    <div className="col" style={{ gap: 0 }}>
      {runs.slice(0, size === 'l' ? 12 : 6).map((r) => (
        <div key={r.id} className="list-row" onClick={() => openPage('specter://automations?tab=log')} title={r.detail}>
          <span className={'status-dot ' + (r.status === 'ok' ? 'ok' : r.status === 'error' ? 'bad' : 'warn')} />
          <span className="ellipsis grow">{r.ruleName}</span>
          <span className="dim mono" style={{ fontSize: 10.5 }}>
            {timeAgo(r.startedAt)}
          </span>
        </div>
      ))}
    </div>
  )
}

function MediaWidget() {
  return <MediaList compact />
}

export const BUILTIN_WIDGETS: DashboardWidgetDef[] = [
  { id: 'clock', title: 'Clock', icon: Clock3, description: 'Local time with a second time zone', defaultSize: 'm', component: ClockWidget },
  { id: 'tasks', title: 'Tasks', icon: CheckSquare, description: 'A simple checklist, saved locally', defaultSize: 'm', component: TasksWidget },
  { id: 'downloads', title: 'Downloads', icon: Download, description: 'Recent downloads', defaultSize: 'm', component: DownloadsWidget },
  { id: 'quicklinks', title: 'Quick links', icon: Link2, description: 'New-tab shortcuts and plugin links', defaultSize: 'm', component: QuickLinksWidget },
  { id: 'automations', title: 'Automation activity', icon: Activity, description: 'Latest automation runs', defaultSize: 's', component: AutomationsWidget },
  { id: 'media', title: 'Now playing', icon: Music, description: 'Media playing in this window', defaultSize: 'm', component: MediaWidget }
]

export const OWN_NEWTAB_WIDGET = 'automation.widgets'

/** Built-in widgets plus other modules' new-tab widgets (as "ntw:<id>"). */
export function useWidgetDefs(): DashboardWidgetDef[] {
  const external = useSyncExternalStore(newTabWidgets.subscribe, () => newTabWidgets.list())
  return useMemo(
    () => [
      ...BUILTIN_WIDGETS,
      ...external
        .filter((w) => w.id !== OWN_NEWTAB_WIDGET)
        .map<DashboardWidgetDef>((w) => ({ id: 'ntw:' + w.id, title: w.title, icon: Activity, description: 'From a SPECTER module', defaultSize: 'm', component: () => <w.component /> }))
    ],
    [external]
  )
}
