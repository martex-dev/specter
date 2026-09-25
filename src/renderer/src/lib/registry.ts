// UI extension points used by feature modules.
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SidePanelDef {
  id: string
  title: string
  icon: LucideIcon
  order: number
  component: ComponentType<{ popout?: boolean }>
  /** Hide from the rail unless enabled by this predicate. */
  enabled?: () => boolean
  /** Can be popped out into a floating window. */
  popout?: boolean
  shortcutCommand?: string
}

export interface HudItemDef {
  id: string
  order: number
  component: ComponentType
  enabled?: () => boolean
}

export interface StatusItemDef {
  id: string
  side: 'left' | 'right'
  order: number
  component: ComponentType
}

export interface SettingsSectionDef {
  id: string
  title: string
  icon: LucideIcon
  order: number
  component: ComponentType
}

export interface NewTabWidgetDef {
  id: string
  title: string
  order: number
  component: ComponentType
  /** Default setting key controlling visibility (optional). */
  defaultOn?: boolean
}

type Listener = () => void

function makeRegistry<T extends { id: string; order: number }>() {
  const items = new Map<string, T>()
  const listeners = new Set<Listener>()
  // Cached, stable array so useSyncExternalStore sees identical snapshots.
  let cache: T[] = []
  return {
    register(def: T) {
      items.set(def.id, def)
      cache = [...items.values()].sort((a, b) => a.order - b.order)
      listeners.forEach((l) => l())
    },
    list(): T[] {
      return cache
    },
    get(id: string): T | undefined {
      return items.get(id)
    },
    subscribe(l: Listener) {
      listeners.add(l)
      return () => listeners.delete(l)
    }
  }
}

export const sidePanels = makeRegistry<SidePanelDef>()
export const hudItems = makeRegistry<HudItemDef>()
export const statusItems = makeRegistry<StatusItemDef>()
export const settingsSections = makeRegistry<SettingsSectionDef>()
export const newTabWidgets = makeRegistry<NewTabWidgetDef>()
