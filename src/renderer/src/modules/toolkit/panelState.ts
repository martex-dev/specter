// Active tab of the Tools side panel (tiny; shared by commands and the panel).

export type PanelTab = 'calc' | 'units' | 'timer' | 'stopwatch' | 'pomodoro' | 'todo' | 'calendar' | 'snippets'

export const PANEL_TABS: PanelTab[] = ['calc', 'units', 'timer', 'stopwatch', 'pomodoro', 'todo', 'calendar', 'snippets']

const KEY = 'specter.toolkit.panelTab'
let tab: PanelTab = read()
const listeners = new Set<() => void>()

function read(): PanelTab {
  try {
    const v = localStorage.getItem(KEY) as PanelTab | null
    return v && PANEL_TABS.includes(v) ? v : 'calc'
  } catch {
    return 'calc'
  }
}

export function getPanelTab(): PanelTab {
  return tab
}

export function setPanelTab(t: PanelTab): void {
  tab = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l())
}

export function subscribePanelTab(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
