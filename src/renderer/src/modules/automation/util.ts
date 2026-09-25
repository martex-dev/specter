// Renderer helpers shared by the automation, plugin, widget and cockpit UIs.
import { EVENT_CATALOG, type AutomationAction, type AutomationRuleInput, type AutomationTrigger } from '@shared/modules/automation'
import { internalRoute } from '@shared/url'
import { activateTab, activeWs, loadUrl, newTab } from '../../stores/browser'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function describeTrigger(t: AutomationTrigger): string {
  if (t.type === 'event') return (EVENT_CATALOG[t.event]?.label ?? t.event) + (t.match ? ` · ${t.match}` : '')
  if (t.type === 'interval') return `Every ${t.minutes} min`
  return `Daily at ${t.time}` + (t.days?.length ? ` · ${t.days.map((d) => WEEKDAYS[d]).join(' ')}` : '')
}

export function describeAction(a: AutomationAction): string {
  switch (a.type) {
    case 'command':
      return `Run ${a.command}`
    case 'openUrl':
      return `Open ${a.url.replace(/^https?:\/\//, '')}${a.newWindow ? ' (new window)' : a.background ? ' (background)' : ''}`
    case 'workspace':
      return `Workspace “${a.workspace}”`
    case 'notify':
      return `Notify “${a.title}”`
    case 'performanceMode':
      return `Mode → ${a.mode}`
    case 'setting':
      return `${a.key} = ${a.value ? 'on' : 'off'}`
    case 'sidePanel':
      return `${a.popout ? 'Pop out' : 'Open'} panel ${a.panel}`
    case 'wait':
      return `Wait ${a.seconds}s`
  }
}

// Mirrors the main-process deny list (main validates again).
const DENIED = [/^app\.quit$/, /^browser\.closeTab$/, /^tabs\.close/, /^internal\./, /^automation\.(?!openWorkspace$)/, /^plugin\./, /^privacy\.clear/, /delete/i, /remove/i, /^terminal\./, /^developer\.(run|exec|shell)/i]
export function commandAllowed(id: string): boolean {
  return !DENIED.some((r) => r.test(id))
}

/** Opens (or focuses) an internal page in the active workspace. */
export function openPage(url: string): void {
  const target = internalRoute(url)
  const ws = activeWs()
  const existing = ws?.tabs.find((t) => t.url.startsWith('specter://') && internalRoute(t.url).page === target.page)
  if (existing) {
    activateTab(existing.id)
    if (existing.url !== url && (url.includes('?') || target.sub !== internalRoute(existing.url).sub)) loadUrl(existing.id, url)
  } else newTab(url)
}

export interface Template {
  id: string
  title: string
  description: string
  rule: AutomationRuleInput
}

export const TEMPLATES: Template[] = [
  {
    id: 'startup-dev',
    title: 'On startup → open Development workspace',
    description: 'Switches the window to your Development workspace every time SPECTER starts.',
    rule: { name: 'Startup: Development workspace', enabled: true, trigger: { type: 'event', event: 'APP_STARTED' }, conditions: [], actions: [{ type: 'workspace', workspace: 'Development' }] }
  },
  {
    id: 'alert-notify',
    title: 'When a market alert triggers → show notification',
    description: 'Surfaces alert messages in the notification center and as a toast.',
    rule: {
      name: 'Market alert notification',
      enabled: true,
      trigger: { type: 'event', event: 'ALERT_TRIGGERED' },
      conditions: [],
      actions: [{ type: 'notify', title: 'Alert triggered', body: '{{message}}' }]
    }
  },
  {
    id: 'ml-pause-research',
    title: 'When ML mode activates → pause research indexing',
    description: 'Turns off research.indexPages while ML mode is on to free CPU for training.',
    rule: {
      name: 'ML mode: pause research indexing',
      enabled: true,
      trigger: { type: 'event', event: 'SYSTEM_MODE_CHANGED' },
      conditions: [{ field: 'mode', op: 'equals', value: 'ml' }],
      actions: [
        { type: 'setting', key: 'research.indexPages', value: false },
        { type: 'notify', title: 'Research indexing paused', body: 'ML mode is active.' }
      ]
    }
  },
  {
    id: 'project-panels',
    title: 'When a project opens → open Git + terminal panels',
    description: 'Opens the Git side panel and pops the terminal out into its own window (developer module panels).',
    rule: {
      name: 'Project opened: Git + terminal',
      enabled: true,
      trigger: { type: 'event', event: 'PROJECT_OPENED' },
      conditions: [],
      actions: [
        { type: 'sidePanel', panel: 'git' },
        { type: 'sidePanel', panel: 'terminal', popout: true }
      ]
    }
  },
  {
    id: 'download-notify',
    title: 'When a download finishes → notify',
    description: 'A notification with the file name whenever a download completes.',
    rule: {
      name: 'Download finished',
      enabled: true,
      trigger: { type: 'event', event: 'DOWNLOAD_FINISHED' },
      conditions: [{ field: 'state', op: 'equals', value: 'completed' }],
      actions: [{ type: 'notify', title: 'Download complete', body: '{{filename}}' }]
    }
  },
  {
    id: 'youtube-mode',
    title: 'When YouTube loads → open media controls',
    description: 'Opens the media controls panel whenever a YouTube page finishes loading.',
    rule: {
      name: 'YouTube: media panel',
      enabled: true,
      trigger: { type: 'event', event: 'PAGE_LOADED', match: 'youtube.com' },
      conditions: [],
      actions: [{ type: 'sidePanel', panel: 'media' }]
    }
  },
  {
    id: 'daily-standup',
    title: 'Weekdays at 09:00 → open Development + GitHub',
    description: 'A morning routine on a schedule: switch workspace and open your pull requests.',
    rule: {
      name: 'Morning routine',
      enabled: true,
      trigger: { type: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] },
      conditions: [],
      actions: [
        { type: 'workspace', workspace: 'Development' },
        { type: 'openUrl', url: 'https://github.com/pulls' }
      ]
    }
  },
  {
    id: 'tab-notify',
    title: 'When a tab is created → notification',
    description: 'A simple rule for trying out automations and the run log.',
    rule: { name: 'Tab created notification', enabled: true, trigger: { type: 'event', event: 'TAB_CREATED' }, conditions: [], actions: [{ type: 'notify', title: 'Tab created', body: '{{url}}' }] }
  }
]

export function emptyRule(): AutomationRuleInput {
  return { name: '', enabled: true, trigger: { type: 'event', event: 'TAB_CREATED' }, conditions: [], actions: [{ type: 'notify', title: 'Automation', body: '{{url}}' }] }
}

export function errorText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
