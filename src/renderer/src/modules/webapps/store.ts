// Sidebar web apps — renderer state: the user's apps (from SQLite via IPC),
// per-app runtime state (loading / unread / audible), the live <webview>
// registry and every action the dock, panel header and manager page share.
import { create } from 'zustand'
import type { WebviewTag } from 'electron'
import type { WebApp, WebAppInput } from '@shared/modules/webapps'
import { desktopUserAgent, mobileUserAgent, originOfUrl } from '@shared/modules/webapps'
import { invoke, on } from '../../lib/ipc'
import { newTab } from '../../stores/browser'
import { openSidePanel, toast, toggleSidePanel, useUi } from '../../stores/ui'

export const PANEL_PREFIX = 'webapp:'
export const panelIdOf = (id: string) => PANEL_PREFIX + id
export const appIdOfPanel = (panelId: string | null | undefined) => (panelId?.startsWith(PANEL_PREFIX) ? panelId.slice(PANEL_PREFIX.length) : null)

export interface LoadError {
  code: number
  description: string
  url: string
}

export interface AppRuntime {
  /** The panel (and its webview) is mounted. */
  live: boolean
  ready: boolean
  loading: boolean
  error: LoadError | null
  crashed: string | null
  unread: number
  audible: boolean
  hasMedia: boolean
  title: string
  url: string
  canGoBack: boolean
  /** Last permission a page asked for (SPECTER can't prompt inside panels). */
  blockedPermission: { permission: string; origin: string } | null
}

const EMPTY_RUNTIME: AppRuntime = {
  live: false,
  ready: false,
  loading: false,
  error: null,
  crashed: null,
  unread: 0,
  audible: false,
  hasMedia: false,
  title: '',
  url: '',
  canGoBack: false,
  blockedPermission: null
}

interface WebAppsStore {
  loaded: boolean
  apps: WebApp[]
  icons: Record<string, string>
  runtime: Record<string, AppRuntime>
}

export const useWebApps = create<WebAppsStore>(() => ({ loaded: false, apps: [], icons: {}, runtime: {} }))

export function getApp(id: string): WebApp | undefined {
  return useWebApps.getState().apps.find((a) => a.id === id)
}

export function runtimeOf(id: string): AppRuntime {
  return useWebApps.getState().runtime[id] ?? EMPTY_RUNTIME
}

export function useRuntime(id: string): AppRuntime {
  return useWebApps((s) => s.runtime[id] ?? EMPTY_RUNTIME)
}

export function setRuntime(id: string, patch: Partial<AppRuntime>): void {
  useWebApps.setState((s) => {
    const cur = s.runtime[id] ?? EMPTY_RUNTIME
    let same = true
    for (const k in patch) if ((patch as any)[k] !== (cur as any)[k]) same = false
    if (same) return s
    return { runtime: { ...s.runtime, [id]: { ...cur, ...patch } } }
  })
}

export function resetRuntime(id: string): void {
  useWebApps.setState((s) => {
    const { [id]: _drop, ...rest } = s.runtime
    return { runtime: rest }
  })
}

// ------------------------------------------------------------------ loading

let loadSeq = 0
export async function loadApps(): Promise<void> {
  const seq = ++loadSeq
  try {
    const [apps, icons] = await Promise.all([invoke('webapps:list'), invoke('webapps:icons').catch(() => ({}))])
    if (seq !== loadSeq) return
    useWebApps.setState({ apps, icons, loaded: true })
  } catch (err) {
    console.warn('[webapps] load failed', err)
    useWebApps.setState({ loaded: true })
  }
}

export function startSync(): void {
  on('webapps:changed', () => void loadApps())
  void loadApps()
}

function patchLocal(id: string, patch: Partial<WebApp>): void {
  useWebApps.setState((s) => ({ apps: s.apps.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
}

export async function saveApp(input: WebAppInput): Promise<WebApp | null> {
  if (input.id) patchLocal(input.id, input as Partial<WebApp>)
  try {
    return await invoke('webapps:save', input)
  } catch (err) {
    toast({ kind: 'error', title: 'Could not save web app', body: errText(err) })
    void loadApps()
    return null
  }
}

export function errText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// ------------------------------------------------------------------ live webviews

const views = new Map<string, WebviewTag>()

export function registerView(id: string, wv: WebviewTag): void {
  views.set(id, wv)
}
export function unregisterView(id: string): void {
  views.delete(id)
}
/** The app's webview once attached (methods usable). */
export function viewOf(id: string): WebviewTag | null {
  return runtimeOf(id).ready ? (views.get(id) ?? null) : null
}
export function appIdForWcId(wcId: number): string | null {
  for (const [id, wv] of views) {
    try {
      if (runtimeOf(id).ready && wv.getWebContentsId() === wcId) return id
    } catch {
      /* not attached */
    }
  }
  return null
}

export function userAgentFor(mobile: boolean): string {
  return mobile ? mobileUserAgent(navigator.userAgent) : desktopUserAgent(navigator.userAgent)
}

// ------------------------------------------------------------------ actions

export function isOpen(id: string): boolean {
  return useUi.getState().sidePanel === panelIdOf(id)
}

export function openApp(id: string): void {
  if (!getApp(id)) return
  openSidePanel(panelIdOf(id))
}

export function toggleApp(id: string): void {
  toggleSidePanel(panelIdOf(id))
}

export function currentUrl(id: string): string {
  const wv = viewOf(id)
  try {
    const u = wv?.getURL()
    if (u && /^https?:/i.test(u)) return u
  } catch {
    /* ignore */
  }
  return getApp(id)?.url ?? ''
}

export function reloadApp(id: string): void {
  const wv = views.get(id)
  const rt = runtimeOf(id)
  if (!wv || !rt.live) return openApp(id)
  setRuntime(id, { error: null, crashed: null })
  try {
    if (rt.crashed || rt.error || !rt.ready) wv.loadURL(rt.error?.url || currentUrl(id) || getApp(id)!.url).catch(() => undefined)
    else wv.reload()
  } catch {
    /* not attached yet */
  }
}

export function goHome(id: string): void {
  const app = getApp(id)
  const wv = viewOf(id)
  if (!app) return
  if (!wv) return openApp(id)
  setRuntime(id, { error: null, crashed: null })
  wv.loadURL(app.url).catch(() => undefined)
}

export function goBack(id: string): void {
  const wv = viewOf(id)
  if (wv?.canGoBack()) wv.goBack()
}

export function openInTab(id: string): void {
  const url = currentUrl(id)
  if (url) newTab(url)
}

/** Destroys the app's webview (frees its memory). It reloads next time it's opened. */
export function unloadApp(id: string): void {
  const pid = panelIdOf(id)
  if (useUi.getState().sidePanel === pid) useUi.setState({ sidePanel: null })
  window.dispatchEvent(new CustomEvent('specter:panel-unload', { detail: pid }))
  resetRuntime(id)
}

export function unloadAll(): number {
  const live = useWebApps.getState().apps.filter((a) => runtimeOf(a.id).live)
  live.forEach((a) => unloadApp(a.id))
  return live.length
}

export async function setMobile(id: string, mobile: boolean): Promise<void> {
  await saveApp({ id, mobile })
  const wv = viewOf(id)
  if (!wv) return
  try {
    wv.setUserAgent(userAgentFor(mobile))
    wv.loadURL(currentUrl(id)).catch(() => undefined)
  } catch {
    /* ignore */
  }
}

export async function setMuted(id: string, muted: boolean): Promise<void> {
  await saveApp({ id, muted })
  try {
    viewOf(id)?.setAudioMuted(muted)
  } catch {
    /* ignore */
  }
}

export async function setZoom(id: string, zoom: number): Promise<void> {
  await saveApp({ id, zoom })
  try {
    viewOf(id)?.setZoomFactor(zoom)
  } catch {
    /* ignore */
  }
}

export async function removeApp(id: string): Promise<void> {
  const app = getApp(id)
  if (!app) return
  unloadApp(id)
  useWebApps.setState((s) => ({ apps: s.apps.filter((a) => a.id !== id) }))
  try {
    await invoke('webapps:delete', id)
    toast({ kind: 'info', title: `Removed ${app.name} from the sidebar`, body: 'Your login for the site is kept (it is shared with normal tabs).' })
  } catch (err) {
    toast({ kind: 'error', title: 'Could not remove app', body: errText(err) })
    void loadApps()
  }
}

export async function reorderApps(ids: string[]): Promise<void> {
  useWebApps.setState((s) => ({ apps: ids.map((id) => s.apps.find((a) => a.id === id)).filter((a): a is WebApp => !!a).map((a, i) => ({ ...a, sort: i })) }))
  try {
    await invoke('webapps:reorder', ids)
  } catch (err) {
    toast({ kind: 'error', title: 'Could not reorder apps', body: errText(err) })
    void loadApps()
  }
}

/** Origin the app's site permissions apply to (current page when loaded, else home). */
export function permissionOrigin(id: string): string {
  return originOfUrl(currentUrl(id))
}
