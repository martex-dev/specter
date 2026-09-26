// Automation rule editor (modal): trigger, conditions, ordered actions.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, FlaskConical, Plus, Workflow, X } from 'lucide-react'
import {
  ACTION_LABELS,
  EVENT_CATALOG,
  PERFORMANCE_MODES,
  SAFE_SETTING_KEYS,
  type ActionType,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRuleInput,
  type AutomationTrigger,
  type ConditionOp
} from '@shared/modules/automation'
import { invoke } from '../../lib/ipc'
import { listCommands } from '../../lib/commands'
import { sidePanels } from '../../lib/registry'
import { Modal, Seg, Switch } from '../../components/ui'
import { confirmAction } from '../../components/prompt'
import { useBrowser } from '../../stores/browser'
import { toast } from '../../stores/ui'
import { commandAllowed, errorText, WEEKDAYS } from './util'

const OPS: { value: ConditionOp; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'notEquals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' }
]

function defaultAction(type: ActionType, workspaceName: string): AutomationAction {
  switch (type) {
    case 'command':
      return { type, command: 'browser.newTab' }
    case 'openUrl':
      return { type, url: 'https://' }
    case 'workspace':
      return { type, workspace: workspaceName }
    case 'notify':
      return { type, title: 'Automation', body: '' }
    case 'performanceMode':
      return { type, mode: 'normal' }
    case 'setting':
      return { type, key: 'research.indexPages', value: false }
    case 'sidePanel':
      return { type, panel: 'notifications' }
    case 'wait':
      return { type, seconds: 5 }
  }
}

// Stable React keys for action rows: ActionFields keeps local state (the args
// text), so index keys would show one action's args on another after a move/remove.
let actionKeySeq = 0
const actionKey = () => 'a' + ++actionKeySeq

function Field({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label className={'ae-field' + (grow ? ' grow' : '')}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

function ActionFields({ a, onChange }: { a: AutomationAction; onChange: (a: AutomationAction) => void }) {
  const workspaces = useBrowser((s) => s.workspaces)
  const commands = useMemo(() => listCommands(true).filter((c) => commandAllowed(c.id) && !c.permissions?.some((p) => p === 'execute' || p === 'filesystem')).sort((x, y) => x.id.localeCompare(y.id)), [])
  const panels = sidePanels.list()
  const [argsText, setArgsText] = useState(a.type === 'command' && a.args ? JSON.stringify(a.args) : '')
  const [argsErr, setArgsErr] = useState('')

  switch (a.type) {
    case 'command':
      return (
        <>
          <Field label="Command" grow>
            <select className="select" value={a.command} onChange={(e) => onChange({ ...a, command: e.target.value })}>
              {!commands.some((c) => c.id === a.command) && <option value={a.command}>{a.command} (not available)</option>}
              {commands.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} — {c.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Args (JSON, optional)" grow>
            <input
              className={'input mono' + (argsErr ? ' invalid' : '')}
              value={argsText}
              placeholder='{"url":"https://…"}'
              onChange={(e) => {
                const v = e.target.value
                setArgsText(v)
                if (!v.trim()) {
                  setArgsErr('')
                  const { args: _drop, ...rest } = a
                  onChange(rest)
                  return
                }
                try {
                  const parsed = JSON.parse(v)
                  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Must be an object')
                  setArgsErr('')
                  onChange({ ...a, args: parsed })
                } catch {
                  setArgsErr('Invalid JSON object')
                }
              }}
              title={argsErr || undefined}
            />
          </Field>
        </>
      )
    case 'openUrl':
      return (
        <>
          <Field label="URL" grow>
            <input className="input" value={a.url} onChange={(e) => onChange({ ...a, url: e.target.value })} placeholder="https://… or specter://…" />
          </Field>
          <Field label="Where">
            <select className="select" value={a.newWindow ? 'window' : a.background ? 'background' : 'tab'} onChange={(e) => onChange({ ...a, newWindow: e.target.value === 'window' || undefined, background: e.target.value === 'background' || undefined })}>
              <option value="tab">New tab</option>
              <option value="background">Background tab</option>
              <option value="window">New window</option>
            </select>
          </Field>
        </>
      )
    case 'workspace':
      return (
        <>
          <Field label="Workspace" grow>
            <input className="input" list="ae-workspaces" value={a.workspace} onChange={(e) => onChange({ ...a, workspace: e.target.value })} />
            <datalist id="ae-workspaces">
              {workspaces.map((w) => (
                <option key={w.id} value={w.name} />
              ))}
            </datalist>
          </Field>
          <Field label="If missing">
            <select className="select" value={a.create ? 'create' : 'fail'} onChange={(e) => onChange({ ...a, create: e.target.value === 'create' || undefined })}>
              <option value="fail">Fail</option>
              <option value="create">Create it</option>
            </select>
          </Field>
        </>
      )
    case 'notify':
      return (
        <>
          <Field label="Title" grow>
            <input className="input" value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} />
          </Field>
          <Field label="Body" grow>
            <input className="input" value={a.body ?? ''} onChange={(e) => onChange({ ...a, body: e.target.value || undefined })} placeholder="{{url}} placeholders allowed" />
          </Field>
        </>
      )
    case 'performanceMode':
      return (
        <Field label="Mode" grow>
          <select className="select" value={a.mode} onChange={(e) => onChange({ ...a, mode: e.target.value as typeof a.mode })}>
            {PERFORMANCE_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      )
    case 'setting':
      return (
        <>
          <Field label="Setting" grow>
            <select className="select" value={a.key} onChange={(e) => onChange({ ...a, key: e.target.value as typeof a.key })}>
              {SAFE_SETTING_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Value">
            <div className="row" style={{ height: 30 }}>
              <Switch on={a.value} onChange={(v) => onChange({ ...a, value: v })} label="Value" />
              <span className="dim" style={{ fontSize: 12 }}>
                {a.value ? 'On' : 'Off'}
              </span>
            </div>
          </Field>
        </>
      )
    case 'sidePanel':
      return (
        <>
          <Field label="Panel" grow>
            <input className="input" list="ae-panels" value={a.panel} onChange={(e) => onChange({ ...a, panel: e.target.value.trim() })} />
            <datalist id="ae-panels">
              {panels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="Display">
            <select className="select" value={a.popout ? 'popout' : 'side'} onChange={(e) => onChange({ ...a, popout: e.target.value === 'popout' || undefined })}>
              <option value="side">Side panel</option>
              <option value="popout">Floating window</option>
            </select>
          </Field>
        </>
      )
    case 'wait':
      return (
        <Field label="Seconds">
          <input className="input num" type="number" min={1} max={300} value={a.seconds} onChange={(e) => onChange({ ...a, seconds: Math.max(1, Math.min(300, Number(e.target.value) || 1)) })} style={{ width: 90 }} />
        </Field>
      )
  }
}

export function RuleEditor({ initial, onClose, onSaved }: { initial: AutomationRuleInput; onClose: () => void; onSaved: () => void }) {
  const [rule, setRule] = useState<AutomationRuleInput>(() => structuredClone(initial))
  const [keys, setKeys] = useState<string[]>(() => initial.actions.map(actionKey))
  const [events, setEvents] = useState<string[]>(Object.keys(EVENT_CATALOG))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<string>('')
  const workspaces = useBrowser((s) => s.workspaces)

  useEffect(() => {
    invoke('automation:events').then(setEvents).catch(() => undefined)
  }, [])

  const t = rule.trigger
  const fields = t.type === 'event' ? EVENT_CATALOG[t.event]?.fields ?? [] : []
  const setTrigger = (trigger: AutomationTrigger) => setRule({ ...rule, trigger })
  const setCond = (i: number, c: AutomationCondition | null) => setRule({ ...rule, conditions: c ? rule.conditions.map((x, j) => (j === i ? c : x)) : rule.conditions.filter((_, j) => j !== i) })
  const setAction = (i: number, a: AutomationAction | null) => {
    if (!a) setKeys(keys.filter((_, j) => j !== i))
    setRule({ ...rule, actions: a ? rule.actions.map((x, j) => (j === i ? a : x)) : rule.actions.filter((_, j) => j !== i) })
  }
  const move = (i: number, d: -1 | 1) => {
    const next = [...rule.actions]
    const nextKeys = [...keys]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    ;[nextKeys[i], nextKeys[j]] = [nextKeys[j], nextKeys[i]]
    setKeys(nextKeys)
    setRule({ ...rule, actions: next })
  }

  // Escape (e.g. to dismiss a datalist) or a click on the backdrop must not silently discard edits.
  const initialJson = useMemo(() => JSON.stringify(initial), [initial])
  const confirming = useRef(false)
  const requestClose = async () => {
    if (confirming.current) return
    if (JSON.stringify(rule) === initialJson) return onClose()
    confirming.current = true
    const discard = await confirmAction('Discard changes?', 'Your edits to this automation have not been saved.', 'Discard', true)
    // Released after the current event: the same Escape also reaches this modal's listener.
    setTimeout(() => (confirming.current = false), 0)
    if (discard) onClose()
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await invoke('automation:save', { ...rule, name: rule.name.trim() || 'Untitled automation' })
      toast({ kind: 'ok', title: rule.id ? 'Automation saved' : 'Automation created', body: rule.name })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setError('')
    setTestResult('')
    try {
      const r = await invoke('automation:testActions', rule.actions)
      setTestResult(`${r.status === 'ok' ? '✓' : '✕'} ${r.detail} (${r.durationMs} ms)`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={rule.id ? 'Edit automation' : 'New automation'}
      icon={<Workflow size={15} className="accent" />}
      onClose={requestClose}
      width={760}
      footer={
        <>
          <button className="btn ghost" onClick={test} disabled={busy} data-tip="Runs the actions once now (placeholders are empty)">
            <FlaskConical size={13} /> Test actions
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {rule.id ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="col ae" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <Field label="Name" grow>
            <input className="input" autoFocus value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} placeholder="e.g. Morning routine" maxLength={120} />
          </Field>
          <Field label="Enabled">
            <div className="row" style={{ height: 30 }}>
              <Switch on={rule.enabled} onChange={(v) => setRule({ ...rule, enabled: v })} label="Enabled" />
            </div>
          </Field>
        </div>

        <section className="ae-section">
          <div className="ae-section-h">
            <span className="ae-step">1</span> When
            <span className="spacer" />
            <Seg
              value={t.type}
              options={[
                { value: 'event', label: 'Event' },
                { value: 'interval', label: 'Every N min' },
                { value: 'daily', label: 'Daily' }
              ]}
              onChange={(v) => setTrigger(v === 'event' ? { type: 'event', event: 'TAB_CREATED' } : v === 'interval' ? { type: 'interval', minutes: 30 } : { type: 'daily', time: '09:00' })}
            />
          </div>
          {t.type === 'event' && (
            <div className="row ae-row">
              <Field label="Event" grow>
                <select className="select" value={t.event} onChange={(e) => setTrigger({ type: 'event', event: e.target.value, match: EVENT_CATALOG[e.target.value]?.url ? t.match : undefined })}>
                  {events.map((ev) => (
                    <option key={ev} value={ev}>
                      {EVENT_CATALOG[ev]?.label ?? ev} · {ev}
                    </option>
                  ))}
                </select>
              </Field>
              {EVENT_CATALOG[t.event]?.url && (
                <Field label="URL filter (optional)" grow>
                  <input className="input" value={t.match ?? ''} onChange={(e) => setTrigger({ ...t, match: e.target.value || undefined })} placeholder="github.com · https://*/pulls* · watch?v=" />
                </Field>
              )}
            </div>
          )}
          {t.type === 'interval' && (
            <div className="row ae-row">
              <Field label="Every (minutes)">
                <input className="input num" type="number" min={1} max={10080} value={t.minutes} onChange={(e) => setTrigger({ type: 'interval', minutes: Math.max(1, Math.min(10080, Math.round(Number(e.target.value) || 1))) })} style={{ width: 120 }} />
              </Field>
              <span className="dim" style={{ fontSize: 11.5, alignSelf: 'flex-end', paddingBottom: 8 }}>
                Runs while SPECTER is open. Missed runs are not replayed.
              </span>
            </div>
          )}
          {t.type === 'daily' && (
            <div className="row ae-row" style={{ alignItems: 'flex-end' }}>
              <Field label="Time">
                <input className="input num" type="time" value={t.time} onChange={(e) => setTrigger({ ...t, time: e.target.value || '09:00' })} style={{ width: 120 }} />
              </Field>
              <Field label="Days (none = every day)">
                <div className="seg">
                  {WEEKDAYS.map((d, i) => (
                    <button key={d} className={t.days?.includes(i) ? 'on' : ''} onClick={() => setTrigger({ ...t, days: t.days?.includes(i) ? t.days.filter((x) => x !== i) : [...(t.days ?? []), i].sort() })}>
                      {d}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}
        </section>

        <section className="ae-section">
          <div className="ae-section-h">
            <span className="ae-step">2</span> Only if <span className="dim" style={{ fontWeight: 400 }}>(optional — all must match)</span>
            <span className="spacer" />
            <button className="btn sm ghost" disabled={t.type !== 'event' || rule.conditions.length >= 10} onClick={() => setRule({ ...rule, conditions: [...rule.conditions, { field: fields[0] ?? 'url', op: 'contains', value: '' }] })}>
              <Plus size={12} /> Condition
            </button>
          </div>
          {t.type !== 'event' && <div className="dim" style={{ fontSize: 11.5 }}>Conditions apply to event payloads; schedules have none.</div>}
          {t.type === 'event' && rule.conditions.length === 0 && <div className="dim" style={{ fontSize: 11.5 }}>Runs on every {EVENT_CATALOG[t.event]?.label.toLowerCase() ?? t.event} event{t.match ? ' matching the URL filter' : ''}.</div>}
          {rule.conditions.map((c, i) => (
            <div key={i} className="row ae-row">
              <input className="input" list="ae-fields" value={c.field} onChange={(e) => setCond(i, { ...c, field: e.target.value.trim() })} style={{ width: 150 }} aria-label="Field" placeholder="field" />
              <select className="select" value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as ConditionOp })} aria-label="Operator">
                {OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input className="input grow" value={c.value} onChange={(e) => setCond(i, { ...c, value: e.target.value })} aria-label="Value" placeholder="value (case-insensitive)" />
              <button className="icon-btn sm" onClick={() => setCond(i, null)} aria-label="Remove condition">
                <X size={13} />
              </button>
            </div>
          ))}
          <datalist id="ae-fields">
            {fields.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </section>

        <section className="ae-section">
          <div className="ae-section-h">
            <span className="ae-step">3</span> Do
            <span className="spacer" />
            <button
              className="btn sm ghost"
              disabled={rule.actions.length >= 20}
              onClick={() => {
                setKeys([...keys, actionKey()])
                setRule({ ...rule, actions: [...rule.actions, defaultAction('notify', workspaces[0]?.name ?? '')] })
              }}
            >
              <Plus size={12} /> Action
            </button>
          </div>
          {rule.actions.map((a, i) => (
            <div key={keys[i] ?? i} className="ae-action">
              <span className="ae-index mono">{i + 1}</span>
              <div className="grow col" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Field label="Action">
                    <select className="select" value={a.type} onChange={(e) => setAction(i, defaultAction(e.target.value as ActionType, workspaces[0]?.name ?? ''))}>
                      {(Object.keys(ACTION_LABELS) as ActionType[]).map((k) => (
                        <option key={k} value={k}>
                          {ACTION_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <ActionFields key={a.type} a={a} onChange={(n) => setAction(i, n)} />
                </div>
              </div>
              <div className="col" style={{ gap: 2 }}>
                <button className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp size={12} />
                </button>
                <button className="icon-btn sm" disabled={i === rule.actions.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown size={12} />
                </button>
              </div>
              <button className="icon-btn sm" onClick={() => setAction(i, null)} aria-label="Remove action" disabled={rule.actions.length === 1}>
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="dim" style={{ fontSize: 11 }}>
            Text fields accept placeholders from the event: {'{{url}}'}, {'{{title}}'}, {'{{name}}'}, {'{{message}}'}, {'{{mode}}'}, {'{{event}}'}. Destructive actions (closing, deleting, shell) are not available.
          </div>
        </section>

        {error && <div className="ae-error">{error}</div>}
        {testResult && <div className="ae-test mono">{testResult}</div>}
      </div>
    </Modal>
  )
}
