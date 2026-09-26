// Tab state reported by each SPECTER window's renderer (the renderer owns tabs;
// main only knows webContents). Keyed by the reporting window's webContents id.
import { webContents } from 'electron'
import type { TabReport } from '@shared/modules/control'

const byWindow = new Map<number, TabReport[]>()
const watched = new Set<number>()
const listeners = new Set<() => void>()

export function setWindowTabs(senderId: number, tabs: TabReport[]): void {
  byWindow.set(senderId, Array.isArray(tabs) ? tabs.slice(0, 2000) : [])
  if (!watched.has(senderId)) {
    watched.add(senderId)
    webContents.fromId(senderId)?.once('destroyed', () => {
      watched.delete(senderId)
      byWindow.delete(senderId)
      listeners.forEach((l) => l())
    })
  }
  listeners.forEach((l) => l())
}

export function allTabs(): TabReport[] {
  return [...byWindow.values()].flat()
}

export function ownerOf(tabId: string): number | null {
  for (const [sender, tabs] of byWindow) if (tabs.some((t) => t.tabId === tabId)) return sender
  return null
}

export function onTabsChanged(fn: () => void): void {
  listeners.add(fn)
}
