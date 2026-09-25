// Central typed command registry. Every user-facing action is a command so it
// is reachable from the palette, keyboard shortcuts, menus and automations.
import type { LucideIcon } from 'lucide-react'
import { DEFAULT_KEYBINDINGS } from '@shared/keys'
import { toast } from '../stores/ui'

export type CommandCategory =
  | 'Browser'
  | 'Tabs'
  | 'Navigation'
  | 'Workspace'
  | 'Layout'
  | 'View'
  | 'Page'
  | 'Tools'
  | 'AI'
  | 'Research'
  | 'Knowledge'
  | 'Developer'
  | 'Markets'
  | 'Finance'
  | 'System'
  | 'Privacy'
  | 'Settings'
  | 'Help'

export interface Command {
  id: string
  title: string
  category: CommandCategory
  description?: string
  icon?: LucideIcon
  keywords?: string[]
  /** Hidden commands run via shortcuts/automation but don't appear in the palette. */
  hidden?: boolean
  /** Return false to hide/disable in current context. */
  when?: () => boolean
  /** Permissions the command needs (documentation / AI gating). */
  permissions?: ('network' | 'filesystem' | 'execute' | 'ai')[]
  run: (args?: any) => unknown | Promise<unknown>
}

const registry = new Map<string, Command>()
const listeners = new Set<() => void>()
let bindings: Record<string, string> = { ...DEFAULT_KEYBINDINGS }

export function registerCommand(cmd: Command): () => void {
  registry.set(cmd.id, cmd)
  listeners.forEach((l) => l())
  return () => {
    registry.delete(cmd.id)
    listeners.forEach((l) => l())
  }
}

export function registerCommands(cmds: Command[]): void {
  for (const c of cmds) registry.set(c.id, c)
  listeners.forEach((l) => l())
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id)
}

export function listCommands(includeHidden = false): Command[] {
  return [...registry.values()].filter((c) => (includeHidden || !c.hidden) && (!c.when || safeWhen(c)))
}

function safeWhen(c: Command): boolean {
  try {
    return c.when ? c.when() : true
  } catch {
    return false
  }
}

export async function runCommand(id: string, args?: unknown): Promise<unknown> {
  const cmd = registry.get(id)
  if (!cmd) {
    console.warn('[commands] unknown command', id)
    return undefined
  }
  if (cmd.when && !safeWhen(cmd)) return undefined
  try {
    return await cmd.run(args)
  } catch (err) {
    console.error('[commands] failed', id, err)
    toast({ kind: 'error', title: `${cmd.title} failed`, body: err instanceof Error ? err.message : String(err) })
    return undefined
  }
}

export function onCommandsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setBindings(b: Record<string, string>): void {
  bindings = b
}

export function shortcutFor(id: string): string | undefined {
  return bindings[id]
}
