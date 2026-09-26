// Browser state for this window: open workspaces, their tabs, groups and
// split layouts. Persisted per workspace (debounced) through IPC.
import { create } from 'zustand'
import type { InitialSession } from '@shared/ipc'
import type { GroupColor, PermissionRequest, Profile, SplitLayout, SplitPreset, TabGroup, TabState, Workspace, WorkspaceState } from '@shared/types'
import { detectPageKind, interpretInput, isInternal } from '@shared/url'
import { searchUrl, SUSPEND_MS } from '@shared/settings'
import { invoke } from '../lib/ipc'
import { webviewElementFor, webviewFor, wcIdFor } from '../lib/webviews'
import { getSetting } from './settings'
import { record } from '../lib/perf'
import { getPage } from '../pages/registry'

export interface RuntimeTab extends TabState {
  loading?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  audible?: boolean
  crashed?: string
  unresponsive?: boolean
  error?: { code: number; description: string; url: string }
  blockedPopups?: { url: string; origin: string }[]
  permissionRequests?: PermissionRequest[]
  reader?: boolean
  devtoolsDocked?: boolean
  /** Private memory (KB) measured right before the tab was suspended. */
  memoryReleasedKB?: number
  /** Internal page shown before the first web navigation (for Back). */
  internalBack?: string
  hasMedia?: boolean
  pendingScrollY?: number
  loadProgress?: number
  themeColor?: string
  /** Last measured top-level load time (navigation start → load finished), ms. */
  loadMs?: number
  /** Third-party tracker requests blocked on the current page. */
  blocked?: number
  /** Tab that opened this one (for Chrome-like child placement). Not persisted. */
  openerId?: string
}

export interface RuntimeWorkspace {
  id: string
  name: string
  icon: string
  color: string
  tabs: RuntimeTab[]
  groups: TabGroup[]
  activeTabId?: string
  layout: SplitLayout
}

interface BrowserStore {
  ready: boolean
  windowId: number
  profile: Profile | null
  workspaces: Workspace[]
  open: Record<string, RuntimeWorkspace>
  openOrder: string[]
  activeWsId: string
  restorePrompt?: InitialSession['restorePrompt']
}

export const useBrowser = create<BrowserStore>(() => ({
  ready: false,
  windowId: 0,
  profile: null,
  workspaces: [],
  open: {},
  openOrder: [],
  activeWsId: ''
}))

const S = () => useBrowser.getState()
const set = useBrowser.setState

export const uid = (p = 't_') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// ---------------------------------------------------------------- selectors

export function activeWs(): RuntimeWorkspace | undefined {
  const s = S()
  return s.open[s.activeWsId]
}

export function activeTab(): RuntimeTab | undefined {
  const ws = activeWs()
  return ws?.tabs.find((t) => t.id === ws.activeTabId)
}

export function findTab(tabId: string): { ws: RuntimeWorkspace; tab: RuntimeTab; index: number } | null {
  for (const ws of Object.values(S().open)) {
    const index = ws.tabs.findIndex((t) => t.id === tabId)
    if (index >= 0) return { ws, tab: ws.tabs[index], index }
  }
  return null
}

export function useActiveWs(): RuntimeWorkspace | undefined {
  return useBrowser((s) => s.open[s.activeWsId])
}

export function useActiveTab(): RuntimeTab | undefined {
  return useBrowser((s) => {
    const ws = s.open[s.activeWsId]
    return ws?.tabs.find((t) => t.id === ws.activeTabId)
  })
}

/** Tabs currently visible (active tab or split panes). */
export function visibleTabIds(ws: RuntimeWorkspace | undefined): string[] {
  if (!ws) return []
  if (ws.layout.preset !== 'single' && ws.layout.panes.length > 1) return ws.layout.panes
  return ws.activeTabId ? [ws.activeTabId] : []
}

// ---------------------------------------------------------------- mutation helpers

function updateWs(wsId: string, fn: (ws: RuntimeWorkspace) => RuntimeWorkspace): void {
  set((s) => {
    const ws = s.open[wsId]
    if (!ws) return s
    return { open: { ...s.open, [wsId]: fn(ws) } }
  })
  scheduleSave(wsId)
}

export function updateTab(tabId: string, patch: Partial<RuntimeTab>): void {
  const f = findTab(tabId)
  if (!f) return
  const persistent = Object.keys(patch).some((k) => PERSISTED_KEYS.has(k))
  set((s) => {
    const ws = s.open[f.ws.id]
    return { open: { ...s.open, [ws.id]: { ...ws, tabs: ws.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) } } }
  })
  if (persistent) scheduleSave(f.ws.id)
}

const PERSISTED_KEYS = new Set(['url', 'title', 'favicon', 'pinned', 'groupId', 'muted', 'suspended', 'scrollY', 'note', 'lastActive', 'zoom', 'temporary'])

export function toPersisted(ws: RuntimeWorkspace): WorkspaceState {
  const kept = ws.tabs.filter((t) => !t.temporary)
  const keptIds = new Set(kept.map((t) => t.id))
  // Temporary tabs are not saved, so the active tab / split panes must not point at one
  // (a restore would otherwise show an empty content area with no active tab).
  const activeTabId = ws.activeTabId && keptIds.has(ws.activeTabId) ? ws.activeTabId : [...kept].sort((a, b) => b.lastActive - a.lastActive)[0]?.id
  const panes = ws.layout.panes.filter((id) => keptIds.has(id))
  const layout = panes.length === ws.layout.panes.length ? ws.layout : panes.length > 1 ? { ...ws.layout, panes, preset: fitPreset(ws.layout.preset, panes.length), sizes: undefined } : { preset: 'single' as const, panes: [] }
  return {
    tabs: kept
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        pinned: t.pinned,
        groupId: t.groupId,
        muted: t.muted,
        suspended: t.suspended,
        scrollY: t.scrollY,
        note: t.note,
        lastActive: t.lastActive,
        createdAt: t.createdAt,
        zoom: t.zoom
      })),
    groups: ws.groups,
    activeTabId,
    layout
  }
}

const saveTimers = new Map<string, number>()
function scheduleSave(wsId: string): void {
  const prev = saveTimers.get(wsId)
  if (prev) clearTimeout(prev)
  saveTimers.set(
    wsId,
    window.setTimeout(() => {
      saveTimers.delete(wsId)
      const ws = S().open[wsId]
      if (ws) invoke('workspaces:saveState', wsId, toPersisted(ws)).catch(() => undefined)
    }, 500)
  )
}

/** Immediately persists all open workspaces (used on unload / quit). */
export function flushAll(): void {
  for (const [wsId, t] of saveTimers) {
    clearTimeout(t)
    saveTimers.delete(wsId)
  }
  for (const ws of Object.values(S().open)) window.specter.flushWorkspace(ws.id, toPersisted(ws))
}

function persistSession(): void {
  const s = S()
  invoke('session:update', { openWorkspaceIds: s.openOrder, activeWorkspaceId: s.activeWsId }).catch(() => undefined)
}

function newTabState(url: string, extra: Partial<RuntimeTab> = {}): RuntimeTab {
  const now = Date.now()
  return {
    id: uid(),
    url,
    title: isInternal(url) ? internalTitle(url) : url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || 'New Tab',
    pinned: false,
    muted: false,
    suspended: false,
    lastActive: now,
    createdAt: now,
    ...extra
  }
}

export function internalTitle(url: string): string {
  const page = url.slice('specter://'.length).split(/[/?#]/)[0] || 'newtab'
  const names: Record<string, string> = {
    newtab: 'New Tab',
    settings: 'Settings',
    history: 'History',
    bookmarks: 'Bookmarks',
    downloads: 'Downloads',
    privacy: 'Privacy Center',
    security: 'Security',
    diagnostics: 'Diagnostics',
    help: 'Help',
    logs: 'Logs',
    workspaces: 'Workspaces',
    welcome: 'Welcome'
  }
  return names[page] ?? getPage(page)?.title ?? page.charAt(0).toUpperCase() + page.slice(1)
}

// ---------------------------------------------------------------- init

function toRuntime(w: Workspace, wakeActive: boolean): RuntimeWorkspace {
  // Older saves may reference a tab that no longer exists (e.g. an unsaved temporary tab).
  const ids = new Set(w.state.tabs.map((t) => t.id))
  const activeTabId = w.state.activeTabId && ids.has(w.state.activeTabId) ? w.state.activeTabId : w.state.tabs[0]?.id
  const panes = w.state.layout.panes.filter((id) => ids.has(id))
  const layout: SplitLayout = panes.length === w.state.layout.panes.length ? w.state.layout : panes.length > 1 ? { ...w.state.layout, panes, preset: fitPreset(w.state.layout.preset, panes.length), sizes: undefined } : { preset: 'single', panes: [] }
  const visible = new Set(layout.preset !== 'single' ? layout.panes : [])
  if (activeTabId) visible.add(activeTabId)
  return {
    id: w.id,
    name: w.name,
    icon: w.icon,
    color: w.color,
    groups: w.state.groups,
    activeTabId,
    layout,
    // Lazy restore: only visible tabs load immediately.
    tabs: w.state.tabs.map((t) => ({ ...t, suspended: isInternal(t.url) ? false : wakeActive && visible.has(t.id) ? false : true, pendingScrollY: t.scrollY }))
  }
}

export function initBrowser(init: InitialSession): void {
  const open: Record<string, RuntimeWorkspace> = {}
  for (const id of init.openWorkspaceIds) {
    const w = init.workspaces.find((x) => x.id === id)
    if (w) open[id] = toRuntime(w, id === init.activeWorkspaceId)
  }
  const openOrder = init.openWorkspaceIds.filter((id) => open[id])
  let activeWsId = open[init.activeWorkspaceId] ? init.activeWorkspaceId : openOrder[0]
  if (!activeWsId && init.workspaces[0]) {
    open[init.workspaces[0].id] = toRuntime(init.workspaces[0], true)
    openOrder.push(init.workspaces[0].id)
    activeWsId = init.workspaces[0].id
  }
  set({ ready: true, windowId: init.windowId, profile: init.profile, workspaces: init.workspaces, open, openOrder, activeWsId, restorePrompt: init.restorePrompt })
  const ws = open[activeWsId]
  // A window opened for a URL (e.g. "Move tab to new window") shows just that tab.
  if (ws && ws.tabs.length === 0 && !init.initialUrls.length) newTab('specter://newtab')
  for (const url of init.initialUrls) newTab(url)
  persistSession()
}

export async function refreshWorkspaceList(): Promise<void> {
  const workspaces = await invoke('workspaces:list')
  set((s) => {
    const open = { ...s.open }
    for (const w of workspaces) if (open[w.id]) open[w.id] = { ...open[w.id], name: w.name, icon: w.icon, color: w.color }
    return { workspaces, open }
  })
}

// ---------------------------------------------------------------- tabs

export interface NewTabOptions {
  background?: boolean
  index?: number
  wsId?: string
  groupId?: string
  temporary?: boolean
  openerId?: string
  pinned?: boolean
}

export function newTab(url = 'specter://newtab', opts: NewTabOptions = {}): string {
  const wsId = opts.wsId ?? S().activeWsId
  const ws = S().open[wsId]
  if (!ws) return ''
  const tab = newTabState(url, { groupId: opts.groupId, temporary: opts.temporary, pinned: !!opts.pinned })
  updateWs(wsId, (w) => {
    const tabs = [...w.tabs]
    let index = opts.index
    if (index === undefined) {
      if (opts.openerId) {
        // Open after the opener (and after previously opened children), like Chrome.
        const oi = tabs.findIndex((t) => t.id === opts.openerId)
        index = oi >= 0 ? oi + 1 : tabs.length
        while (index < tabs.length && tabs[index].openerId === opts.openerId) index++
        tab.openerId = opts.openerId
        if (!tab.groupId) tab.groupId = tabs[oi]?.groupId
      } else if (getSetting('tabs.newTabPosition') === 'afterActive' && w.activeTabId && !opts.pinned) {
        const ai = tabs.findIndex((t) => t.id === w.activeTabId)
        index = ai >= 0 ? ai + 1 : tabs.length
        // skip past pinned tabs
        while (index < tabs.length && tabs[index].pinned) index++
      } else index = tabs.length
    }
    if (!opts.pinned) {
      const pinnedCount = tabs.filter((t) => t.pinned).length
      index = Math.max(index, pinnedCount)
    }
    tabs.splice(index, 0, tab)
    return { ...w, tabs, activeTabId: opts.background ? w.activeTabId : tab.id }
  })
  window.dispatchEvent(new CustomEvent('specter:tab-created', { detail: { url, wsId } }))
  // Focus the address bar synchronously so the user's very next keystrokes land in it.
  if (!opts.background && url === 'specter://newtab') window.dispatchEvent(new CustomEvent('specter:focus-omnibox', { detail: { clear: true } }))
  return tab.id
}

export function activateTab(tabId: string): void {
  const f = findTab(tabId)
  if (!f) return
  // Switch after choosing the tab so the workspace's previously active tab isn't woken for nothing.
  const otherWs = f.ws.id !== S().activeWsId
  updateWs(f.ws.id, (w) => {
    let layout = w.layout
    // Activating a tab outside the split replaces the focused pane (keeps split alive).
    if (layout.preset !== 'single' && !layout.panes.includes(tabId)) {
      const panes = [...layout.panes]
      const focusedIdx = Math.max(0, panes.indexOf(w.activeTabId ?? ''))
      panes[focusedIdx] = tabId
      layout = { ...layout, panes }
    }
    return {
      ...w,
      activeTabId: tabId,
      layout,
      tabs: w.tabs.map((t) => (t.id === tabId ? { ...t, lastActive: Date.now(), suspended: isInternal(t.url) ? false : false } : t))
    }
  })
  if (otherWs) void switchWorkspace(f.ws.id)
}

export function closeTab(tabId: string): void {
  const f = findTab(tabId)
  if (!f) return
  const { ws, tab, index } = f
  // Blank new tabs are not worth restoring (Ctrl+Shift+T should bring back real pages).
  if (!tab.temporary && tab.url !== 'specter://newtab') invoke('session:closedTabPush', { url: tab.url, title: tab.title, favicon: tab.favicon, workspaceId: ws.id, index }).catch(() => undefined)
  window.dispatchEvent(new CustomEvent('specter:tab-closed', { detail: { url: tab.url, wsId: ws.id } }))
  const remaining = ws.tabs.filter((t) => t.id !== tabId)
  if (remaining.length === 0) {
    // Closing the last tab of a workspace leaves a fresh new tab (browser never goes empty).
    const nt = newTabState('specter://newtab')
    updateWs(ws.id, (w) => ({ ...w, tabs: [nt], activeTabId: nt.id, layout: { preset: 'single', panes: [] } }))
    return
  }
  let nextActive = ws.activeTabId
  if (ws.activeTabId === tabId) {
    // Closing the focused pane of a split: focus a remaining pane (another tab would
    // replace one of the still-visible panes, or hide the pane the user was looking at).
    const panesLeft = ws.layout.preset !== 'single' ? ws.layout.panes.filter((p) => p !== tabId && remaining.some((t) => t.id === p)) : []
    if (panesLeft.length) nextActive = panesLeft[Math.min(Math.max(0, ws.layout.panes.indexOf(tabId)), panesLeft.length - 1)]
    else {
      // Prefer the tab to the right, then left (Chrome behaviour), within the same group if possible.
      const sameGroup = tab.groupId ? remaining.filter((t) => t.groupId === tab.groupId) : []
      const pool = sameGroup.length ? sameGroup : remaining
      const right = pool.find((t) => ws.tabs.indexOf(t) > index)
      nextActive = (right ?? pool[pool.length - 1]).id
    }
  }
  updateWs(ws.id, (w) => {
    let layout = w.layout
    if (layout.panes.includes(tabId)) {
      const panes = layout.panes.filter((p) => p !== tabId)
      layout = panes.length > 1 ? { ...layout, panes, preset: fitPreset(layout.preset, panes.length) } : { preset: 'single', panes: [] }
    }
    const groups = w.groups.filter((g) => remaining.some((t) => t.groupId === g.id))
    return { ...w, tabs: remaining, activeTabId: nextActive, layout, groups }
  })
  // A page closing itself in a background workspace must not pull the user over there;
  // that workspace wakes its visible tab when it is switched to.
  if (nextActive && nextActive !== ws.activeTabId && ws.id === S().activeWsId) activateTab(nextActive)
}

export function closeTabs(ids: string[]): void {
  for (const id of ids) closeTab(id)
}

export async function reopenClosedTab(): Promise<void> {
  const t = await invoke('session:closedTabPop')
  if (!t) return
  const wsId = t.workspaceId && S().open[t.workspaceId] ? t.workspaceId : S().activeWsId
  const id = newTab(t.url, { wsId, index: t.index })
  // The tab went back to its (background) workspace: show it there.
  if (id && wsId !== S().activeWsId) activateTab(id)
}

export function navigate(tabId: string, input: string, opts: { fromOmnibox?: boolean } = {}): void {
  const f = findTab(tabId)
  if (!f) return
  let url: string
  const intent = interpretInput(input)
  if (intent.kind === 'url') url = intent.url
  else if (intent.kind === 'search') {
    url = searchUrl(useSettingsSnapshot(), intent.query)
    if (opts.fromOmnibox) invoke('searches:add', intent.query).catch(() => undefined)
  } else return
  loadUrl(tabId, url)
}

function useSettingsSnapshot() {
  return { 'search.engine': getSetting('search.engine'), 'search.customTemplate': getSetting('search.customTemplate') }
}

/** Loads a concrete URL into a tab, handling internal ↔ web transitions. */
export function loadUrl(tabId: string, url: string): void {
  const f = findTab(tabId)
  if (!f) return
  const wasInternal = isInternal(f.tab.url)
  const goingInternal = isInternal(url)
  const wv = webviewFor(tabId)
  if (goingInternal) {
    // The page's webview (and its history) goes away, so its back/forward state is stale.
    updateTab(tabId, { url, title: internalTitle(url), favicon: undefined, error: undefined, crashed: undefined, reader: false, loading: false, canGoBack: false, canGoForward: false })
    return
  }
  if (wasInternal || !wv || f.tab.suspended || f.tab.crashed) {
    // A webview that is still attaching ignores loadURL: retarget its src instead.
    const pending = !wasInternal && !f.tab.suspended && !f.tab.crashed ? webviewElementFor(tabId) : null
    if (pending) pending.src = url
    // Otherwise the webview mounts with this URL as its initial src.
    updateTab(tabId, { url, suspended: false, crashed: undefined, error: undefined, internalBack: wasInternal ? f.tab.url : f.tab.internalBack, loading: true, reader: false })
    return
  }
  updateTab(tabId, { url, error: undefined, loading: true, reader: false })
  wv.loadURL(url).catch(() => undefined)
}

export function goBack(tabId: string): void {
  const f = findTab(tabId)
  if (!f) return
  const wv = webviewFor(tabId)
  if (wv && wv.canGoBack()) wv.goBack()
  else if (f.tab.internalBack) loadUrl(tabId, f.tab.internalBack)
}

export function goForward(tabId: string): void {
  const wv = webviewFor(tabId)
  if (wv && wv.canGoForward()) wv.goForward()
}

export function reload(tabId: string, hard = false): void {
  const f = findTab(tabId)
  if (!f) return
  if (f.tab.crashed || f.tab.suspended) {
    updateTab(tabId, { crashed: undefined, suspended: false, error: undefined })
    return
  }
  const wv = webviewFor(tabId)
  if (!wv) return
  if (hard) wv.reloadIgnoringCache()
  else wv.reload()
}

export function stop(tabId: string): void {
  webviewFor(tabId)?.stop()
}

export function duplicateTab(tabId: string): void {
  const f = findTab(tabId)
  if (!f) return
  newTab(f.tab.url, { wsId: f.ws.id, index: f.index + 1, groupId: f.tab.groupId })
}

export function togglePin(tabId: string): void {
  const f = findTab(tabId)
  if (!f) return
  updateWs(f.ws.id, (w) => {
    const tabs = w.tabs.filter((t) => t.id !== tabId)
    const tab = { ...f.tab, pinned: !f.tab.pinned, groupId: undefined }
    const pinnedCount = tabs.filter((t) => t.pinned).length
    tabs.splice(tab.pinned ? pinnedCount : pinnedCount, 0, tab)
    return { ...w, tabs }
  })
}

export function setMuted(tabId: string, muted: boolean): void {
  const wv = webviewFor(tabId)
  wv?.setAudioMuted(muted)
  updateTab(tabId, { muted })
}

export function muteAll(except?: string): void {
  const ws = activeWs()
  ws?.tabs.forEach((t) => t.id !== except && setMuted(t.id, true))
}

export function moveTab(tabId: string, toIndex: number, wsId?: string): void {
  const f = findTab(tabId)
  if (!f) return
  const target = wsId ?? f.ws.id
  if (target !== f.ws.id) {
    void moveTabToWorkspace(tabId, target)
    return
  }
  updateWs(target, (w) => {
    const tabs = w.tabs.filter((t) => t.id !== tabId)
    const pinnedCount = tabs.filter((t) => t.pinned).length
    let idx = Math.max(0, Math.min(toIndex, tabs.length))
    idx = f.tab.pinned ? Math.min(idx, pinnedCount) : Math.max(idx, pinnedCount)
    tabs.splice(idx, 0, f.tab)
    return { ...w, tabs }
  })
}

export async function moveTabToWorkspace(tabId: string, wsId: string): Promise<void> {
  const f = findTab(tabId)
  if (!f || f.ws.id === wsId) return
  const tab = { ...f.tab, groupId: undefined }
  closeTabSilently(tabId)
  if (S().open[wsId]) {
    updateWs(wsId, (w) => ({ ...w, tabs: [...w.tabs, { ...tab, suspended: true }] }))
  } else {
    // Workspace not open in this window: append to its stored state.
    const list = await invoke('workspaces:list')
    const target = list.find((w) => w.id === wsId)
    if (!target) return
    const state = target.state
    state.tabs.push({ ...tab, suspended: true })
    await invoke('workspaces:saveState', wsId, state)
  }
}

function closeTabSilently(tabId: string): void {
  const f = findTab(tabId)
  if (!f) return
  const remaining = f.ws.tabs.filter((t) => t.id !== tabId)
  if (!remaining.length) remaining.push(newTabState('specter://newtab'))
  updateWs(f.ws.id, (w) => ({
    ...w,
    tabs: remaining,
    activeTabId: w.activeTabId === tabId ? (remaining[Math.min(f.index, remaining.length - 1)]?.id ?? remaining[0].id) : w.activeTabId,
    layout: w.layout.panes.includes(tabId) ? { preset: 'single', panes: [] } : w.layout
  }))
}

export async function moveTabToNewWindow(tabId: string): Promise<void> {
  const f = findTab(tabId)
  if (!f) return
  await invoke('window:new', { url: f.tab.url })
  closeTabSilently(tabId)
}

export function closeOtherTabs(tabId: string): void {
  const ws = findTab(tabId)?.ws
  if (!ws) return
  closeTabs(ws.tabs.filter((t) => t.id !== tabId && !t.pinned).map((t) => t.id))
}

export function closeTabsToRight(tabId: string): void {
  const f = findTab(tabId)
  if (!f) return
  closeTabs(f.ws.tabs.slice(f.index + 1).filter((t) => !t.pinned).map((t) => t.id))
}

export function closeDuplicateTabs(): number {
  const ws = activeWs()
  if (!ws) return 0
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const t of ws.tabs) {
    const key = t.url.replace(/#.*$/, '')
    if (seen.has(key) && t.id !== ws.activeTabId) dupes.push(t.id)
    else seen.add(key)
  }
  closeTabs(dupes)
  return dupes.length
}

export function setTabNote(tabId: string, note: string): void {
  updateTab(tabId, { note: note.trim() || undefined })
}

export function cycleTab(delta: number): void {
  const ws = activeWs()
  if (!ws || ws.tabs.length < 2) return
  const visible = ws.tabs.filter((t) => !t.groupId || !ws.groups.find((g) => g.id === t.groupId)?.collapsed || t.id === ws.activeTabId)
  const i = visible.findIndex((t) => t.id === ws.activeTabId)
  const next = visible[(i + delta + visible.length) % visible.length]
  if (next) activateTab(next.id)
}

export function activateTabIndex(n: number): void {
  const ws = activeWs()
  if (!ws || !ws.tabs.length) return
  const t = n < 0 ? ws.tabs[ws.tabs.length - 1] : ws.tabs[n]
  if (t) activateTab(t.id)
}

// ---------------------------------------------------------------- groups

const GROUP_COLORS: GroupColor[] = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'grey']

export function createGroup(tabIds: string[], name = '', color?: GroupColor): string {
  const ws = activeWs()
  if (!ws || !tabIds.length) return ''
  const id = uid('g_')
  const used = new Set(ws.groups.map((g) => g.color))
  const col = color ?? GROUP_COLORS.find((c) => !used.has(c)) ?? 'blue'
  updateWs(ws.id, (w) => {
    // Move grouped tabs to be contiguous at the position of the first one.
    const members = w.tabs.filter((t) => tabIds.includes(t.id)).map((t) => ({ ...t, groupId: id, pinned: false }))
    const firstIdx = w.tabs.findIndex((t) => tabIds.includes(t.id))
    const rest = w.tabs.filter((t) => !tabIds.includes(t.id))
    const insertAt = rest.filter((t, i) => i < firstIdx).length
    rest.splice(Math.min(insertAt, rest.length), 0, ...members)
    return { ...w, tabs: rest, groups: [...w.groups, { id, name, color: col, collapsed: false }] }
  })
  return id
}

export function updateGroup(groupId: string, patch: Partial<TabGroup>): void {
  const ws = Object.values(S().open).find((w) => w.groups.some((g) => g.id === groupId))
  if (!ws) return
  updateWs(ws.id, (w) => ({ ...w, groups: w.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) }))
}

export function ungroup(groupId: string): void {
  const ws = Object.values(S().open).find((w) => w.groups.some((g) => g.id === groupId))
  if (!ws) return
  updateWs(ws.id, (w) => ({ ...w, groups: w.groups.filter((g) => g.id !== groupId), tabs: w.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t)) }))
}

export function closeGroup(groupId: string): void {
  const ws = Object.values(S().open).find((w) => w.groups.some((g) => g.id === groupId))
  if (!ws) return
  closeTabs(ws.tabs.filter((t) => t.groupId === groupId).map((t) => t.id))
}

export function addTabToGroup(tabId: string, groupId: string | undefined): void {
  const f = findTab(tabId)
  if (!f) return
  if (!groupId) {
    updateTab(tabId, { groupId: undefined })
    return
  }
  updateWs(f.ws.id, (w) => {
    const tabs = w.tabs.filter((t) => t.id !== tabId)
    const lastIdx = tabs.map((t) => t.groupId).lastIndexOf(groupId)
    tabs.splice(lastIdx + 1, 0, { ...f.tab, groupId, pinned: false })
    return { ...w, tabs }
  })
}

// ---------------------------------------------------------------- split layouts

export const PRESET_PANES: Record<SplitPreset, number> = {
  single: 1,
  '50/50': 2,
  '33/67': 2,
  '67/33': 2,
  '25/75': 2,
  'rows-50/50': 2,
  'three-column': 3,
  quadrant: 4,
  'four-panel': 4
}

function fitPreset(preset: SplitPreset, panes: number): SplitPreset {
  if (PRESET_PANES[preset] === panes) return preset
  return panes >= 4 ? 'quadrant' : panes === 3 ? 'three-column' : panes === 2 ? '50/50' : 'single'
}

export function setLayout(preset: SplitPreset, panes?: string[]): void {
  const ws = activeWs()
  if (!ws) return
  if (preset === 'single') {
    updateWs(ws.id, (w) => ({ ...w, layout: { preset: 'single', panes: [] } }))
    return
  }
  const need = PRESET_PANES[preset]
  let list = panes ?? (ws.layout.panes.length ? [...ws.layout.panes] : ws.activeTabId ? [ws.activeTabId] : [])
  if (ws.activeTabId && !list.includes(ws.activeTabId)) list.unshift(ws.activeTabId)
  // Fill remaining panes with the most recently used tabs, then new tabs.
  const recent = [...ws.tabs].filter((t) => !list.includes(t.id)).sort((a, b) => b.lastActive - a.lastActive)
  while (list.length < need && recent.length) list.push(recent.shift()!.id)
  const created: string[] = []
  while (list.length + created.length < need) created.push(newTab('specter://newtab', { background: true, wsId: ws.id }))
  list = [...list, ...created].slice(0, need)
  updateWs(ws.id, (w) => ({ ...w, layout: { preset, panes: list }, tabs: w.tabs.map((t) => (list.includes(t.id) ? { ...t, suspended: false } : t)) }))
}

export function setPaneSizes(sizes: number[]): void {
  const ws = activeWs()
  if (!ws) return
  updateWs(ws.id, (w) => ({ ...w, layout: { ...w.layout, sizes } }))
}

export function swapPanes(a: number, b: number): void {
  const ws = activeWs()
  if (!ws) return
  updateWs(ws.id, (w) => {
    const panes = [...w.layout.panes]
    ;[panes[a], panes[b]] = [panes[b], panes[a]]
    return { ...w, layout: { ...w.layout, panes } }
  })
}

export function splitWith(tabId: string): void {
  const ws = activeWs()
  if (!ws || !ws.activeTabId || ws.activeTabId === tabId) return
  setLayout('50/50', [ws.activeTabId, tabId])
}

// ---------------------------------------------------------------- workspaces

export async function switchWorkspace(wsId: string): Promise<void> {
  const s = S()
  if (s.activeWsId === wsId) return
  const t0 = performance.now()
  requestAnimationFrame(() => requestAnimationFrame(() => S().activeWsId === wsId && record('workspaceSwitch', performance.now() - t0)))
  if (!s.open[wsId]) {
    const list = await invoke('workspaces:list')
    const w = list.find((x) => x.id === wsId)
    if (!w) return
    // If another window shows this workspace, focus it instead.
    const owner = await invoke('window:ownerOf', wsId)
    if (owner !== null && owner !== S().windowId) {
      await invoke('window:focus', owner)
      return
    }
    set((st) => ({ open: { ...st.open, [wsId]: toRuntime(w, true) }, openOrder: [...st.openOrder, wsId], workspaces: list }))
  }
  set({ activeWsId: wsId })
  const ws = S().open[wsId]
  if (ws && ws.tabs.length === 0) newTab()
  // Wake the visible tabs of the target workspace.
  for (const id of visibleTabIds(ws)) {
    const t = ws?.tabs.find((x) => x.id === id)
    if (t?.suspended) updateTab(id, { suspended: false })
  }
  persistSession()
  window.dispatchEvent(new CustomEvent('specter:workspace-changed', { detail: { wsId, name: ws?.name } }))
}

export async function createWorkspaceAndSwitch(name: string, icon?: string, color?: string, state?: WorkspaceState): Promise<string> {
  const ws = await invoke('workspaces:create', { name, icon, color, state })
  await refreshWorkspaceList()
  await switchWorkspace(ws.id)
  return ws.id
}

/** Saves all current tabs into a brand-new workspace. */
export async function saveTabsAsWorkspace(name: string): Promise<void> {
  const ws = activeWs()
  if (!ws) return
  const persisted = toPersisted(ws)
  const idMap = new Map<string, string>()
  const tabs = persisted.tabs.map((t) => {
    const id = uid()
    idMap.set(t.id, id)
    return { ...t, id, suspended: true }
  })
  await invoke('workspaces:create', { name, state: { ...persisted, tabs, activeTabId: idMap.get(persisted.activeTabId ?? '') ?? tabs[0]?.id, layout: { preset: 'single', panes: [] } } })
  await refreshWorkspaceList()
}

/** Adds workspaces to this window without switching (used when merging windows). */
export async function openWorkspacesInWindow(ids: string[]): Promise<void> {
  const list = await invoke('workspaces:list')
  set((st) => {
    const open = { ...st.open }
    const order = [...st.openOrder]
    for (const id of ids) {
      const w = list.find((x) => x.id === id)
      if (!w || open[id]) continue
      open[id] = toRuntime(w, false)
      order.push(id)
    }
    return { open, openOrder: order, workspaces: list }
  })
  persistSession()
}

export function closeWorkspaceInWindow(wsId: string): void {
  const s = S()
  if (s.openOrder.length <= 1) return
  const ws = s.open[wsId]
  if (ws) invoke('workspaces:saveState', wsId, toPersisted(ws)).catch(() => undefined)
  const openOrder = s.openOrder.filter((id) => id !== wsId)
  const open = { ...s.open }
  delete open[wsId]
  set({ open, openOrder, activeWsId: s.activeWsId === wsId ? openOrder[0] : s.activeWsId })
  persistSession()
}

export async function restoreSnapshotIntoWorkspace(snapshotId: string): Promise<void> {
  const snap = await invoke('workspaces:getSnapshot', snapshotId)
  if (!snap) return
  const cur = S().open[snap.workspaceId]
  if (cur) await invoke('workspaces:snapshot', snap.workspaceId, 'Before restoring snapshot')
  const w: Workspace = { ...(S().workspaces.find((x) => x.id === snap.workspaceId) as Workspace), state: snap.state }
  if (cur) set((st) => ({ open: { ...st.open, [w.id]: toRuntime(w, st.activeWsId === w.id) } }))
  await invoke('workspaces:saveState', snap.workspaceId, snap.state)
}

export function applyRestoreChoice(init: InitialSession): void {
  set({ restorePrompt: undefined })
  const open: Record<string, RuntimeWorkspace> = {}
  for (const id of init.openWorkspaceIds) {
    const w = init.workspaces.find((x) => x.id === id)
    if (w) open[id] = toRuntime(w, id === init.activeWorkspaceId)
  }
  const openOrder = init.openWorkspaceIds.filter((id) => open[id])
  set({ workspaces: init.workspaces, open, openOrder, activeWsId: open[init.activeWorkspaceId] ? init.activeWorkspaceId : openOrder[0] })
  persistSession()
}

export function dismissRestorePrompt(): void {
  set({ restorePrompt: undefined })
}

// ---------------------------------------------------------------- lifecycle / suspension

export async function suspendTab(tabId: string): Promise<void> {
  const f = findTab(tabId)
  if (!f || f.tab.suspended || isInternal(f.tab.url)) return
  const wcId = wcIdFor(tabId)
  let scrollY: number | undefined
  let mem: number | null = null
  if (wcId !== null) {
    ;[scrollY, mem] = await Promise.all([invoke('guest:scrollY', wcId).catch(() => undefined), invoke('guest:pageMemory', wcId).catch(() => null)])
  }
  updateTab(tabId, { suspended: true, scrollY, pendingScrollY: scrollY, memoryReleasedKB: mem ?? undefined, loading: false, audible: false, devtoolsDocked: false })
}

export function wakeTab(tabId: string): void {
  updateTab(tabId, { suspended: false })
}

export function suspendAllBackground(): void {
  for (const ws of Object.values(S().open)) {
    const visible = new Set(ws.id === S().activeWsId ? visibleTabIds(ws) : [])
    for (const t of ws.tabs) if (!visible.has(t.id) && !t.suspended) void suspendTab(t.id)
  }
}

export function tabLifecycle(t: RuntimeTab, visible: boolean): 'active' | 'background' | 'idle' | 'suspended' {
  if (t.suspended) return 'suspended'
  if (visible) return 'active'
  const threshold = SUSPEND_MS[getSetting('tabs.suspendAfter')]
  const idleAfter = isFinite(threshold) ? threshold / 2 : 10 * 60_000
  return Date.now() - t.lastActive > idleAfter ? 'idle' : 'background'
}

/** Periodic automatic suspension according to settings. */
export function runSuspensionPass(): void {
  const threshold = SUSPEND_MS[getSetting('tabs.suspendAfter')]
  const mode = getSetting('performance.mode')
  // Performance modes only change SPECTER's own behaviour:
  //  gaming / battery → background tabs sleep after at most 5 minutes
  //  coding / research → tabs stay awake twice as long (docs, references)
  //  trading → finance / trading pages never sleep
  const effective = mode === 'gaming' || mode === 'battery' ? Math.min(threshold, 5 * 60_000) : mode === 'coding' || mode === 'research' ? threshold * 2 : threshold
  if (!isFinite(effective)) return
  const now = Date.now()
  const s = S()
  for (const ws of Object.values(s.open)) {
    const isActiveWs = ws.id === s.activeWsId
    const visible = new Set(isActiveWs ? visibleTabIds(ws) : [])
    for (const t of ws.tabs) {
      if (t.suspended || visible.has(t.id) || isInternal(t.url)) continue
      if (t.pinned && getSetting('tabs.suspendExcludePinned')) continue
      if (t.audible && getSetting('tabs.suspendExcludeAudible')) continue
      if (mode === 'trading' && detectPageKind(t.url, t.title) === 'finance') continue
      const limit = !isActiveWs && getSetting('workspaces.suspendInactive') ? effective / 2 : effective
      if (now - t.lastActive > limit) void suspendTab(t.id)
    }
  }
}

// ---------------------------------------------------------------- permission prompts

export function addPermissionRequest(req: PermissionRequest, tabId: string): void {
  const f = findTab(tabId)
  if (!f) return
  updateTab(tabId, { permissionRequests: [...(f.tab.permissionRequests ?? []), req] })
}

export function resolvePermissionRequest(tabId: string, requestId: string, decision: 'allow' | 'deny', remember: boolean): void {
  invoke('permissions:respond', requestId, decision, remember).catch(() => undefined)
  const f = findTab(tabId)
  if (f) updateTab(tabId, { permissionRequests: (f.tab.permissionRequests ?? []).filter((r) => r.requestId !== requestId) })
}
