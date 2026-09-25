// SQLite persistence for automation rules, run log, plugin state and widget/cockpit data.
import type { AutomationRule, AutomationRuleInput, AutomationRun, RunStatus } from '@shared/modules/automation'
import { all, get, json, registerMigrations, run, uid } from '../../db'

export const MAX_RUNS = 200

registerMigrations('automation', [
  `
  CREATE TABLE automation_rules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL DEFAULT 1,
    trigger TEXT NOT NULL, conditions TEXT NOT NULL, actions TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    run_count INTEGER NOT NULL DEFAULT 0, last_run_at INTEGER, last_status TEXT
  );
  CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, rule_name TEXT NOT NULL, source TEXT NOT NULL, trigger TEXT NOT NULL,
    started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, steps TEXT NOT NULL
  );
  CREATE INDEX idx_automation_runs_started ON automation_runs(started_at);
  CREATE TABLE plugin_state (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE widget_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `
])

type RuleRow = {
  id: string
  name: string
  description: string | null
  enabled: number
  trigger: string
  conditions: string
  actions: string
  created_at: number
  updated_at: number
  run_count: number
  last_run_at: number | null
  last_status: string | null
}

function toRule(r: RuleRow): AutomationRule {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    enabled: !!r.enabled,
    trigger: json(r.trigger, { type: 'event', event: 'APP_STARTED' }),
    conditions: json(r.conditions, []),
    actions: json(r.actions, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    runCount: r.run_count,
    lastRunAt: r.last_run_at ?? undefined,
    lastStatus: (r.last_status as RunStatus | null) ?? undefined,
    origin: 'user'
  }
}

export function loadRules(): AutomationRule[] {
  return all<RuleRow>('SELECT * FROM automation_rules ORDER BY created_at').map(toRule)
}

export function saveRule(input: AutomationRuleInput): AutomationRule {
  const now = Date.now()
  const existing = input.id ? get<RuleRow>('SELECT * FROM automation_rules WHERE id = ?', input.id) : undefined
  const id = existing?.id ?? uid('ar_')
  if (existing) {
    run(
      'UPDATE automation_rules SET name = ?, description = ?, enabled = ?, trigger = ?, conditions = ?, actions = ?, updated_at = ? WHERE id = ?',
      input.name.trim(),
      input.description ?? null,
      input.enabled ? 1 : 0,
      JSON.stringify(input.trigger),
      JSON.stringify(input.conditions),
      JSON.stringify(input.actions),
      now,
      id
    )
  } else {
    run(
      'INSERT INTO automation_rules(id, name, description, enabled, trigger, conditions, actions, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      id,
      input.name.trim(),
      input.description ?? null,
      input.enabled ? 1 : 0,
      JSON.stringify(input.trigger),
      JSON.stringify(input.conditions),
      JSON.stringify(input.actions),
      now,
      now
    )
  }
  return toRule(get<RuleRow>('SELECT * FROM automation_rules WHERE id = ?', id)!)
}

export function deleteRule(id: string): void {
  run('DELETE FROM automation_rules WHERE id = ?', id)
}

export function setRuleEnabled(id: string, enabled: boolean): void {
  run('UPDATE automation_rules SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, Date.now(), id)
}

export function markRuleRun(id: string, at: number, status: RunStatus): void {
  run('UPDATE automation_rules SET run_count = run_count + 1, last_run_at = ?, last_status = ? WHERE id = ?', at, status, id)
}

export function insertRun(r: Omit<AutomationRun, 'id'>): AutomationRun {
  const full: AutomationRun = { ...r, id: uid('run_') }
  run(
    'INSERT INTO automation_runs(id, rule_id, rule_name, source, trigger, started_at, duration_ms, status, detail, steps) VALUES(?,?,?,?,?,?,?,?,?,?)',
    full.id,
    full.ruleId,
    full.ruleName,
    full.source,
    full.trigger,
    full.startedAt,
    full.durationMs,
    full.status,
    full.detail,
    JSON.stringify(full.steps)
  )
  run(`DELETE FROM automation_runs WHERE id NOT IN (SELECT id FROM automation_runs ORDER BY started_at DESC LIMIT ${MAX_RUNS})`)
  return full
}

export function listRuns(limit = MAX_RUNS): AutomationRun[] {
  return all<{
    id: string
    rule_id: string
    rule_name: string
    source: AutomationRun['source']
    trigger: string
    started_at: number
    duration_ms: number
    status: RunStatus
    detail: string
    steps: string
  }>('SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT ?', Math.min(MAX_RUNS, Math.max(1, limit))).map((r) => ({
    id: r.id,
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    source: r.source,
    trigger: r.trigger,
    startedAt: r.started_at,
    durationMs: r.duration_ms,
    status: r.status,
    detail: r.detail,
    steps: json(r.steps, [])
  }))
}

export function clearRuns(): void {
  run('DELETE FROM automation_runs')
}

// ---------------------------------------------------------------- plugin state

export function pluginState(id: string): { enabled: boolean; settings: Record<string, string | boolean | number> } {
  const r = get<{ enabled: number; settings: string }>('SELECT enabled, settings FROM plugin_state WHERE id = ?', id)
  return { enabled: !!r?.enabled, settings: json(r?.settings, {}) }
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  run('INSERT INTO plugin_state(id, enabled) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled', id, enabled ? 1 : 0)
}

export function setPluginSettings(id: string, settings: Record<string, string | boolean | number>): void {
  run('INSERT INTO plugin_state(id, settings) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET settings = excluded.settings', id, JSON.stringify(settings))
}

// ---------------------------------------------------------------- widget / cockpit key-value

export function kvGet(key: string): unknown {
  const r = get<{ value: string }>('SELECT value FROM widget_kv WHERE key = ?', key)
  return r ? json<unknown>(r.value, null) : null
}

export function kvSet(key: string, value: unknown): void {
  if (value === null || value === undefined) run('DELETE FROM widget_kv WHERE key = ?', key)
  else run('INSERT INTO widget_kv(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, JSON.stringify(value), Date.now())
}
