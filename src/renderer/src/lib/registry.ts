// UI extension points used by feature modules.
import type { ComponentType, ReactNode } from 'react'
import type { MenuItem } from '../stores/ui'
import type { LucideIcon } from 'lucide-react'

export type SidebarSection = 'apps' | 'widgets' | 'tools' | 'system'

export interface SidePanelDef {
  id: string
  title: string
  icon: LucideIcon
  order: number
  component: ComponentType<{ popout?: boolean }>
  /** Dock section. Defaults: order < 100 → 'tools', otherwise 'system'. */
  section?: SidebarSection
  /** Custom icon (e.g. a web app's favicon) instead of the Lucide icon. */
  iconNode?: ReactNode
  /** Small badge rendered on the dock button (e.g. unread count). */
  Badge?: ComponentType
  /** Stay mounted while hidden (web apps keep playing / receiving messages). */
  keepAlive?: boolean
  /** Default panel width in px. */
  width?: number
  /** Render without SPECTER's panel header. */
  bare?: boolean
  /** Extra header controls. */
  headerExtra?: ComponentType
  /** Extra items for the dock button's context menu. */
  contextItems?: () => MenuItem[]
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
    unregister(id: string) {
      if (!items.delete(id)) return
      cache = [...items.values()].sort((a, b) => a.order - b.order)
      listeners.forEach((l) => l())
    },
    /** Re-evaluate dynamic fields (enabled(), badges) without changing entries. */
    refresh() {
      cache = [...cache]
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
/** Full-bleed layers rendered behind the new tab page (e.g. wallpapers). */
export const newTabBackgrounds = makeRegistry<{ id: string; order: number; component: ComponentType }>()
