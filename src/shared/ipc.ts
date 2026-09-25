// Typed IPC contract between the main process and the SPECTER chrome renderer.
//
// Feature modules extend these interfaces through module augmentation:
//
//   declare module '@shared/ipc' {
//     interface IpcContract { 'market:quotes': (symbols: string[]) => Quote[] }
//   }
//
// Web pages (tab guests) never get a preload and cannot reach any of this.

import type {
  Bookmark,
  ClosedTab,
  ContextMenuParams,
  DownloadInfo,
  HistoryEntry,
  HistoryQuery,
  LogEntry,
  NotificationItem,
  PageStats,
  PermissionDecision,
  PermissionRequest,
  Profile,
  ReaderArticle,
  SavedLayout,
  SecurityInfo,
  SitePermission,
  Suggestion,
  AppMetricsEntry,
  Workspace,
  WorkspaceSnapshot,
  WorkspaceState,
  DiagnosticCheck
} from './types'
import type { SettingKey, Settings } from './settings'

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
  userData: string
  isPackaged: boolean
  gpuEnabled: boolean
}

export interface SecurityState {
  chrome: { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean; webSecurity: boolean }[]
  guests: { count: number; sandboxed: number; isolated: number; nodeIntegration: number; webSecurityOff: number }
  extensions: { count: number; names: string[] }
  sitePermissions: { allow: number; deny: number }
  ipcDomains: number
  electron: string
  chromium: string
}

export interface InitialSession {
  windowId: number
  profile: Profile
  workspaces: Workspace[]
  openWorkspaceIds: string[]
  activeWorkspaceId: string
  /** Set when a previous session exists and the user should be asked. */
  restorePrompt?: { workspaceCount: number; tabCount: number; crashed: boolean }
  /** URLs passed on the command line or by a new-window request. */
  initialUrls: string[]
  isPopoutPanel?: string
}

export interface ImportSource {
  id: 'chrome' | 'edge' | 'brave' | 'opera' | 'vivaldi' | 'firefox'
  name: string
  profiles: { name: string; path: string }[]
}

export interface ImportResult {
  bookmarks: number
  history: number
  errors: string[]
}

export interface FindOptions {
  matchCase?: boolean
  wholeWord?: boolean
  regex?: boolean
  forward?: boolean
  findNext?: boolean
}

export interface AdvancedFindResult {
  matches: number
  active: number
  error?: string
}

export interface PrivacySummary {
  trackersBlocked: number
  trackersBlockedSession: number
  cookieCount: number
  sitePermissions: number
  historyEntries: number
  downloads: number
  storageUsageBytes?: number
  cacheBytes: number
  blocklistSize: number
}

export interface ClearDataOptions {
  history?: boolean
  cookies?: boolean
  cache?: boolean
  storage?: boolean
  downloads?: boolean
  permissions?: boolean
  since?: number
}

export interface WindowOpenRequest {
  url?: string
  workspaceId?: string
  focus?: boolean
  panel?: string
}

export interface MediaState {
  webContentsId: number
  playing: boolean
  title: string
  artist?: string
  duration?: number
  currentTime?: number
  volume?: number
  rate?: number
  hasVideo: boolean
}

export interface IpcContract {
  // App
  'app:info': () => AppInfo
  'app:quit': () => void
  'app:relaunch': () => void
  'app:openExternal': (url: string) => void
  'app:showItemInFolder': (path: string) => void
  'app:openPath': (path: string) => string
  'app:clipboardWrite': (text: string) => void
  'app:clipboardWriteImage': (dataUrl: string) => void
  'app:clipboardRead': () => string
  'app:pickFolder': (title?: string) => string | null
  'app:pickFile': (filters?: { name: string; extensions: string[] }[]) => string | null
  'app:readTextFile': (path: string) => string
  'app:saveFile': (defaultName: string, content: string) => string | null
  'app:notify': (n: { title: string; body?: string; category: NotificationItem['category'] }) => void
  'app:gpuInfo': () => unknown
  'app:setDefaultBrowser': () => void
  'app:checkUpdates': () => { checked: boolean; current: string; latest?: string; url?: string; name?: string; publishedAt?: string; newer: boolean; error?: string }
  'app:securityState': () => SecurityState

  // Windows
  'window:new': (req: WindowOpenRequest) => number
  'window:close': () => void
  'window:minimize': () => void
  'window:toggleMaximize': () => void
  'window:toggleFullscreen': () => void
  'window:setTitleBarOverlay': (o: { color: string; symbolColor: string; height: number }) => void
  'window:popout': (panel: string, opts?: { alwaysOnTop?: boolean }) => void
  'window:list': () => { id: number; title: string; focused: boolean }[]
  'window:setTitle': (title: string) => void
  'window:ownerOf': (workspaceId: string) => number | null
  'window:focus': (windowId: number) => void
  'window:mergeInto': () => number

  // Settings
  'settings:getAll': () => Settings
  'settings:set': <K extends SettingKey>(key: K, value: Settings[K]) => void
  'settings:reset': (key?: SettingKey) => void
  'settings:export': () => string | null
  'settings:import': () => boolean

  // History
  'history:add': (e: { url: string; title: string; workspaceId?: string }) => void
  'history:updateTitle': (url: string, title: string) => void
  'history:search': (q: HistoryQuery) => HistoryEntry[]
  'history:delete': (ids: number[]) => void
  'history:deleteRange': (from: number, to: number) => number
  'history:deleteDomain': (domain: string) => number
  'history:clear': () => void
  'history:topSites': (limit: number) => { url: string; title: string; visits: number }[]
  'history:count': () => number
  'history:activity': (since: number) => { day: string; visits: number; domains: number }[]

  // Search history
  'searches:add': (q: string) => void
  'searches:recent': (limit: number) => { query: string; ts: number }[]
  'searches:clear': () => void

  // Bookmarks
  'bookmarks:list': () => Bookmark[]
  'bookmarks:add': (b: Partial<Bookmark> & { title: string; kind: Bookmark['kind'] }) => Bookmark
  'bookmarks:update': (id: string, patch: Partial<Bookmark>) => void
  'bookmarks:remove': (id: string) => void
  'bookmarks:move': (id: string, parentId: string | null, index: number) => void
  'bookmarks:findByUrl': (url: string) => Bookmark | null
  'bookmarks:importHtml': () => number
  'bookmarks:exportHtml': () => string | null

  // Downloads
  'downloads:list': () => DownloadInfo[]
  'downloads:pause': (id: string) => void
  'downloads:resume': (id: string) => void
  'downloads:cancel': (id: string) => void
  'downloads:retry': (id: string) => void
  'downloads:open': (id: string) => void
  'downloads:showInFolder': (id: string) => void
  'downloads:remove': (id: string) => void
  'downloads:clearFinished': () => void
  'downloads:openFolder': () => void

  // Permissions
  'permissions:list': () => SitePermission[]
  'permissions:set': (origin: string, permission: string, decision: PermissionDecision) => void
  'permissions:remove': (origin: string, permission?: string) => void
  'permissions:respond': (requestId: string, decision: 'allow' | 'deny', remember: boolean) => void

  // Workspaces
  'workspaces:list': () => Workspace[]
  'workspaces:create': (w: { name: string; icon?: string; color?: string; state?: WorkspaceState }) => Workspace
  'workspaces:update': (id: string, patch: Partial<Pick<Workspace, 'name' | 'icon' | 'color' | 'sort'>>) => void
  'workspaces:delete': (id: string) => void
  'workspaces:saveState': (id: string, state: WorkspaceState) => void
  'workspaces:snapshot': (id: string, label?: string) => WorkspaceSnapshot
  'workspaces:snapshots': (id: string) => WorkspaceSnapshot[]
  'workspaces:deleteSnapshot': (snapshotId: string) => void
  'workspaces:getSnapshot': (snapshotId: string) => WorkspaceSnapshot | null
  'workspaces:export': (id: string, format: 'json' | 'markdown' | 'html') => string | null
  'workspaces:import': () => Workspace | null
  'workspaces:layouts': () => SavedLayout[]
  'workspaces:saveLayout': (l: Omit<SavedLayout, 'id'>) => SavedLayout
  'workspaces:deleteLayout': (id: string) => void

  // Window session
  'session:initial': () => InitialSession
  'session:update': (s: { openWorkspaceIds: string[]; activeWorkspaceId: string }) => void
  'session:restoreChoice': (choice: 'all' | 'clean' | { workspaceId: string }) => InitialSession
  'session:closedTabPush': (t: Omit<ClosedTab, 'id' | 'closedAt'>) => void
  'session:closedTabPop': () => ClosedTab | null
  'session:closedTabs': (limit: number) => ClosedTab[]

  // Profiles
  'profiles:list': () => Profile[]
  'profiles:create': (name: string, color: string) => Profile
  'profiles:delete': (id: string) => void
  'profiles:openWindow': (id: string) => void

  // Guests (tab web contents)
  'guest:register': (wcId: number, tabId: string) => void
  'guest:focused': (wcId: number | null, info?: { url: string; title: string }) => void
  'guest:screenshot': (wcId: number, opts: { fullPage?: boolean; toClipboard?: boolean }) => string | null
  'guest:thumbnail': (wcId: number) => string | null
  'guest:stats': (wcId: number) => PageStats | null
  'guest:reader': (wcId: number) => ReaderArticle | null
  'guest:cleanText': (wcId: number) => string
  'guest:selection': (wcId: number) => string
  'guest:findAdvanced': (wcId: number, query: string, opts: FindOptions) => AdvancedFindResult
  'guest:findAdvancedStep': (wcId: number, forward: boolean) => AdvancedFindResult
  'guest:findAdvancedClear': (wcId: number) => void
  'guest:security': (wcId: number) => SecurityInfo
  'guest:devtools': (wcId: number, mode: 'detach' | 'toggle') => void
  'guest:dockDevtools': (wcId: number, bounds: { x: number; y: number; width: number; height: number }) => void
  'guest:devtoolsBounds': (wcId: number, bounds: { x: number; y: number; width: number; height: number } | null) => void
  'guest:closeDevtools': (wcId: number) => void
  'guest:scrollY': (wcId: number) => number
  'guest:navHistory': (wcId: number) => { offset: number; title: string; url: string }[]
  'guest:setScrollY': (wcId: number, y: number) => void
  'guest:media': (wcId: number) => MediaState | null
  'guest:mediaControl': (wcId: number, action: 'play' | 'pause' | 'toggle' | 'seek' | 'rate' | 'volume' | 'pip', value?: number) => void
  'guest:savePage': (wcId: number) => string | null
  'guest:print': (wcId: number) => void
  'guest:copyImageAt': (wcId: number, x: number, y: number) => void
  'guest:setZoom': (wcId: number, factor: number) => void
  'guest:pageMemory': (wcId: number) => number | null

  // Search / omnibox
  'search:suggest': (text: string) => Suggestion[]
  'search:remote': (text: string) => string[]

  // Privacy
  'privacy:summary': () => PrivacySummary
  'privacy:clear': (o: ClearDataOptions) => void
  'privacy:clearOrigin': (origin: string) => void
  'privacy:cookies': (origin?: string) => { domain: string; name: string; secure: boolean; httpOnly: boolean; expires?: number }[]
  'privacy:blockedLog': () => { url: string; host: string; ts: number; tabUrl: string }[]

  // Metrics
  'metrics:app': () => AppMetricsEntry[]

  // Logs / diagnostics
  'logs:list': (limit?: number) => LogEntry[]
  'logs:clear': () => void
  'logs:write': (level: LogEntry['level'], scope: string, message: string) => void
  'diagnostics:run': () => DiagnosticCheck[]
  'diagnostics:export': () => string | null

  // Import
  'import:sources': () => ImportSource[]
  'import:run': (sourceId: ImportSource['id'], profilePath: string, what: { bookmarks: boolean; history: boolean }) => ImportResult

  // Notifications center
  'notifications:list': () => NotificationItem[]
  'notifications:markRead': (id?: string) => void
  'notifications:clear': () => void

  // Extensions (Electron supports a subset of the Chrome extension APIs)
  'extensions:list': () => { id: string; name: string; version: string; path: string }[]
  'extensions:load': () => { id: string; name: string } | null
  'extensions:remove': (id: string) => void
}

export interface IpcEvents {
  'downloads:changed': DownloadInfo
  'permissions:request': PermissionRequest
  'guest:contextMenu': ContextMenuParams
  'guest:openUrl': { url: string; disposition: 'foreground-tab' | 'background-tab' | 'new-window'; sourceWcId: number }
  'guest:crashed': { wcId: number; reason: string }
  'guest:unresponsive': { wcId: number; responsive: boolean }
  'guest:certificateError': { wcId: number; url: string; error: string }
  'guest:mediaChanged': MediaState
  'command:run': { id: string; args?: unknown }
  'settings:changed': { key: SettingKey; value: unknown }
  'notifications:new': NotificationItem
  'window:state': { maximized: boolean; fullscreen: boolean; focused: boolean }
  'workspaces:changed': { id?: string }
  'bookmarks:changed': void
  'privacy:blocked': { count: number; total: number; perTab?: Record<number, number> }
}

export type IpcChannel = keyof IpcContract
export type IpcEvent = keyof IpcEvents
export type IpcArgs<C extends IpcChannel> = Parameters<IpcContract[C]>
export type IpcResult<C extends IpcChannel> = Awaited<ReturnType<IpcContract[C]>>

/** Channel domains the preload is willing to forward. */
export const IPC_DOMAINS = [
  'app',
  'window',
  'settings',
  'history',
  'searches',
  'bookmarks',
  'downloads',
  'permissions',
  'workspaces',
  'session',
  'profiles',
  'guest',
  'search',
  'privacy',
  'metrics',
  'logs',
  'diagnostics',
  'import',
  'notifications',
  'extensions',
  'ai',
  'market',
  'system',
  'notes',
  'research',
  'knowledge',
  'projects',
  'terminal',
  'git',
  'automation',
  'portfolio',
  'paper',
  'alerts',
  'bus',
  'net',
  'command',
  'tools',
  'plugins',
  'media',
  'widgets',
  'kv',
  'crypto',
  'finance'
] as const
