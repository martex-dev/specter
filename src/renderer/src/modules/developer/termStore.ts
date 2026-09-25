// Renderer-side terminal state. Sessions live in the main process; this keeps
// a parsed ANSI model per session (fed by `terminal:data` events) so views can
// mount/unmount (side panel, page, popout) without losing scrollback.
import { create } from 'zustand'
import type { ShellId, TerminalSession } from '@shared/modules/developer'
import { invoke, on } from '../../lib/ipc'
import { toast } from '../../stores/ui'
import { AnsiTerminal } from './ansi'
import { errMsg } from './store'

interface TermState {
  sessions: TerminalSession[]
  activeId: string | null
  loaded: boolean
}

export const useTerm = create<TermState>(() => ({ sessions: [], activeId: null, loaded: false }))

interface Model {
  term: AnsiTerminal
  seq: number
  ready: boolean
  queued: { data: string; seq: number }[]
  listeners: Set<() => void>
}

const models = new Map<string, Model>()
let subscribed = false

function notify(m: Model): void {
  m.listeners.forEach((l) => l())
}

export function ensureTerminalData(): void {
  if (subscribed) return
  subscribed = true
  invoke('terminal:list')
    .then((sessions) => {
      const cur = useTerm.getState().activeId
      useTerm.setState({ sessions, loaded: true, activeId: cur && sessions.some((s) => s.id === cur) ? cur : (sessions[sessions.length - 1]?.id ?? null) })
    })
    .catch(() => useTerm.setState({ loaded: true }))
  on('terminal:data', ({ id, data, seq }) => {
    const m = models.get(id)
    if (!m) return
    if (!m.ready) {
      m.queued.push({ data, seq })
      return
    }
    if (seq <= m.seq) return
    m.seq = seq
    m.term.write(data)
    notify(m)
  })
  on('terminal:cleared', ({ id, seq }) => {
    const m = models.get(id)
    if (!m) return
    m.term.clear()
    m.seq = seq
    m.queued = m.queued.filter((q) => q.seq > seq)
    notify(m)
  })
  on('terminal:state', (s) => {
    useTerm.setState((st) => {
      const i = st.sessions.findIndex((x) => x.id === s.id)
      const sessions = i < 0 ? [...st.sessions, s] : st.sessions.map((x) => (x.id === s.id ? s : x))
      return { sessions, activeId: st.activeId ?? s.id }
    })
  })
  on('terminal:closed', ({ id }) => {
    models.delete(id)
    useTerm.setState((st) => {
      const sessions = st.sessions.filter((x) => x.id !== id)
      return { sessions, activeId: st.activeId === id ? (sessions[sessions.length - 1]?.id ?? null) : st.activeId }
    })
  })
}

/** Returns the parsed model for a session, loading its scrollback on first use. */
export function modelFor(id: string): Model {
  let m = models.get(id)
  if (m) return m
  const model: Model = { term: new AnsiTerminal(6000), seq: 0, ready: false, queued: [], listeners: new Set() }
  m = model
  models.set(id, model)
  invoke('terminal:buffer', id)
    .then(({ data, seq }) => {
      model.term.clear()
      model.term.write(data)
      model.seq = seq
      for (const q of model.queued) {
        if (q.seq > model.seq) {
          model.term.write(q.data)
          model.seq = q.seq
        }
      }
      model.queued = []
      model.ready = true
      notify(model)
    })
    .catch(() => {
      model.ready = true
      notify(model)
    })
  return model
}

export async function createTerminal(projectId: string | null, shell?: ShellId): Promise<string | null> {
  ensureTerminalData()
  try {
    const s = await invoke('terminal:create', { projectId, shell })
    useTerm.setState((st) => ({ sessions: st.sessions.some((x) => x.id === s.id) ? st.sessions : [...st.sessions, s], activeId: s.id }))
    modelFor(s.id)
    return s.id
  } catch (err) {
    toast({ kind: 'error', title: 'Could not start terminal', body: errMsg(err) })
    return null
  }
}

// History (shared across sessions, persisted locally in this profile's UI storage).
const HISTORY_KEY = 'specter.dev.termHistory'
let history: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-300) : []
  } catch {
    return []
  }
})()

export function getHistory(): string[] {
  return history
}

function pushHistory(line: string): void {
  const t = line.trim()
  if (!t) return
  history = [...history.filter((h) => h !== t), t].slice(-300)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    /* ignore */
  }
}

/** Sends a line the user typed (or explicitly confirmed) to the session. */
export async function submitLine(id: string, line: string): Promise<void> {
  const s = useTerm.getState().sessions.find((x) => x.id === id)
  if (!s?.running && /^\s*(clear|cls|clear-host)\s*$/i.test(line)) {
    pushHistory(line)
    await invoke('terminal:clear', id)
    return
  }
  if (!s?.running) pushHistory(line)
  try {
    await invoke('terminal:input', id, line)
  } catch (err) {
    toast({ kind: 'error', title: 'Terminal', body: errMsg(err) })
  }
}
