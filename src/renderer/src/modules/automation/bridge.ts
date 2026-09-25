// Executes automation requests sent by the main process in this window and
// keeps plugin commands registered as SPECTER commands.
import { ExternalLink, Link2, Puzzle } from 'lucide-react'
import type { ExecRequest, PluginInfo } from '@shared/modules/automation'
import { getCommand, registerCommand } from '../../lib/commands'
import { invoke, on } from '../../lib/ipc'
import { sidePanels } from '../../lib/registry'
import { createWorkspaceAndSwitch, newTab, refreshWorkspaceList, switchWorkspace, useBrowser } from '../../stores/browser'
import { openSidePanel, toast } from '../../stores/ui'
import { errorText } from './util'

const isPopout = () => !!new URLSearchParams(location.hash.slice(1)).get('panel')

/** Opens or switches to a workspace by id or (case-insensitive) name. */
export async function openWorkspace(nameOrId: string, create = false): Promise<string> {
  const key = String(nameOrId ?? '').trim()
  if (!key) throw new Error('No workspace given')
  await refreshWorkspaceList().catch(() => undefined)
  const list = useBrowser.getState().workspaces
  const w = list.find((x) => x.id === key) ?? list.find((x) => x.name.toLowerCase() === key.toLowerCase())
  if (!w) {
    if (!create) throw new Error(`No workspace named “${key}”`)
    await createWorkspaceAndSwitch(key)
    return `Created and opened workspace “${key}”`
  }
  await switchWorkspace(w.id)
  return `Switched to workspace “${w.name}”`
}

async function execute(req: ExecRequest): Promise<string> {
  switch (req.type) {
    case 'command': {
      const cmd = getCommand(req.command)
      if (!cmd) throw new Error(`Unknown command “${req.command}” (is its module enabled?)`)
      if (cmd.permissions?.some((p) => p === 'execute' || p === 'filesystem')) throw new Error(`“${cmd.title}” needs execute/filesystem access and can't run from automations`)
      if (cmd.when && !cmd.when()) throw new Error(`“${cmd.title}” is not available right now`)
      await cmd.run(req.args)
      return `Ran “${cmd.title}”`
    }
    case 'openUrl':
      newTab(req.url, { background: req.background })
      return `Opened ${req.url}`
    case 'workspace':
      return openWorkspace(req.workspace, req.create)
    case 'sidePanel': {
      const def = sidePanels.get(req.panel)
      if (!def || (def.enabled && !def.enabled())) throw new Error(`Side panel “${req.panel}” is not available (module not installed or disabled)`)
      if (req.popout) {
        if (!def.popout) throw new Error(`“${def.title}” can't be popped out`)
        await invoke('window:popout', def.id, { alwaysOnTop: false })
        return `Popped out ${def.title}`
      }
      openSidePanel(def.id)
      return `Opened ${def.title} panel`
    }
    case 'toast':
      toast({ kind: 'info', title: req.title, body: req.body })
      return 'Shown'
  }
}

let pluginDisposers: (() => void)[] = []

export async function syncPluginCommands(): Promise<PluginInfo[]> {
  let list: PluginInfo[] = []
  try {
    list = await invoke('plugins:list')
  } catch {
    return []
  }
  pluginDisposers.forEach((d) => d())
  pluginDisposers = []
  for (const p of list) {
    const m = p.manifest
    if (!p.enabled || !m) continue
    for (const c of m.commands) {
      pluginDisposers.push(
        registerCommand({
          id: `plugin.${p.id}.${c.id}`,
          title: c.title,
          category: 'Tools',
          icon: Puzzle,
          description: c.description ?? `Plugin · ${m.name}`,
          keywords: ['plugin', p.id, m.name],
          run: async () => {
            try {
              const r = await invoke('plugins:runCommand', p.id, c.id)
              if (r.status !== 'ok') toast({ kind: r.status === 'skipped' ? 'warn' : 'error', title: c.title, body: r.detail })
            } catch (err) {
              toast({ kind: 'error', title: c.title, body: errorText(err) })
            }
          }
        })
      )
    }
    ;(m.ui?.quickLinks ?? []).forEach((l, i) =>
      pluginDisposers.push(
        registerCommand({ id: `plugin.${p.id}.link${i}`, title: `${m.name}: ${l.title}`, category: 'Tools', icon: Link2, keywords: ['plugin', 'link', p.id], description: l.url, run: () => newTab(l.url) })
      )
    )
    if (m.ui?.sidePanelUrl) {
      const url = m.ui.sidePanelUrl
      pluginDisposers.push(registerCommand({ id: `plugin.${p.id}.panel`, title: `${m.name}: open panel page`, category: 'Tools', icon: ExternalLink, keywords: ['plugin', p.id], description: url, run: () => newTab(url) }))
    }
  }
  return list
}

export function startBridge(): void {
  on('automation:exec', async ({ token, req }) => {
    try {
      // Automations can arrive while the window is still booting.
      if (!useBrowser.getState().ready) await new Promise<void>((r) => {
        const off = useBrowser.subscribe((s) => s.ready && (off(), r()))
      })
      const detail = await execute(req)
      invoke('automation:ack', token, true, detail).catch(() => undefined)
    } catch (err) {
      invoke('automation:ack', token, false, errorText(err)).catch(() => undefined)
    }
  })
  on('plugins:changed', () => void syncPluginCommands())
  syncPluginCommands()

  if (isPopout()) return
  const announce = () => invoke('automation:ready').catch(() => undefined)
  if (useBrowser.getState().ready) announce()
  else {
    const off = useBrowser.subscribe((s) => {
      if (s.ready) {
        off()
        announce()
      }
    })
  }
}
