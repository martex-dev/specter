// Core domain types shared by main, preload and renderer.

export type ID = string

export type TabLifecycle = 'active' | 'background' | 'idle' | 'suspended'

export interface TabState {
  id: ID
  url: string
  title: string
  favicon?: string
  pinned: boolean
  groupId?: ID
  muted: boolean
  /** Temporary tabs are not persisted to the workspace session. */
  temporary?: boolean
  suspended: boolean
  /** Scroll position captured on suspension so it can be restored. */
  scrollY?: number
  note?: string
  lastActive: number
  createdAt: number
  /** Zoom factor (1 = 100%). */
  zoom?: number
}

export type GroupColor = 'grey' | 'blue' | 'cyan' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'purple'

export interface TabGroup {
  id: ID
  name: string
  color: GroupColor
  collapsed: boolean
}

export type SplitPreset =
  | 'single'
  | '50/50'
  | '33/67'
  | '67/33'
  | '25/75'
  | 'rows-50/50'
  | 'three-column'
  | 'quadrant'
  | 'four-panel'

export interface SplitLayout {
  preset: SplitPreset
  /** Tab ids shown in panes, in pane order. */
  panes: ID[]
  /** Custom fractional sizes for column/row tracks (overrides preset ratios). */
  sizes?: number[]
}

export interface WorkspaceState {
  tabs: TabState[]
  groups: TabGroup[]
  activeTabId?: ID
  layout: SplitLayout
}

export interface Workspace {
  id: ID
  profileId: ID
  name: string
  icon: string
  color: string
  sort: number
  createdAt: number
  updatedAt: number
  state: WorkspaceState
}

export interface WorkspaceSnapshot {
  id: ID
  workspaceId: ID
  label: string
  createdAt: number
  tabCount: number
  state: WorkspaceState
}

export interface SavedLayout {
  id: ID
  name: string
  layout: SplitLayout
  urls: string[]
}

export interface Profile {
  id: ID
  name: string
  color: string
  partition: string
  createdAt: number
}

export interface HistoryEntry {
  id: number
  url: string
  title: string
  visitedAt: number
  workspaceId?: ID
  profileId: ID
  visitCount?: number
}

export interface HistoryQuery {
  text?: string
  from?: number
  to?: number
  domain?: string
  workspaceId?: ID
  limit?: number
  offset?: number
}

export interface Bookmark {
  id: ID
  parentId: ID | null
  kind: 'bookmark' | 'folder'
  title: string
  url?: string
  tags: string[]
  workspaceId?: ID
  sort: number
  createdAt: number
  favicon?: string
}

export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadInfo {
  id: ID
  url: string
  filename: string
  savePath: string
  mime: string
  totalBytes: number
  receivedBytes: number
  state: DownloadState
  startedAt: number
  endedAt?: number
  /** Bytes per second, measured over the last progress interval. */
  speed: number
  canResume: boolean
}

export type PermissionKind =
  | 'media'
  | 'camera'
  | 'microphone'
  | 'notifications'
  | 'geolocation'
  | 'clipboard-read'
  | 'clipboard-sanitized-write'
  | 'fullscreen'
  | 'pointerLock'
  | 'midi'
  | 'display-capture'
  | 'popups'
  | 'javascript'
  | 'idle-detection'
  | 'window-management'
  | 'storage-access'
  | string

export type PermissionDecision = 'allow' | 'deny' | 'ask'

export interface SitePermission {
  origin: string
  permission: PermissionKind
  decision: PermissionDecision
  updatedAt: number
}

export interface PermissionRequest {
  requestId: ID
  webContentsId: number
  origin: string
  permission: PermissionKind
  details?: string
}

export interface ClosedTab {
  id: number
  url: string
  title: string
  favicon?: string
  workspaceId?: ID
  closedAt: number
  index: number
}

export interface Note {
  id: ID
  title: string
  body: string
  tags: string[]
  workspaceId?: ID
  sourceUrl?: string
  createdAt: number
  updatedAt: number
  pinned?: boolean
}

export interface ContextMenuParams {
  webContentsId: number
  x: number
  y: number
  linkURL: string
  linkText: string
  srcURL: string
  mediaType: string
  selectionText: string
  isEditable: boolean
  pageURL: string
  frameURL: string
  titleText: string
  hasImageContents: boolean
  editFlags: {
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canSelectAll: boolean
    canUndo: boolean
    canRedo: boolean
  }
  misspelledWord: string
  dictionarySuggestions: string[]
}

export interface FoundInPage {
  requestId: number
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

export interface PageStats {
  words: number
  characters: number
  readingMinutes: number
  headings: { level: number; text: string; id?: string }[]
  links: { href: string; text: string }[]
  images: { src: string; alt: string; width: number; height: number }[]
  title: string
  lang?: string
  description?: string
}

export interface ReaderArticle {
  title: string
  byline?: string
  siteName?: string
  content: string // sanitized HTML
  textContent: string
  length: number
  excerpt?: string
  url: string
}

export interface SecurityInfo {
  url: string
  origin: string
  protocol: string
  secure: boolean
  certificate?: {
    issuer: string
    subject: string
    validFrom: number
    validTo: number
    fingerprint: string
  }
  cookies: number
  permissions: SitePermission[]
  storageBytes?: number
}

export interface Suggestion {
  kind: 'history' | 'bookmark' | 'tab' | 'search' | 'url' | 'command' | 'workspace' | 'note' | 'remote' | 'market' | 'ai'
  title: string
  subtitle?: string
  url?: string
  score: number
  data?: unknown
}

export interface NotificationItem {
  id: ID
  category: 'browser' | 'market' | 'ai' | 'research' | 'system' | 'downloads' | 'projects'
  title: string
  body?: string
  createdAt: number
  read: boolean
}

export interface AppMetricsEntry {
  pid: number
  type: string
  name?: string
  cpu: number
  memoryKB: number
  webContentsId?: number
  url?: string
  title?: string
}

export interface DiagnosticCheck {
  id: string
  label: string
  status: 'ok' | 'warn' | 'error' | 'unknown'
  detail: string
}

export interface LogEntry {
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
  data?: unknown
}
