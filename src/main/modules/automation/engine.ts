// Pure automation logic: trigger matching, conditions, schedules, loop
// protection and validation. No Electron imports — unit tested directly.
import {
  EVENT_CATALOG,
  PERFORMANCE_MODES,
  SAFE_SETTING_KEYS,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRuleInput,
  type AutomationTrigger,
  type ConditionOp
} from '@shared/modules/automation'

// ---------------------------------------------------------------- matching

/** Reads a dotted path from an event payload. */
export function readField(payload: unknown, path: string): unknown {
  let cur: unknown = payload
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function asText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (Array.isArray(v)) return v.map(asText).join(',')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function evalCondition(c: AutomationCondition, payload: unknown): boolean {
  const actual = asText(readField(payload, c.field)).toLowerCase()
  const want = String(c.value ?? '').toLowerCase()
  switch (c.op) {
    case 'equals':
      return actual === want
    case 'notEquals':
      return actual !== want
    case 'contains':
      return actual.includes(want)
    case 'notContains':
      return !actual.includes(want)
    case 'startsWith':
      return actual.startsWith(want)
    case 'endsWith':
      return actual.endsWith(want)
    default:
      return false
  }
}

export function evalConditions(conditions: AutomationCondition[] | undefined, payload: unknown): boolean {
  return (conditions ?? []).every((c) => evalCondition(c, payload))
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp('^' + esc + '$', 'i')
}

/**
 * URL filter used by url-bearing events:
 *  - contains "*"      → glob against the full URL
 *  - looks like a host → the URL's host equals it or is a subdomain of it
 *  - otherwise         → case-insensitive substring of the URL
 */
export function urlMatches(url: string | undefined, pattern: string | undefined): boolean {
  const p = (pattern ?? '').trim()
  if (!p) return true
  if (!url) return false
  if (p.includes('*')) return globToRegex(p).test(url)
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(p)) {
    let host = ''
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      return false
    }
    const h = p.toLowerCase().replace(/^www\./, '')
    return host === h || host.endsWith('.' + h) || host === 'www.' + h
  }
  return url.toLowerCase().includes(p.toLowerCase())
}

export function triggerMatches(trigger: AutomationTrigger, eventName: string, payload: unknown): boolean {
  if (trigger.type !== 'event' || trigger.event !== eventName) return false
  if (trigger.match) {
    const url = readField(payload, 'url')
    return urlMatches(typeof url === 'string' ? url : undefined, trigger.match)
  }
  return true
}

export function ruleMatches(rule: Pick<AutomationRuleInput, 'enabled' | 'trigger' | 'conditions'>, eventName: string, payload: unknown): boolean {
  return rule.enabled && triggerMatches(rule.trigger, eventName, payload) && evalConditions(rule.conditions, payload)
}

/** Replaces {{path}} placeholders from a context object (payload fields, settings.*, event). */
export function interpolate(text: string, ctx: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path: string) => asText(readField(ctx, path)))
}

// ---------------------------------------------------------------- schedules

export function parseTime(time: string): { h: number; m: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim())
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null
}

/** First local time strictly after `from` matching HH:MM (and weekday filter). */
export function nextDaily(time: string, days: number[] | undefined, from: number): number | null {
  const t = parseTime(time)
  if (!t) return null
  const allowed = days && days.length ? new Set(days) : null
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setHours(t.h, t.m)
  for (let i = 0; i < 8; i++) {
    const c = new Date(d)
    c.setDate(d.getDate() + i)
    c.setHours(t.h, t.m, 0, 0)
    if (c.getTime() > from && (!allowed || allowed.has(c.getDay()))) return c.getTime()
  }
  return null
}

/**
 * Next run time for a schedule trigger. Intervals are anchored at the later of
 * the last run and app start, so missed runs while SPECTER was closed never
 * fire in a burst on startup.
 */
export function nextRunAt(trigger: AutomationTrigger, lastRun: number | undefined, now: number, startedAt: number): number | null {
  if (trigger.type === 'interval') {
    const period = Math.max(1, Math.round(trigger.minutes)) * 60_000
    const base = Math.max(lastRun ?? 0, startedAt)
    return Math.max(base + period, now)
  }
  if (trigger.type === 'daily') return nextDaily(trigger.time, trigger.days, Math.max(now, lastRun ?? 0))
  return null
}

// ---------------------------------------------------------------- loop protection

/** Events an action may cause (used to attribute follow-up events to a rule). */
export function actionMayEmit(a: AutomationAction): string[] | '*' {
  switch (a.type) {
    case 'openUrl':
      return ['TAB_CREATED', 'TAB_CHANGED', 'PAGE_LOADED']
    case 'workspace':
      return ['WORKSPACE_CHANGED', 'TAB_CREATED', 'TAB_CHANGED', 'PAGE_LOADED']
    case 'performanceMode':
      return ['SYSTEM_MODE_CHANGED', 'SETTINGS_CHANGED']
    case 'setting':
      return ['SETTINGS_CHANGED']
    case 'command':
      return '*'
    default:
      return []
  }
}

export function actionsMayEmit(actions: AutomationAction[]): string[] | '*' {
  const out = new Set<string>()
  for (const a of actions) {
    const e = actionMayEmit(a)
    if (e === '*') return '*'
    e.forEach((x) => out.add(x))
  }
  return [...out]
}

export interface LoopGuardOptions {
  /** Max runs of one rule inside `windowMs`. */
  maxPerRule: number
  /** Max runs of all rules inside `windowMs`. */
  maxGlobal: number
  windowMs: number
  /** Max automation → event → automation chain length. */
  maxDepth: number
  /** How long after a run its possible side-effect events are attributed to it. */
  causalMs: number
}

export const DEFAULT_GUARD: LoopGuardOptions = { maxPerRule: 6, maxGlobal: 60, windowMs: 60_000, maxDepth: 3, causalMs: 4000 }

interface Cause {
  ruleId: string
  depth: number
  emits: Set<string> | '*'
  until: number
  running: boolean
}

export type GuardVerdict = { ok: true; depth: number } | { ok: false; reason: string }

export class LoopGuard {
  private causes: Cause[] = []
  private runs = new Map<string, number[]>()
  private all: number[] = []

  constructor(private opts: LoopGuardOptions = DEFAULT_GUARD) {}

  private prune(now: number): void {
    this.causes = this.causes.filter((c) => c.running || c.until > now)
    const cutoff = now - this.opts.windowMs
    this.all = this.all.filter((t) => t > cutoff)
    for (const [k, v] of this.runs) {
      const kept = v.filter((t) => t > cutoff)
      if (kept.length) this.runs.set(k, kept)
      else this.runs.delete(k)
    }
  }

  /** Active causes that could have produced this event. */
  private causesOf(eventName: string | null, now: number): Cause[] {
    if (!eventName) return []
    this.prune(now)
    return this.causes.filter((c) => c.emits === '*' || c.emits.has(eventName))
  }

  /** Chain depth of an incoming event (0 = not caused by an automation). */
  depthOf(eventName: string | null, now: number): number {
    const cs = this.causesOf(eventName, now)
    return cs.length ? Math.max(...cs.map((c) => c.depth)) + 1 : 0
  }

  /** Decides whether `ruleId` may run in response to `eventName` (null for schedule/manual). */
  check(ruleId: string, eventName: string | null, now: number, opts: { manual?: boolean } = {}): GuardVerdict {
    this.prune(now)
    const cs = this.causesOf(eventName, now)
    if (cs.some((c) => c.ruleId === ruleId)) return { ok: false, reason: 'Loop protection: this event was caused by the same automation' }
    const depth = cs.length ? Math.max(...cs.map((c) => c.depth)) + 1 : 0
    if (depth > this.opts.maxDepth) return { ok: false, reason: `Loop protection: chain depth ${depth} exceeds ${this.opts.maxDepth}` }
    if (this.causes.some((c) => c.ruleId === ruleId && c.running)) return { ok: false, reason: 'Already running' }
    // Explicit user runs are never rate limited (they still count towards the limits).
    if (opts.manual) return { ok: true, depth }
    if ((this.runs.get(ruleId)?.length ?? 0) >= this.opts.maxPerRule)
      return { ok: false, reason: `Rate limited: more than ${this.opts.maxPerRule} runs in ${Math.round(this.opts.windowMs / 1000)} s` }
    if (this.all.length >= this.opts.maxGlobal) return { ok: false, reason: 'Rate limited: too many automation runs overall' }
    return { ok: true, depth }
  }

  begin(ruleId: string, depth: number, emits: string[] | '*', now: number): void {
    this.runs.set(ruleId, [...(this.runs.get(ruleId) ?? []), now])
    this.all.push(now)
    this.causes.push({ ruleId, depth, emits: emits === '*' ? '*' : new Set(emits), until: now + this.opts.causalMs, running: true })
  }

  end(ruleId: string, now: number): void {
    for (const c of this.causes) if (c.ruleId === ruleId && c.running) {
      c.running = false
      c.until = now + this.opts.causalMs
    }
  }
}

// ---------------------------------------------------------------- validation

/** Commands automations and plugins may never run (destructive, recursive or internal). */
const DENIED_COMMANDS = [/^app\.quit$/, /^browser\.closeTab$/, /^tabs\.close/, /^internal\./, /^automation\.(?!openWorkspace$)/, /^plugin\./, /^privacy\.clear/, /delete/i, /remove/i, /^terminal\./, /^developer\.(run|exec|shell)/i]

export function commandAllowed(id: string): boolean {
  return /^[a-zA-Z][\w-]*(\.[\w-]+)+$/.test(id) && !DENIED_COMMANDS.some((r) => r.test(id))
}

export function safeUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url) || /^specter:\/\/[a-z0-9-]+([/?#][^\s]*)?$/i.test(url)
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

/** Validates an action; returns an error message or null. */
export function validateAction(a: unknown): string | null {
  if (!a || typeof a !== 'object') return 'Action must be an object'
  const x = a as Record<string, unknown>
  const allowedKeys: Record<string, string[]> = {
    command: ['type', 'command', 'args'],
    openUrl: ['type', 'url', 'background', 'newWindow'],
    workspace: ['type', 'workspace', 'create'],
    notify: ['type', 'title', 'body'],
    performanceMode: ['type', 'mode'],
    setting: ['type', 'key', 'value'],
    sidePanel: ['type', 'panel', 'popout'],
    wait: ['type', 'seconds']
  }
  const keys = allowedKeys[x.type as string]
  if (!keys) return `Unknown action type "${String(x.type)}"`
  const extra = Object.keys(x).filter((k) => !keys.includes(k))
  if (extra.length) return `Unexpected field(s) on ${x.type} action: ${extra.join(', ')}`
  const bool = (k: string) => x[k] === undefined || typeof x[k] === 'boolean'
  switch (x.type) {
    case 'command':
      if (!str(x.command, 80)) return 'Command id is required'
      if (!commandAllowed(x.command)) return `Command "${x.command}" is not allowed in automations`
      if (x.args !== undefined && (typeof x.args !== 'object' || x.args === null || Array.isArray(x.args))) return 'Command args must be an object'
      if (x.args !== undefined && JSON.stringify(x.args).length > 2000) return 'Command args are too large'
      return null
    case 'openUrl':
      if (!str(x.url, 2048)) return 'URL is required'
      if (!safeUrl(x.url.replace(/\{\{[^}]*\}\}/g, 'x'))) return 'Only http(s):// and specter:// URLs can be opened'
      return bool('background') && bool('newWindow') ? null : 'Invalid openUrl flags'
    case 'workspace':
      return str(x.workspace, 120) && bool('create') ? null : 'Workspace name is required'
    case 'notify':
      if (!str(x.title, 200)) return 'Notification title is required'
      return x.body === undefined || (typeof x.body === 'string' && x.body.length <= 1000) ? null : 'Notification body is too long'
    case 'performanceMode':
      return PERFORMANCE_MODES.includes(x.mode as never) ? null : `Unknown performance mode "${String(x.mode)}"`
    case 'setting':
      if (!SAFE_SETTING_KEYS.includes(x.key as never)) return `Setting "${String(x.key)}" cannot be changed by automations`
      return typeof x.value === 'boolean' ? null : 'Setting value must be true or false'
    case 'sidePanel':
      return str(x.panel, 60) && /^[\w.-]+$/.test(x.panel) && bool('popout') ? null : 'Side panel id is required'
    case 'wait':
      return typeof x.seconds === 'number' && x.seconds > 0 && x.seconds <= 300 ? null : 'Wait must be between 1 and 300 seconds'
  }
  return 'Invalid action'
}

export function validateTrigger(t: unknown, knownEvents: string[] = Object.keys(EVENT_CATALOG)): string | null {
  if (!t || typeof t !== 'object') return 'Trigger is required'
  const x = t as Record<string, unknown>
  if (x.type === 'event') {
    if (Object.keys(x).some((k) => !['type', 'event', 'match'].includes(k))) return 'Unexpected field on event trigger'
    if (typeof x.event !== 'string' || !knownEvents.includes(x.event)) return `Unknown event "${String(x.event)}"`
    if (x.match !== undefined && (typeof x.match !== 'string' || x.match.length > 300)) return 'Invalid URL match'
    return null
  }
  if (x.type === 'interval') {
    if (Object.keys(x).some((k) => !['type', 'minutes'].includes(k))) return 'Unexpected field on interval trigger'
    return typeof x.minutes === 'number' && Number.isFinite(x.minutes) && x.minutes >= 1 && x.minutes <= 10080 ? null : 'Interval must be 1–10080 minutes'
  }
  if (x.type === 'daily') {
    if (Object.keys(x).some((k) => !['type', 'time', 'days'].includes(k))) return 'Unexpected field on daily trigger'
    if (typeof x.time !== 'string' || !parseTime(x.time)) return 'Daily time must be HH:MM'
    if (x.days !== undefined && (!Array.isArray(x.days) || x.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) return 'Days must be 0–6'
    return null
  }
  return `Unknown trigger type "${String(x.type)}"`
}

export function validateCondition(c: unknown): string | null {
  if (!c || typeof c !== 'object') return 'Condition must be an object'
  const x = c as Record<string, unknown>
  const ops: ConditionOp[] = ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith']
  if (Object.keys(x).some((k) => !['field', 'op', 'value'].includes(k))) return 'Unexpected field on condition'
  if (!str(x.field, 80) || !/^[\w.]+$/.test(x.field)) return 'Condition field is required'
  if (!ops.includes(x.op as ConditionOp)) return `Unknown condition operator "${String(x.op)}"`
  if (typeof x.value !== 'string' || x.value.length > 500) return 'Condition value must be text'
  return null
}

export function validateRule(r: unknown, knownEvents?: string[]): string | null {
  if (!r || typeof r !== 'object') return 'Rule must be an object'
  const x = r as Partial<AutomationRuleInput>
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 120) return 'Name is required (max 120 characters)'
  const te = validateTrigger(x.trigger, knownEvents)
  if (te) return te
  if (!Array.isArray(x.conditions) || x.conditions.length > 10) return 'Up to 10 conditions are allowed'
  for (const c of x.conditions) {
    const e = validateCondition(c)
    if (e) return e
  }
  if (!Array.isArray(x.actions) || x.actions.length === 0) return 'Add at least one action'
  if (x.actions.length > 20) return 'Up to 20 actions are allowed'
  for (const a of x.actions) {
    const e = validateAction(a)
    if (e) return e
  }
  return null
}

export function describeTrigger(t: AutomationTrigger): string {
  if (t.type === 'event') return (EVENT_CATALOG[t.event]?.label ?? t.event) + (t.match ? ` · ${t.match}` : '')
  if (t.type === 'interval') return `Every ${t.minutes} min`
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `Daily at ${t.time}` + (t.days?.length ? ` (${t.days.map((d) => names[d]).join(', ')})` : '')
}
