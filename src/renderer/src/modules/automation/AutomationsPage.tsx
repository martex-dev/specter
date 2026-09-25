// specter://automations — rules, templates, run log and live event bus.
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Pause, Pencil, Play, Plus, Puzzle, Radio, Trash2, Workflow, Zap } from 'lucide-react'
import { EVENT_CATALOG, type AutomationRule, type AutomationRuleInput, type AutomationRun, type BusRecord } from '@shared/modules/automation'
import type { PageProps } from '../../pages/registry'
import { invoke, invokeRaw, on, onRaw } from '../../lib/ipc'
import { clock, timeAgo } from '../../lib/format'
import { Seg, Switch } from '../../components/ui'
import { confirmAction } from '../../components/prompt'
import { toast } from '../../stores/ui'
import { RuleEditor } from './RuleEditor'
import { describeAction, describeTrigger, emptyRule, errorText, openPage, TEMPLATES } from './util'
import './automation.css'

type Tab = 'rules' | 'templates' | 'log' | 'events'

function useRules(): [AutomationRule[] | null, () => void] {
  const [rules, setRules] = useState<AutomationRule[] | null>(null)
  const load = () => invoke('automation:list').then(setRules).catch(() => setRules([]))
  useEffect(() => {
    load()
    return on('automation:changed', (c) => c.rules && load())
  }, [])
  return [rules, load]
}

function statusClass(s?: string): string {
  return s === 'ok' ? 'ok' : s === 'error' ? 'bad' : s === 'skipped' ? 'warn' : 'hollow'
}

function RuleRow({ r, onEdit }: { r: AutomationRule; onEdit: (r: AutomationRule) => void }) {
  const plugin = r.origin === 'plugin'
  const runNow = async () => {
    try {
      const run = await invoke('automation:runNow', r.id)
      toast({ kind: run.status === 'ok' ? 'ok' : run.status === 'skipped' ? 'warn' : 'error', title: r.name, body: run.detail })
    } catch (err) {
      toast({ kind: 'error', title: 'Run failed', body: errorText(err) })
    }
  }
  return (
    <div className={'ar-row' + (r.enabled ? '' : ' off')}>
      <Switch
        on={r.enabled}
        disabled={plugin}
        onChange={(v) => invoke('automation:setEnabled', r.id, v).catch((err) => toast({ kind: 'error', title: 'Could not change', body: errorText(err) }))}
        label={r.enabled ? 'Disable automation' : 'Enable automation'}
      />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <span className="ar-name ellipsis">{r.name}</span>
          {plugin && (
            <span className="badge accent" data-tip="Declared by a plugin — manage it on the Plugins page">
              <Puzzle size={10} /> {r.pluginId}
            </span>
          )}
        </div>
        <div className="ar-flow">
          <span className="ar-chip trigger">
            <Zap size={10} /> {describeTrigger(r.trigger)}
          </span>
          {r.conditions.length > 0 && <span className="ar-chip">if {r.conditions.map((c) => `${c.field} ${c.op} “${c.value}”`).join(' and ')}</span>}
          {r.actions.map((a, i) => (
            <span key={i} className="ar-chip action">
              {describeAction(a)}
            </span>
          ))}
        </div>
      </div>
      <div className="ar-meta">
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <span className={'status-dot ' + statusClass(r.lastStatus)} />
          <span>{r.lastRunAt ? timeAgo(r.lastRunAt) : 'never run'}</span>
        </div>
        <div className="dim">
          {r.runCount} run{r.runCount === 1 ? '' : 's'}
          {r.nextRunAt && r.enabled ? ` · next ${clock(r.nextRunAt)}` : ''}
        </div>
      </div>
      <div className="row" style={{ gap: 2 }}>
        <button className="icon-btn sm" onClick={runNow} data-tip="Run now" aria-label="Run now">
          <Play size={13} />
        </button>
        {!plugin && (
          <>
            <button className="icon-btn sm" onClick={() => onEdit(r)} data-tip="Edit" aria-label="Edit">
              <Pencil size={13} />
            </button>
            <button
              className="icon-btn sm"
              onClick={async () => {
                if (await confirmAction('Delete automation?', `“${r.name}” will be removed. Its run history stays in the log.`, 'Delete', true)) invoke('automation:delete', r.id)
              }}
              data-tip="Delete"
              aria-label="Delete"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function RunLog() {
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    const load = () => invoke('automation:runs', 200).then(setRuns).catch(() => undefined)
    load()
    return on('automation:changed', (c) => c.runs && load())
  }, [])
  return (
    <div className="card">
      <div className="card-h">
        <span className="label">Last {runs.length} runs · kept: 200</span>
        <span className="spacer" />
        <button
          className="btn sm ghost"
          disabled={!runs.length}
          onClick={async () => {
            if (await confirmAction('Clear run log?', 'Removes all recorded automation runs.', 'Clear', true)) invoke('automation:clearRuns')
          }}
        >
          <Trash2 size={12} /> Clear log
        </button>
      </div>
      {runs.length === 0 ? (
        <div className="empty">
          <Workflow size={22} />
          No runs yet. Automations record every run here with its outcome.
        </div>
      ) : (
        <div style={{ maxHeight: 620, overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th>Time</th>
                <th>Automation</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <FragmentRow key={r.id} r={r} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FragmentRow({ r, open, toggle }: { r: AutomationRun; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr onClick={toggle} style={{ cursor: 'pointer' }}>
        <td>{r.steps.length > 0 ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}</td>
        <td className="mono dim" style={{ whiteSpace: 'nowrap' }} title={new Date(r.startedAt).toLocaleString()}>
          {new Date(r.startedAt).toLocaleTimeString()}
        </td>
        <td>
          <span className="ellipsis" style={{ display: 'inline-block', maxWidth: 220, verticalAlign: 'bottom' }}>
            {r.ruleName}
          </span>{' '}
          {r.source !== 'rule' && <span className="badge">{r.source}</span>}
        </td>
        <td className="mono" style={{ fontSize: 11 }}>
          {r.trigger}
        </td>
        <td>
          <span className={'badge ' + (r.status === 'ok' ? 'ok' : r.status === 'error' ? 'bad' : 'warn')}>{r.status}</span>
        </td>
        <td className="num dim">{r.durationMs} ms</td>
        <td>
          <span className="ellipsis" style={{ display: 'inline-block', maxWidth: 360, verticalAlign: 'bottom' }} title={r.detail}>
            {r.detail}
          </span>
        </td>
      </tr>
      {open &&
        r.steps.map((s, i) => (
          <tr key={i} className="ar-step">
            <td />
            <td className="mono dim">#{i + 1}</td>
            <td className="mono">{s.type}</td>
            <td colSpan={4}>
              <span className={s.ok ? 'ok' : 'bad'}>{s.ok ? '✓' : '✕'}</span> {s.detail}
            </td>
          </tr>
        ))}
    </>
  )
}

function EventViewer({ onCreate }: { onCreate: (r: AutomationRuleInput) => void }) {
  const [events, setEvents] = useState<BusRecord[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('')
  useEffect(() => {
    invokeRaw<BusRecord[]>('bus:recent')
      .then((l) => setEvents(l.slice().reverse()))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (paused) return
    return onRaw<BusRecord>('bus:event', (e) => setEvents((l) => [e, ...l].slice(0, 300)))
  }, [paused])
  const names = useMemo(() => [...new Set(events.map((e) => e.name))].sort(), [events])
  const shown = filter ? events.filter((e) => e.name === filter) : events
  return (
    <div className="card">
      <div className="card-h">
        <Radio size={13} className={paused ? 'muted' : 'accent'} />
        <span className="label">{paused ? 'Paused' : 'Live'} · last {events.length} events on the SPECTER bus</span>
        <span className="spacer" />
        <select className="select" style={{ height: 26, fontSize: 12 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter events">
          <option value="">All events</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button className="btn sm ghost" onClick={() => setPaused(!paused)}>
          {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          <Radio size={22} />
          No events yet. Open a tab, switch workspace or change the performance mode to see events arrive.
        </div>
      ) : (
        <div style={{ maxHeight: 620, overflow: 'auto' }}>
          {shown.map((e, i) => (
            <div key={e.ts + e.name + i} className="ev-row">
              <span className="mono dim ev-time">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="badge ev-name">{e.name}</span>
              <code className="ev-payload ellipsis selectable" title={JSON.stringify(e.payload)}>
                {JSON.stringify(e.payload)}
              </code>
              {EVENT_CATALOG[e.name] && (
                <button
                  className="btn sm ghost ev-use"
                  onClick={() => {
                    const url = (e.payload as { url?: string } | null)?.url
                    let host = ''
                    try {
                      host = url ? new URL(url).hostname.replace(/^www\./, '') : ''
                    } catch {
                      /* ignore */
                    }
                    onCreate({ ...emptyRule(), name: `On ${EVENT_CATALOG[e.name].label.toLowerCase()}${host ? ' · ' + host : ''}`, trigger: { type: 'event', event: e.name, match: host && EVENT_CATALOG[e.name].url ? host : undefined } })
                  }}
                >
                  <Plus size={11} /> Automate
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AutomationsPage({ query }: PageProps) {
  const [tab, setTab] = useState<Tab>((query.get('tab') as Tab) || 'rules')
  const [rules] = useRules()
  const [editing, setEditing] = useState<AutomationRuleInput | null>(null)

  useEffect(() => {
    if (query.get('new') === '1') setEditing(emptyRule())
    const t = query.get('tab') as Tab | null
    if (t) setTab(t)
  }, [query])

  const addTemplate = async (tpl: (typeof TEMPLATES)[number]) => {
    try {
      const saved = await invoke('automation:save', structuredClone(tpl.rule))
      toast({ kind: 'ok', title: 'Automation added', body: saved.name, action: { label: 'Edit', run: () => setEditing(saved) } })
      setTab('rules')
    } catch (err) {
      toast({ kind: 'error', title: 'Could not add', body: errorText(err) })
    }
  }

  const userRules = rules?.filter((r) => r.origin === 'user') ?? []
  const pluginRules = rules?.filter((r) => r.origin === 'plugin') ?? []

  return (
    <div className="page wide">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">SPECTER Automation</div>
          <h1 className="page-title">Automations</h1>
          <div className="page-sub">Local rules that react to SPECTER events or a schedule. They run only inside SPECTER — nothing leaves this machine, and loops are stopped automatically.</div>
        </div>
        <button className="btn" onClick={() => openPage('specter://plugins')}>
          <Puzzle size={13} /> Plugins
        </button>
        <button className="btn primary" onClick={() => setEditing(emptyRule())}>
          <Plus size={13} /> New automation
        </button>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <Seg
          value={tab}
          options={[
            { value: 'rules', label: `Rules${rules ? ` · ${rules.length}` : ''}` },
            { value: 'templates', label: 'Templates' },
            { value: 'log', label: 'Run log' },
            { value: 'events', label: 'Event bus' }
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'rules' && (
        <>
          {rules && userRules.length === 0 && (
            <div className="card empty">
              <Workflow size={26} />
              <div style={{ color: 'var(--fg-0)', fontWeight: 500 }}>No automations yet</div>
              <div>Start from a template or build one from scratch.</div>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn" onClick={() => setTab('templates')}>
                  Browse templates
                </button>
                <button className="btn primary" onClick={() => setEditing(emptyRule())}>
                  <Plus size={13} /> New automation
                </button>
              </div>
            </div>
          )}
          {userRules.length > 0 && (
            <div className="card ar-list">
              {userRules.map((r) => (
                <RuleRow key={r.id} r={r} onEdit={setEditing} />
              ))}
            </div>
          )}
          {pluginRules.length > 0 && (
            <div className="section">
              <div className="section-title">
                From plugins <span className="badge">{pluginRules.length}</span>
              </div>
              <div className="card ar-list">
                {pluginRules.map((r) => (
                  <RuleRow key={r.id} r={r} onEdit={setEditing} />
                ))}
              </div>
            </div>
          )}
          <div className="dim" style={{ fontSize: 11.5, marginTop: 14 }}>
            Loop protection: an automation is never re-triggered by its own side effects, chains stop after 3 levels, and each automation runs at most 6 times per minute.
          </div>
        </>
      )}

      {tab === 'templates' && (
        <div className="grid-2">
          {TEMPLATES.map((tpl) => (
            <div key={tpl.id} className="card at-card">
              <div className="ar-name">{tpl.title}</div>
              <div className="dim" style={{ fontSize: 12, margin: '4px 0 10px' }}>
                {tpl.description}
              </div>
              <div className="ar-flow" style={{ marginBottom: 12 }}>
                <span className="ar-chip trigger">
                  <Zap size={10} /> {describeTrigger(tpl.rule.trigger)}
                </span>
                {tpl.rule.conditions.map((c, i) => (
                  <span key={i} className="ar-chip">
                    if {c.field} {c.op} “{c.value}”
                  </span>
                ))}
                {tpl.rule.actions.map((a, i) => (
                  <span key={i} className="ar-chip action">
                    {describeAction(a)}
                  </span>
                ))}
              </div>
              <div className="row">
                <button className="btn sm primary" onClick={() => addTemplate(tpl)}>
                  <Plus size={12} /> Add
                </button>
                <button className="btn sm ghost" onClick={() => setEditing(structuredClone(tpl.rule))}>
                  Customize…
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'log' && <RunLog />}
      {tab === 'events' && <EventViewer onCreate={setEditing} />}

      {editing && <RuleEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => setTab('rules')} />}
    </div>
  )
}
