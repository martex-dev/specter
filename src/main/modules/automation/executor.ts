// Executes automation actions. Main-process actions (notifications, settings,
// performance mode, waits) run here; window actions (commands, tabs,
// workspaces, panels) are sent to the last-focused SPECTER window, which
// acknowledges each one so the run log records the real outcome.
import { BrowserWindow, webContents } from 'electron'
import type { AutomationAction, AutomationStep, ExecRequest } from '@shared/modules/automation'
import { SAFE_SETTING_KEYS } from '@shared/modules/automation'
import { bus } from '../../bus'
import { uid } from '../../db'
import { sendTo } from '../../ipc'
import { createLogger } from '../../logger'
import { notify } from '../../services/notifications'
import { setSetting } from '../../services/settings'
import { chromeContexts, createBrowserWindow, ctxForSender, lastFocusedCtx } from '../../windows'
import { commandAllowed, interpolate, safeUrl } from './engine'

const log = createLogger('automation')

const ready = new Set<number>()
const watched = new Set<number>()
const readyWaiters = new Map<number, (() => void)[]>()
const acks = new Map<string, (r: { ok: boolean; detail: string }) => void>()

/** Called by a window's renderer once it can execute automation requests. */
export function markWindowReady(wcId: number): void {
  ready.add(wcId)
  readyWaiters.get(wcId)?.forEach((f) => f())
  readyWaiters.delete(wcId)
  if (watched.has(wcId)) return
  const wc = webContents.fromId(wcId)
  if (!wc) return
  watched.add(wcId)
  // A crashed (and then reloaded) renderer must announce readiness again.
  // Note: 'did-start-loading' can't be used — it also fires for hosted <webview> guests.
  wc.on('render-process-gone', () => ready.delete(wcId))
  wc.once('destroyed', () => {
    ready.delete(wcId)
    watched.delete(wcId)
  })
}

export function ackExec(token: string, ok: boolean, detail?: string): void {
  const f = acks.get(token)
  if (f) {
    acks.delete(token)
    f({ ok, detail: detail ?? (ok ? 'Done' : 'Failed') })
  }
}

function alive(wcId: number): boolean {
  const wc = webContents.fromId(wcId)
  return !!wc && !wc.isDestroyed() && !!ctxForSender(wcId) && !ctxForSender(wcId)?.popoutPanel
}

async function waitFor<T>(fn: () => T | null | undefined, ms: number): Promise<T | null> {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) return null
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** Picks the window to act in and waits (bounded) until its UI is ready. */
async function targetWindow(preferred?: number): Promise<number | null> {
  const pick = () => {
    if (preferred !== undefined && alive(preferred)) return preferred
    const c = lastFocusedCtx()
    return c && !c.popoutPanel ? c.win.webContents.id : null
  }
  const id = await waitFor(pick, 20_000)
  if (id === null) return null
  if (ready.has(id)) return id
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 20_000)
    const list = readyWaiters.get(id) ?? []
    list.push(() => (clearTimeout(t), resolve(true)))
    readyWaiters.set(id, list)
  })
  return ok ? id : null
}

export async function execInWindow(req: ExecRequest, preferred?: number, timeoutMs = 15_000): Promise<{ ok: boolean; detail: string }> {
  const wcId = await targetWindow(preferred)
  if (wcId === null) return { ok: false, detail: 'No SPECTER window is open or ready' }
  const token = uid('x_')
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      acks.delete(token)
      resolve({ ok: false, detail: 'The window did not respond in time' })
    }, timeoutMs)
    acks.set(token, (r) => {
      clearTimeout(t)
      resolve(r)
    })
    sendTo(wcId, 'automation:exec', { token, req })
  })
}

export interface ExecContext {
  /** Values available to {{placeholders}}: event payload fields, `event`, `settings.*`. */
  vars: Record<string, unknown>
  targetWcId?: number
}

function focusedChrome(): boolean {
  const w = BrowserWindow.getFocusedWindow()
  return !!w && chromeContexts().some((c) => c.win === w)
}

async function runOne(a: AutomationAction, ctx: ExecContext): Promise<AutomationStep> {
  const t = (s: string) => interpolate(s, ctx.vars)
  switch (a.type) {
    case 'notify': {
      const title = t(a.title).slice(0, 200)
      const body = a.body ? t(a.body).slice(0, 1000) : undefined
      notify({ category: 'system', title, body })
      // In-app toast when SPECTER is focused (desktop toasts cover the unfocused case).
      if (focusedChrome()) execInWindow({ type: 'toast', title, body }, ctx.targetWcId, 3000).catch(() => undefined)
      return { type: a.type, ok: true, detail: `Notified “${title}”` }
    }
    case 'performanceMode':
      setSetting('performance.mode', a.mode)
      bus.emit('SYSTEM_MODE_CHANGED', { mode: a.mode })
      return { type: a.type, ok: true, detail: `Performance mode → ${a.mode}` }
    case 'setting':
      if (!SAFE_SETTING_KEYS.includes(a.key)) return { type: a.type, ok: false, detail: `Setting ${a.key} is not allowed` }
      setSetting(a.key, a.value as never)
      return { type: a.type, ok: true, detail: `${a.key} = ${a.value}` }
    case 'wait': {
      const s = Math.min(300, Math.max(0, a.seconds))
      await new Promise((r) => setTimeout(r, s * 1000))
      return { type: a.type, ok: true, detail: `Waited ${s} s` }
    }
    case 'openUrl': {
      const url = t(a.url).trim()
      if (!safeUrl(url)) return { type: a.type, ok: false, detail: `Refused to open “${url.slice(0, 120)}” (only http(s) and specter:// URLs)` }
      if (a.newWindow) {
        createBrowserWindow({ urls: [url] })
        return { type: a.type, ok: true, detail: `Opened ${url} in a new window` }
      }
      const r = await execInWindow({ type: 'openUrl', url, background: a.background }, ctx.targetWcId)
      return { type: a.type, ok: r.ok, detail: r.ok ? `Opened ${url}` : r.detail }
    }
    case 'command': {
      if (!commandAllowed(a.command)) return { type: a.type, ok: false, detail: `Command ${a.command} is not allowed in automations` }
      const args = a.args ? (deepInterpolate(a.args, t) as Record<string, unknown>) : undefined
      const r = await execInWindow({ type: 'command', command: a.command, args }, ctx.targetWcId)
      return { type: a.type, ok: r.ok, detail: r.detail }
    }
    case 'workspace': {
      const r = await execInWindow({ type: 'workspace', workspace: t(a.workspace), create: a.create }, ctx.targetWcId)
      return { type: a.type, ok: r.ok, detail: r.detail }
    }
    case 'sidePanel': {
      const r = await execInWindow({ type: 'sidePanel', panel: a.panel, popout: a.popout }, ctx.targetWcId)
      return { type: a.type, ok: r.ok, detail: r.detail }
    }
  }
}

function deepInterpolate(v: unknown, t: (s: string) => string): unknown {
  if (typeof v === 'string') return t(v)
  if (Array.isArray(v)) return v.map((x) => deepInterpolate(x, t))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepInterpolate(x, t)]))
  return v
}

/** Runs actions in order; stops at the first failure. */
export async function executeActions(actions: AutomationAction[], ctx: ExecContext): Promise<{ ok: boolean; steps: AutomationStep[]; detail: string }> {
  const steps: AutomationStep[] = []
  for (const a of actions) {
    let step: AutomationStep
    try {
      step = await runOne(a, ctx)
    } catch (err) {
      log.warn('automation action failed', { type: a.type, err: String(err) })
      step = { type: a.type, ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
    steps.push(step)
    if (!step.ok) {
      const skipped = actions.length - steps.length
      return { ok: false, steps, detail: step.detail + (skipped ? ` · ${skipped} later action(s) skipped` : '') }
    }
  }
  return { ok: true, steps, detail: steps.map((s) => s.detail).join(' · ') || 'No actions' }
}
