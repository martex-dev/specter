// Automation, plugins, media, widgets & cockpit — shared types and IPC contract.
import type { PerformanceMode } from '../settings'

// ---------------------------------------------------------------- automation model

export type ConditionOp = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'startsWith' | 'endsWith'

export interface AutomationCondition {
  /** Dotted path into the event payload, e.g. "url" or "mode". */
  field: string
  op: ConditionOp
  value: string
}

export type AutomationTrigger =
  /** A bus event. `match` filters url-bearing events by host, glob (*) or substring. */
  | { type: 'event'; event: string; match?: string }
  | { type: 'interval'; minutes: number }
  /** Local time "HH:MM"; optional weekdays 0 (Sun) … 6 (Sat). */
  | { type: 'daily'; time: string; days?: number[] }

export const SAFE_SETTING_KEYS = [
  'research.indexPages',
  'knowledge.semanticSearch',
  'ai.enabled',
  'markets.enabled',
  'markets.showTickerInHud',
  'appearance.showHud',
  'appearance.showBookmarksBar',
  'appearance.showStatusBar',
  'appearance.showSideRail',
  'notifications.enabled',
  'workspaces.suspendInactive',
  'newtab.showMarkets',
  'newtab.showSystem'
] as const
export type SafeSettingKey = (typeof SAFE_SETTING_KEYS)[number]

export const PERFORMANCE_MODES: PerformanceMode[] = ['normal', 'coding', 'ml', 'research', 'trading', 'gaming', 'battery']

export type AutomationAction =
  | { type: 'command'; command: string; args?: Record<string, unknown> }
  | { type: 'openUrl'; url: string; background?: boolean; newWindow?: boolean }
  | { type: 'workspace'; workspace: string; create?: boolean }
  | { type: 'notify'; title: string; body?: string }
  | { type: 'performanceMode'; mode: PerformanceMode }
  | { type: 'setting'; key: SafeSettingKey; value: boolean }
  | { type: 'sidePanel'; panel: string; popout?: boolean }
  | { type: 'wait'; seconds: number }

export type ActionType = AutomationAction['type']

export const ACTION_LABELS: Record<ActionType, string> = {
  command: 'Run SPECTER command',
  openUrl: 'Open URL',
  workspace: 'Open / switch workspace',
  notify: 'Show notification',
  performanceMode: 'Set performance mode',
  setting: 'Toggle a setting',
  sidePanel: 'Open side panel',
  wait: 'Wait'
}

export interface AutomationRuleInput {
  id?: string
  name: string
  description?: string
  enabled: boolean
  trigger: AutomationTrigger
  conditions: AutomationCondition[]
  actions: AutomationAction[]
}

export interface AutomationRule extends AutomationRuleInput {
  id: string
  createdAt: number
  updatedAt: number
  runCount: number
  lastRunAt?: number
  lastStatus?: RunStatus
  /** 'plugin' rules come from enabled plugin manifests and are read-only here. */
  origin: 'user' | 'plugin'
  pluginId?: string
  nextRunAt?: number
}

export type RunStatus = 'ok' | 'error' | 'skipped'

export interface AutomationStep {
  type: ActionType
  ok: boolean
  detail: string
}

export interface AutomationRun {
  id: string
  ruleId: string
  ruleName: string
  source: 'rule' | 'manual' | 'plugin-rule' | 'plugin-command'
  trigger: string
  startedAt: number
  durationMs: number
  status: RunStatus
  detail: string
  steps: AutomationStep[]
}

export interface BusRecord {
  name: string
  payload: unknown
  ts: number
}

/** Describes the bus events available as triggers (for the editor UI). */
export const EVENT_CATALOG: Record<string, { label: string; fields: string[]; url?: boolean }> = {
  APP_STARTED: { label: 'SPECTER started', fields: [] },
  TAB_CREATED: { label: 'Tab created', fields: ['url', 'workspaceId'], url: true },
  TAB_CLOSED: { label: 'Tab closed', fields: ['url', 'workspaceId'], url: true },
  TAB_CHANGED: { label: 'Tab changed', fields: ['url', 'title', 'workspaceId'], url: true },
  PAGE_LOADED: { label: 'Page loaded', fields: ['url', 'title'], url: true },
  WORKSPACE_CHANGED: { label: 'Workspace changed', fields: ['workspaceId', 'name'] },
  DOWNLOAD_STARTED: { label: 'Download started', fields: ['id', 'filename'] },
  DOWNLOAD_FINISHED: { label: 'Download finished', fields: ['id', 'filename', 'state'] },
  ALERT_TRIGGERED: { label: 'Alert triggered', fields: ['alertId', 'message'] },
  SYSTEM_MODE_CHANGED: { label: 'Performance mode changed', fields: ['mode'] },
  PROJECT_OPENED: { label: 'Project opened', fields: ['projectId', 'path'] },
  AI_STARTED: { label: 'AI request started', fields: ['model'] },
  AI_FINISHED: { label: 'AI request finished', fields: ['model', 'ok'] },
  MARKET_UPDATED: { label: 'Market data updated', fields: ['symbols'] },
  SETTINGS_CHANGED: { label: 'Setting changed', fields: ['key'] }
}

// ---------------------------------------------------------------- execution in a window

export type ExecRequest =
  | { type: 'command'; command: string; args?: Record<string, unknown> }
  | { type: 'openUrl'; url: string; background?: boolean }
  | { type: 'workspace'; workspace: string; create?: boolean }
  | { type: 'sidePanel'; panel: string; popout?: boolean }
  | { type: 'toast'; title: string; body?: string }

export interface ExecMessage {
  token: string
  req: ExecRequest
}

// ---------------------------------------------------------------- plugins

export const PLUGIN_PERMISSIONS = ['tabs', 'notifications', 'workspaces', 'ui', 'commands', 'system', 'settings', 'events'] as const
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

export const PERMISSION_LABELS: Record<PluginPermission, string> = {
  tabs: 'Open web pages in tabs or windows',
  notifications: 'Show notifications',
  workspaces: 'Open and switch workspaces',
  ui: 'Open SPECTER side panels',
  commands: 'Run SPECTER commands (non-destructive only)',
  system: 'Change the performance mode',
  settings: 'Toggle a small set of feature settings',
  events: 'React to SPECTER events automatically'
}

/** Which permission each action type requires. */
export const ACTION_PERMISSION: Record<ActionType, PluginPermission | null> = {
  openUrl: 'tabs',
  notify: 'notifications',
  workspace: 'workspaces',
  sidePanel: 'ui',
  command: 'commands',
  performanceMode: 'system',
  setting: 'settings',
  wait: null
}

export interface PluginSettingDef {
  key: string
  title: string
  type: 'string' | 'boolean' | 'number'
  default: string | boolean | number
  description?: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  permissions: PluginPermission[]
  commands: { id: string; title: string; description?: string; actions: AutomationAction[] }[]
  events: { trigger: AutomationTrigger; conditions?: AutomationCondition[]; actions: AutomationAction[] }[]
  settings: PluginSettingDef[]
  ui?: { quickLinks?: { title: string; url: string }[]; sidePanelUrl?: string }
}

export interface PluginInfo {
  id: string
  folder: string
  path: string
  enabled: boolean
  manifest: PluginManifest | null
  errors: string[]
  settings: Record<string, string | boolean | number>
  example: boolean
}

// ---------------------------------------------------------------- widgets & cockpit

export type WidgetSize = 's' | 'm' | 'l'

export interface WidgetItem {
  key: string
  widget: string
  size: WidgetSize
}

export interface DashboardLayout {
  items: WidgetItem[]
}

export type CockpitPanelKind = 'widget' | 'panel' | 'web'

export interface CockpitPanel {
  key: string
  kind: CockpitPanelKind
  /** Widget id, side panel id or URL. */
  ref: string
  title?: string
  colSpan: number
  rowSpan: number
}

export interface CockpitLayout {
  id: string
  name: string
  columns: number
  rows: number
  panels: CockpitPanel[]
  preset?: string
  updatedAt: number
}

export interface TaskItem {
  id: string
  text: string
  done: boolean
  createdAt: number
}

// ---------------------------------------------------------------- IPC contract

declare module '../ipc' {
  interface IpcContract {
    'automation:list': () => AutomationRule[]
    'automation:save': (rule: AutomationRuleInput) => AutomationRule
    'automation:delete': (id: string) => void
    'automation:setEnabled': (id: string, enabled: boolean) => void
    'automation:runNow': (id: string) => AutomationRun
    'automation:runs': (limit?: number) => AutomationRun[]
    'automation:clearRuns': () => void
    'automation:events': () => string[]
    'automation:ready': () => void
    'automation:ack': (token: string, ok: boolean, detail?: string) => void
    'automation:testActions': (actions: AutomationAction[]) => AutomationRun

    'plugins:list': () => PluginInfo[]
    'plugins:reload': () => PluginInfo[]
    'plugins:setEnabled': (id: string, enabled: boolean) => PluginInfo[]
    'plugins:setSetting': (id: string, key: string, value: string | boolean | number) => void
    'plugins:runCommand': (id: string, commandId: string) => AutomationRun
    'plugins:openFolder': () => string

    'widgets:get': (key: string) => unknown
    'widgets:set': (key: string, value: unknown) => void
  }
  interface IpcEvents {
    'automation:exec': ExecMessage
    'automation:changed': { rules?: boolean; runs?: boolean }
    'plugins:changed': { ids: string[] }
    'widgets:changed': { key: string }
  }
}
