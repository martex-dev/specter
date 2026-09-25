// Central typed event bus for the main process. Renderer windows can emit
// events through the 'bus:emit' IPC channel and receive them via 'bus:event'.
import { EventEmitter } from 'node:events'

export interface BusEvents {
  TAB_CREATED: { url: string; workspaceId?: string }
  TAB_CLOSED: { url: string; workspaceId?: string }
  TAB_CHANGED: { url: string; title: string; workspaceId?: string }
  WORKSPACE_CHANGED: { workspaceId: string; name: string }
  PAGE_LOADED: { url: string; title: string }
  DOWNLOAD_STARTED: { id: string; filename: string }
  DOWNLOAD_FINISHED: { id: string; filename: string; state: string }
  AI_STARTED: { model: string }
  AI_FINISHED: { model: string; ok: boolean }
  MARKET_UPDATED: { symbols: string[] }
  ALERT_TRIGGERED: { alertId: string; message: string }
  PROJECT_OPENED: { projectId: string; path: string }
  SYSTEM_MODE_CHANGED: { mode: string }
  APP_STARTED: Record<string, never>
  SETTINGS_CHANGED: { key: string }
}

export type BusEventName = keyof BusEvents

class TypedBus {
  private emitter = new EventEmitter()
  private history: { name: BusEventName; payload: unknown; ts: number }[] = []

  constructor() {
    this.emitter.setMaxListeners(100)
  }

  emit<K extends BusEventName>(name: K, payload: BusEvents[K]): void {
    this.history.push({ name, payload, ts: Date.now() })
    if (this.history.length > 300) this.history.shift()
    try {
      this.emitter.emit(name, payload)
      this.emitter.emit('*', name, payload)
    } catch (err) {
      console.error('[bus] listener error', name, err)
    }
  }

  on<K extends BusEventName>(name: K, fn: (payload: BusEvents[K]) => void): () => void {
    this.emitter.on(name, fn as (p: unknown) => void)
    return () => this.emitter.off(name, fn as (p: unknown) => void)
  }

  onAny(fn: (name: BusEventName, payload: unknown) => void): () => void {
    this.emitter.on('*', fn)
    return () => this.emitter.off('*', fn)
  }

  recent(): { name: BusEventName; payload: unknown; ts: number }[] {
    return [...this.history]
  }
}

export const bus = new TypedBus()

export const BUS_EVENT_NAMES: BusEventName[] = [
  'TAB_CREATED', 'TAB_CLOSED', 'TAB_CHANGED', 'WORKSPACE_CHANGED', 'PAGE_LOADED', 'DOWNLOAD_STARTED', 'DOWNLOAD_FINISHED',
  'AI_STARTED', 'AI_FINISHED', 'MARKET_UPDATED', 'ALERT_TRIGGERED', 'PROJECT_OPENED', 'SYSTEM_MODE_CHANGED', 'APP_STARTED', 'SETTINGS_CHANGED'
]
