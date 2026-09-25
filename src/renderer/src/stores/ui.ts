import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { ContextMenuParams } from '@shared/types'

/** Core overlays: palette, tabSearch, workspaces, capture, saveTo. Modules may add their own ids. */
export type Overlay = null | string

export interface Toast {
  id: string
  kind: 'info' | 'ok' | 'warn' | 'error'
  title: string
  body?: string
  action?: { label: string; run: () => void }
  ttl?: number
}

export interface MenuItem {
  id?: string
  label?: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  checked?: boolean
  separator?: boolean
  header?: string
  submenu?: MenuItem[]
  run?: () => void
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
  /** Minimum width in px. */
  width?: number
}

interface UiStore {
  overlay: Overlay
  overlayArg?: unknown
  paletteQuery: string
  sidePanel: string | null
  sidePanelWidth: number
  focusMode: boolean
  findOpen: Record<string, boolean>
  menu: MenuState | null
  pageMenu: ContextMenuParams | null
  toasts: Toast[]
  hoverUrl: string
  omniboxFocused: boolean
  devtoolsDockHeight: number
  windowState: { maximized: boolean; fullscreen: boolean; focused: boolean }
  trackersBlocked: number
}

export const useUi = create<UiStore>(() => ({
  overlay: null,
  paletteQuery: '',
  sidePanel: null,
  sidePanelWidth: 380,
  focusMode: false,
  findOpen: {},
  menu: null,
  pageMenu: null,
  toasts: [],
  hoverUrl: '',
  omniboxFocused: false,
  devtoolsDockHeight: 320,
  windowState: { maximized: false, fullscreen: false, focused: true },
  trackersBlocked: 0
}))

export function openOverlay(overlay: Overlay, arg?: unknown, paletteQuery = ''): void {
  useUi.setState({ overlay, overlayArg: arg, paletteQuery, menu: null, pageMenu: null })
}

export function closeOverlay(): void {
  useUi.setState({ overlay: null, overlayArg: undefined })
}

export function toggleSidePanel(id: string): void {
  useUi.setState((s) => ({ sidePanel: s.sidePanel === id ? null : id }))
}

export function openSidePanel(id: string): void {
  useUi.setState({ sidePanel: id })
}

export function openMenu(menu: MenuState): void {
  useUi.setState({ menu, pageMenu: null })
}

export function closeMenu(): void {
  useUi.setState({ menu: null, pageMenu: null })
}

let toastSeq = 0
export function toast(t: Omit<Toast, 'id'>): string {
  const id = 'toast' + ++toastSeq
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }))
  const ttl = t.ttl ?? (t.kind === 'error' ? 7000 : t.action ? 6000 : 3500)
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl)
  return id
}

export function dismissToast(id: string): void {
  useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function setFindOpen(tabId: string, open: boolean): void {
  useUi.setState((s) => ({ findOpen: { ...s.findOpen, [tabId]: open } }))
}
