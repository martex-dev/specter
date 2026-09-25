// Declarative plugin manifest validation (strict schema, no code execution).
import { ACTION_PERMISSION, PLUGIN_PERMISSIONS, type AutomationAction, type PluginManifest, type PluginPermission } from '@shared/modules/automation'
import { validateAction, validateCondition, validateTrigger } from './engine'

export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,40}$/
const CMD_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,40}$/
const SETTING_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] }

function onlyKeys(obj: Record<string, unknown>, allowed: string[], where: string, errors: string[]): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k))
  if (extra.length) errors.push(`${where}: unknown field(s) ${extra.join(', ')}`)
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max

/**
 * Validates a parsed manifest.json. `folder` (when given) must equal the id.
 * Every action must be covered by a declared permission; event handlers need
 * the "events" permission.
 */
export function validateManifest(raw: unknown, folder?: string, knownEvents?: string[]): ManifestResult {
  const errors: string[] = []
  if (!isObj(raw)) return { ok: false, errors: ['manifest.json must contain a JSON object'] }
  onlyKeys(raw, ['id', 'name', 'version', 'description', 'author', 'permissions', 'commands', 'events', 'settings', 'ui', '$schema'], 'manifest', errors)

  if (!isStr(raw.id, 42) || !PLUGIN_ID.test(raw.id)) errors.push('id must be 2–41 lowercase letters, digits or dashes')
  else if (folder !== undefined && raw.id !== folder) errors.push(`id "${raw.id}" must match its folder name "${folder}"`)
  if (!isStr(raw.name, 60)) errors.push('name is required (max 60 characters)')
  if (typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(raw.version)) errors.push('version must be semver, e.g. 1.0.0')
  if (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 500)) errors.push('description must be text (max 500)')
  if (raw.author !== undefined && (typeof raw.author !== 'string' || raw.author.length > 100)) errors.push('author must be text (max 100)')

  const perms = raw.permissions ?? []
  if (!Array.isArray(perms) || perms.some((p) => !PLUGIN_PERMISSIONS.includes(p as PluginPermission))) errors.push(`permissions must be a list of: ${PLUGIN_PERMISSIONS.join(', ')}`)
  const granted = new Set(Array.isArray(perms) ? (perms as PluginPermission[]) : [])

  const checkActions = (actions: unknown, where: string) => {
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > 20) {
      errors.push(`${where}: actions must be a list of 1–20 actions`)
      return
    }
    actions.forEach((a, i) => {
      const e = validateAction(a)
      if (e) return errors.push(`${where}.actions[${i}]: ${e}`)
      const need = ACTION_PERMISSION[(a as AutomationAction).type]
      if (need && !granted.has(need)) errors.push(`${where}.actions[${i}]: "${(a as AutomationAction).type}" requires the "${need}" permission`)
    })
  }

  const commands = raw.commands ?? []
  if (!Array.isArray(commands) || commands.length > 50) errors.push('commands must be a list (max 50)')
  else {
    const seen = new Set<string>()
    commands.forEach((c, i) => {
      const where = `commands[${i}]`
      if (!isObj(c)) return errors.push(`${where} must be an object`)
      onlyKeys(c, ['id', 'title', 'description', 'actions'], where, errors)
      if (!isStr(c.id, 41) || !CMD_ID.test(c.id)) errors.push(`${where}.id must be letters, digits or dashes`)
      else if (seen.has(c.id)) errors.push(`${where}.id "${c.id}" is duplicated`)
      else seen.add(c.id)
      if (!isStr(c.title, 80)) errors.push(`${where}.title is required`)
      if (c.description !== undefined && (typeof c.description !== 'string' || c.description.length > 300)) errors.push(`${where}.description must be text`)
      checkActions(c.actions, where)
    })
  }

  const events = raw.events ?? []
  if (!Array.isArray(events) || events.length > 30) errors.push('events must be a list (max 30)')
  else {
    if (events.length && !granted.has('events')) errors.push('events require the "events" permission')
    events.forEach((ev, i) => {
      const where = `events[${i}]`
      if (!isObj(ev)) return errors.push(`${where} must be an object`)
      onlyKeys(ev, ['trigger', 'conditions', 'actions'], where, errors)
      const te = validateTrigger(ev.trigger, knownEvents)
      if (te) errors.push(`${where}.trigger: ${te}`)
      if (ev.conditions !== undefined) {
        if (!Array.isArray(ev.conditions) || ev.conditions.length > 10) errors.push(`${where}.conditions must be a list (max 10)`)
        else ev.conditions.forEach((c, j) => {
          const e = validateCondition(c)
          if (e) errors.push(`${where}.conditions[${j}]: ${e}`)
        })
      }
      checkActions(ev.actions, where)
    })
  }

  const settings = raw.settings ?? []
  if (!Array.isArray(settings) || settings.length > 30) errors.push('settings must be a list (max 30)')
  else settings.forEach((s, i) => {
    const where = `settings[${i}]`
    if (!isObj(s)) return errors.push(`${where} must be an object`)
    onlyKeys(s, ['key', 'title', 'type', 'default', 'description'], where, errors)
    if (!isStr(s.key, 41) || !SETTING_KEY.test(s.key)) errors.push(`${where}.key must be an identifier`)
    if (!isStr(s.title, 80)) errors.push(`${where}.title is required`)
    if (!['string', 'boolean', 'number'].includes(s.type as string)) errors.push(`${where}.type must be string, boolean or number`)
    else if (typeof s.default !== s.type) errors.push(`${where}.default must be a ${String(s.type)}`)
    else if (typeof s.default === 'string' && s.default.length > 500) errors.push(`${where}.default is too long`)
  })

  if (raw.ui !== undefined) {
    if (!isObj(raw.ui)) errors.push('ui must be an object')
    else {
      onlyKeys(raw.ui, ['quickLinks', 'sidePanelUrl'], 'ui', errors)
      const ql = raw.ui.quickLinks
      if (ql !== undefined) {
        if (!Array.isArray(ql) || ql.length > 30) errors.push('ui.quickLinks must be a list (max 30)')
        else ql.forEach((l, i) => {
          if (!isObj(l)) return errors.push(`ui.quickLinks[${i}] must be an object`)
          onlyKeys(l, ['title', 'url'], `ui.quickLinks[${i}]`, errors)
          if (!isStr(l.title, 60)) errors.push(`ui.quickLinks[${i}].title is required`)
          if (typeof l.url !== 'string' || !/^https:\/\/[^\s]+$/i.test(l.url) || l.url.length > 2048) errors.push(`ui.quickLinks[${i}].url must be an https:// URL`)
        })
        if (Array.isArray(ql) && ql.length && !granted.has('tabs')) errors.push('ui.quickLinks require the "tabs" permission')
      }
      const sp = raw.ui.sidePanelUrl
      if (sp !== undefined) {
        if (typeof sp !== 'string' || !/^https:\/\/[^\s]+$/i.test(sp) || sp.length > 2048) errors.push('ui.sidePanelUrl must be an https:// URL')
        else if (!granted.has('tabs')) errors.push('ui.sidePanelUrl requires the "tabs" permission')
      }
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    manifest: {
      id: raw.id as string,
      name: (raw.name as string).trim(),
      version: raw.version as string,
      description: raw.description as string | undefined,
      author: raw.author as string | undefined,
      permissions: [...granted],
      commands: commands as PluginManifest['commands'],
      events: events as PluginManifest['events'],
      settings: settings as PluginManifest['settings'],
      ui: raw.ui as PluginManifest['ui']
    }
  }
}

/** The bundled example plugin (written to <userData>/plugins on first run). */
export const EXAMPLE_PLUGIN: PluginManifest = {
  id: 'github-quick-links',
  name: 'GitHub quick links (example)',
  version: '1.0.0',
  description:
    'Example SPECTER plugin. Plugins are declarative JSON manifests — they cannot run code. This one adds GitHub commands, quick links and a notification when a GitHub page opens. Edit or delete this folder freely.',
  author: 'SPECTER',
  permissions: ['tabs', 'notifications', 'events'],
  commands: [
    {
      id: 'notifications',
      title: 'GitHub: open notifications',
      description: 'Opens github.com/notifications in a new tab.',
      actions: [{ type: 'openUrl', url: 'https://github.com/notifications' }]
    },
    {
      id: 'my-repos',
      title: 'GitHub: open my repositories',
      description: 'Opens the repositories of the user set in plugin settings.',
      actions: [
        { type: 'openUrl', url: 'https://github.com/{{settings.username}}?tab=repositories' },
        { type: 'notify', title: 'GitHub', body: 'Opened repositories for {{settings.username}}' }
      ]
    },
    {
      id: 'trending',
      title: 'GitHub: trending today',
      actions: [{ type: 'openUrl', url: 'https://github.com/trending?since=daily' }]
    }
  ],
  events: [
    {
      trigger: { type: 'event', event: 'PAGE_LOADED', match: 'https://github.com/*/pulls*' },
      actions: [{ type: 'notify', title: 'GitHub pull requests', body: 'Pull request list opened: {{url}}' }]
    }
  ],
  settings: [{ key: 'username', title: 'GitHub username', type: 'string', default: 'octocat', description: 'Used by "open my repositories".' }],
  ui: {
    quickLinks: [
      { title: 'GitHub', url: 'https://github.com' },
      { title: 'Pull requests', url: 'https://github.com/pulls' },
      { title: 'Issues', url: 'https://github.com/issues' },
      { title: 'GitHub status', url: 'https://www.githubstatus.com' }
    ],
    sidePanelUrl: 'https://github.com/notifications'
  }
}
