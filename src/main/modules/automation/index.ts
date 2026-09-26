// Automation, plugins & media — main-process module entry.
//
// Rules listen to the typed event bus (and a schedule); their actions run
// through executor.ts. Declarative plugins contribute commands (registered in
// the renderer as plugin.<id>.<cmd>) and event rules. All state is in SQLite.
import { shell } from 'electron'
import type { AutomationAction, AutomationRule, AutomationRun, PluginInfo } from '@shared/modules/automation'
import { bus, BUS_EVENT_NAMES } from '../../bus'
import { broadcast, handle } from '../../ipc'
import { createLogger } from '../../logger'
import { registerDiagnostic } from '../../services/diagnostics'
import { actionsMayEmit, describeTrigger, LoopGuard, nextRunAt, ruleMatches, validateAction, validateRule } from './engine'
import { ackExec, executeActions, markWindowReady } from './executor'
import { getPlugin, listPlugins, loadPlugins, pluginsDir, seedExamplePlugin } from './plugins'
import * as store from './store'

const log = createLogger('automation')
const guard = new LoopGuard()
const startedAt = Date.now()

let userRules: AutomationRule[] = []
let pluginRules: AutomationRule[] = []
const pluginRuleStats = new Map<string, { runCount: number; lastRunAt?: number; lastStatus?: AutomationRule['lastStatus'] }>()
const nextAt = new Map<string, { sig: string; at: number | null }>()
const lastSkipLogged = new Map<string, number>()
let scheduleTimer: NodeJS.Timeout | null = null

function allRules(): AutomationRule[] {
  return [...userRules, ...pluginRules]
}

function withRuntime(r: AutomationRule): AutomationRule {
  const stats = r.origin === 'plugin' ? pluginRuleStats.get(r.id) : undefined
  return { ...r, ...(stats ?? {}), runCount: stats?.runCount ?? r.runCount, nextRunAt: nextAt.get(r.id)?.at ?? undefined }
}

function changed(what: { rules?: boolean; runs?: boolean }): void {
  broadcast('automation:changed', what)
}

// ---------------------------------------------------------------- plugins → rules

function buildPluginRules(): void {
  pluginRules = []
  for (const p of listPlugins()) {
    if (!p.enabled || !p.manifest) continue
    p.manifest.events.forEach((ev, i) => {
      pluginRules.push({
        id: `plugin:${p.id}:${i}`,
        name: `${p.manifest!.name} · ${describeTrigger(ev.trigger)}`,
        description: `Declared by plugin ${p.id} v${p.manifest!.version}`,
        enabled: true,
        trigger: ev.trigger,
        conditions: ev.conditions ?? [],
        actions: ev.actions,
        createdAt: 0,
        updatedAt: 0,
        runCount: 0,
        origin: 'plugin',
        pluginId: p.id
      })
    })
  }
}

function reloadPlugins(): PluginInfo[] {
  const list = loadPlugins()
  buildPluginRules()
  refreshSchedule()
  broadcast('plugins:changed', { ids: list.map((p) => p.id) })
  changed({ rules: true })
  return list
}

function pluginVars(p: PluginInfo | undefined): Record<string, unknown> {
  return { settings: p?.settings ?? {}, plugin: p ? { id: p.id, name: p.manifest?.name } : undefined }
}

// ---------------------------------------------------------------- running

type Cause = { kind: 'event'; event: string; payload: unknown } | { kind: 'schedule' } | { kind: 'manual'; wcId?: number; source?: AutomationRun['source'] }

async function runRule(rule: AutomationRule, cause: Cause): Promise<AutomationRun | null> {
  const now = Date.now()
  const eventName = cause.kind === 'event' ? cause.event : null
  const triggerLabel = cause.kind === 'event' ? cause.event : cause.kind === 'schedule' ? describeTrigger(rule.trigger) : 'Run now'
  const source: AutomationRun['source'] = cause.kind === 'manual' ? (cause.source ?? 'manual') : rule.origin === 'plugin' ? 'plugin-rule' : 'rule'
  const verdict = guard.check(rule.id, eventName, now, { manual: cause.kind === 'manual' })
  if (!verdict.ok) {
    // Log skips sparingly so a runaway loop can't flood the run log.
    const last = lastSkipLogged.get(rule.id) ?? 0
    if (now - last < 10_000 && cause.kind !== 'manual') return null
    lastSkipLogged.set(rule.id, now)
    log.warn(`automation "${rule.name}" skipped: ${verdict.reason}`)
    const skipped = store.insertRun({ ruleId: rule.id, ruleName: rule.name, source, trigger: triggerLabel, startedAt: now, durationMs: 0, status: 'skipped', detail: verdict.reason, steps: [] })
    changed({ runs: true })
    return skipped
  }
  guard.begin(rule.id, verdict.depth, actionsMayEmit(rule.actions), now)
  const vars: Record<string, unknown> = {
    ...(cause.kind === 'event' && cause.payload && typeof cause.payload === 'object' ? (cause.payload as Record<string, unknown>) : {}),
    event: eventName ?? triggerLabel,
    payload: cause.kind === 'event' ? cause.payload : {},
    rule: { id: rule.id, name: rule.name },
    ...(rule.pluginId ? pluginVars(getPlugin(rule.pluginId)) : {})
  }
  let result: Awaited<ReturnType<typeof executeActions>>
  try {
    result = await executeActions(rule.actions, { vars, targetWcId: cause.kind === 'manual' ? cause.wcId : undefined })
  } finally {
    guard.end(rule.id, Date.now())
  }
  const status = result.ok ? 'ok' : 'error'
  const rec = store.insertRun({ ruleId: rule.id, ruleName: rule.name, source, trigger: triggerLabel + (verdict.depth ? ` · chain ${verdict.depth}` : ''), startedAt: now, durationMs: Date.now() - now, status, detail: result.detail, steps: result.steps })
  if (rule.origin === 'user') {
    store.markRuleRun(rule.id, now, status)
    userRules = userRules.map((r) => (r.id === rule.id ? { ...r, runCount: r.runCount + 1, lastRunAt: now, lastStatus: status } : r))
  } else {
    const s = pluginRuleStats.get(rule.id) ?? { runCount: 0 }
    pluginRuleStats.set(rule.id, { runCount: s.runCount + 1, lastRunAt: now, lastStatus: status })
  }
  if (!result.ok) log.warn(`automation "${rule.name}" failed: ${result.detail}`)
  changed({ runs: true, rules: true })
  return rec
}

function onBusEvent(name: string, payload: unknown): void {
  for (const rule of allRules()) {
    try {
      if (ruleMatches(rule, name, payload)) runRule(rule, { kind: 'event', event: name, payload }).catch((err) => log.error('automation run failed', err))
    } catch (err) {
      log.error('automation match failed', err)
    }
  }
}

// ---------------------------------------------------------------- schedule

function refreshSchedule(): void {
  const now = Date.now()
  const scheduled = allRules().filter((r) => r.enabled && r.trigger.type !== 'event')
  const ids = new Set(scheduled.map((r) => r.id))
  for (const id of [...nextAt.keys()]) if (!ids.has(id)) nextAt.delete(id)
  for (const r of scheduled) {
    const sig = JSON.stringify(r.trigger)
    // A schedule that is new, edited or re-enabled counts from now (like one present at
    // startup) — anchoring it at app start made it fire at once if SPECTER had been open
    // longer than the interval.
    if (nextAt.get(r.id)?.sig !== sig) nextAt.set(r.id, { sig, at: nextRunAt(r.trigger, r.lastRunAt, now, now) })
  }
  if (scheduled.length && !scheduleTimer) {
    scheduleTimer = setInterval(tickSchedule, 15_000)
    scheduleTimer.unref?.()
  } else if (!scheduled.length && scheduleTimer) {
    clearInterval(scheduleTimer)
    scheduleTimer = null
  }
}

function tickSchedule(): void {
  const now = Date.now()
  for (const r of allRules()) {
    if (!r.enabled || r.trigger.type === 'event') continue
    const n = nextAt.get(r.id)
    if (!n || n.at === null || n.at > now) continue
    nextAt.set(r.id, { sig: n.sig, at: nextRunAt(r.trigger, now, now + 1, startedAt) })
    runRule(r, { kind: 'schedule' }).catch((err) => log.error('scheduled automation failed', err))
  }
}

// ---------------------------------------------------------------- IPC

function registerIpc(): void {
  handle('automation:list', () => allRules().map(withRuntime))
  handle('automation:save', (_e, input) => {
    const err = validateRule(input, BUS_EVENT_NAMES)
    if (err) throw new Error(err)
    if (input.id && !userRules.some((r) => r.id === input.id)) throw new Error('Only your own automations can be edited')
    const saved = store.saveRule(input)
    userRules = store.loadRules()
    refreshSchedule()
    changed({ rules: true })
    return withRuntime(saved)
  })
  handle('automation:delete', (_e, id) => {
    store.deleteRule(id)
    userRules = userRules.filter((r) => r.id !== id)
    refreshSchedule()
    changed({ rules: true })
  })
  handle('automation:setEnabled', (_e, id, enabled) => {
    if (!userRules.some((r) => r.id === id)) throw new Error('Plugin automations are enabled with their plugin')
    store.setRuleEnabled(id, enabled)
    userRules = userRules.map((r) => (r.id === id ? { ...r, enabled } : r))
    refreshSchedule()
    changed({ rules: true })
  })
  handle('automation:runNow', async (e, id) => {
    const rule = allRules().find((r) => r.id === id)
    if (!rule) throw new Error('Automation not found')
    const rec = await runRule(rule, { kind: 'manual', wcId: e.sender.id })
    if (!rec) throw new Error('Run was skipped')
    return rec
  })
  handle('automation:testActions', async (e, actions: AutomationAction[]) => {
    if (!Array.isArray(actions) || !actions.length) throw new Error('Add at least one action')
    for (const a of actions) {
      const err = validateAction(a)
      if (err) throw new Error(err)
    }
    const rule: AutomationRule = { id: 'test', name: 'Test run (editor)', enabled: true, trigger: { type: 'event', event: 'APP_STARTED' }, conditions: [], actions, createdAt: 0, updatedAt: 0, runCount: 0, origin: 'user' }
    const rec = await runRuleEphemeral(rule, e.sender.id)
    return rec
  })
  handle('automation:runs', (_e, limit) => store.listRuns(limit))
  handle('automation:clearRuns', () => {
    store.clearRuns()
    changed({ runs: true })
  })
  handle('automation:events', () => [...BUS_EVENT_NAMES])
  handle('automation:ready', (e) => markWindowReady(e.sender.id))
  handle('automation:ack', (_e, token, ok, detail) => ackExec(token, ok, detail))

  handle('plugins:list', () => listPlugins())
  handle('plugins:reload', () => reloadPlugins())
  handle('plugins:setEnabled', (_e, id, enabled) => {
    const p = getPlugin(id)
    if (!p) throw new Error('Plugin not found')
    if (enabled && !p.manifest) throw new Error('This plugin has manifest errors and cannot be enabled')
    store.setPluginEnabled(id, enabled)
    log.info(`plugin ${id} ${enabled ? 'enabled' : 'disabled'}`)
    return reloadPlugins()
  })
  handle('plugins:setSetting', (_e, id, key, value) => {
    const p = getPlugin(id)
    const def = p?.manifest?.settings.find((s) => s.key === key)
    if (!p || !def) throw new Error('Unknown plugin setting')
    if (typeof value !== def.type) throw new Error(`${def.title} must be a ${def.type}`)
    if (typeof value === 'string' && value.length > 500) throw new Error('Value is too long')
    const next = { ...p.settings, [key]: value }
    store.setPluginSettings(id, next)
    p.settings = next
    broadcast('plugins:changed', { ids: [id] })
  })
  handle('plugins:runCommand', async (e, id, commandId) => {
    const p = getPlugin(id)
    if (!p?.enabled || !p.manifest) throw new Error('Plugin is not enabled')
    const cmd = p.manifest.commands.find((c) => c.id === commandId)
    if (!cmd) throw new Error('Plugin command not found')
    const rule: AutomationRule = {
      id: `plugin:${p.id}:cmd:${cmd.id}`,
      name: `${p.manifest.name} · ${cmd.title}`,
      enabled: true,
      trigger: { type: 'event', event: 'APP_STARTED' },
      conditions: [],
      actions: cmd.actions,
      createdAt: 0,
      updatedAt: 0,
      runCount: 0,
      origin: 'plugin',
      pluginId: p.id
    }
    const rec = await runRule(rule, { kind: 'manual', wcId: e.sender.id, source: 'plugin-command' })
    if (!rec) throw new Error('Run was skipped')
    return rec
  })
  handle('plugins:openFolder', async () => {
    const dir = pluginsDir()
    await shell.openPath(dir)
    return dir
  })

  handle('widgets:get', (_e, key) => {
    if (typeof key !== 'string' || key.length > 80) throw new Error('Invalid key')
    return store.kvGet(key)
  })
  handle('widgets:set', (_e, key, value) => {
    if (typeof key !== 'string' || key.length > 80) throw new Error('Invalid key')
    if (JSON.stringify(value ?? null).length > 512 * 1024) throw new Error('Value too large')
    store.kvSet(key, value)
    broadcast('widgets:changed', { key })
  })
}

/** Test runs share the executor and loop guard but don't touch rule stats. */
async function runRuleEphemeral(rule: AutomationRule, wcId: number): Promise<AutomationRun> {
  const now = Date.now()
  const verdict = guard.check(rule.id, null, now, { manual: true })
  if (!verdict.ok) throw new Error(verdict.reason)
  guard.begin(rule.id, 0, actionsMayEmit(rule.actions), now)
  let result: Awaited<ReturnType<typeof executeActions>>
  try {
    result = await executeActions(rule.actions, { vars: { event: 'test', payload: {}, url: '', rule: { id: rule.id, name: rule.name } }, targetWcId: wcId })
  } finally {
    guard.end(rule.id, Date.now())
  }
  const rec = store.insertRun({ ruleId: rule.id, ruleName: rule.name, source: 'manual', trigger: 'Test', startedAt: now, durationMs: Date.now() - now, status: result.ok ? 'ok' : 'error', detail: result.detail, steps: result.steps })
  changed({ runs: true })
  return rec
}

export function register(): void {
  registerIpc()
  try {
    userRules = store.loadRules()
  } catch (err) {
    log.error('could not load automations', err)
  }
  try {
    seedExamplePlugin()
    loadPlugins()
    buildPluginRules()
  } catch (err) {
    log.error('could not load plugins', err)
  }
  refreshSchedule()
  bus.onAny((name, payload) => onBusEvent(name, payload))

  registerDiagnostic(() => {
    const plugins = listPlugins()
    const broken = plugins.filter((p) => p.errors.length)
    const enabledRules = allRules().filter((r) => r.enabled).length
    return {
      id: 'automation',
      label: 'Automation & plugins',
      status: broken.length ? 'warn' : 'ok',
      detail: `${enabledRules} active rule(s) · ${plugins.filter((p) => p.enabled).length}/${plugins.length} plugin(s) enabled${broken.length ? ` · manifest errors in ${broken.map((p) => p.id).join(', ')}` : ''}`
    }
  })
}
