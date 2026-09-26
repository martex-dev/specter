// Renderer state for the Control module: config (owned by main), live stats
// while the panel is open, and the sleep log.
import { create } from 'zustand'
import type { ControlConfig, ControlStats, DeepPartial, SleepLogEntry } from '@shared/modules/control'
import { invoke, on } from '../../lib/ipc'
import { toast } from '../../stores/ui'

export type ControlSection = 'limiters' | 'hot' | 'sound' | 'wallpaper'

interface ControlStore {
  config: ControlConfig | null
  stats: ControlStats | null
  log: SleepLogEntry[]
  section: ControlSection
  panelOpen: number
}

export const useControl = create<ControlStore>(() => ({ config: null, stats: null, log: [], section: 'limiters', panelOpen: 0 }))

let started = false

export function initControlStore(): void {
  if (started) return
  started = true
  invoke('control:getConfig')
    .then((config) => useControl.setState({ config }))
    .catch(() => undefined)
  on('control:config', (config) => useControl.setState({ config }))
  on('control:stats', (stats) => useControl.setState({ stats }))
  on('control:log', (e) => useControl.setState((s) => ({ log: [e, ...s.log.filter((x) => x.id !== e.id)].slice(0, 60) })))
}

export async function patchConfig(patch: DeepPartial<ControlConfig>): Promise<void> {
  try {
    const config = await invoke('control:setConfig', patch)
    useControl.setState({ config })
  } catch (err) {
    toast({ kind: 'error', title: 'Could not save Control settings', body: err instanceof Error ? err.message : String(err) })
  }
}

export function setSection(section: ControlSection): void {
  useControl.setState({ section })
}

/** Panel mounted: start live stats and load the log. */
export function panelMounted(): () => void {
  useControl.setState((s) => ({ panelOpen: s.panelOpen + 1 }))
  invoke('control:subscribe', true).catch(() => undefined)
  invoke('control:log')
    .then((log) => useControl.setState({ log }))
    .catch(() => undefined)
  return () => {
    useControl.setState((s) => ({ panelOpen: Math.max(0, s.panelOpen - 1) }))
    if (useControl.getState().panelOpen === 0) invoke('control:subscribe', false).catch(() => undefined)
  }
}
