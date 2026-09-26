// Settings schema and defaults. Settings are stored as individual key/value
// rows in SQLite so partial updates never rewrite unrelated state.

export type ThemeId = 'specter' | 'neon' | 'aurora' | 'terminal' | 'paper' | 'synthwave'
export type MotionLevel = 'full' | 'reduced' | 'off'
export type StartupBehavior = 'restore' | 'newtab' | 'workspace' | 'nothing'
export type SuspendAfter = 'never' | '5m' | '15m' | '30m' | '1h' | 'auto'
export type PerformanceMode = 'normal' | 'coding' | 'ml' | 'research' | 'trading' | 'gaming' | 'battery'
export type Density = 'comfortable' | 'compact'

export interface SearchEngine {
  id: string
  name: string
  /** URL template with %s placeholder for the encoded query. */
  template: string
  suggest?: string
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?type=list&q=%s' },
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  { id: 'brave', name: 'Brave Search', template: 'https://search.brave.com/search?q=%s' },
  { id: 'startpage', name: 'Startpage', template: 'https://www.startpage.com/do/search?q=%s' },
  { id: 'ecosia', name: 'Ecosia', template: 'https://www.ecosia.org/search?q=%s' },
  { id: 'kagi', name: 'Kagi', template: 'https://kagi.com/search?q=%s' },
  { id: 'perplexity', name: 'Perplexity', template: 'https://www.perplexity.ai/search?q=%s' }
]

export interface QuickLink {
  id: string
  title: string
  url: string
}

export interface Settings {
  // General
  'general.onboarded': boolean
  'general.startup': StartupBehavior
  'general.startupWorkspace': string
  'general.homepage': string
  'general.runInBackground': boolean
  'general.confirmQuitWithTabs': boolean
  'general.activeProfile': string

  // Appearance
  'appearance.theme': ThemeId
  'appearance.palette': string
  'appearance.accent': string
  /** Per-user overrides of the theme's layout (tab style, frame, dock side, omnibox). */
  'appearance.layout': { tabs?: 'chrome' | 'pill' | 'angled' | 'bracket' | 'underline' | 'block'; frame?: 'flush' | 'floating'; rail?: 'left' | 'right'; omnibox?: 'standard' | 'centered' }
  'appearance.effects': boolean
  /** Automatic theme switching: off, follow Windows light/dark, or a day/night schedule. */
  'appearance.auto': { mode: 'off' | 'system' | 'schedule'; dayTheme: ThemeId; nightTheme: ThemeId; dayStart: string; nightStart: string }
  'appearance.wallpaper': string
  'appearance.motion': MotionLevel
  'appearance.density': Density
  'appearance.uiScale': number
  'appearance.showBookmarksBar': boolean
  'appearance.showStatusBar': boolean
  'appearance.showHud': boolean
  'appearance.showSideRail': boolean
  'appearance.verticalTabs': boolean
  'appearance.verticalTabsOpen': boolean
  'appearance.fontFamily': string

  // Sidebar (dock)
  'sidebar.position': 'theme' | 'left' | 'right'
  'sidebar.hiddenItems': string[]
  'sidebar.panelWidths': Record<string, number>

  // Browser / tabs
  'tabs.suspendAfter': SuspendAfter
  'tabs.suspendExcludePinned': boolean
  'tabs.suspendExcludeAudible': boolean
  'tabs.showPreviews': boolean
  'tabs.newTabPosition': 'end' | 'afterActive'
  'tabs.closeOnDoubleClick': boolean
  'browser.defaultZoom': number
  'browser.hardwareAcceleration': boolean
  'browser.smoothScrolling': boolean
  'browser.spellcheck': boolean

  // Search
  'search.engine': string
  'search.customTemplate': string
  'search.remoteSuggestions': boolean
  'search.keepHistory': boolean

  // Privacy
  'privacy.blockTrackers': boolean
  'privacy.sendDNT': boolean
  'privacy.sendGPC': boolean
  'privacy.blockThirdPartyCookies': boolean
  'privacy.clearOnExit': boolean
  'privacy.httpsUpgrade': boolean
  'privacy.recordHistory': boolean
  'privacy.activityLog': boolean

  // Downloads
  'downloads.directory': string
  'downloads.askWhereToSave': boolean

  // AI
  'ai.enabled': boolean
  'ai.provider': 'ollama' | 'disabled'
  'ai.ollamaUrl': string
  'ai.model': string
  'ai.embeddingModel': string
  'ai.temperature': number
  'ai.permissions': ('read' | 'suggest' | 'write' | 'execute')[]
  'ai.sidebarWidth': number

  // Markets
  'markets.enabled': boolean
  'markets.provider': 'binance' | 'coingecko' | 'coinbase'
  'markets.tickerSymbols': string[]
  'markets.showTickerInHud': boolean
  'markets.quote': string

  // Workspaces
  'workspaces.suspendInactive': boolean

  // Research / Knowledge
  'research.indexPages': boolean
  'knowledge.semanticSearch': boolean

  // Developer
  'developer.enabled': boolean
  'developer.shell': 'powershell' | 'cmd' | 'wsl'
  'developer.projectRoots': string[]

  // Performance
  'performance.mode': PerformanceMode
  'performance.hudPollMs': number

  // Notifications
  'notifications.enabled': boolean
  'notifications.categories': Record<string, boolean>

  // Keyboard
  'keyboard.bindings': Record<string, string>

  // New tab
  'newtab.showClock': boolean
  'newtab.showMarkets': boolean
  'newtab.showSystem': boolean
  'newtab.showRecent': boolean
  'newtab.showQuickLinks': boolean
  'newtab.quickLinks': QuickLink[]
  'newtab.widgets': string[]

  // Advanced
  'advanced.experimental': boolean
  'advanced.logLevel': 'debug' | 'info' | 'warn' | 'error'
  'advanced.tray': boolean
  'advanced.checkUpdates': boolean
  'advanced.updateRepo': string
}

export type SettingKey = keyof Settings

export const DEFAULT_SETTINGS: Settings = {
  'general.onboarded': false,
  'general.startup': 'restore',
  'general.startupWorkspace': '',
  'general.homepage': 'specter://newtab',
  'general.runInBackground': false,
  'general.confirmQuitWithTabs': false,
  'general.activeProfile': 'default',

  'appearance.theme': 'specter',
  'appearance.palette': '',
  'appearance.accent': '',
  'appearance.layout': {},
  'appearance.effects': true,
  'appearance.auto': { mode: 'off', dayTheme: 'paper', nightTheme: 'specter', dayStart: '07:00', nightStart: '19:00' },
  'appearance.wallpaper': '',
  'appearance.motion': 'full',
  'appearance.density': 'comfortable',
  'appearance.uiScale': 1,
  'appearance.showBookmarksBar': true,
  'appearance.showStatusBar': true,
  'appearance.showHud': true,
  'appearance.showSideRail': true,
  'appearance.verticalTabs': false,
  'appearance.verticalTabsOpen': true,
  'appearance.fontFamily': '',

  'sidebar.position': 'theme',
  'sidebar.hiddenItems': [],
  'sidebar.panelWidths': {},

  'tabs.suspendAfter': '30m',
  'tabs.suspendExcludePinned': true,
  'tabs.suspendExcludeAudible': true,
  'tabs.showPreviews': true,
  'tabs.newTabPosition': 'afterActive',
  'tabs.closeOnDoubleClick': false,
  'browser.defaultZoom': 1,
  'browser.hardwareAcceleration': true,
  'browser.smoothScrolling': true,
  'browser.spellcheck': true,

  'search.engine': 'duckduckgo',
  'search.customTemplate': '',
  'search.remoteSuggestions': false,
  'search.keepHistory': true,

  'privacy.blockTrackers': true,
  'privacy.sendDNT': false,
  'privacy.sendGPC': true,
  'privacy.blockThirdPartyCookies': false,
  'privacy.clearOnExit': false,
  'privacy.httpsUpgrade': true,
  'privacy.recordHistory': true,
  'privacy.activityLog': true,

  'downloads.directory': '',
  'downloads.askWhereToSave': false,

  'ai.enabled': true,
  'ai.provider': 'ollama',
  'ai.ollamaUrl': 'http://127.0.0.1:11434',
  'ai.model': '',
  'ai.embeddingModel': 'nomic-embed-text',
  'ai.temperature': 0.4,
  'ai.permissions': ['read', 'suggest'],
  'ai.sidebarWidth': 380,

  'markets.enabled': true,
  'markets.provider': 'binance',
  'markets.tickerSymbols': ['BTC', 'ETH', 'SOL'],
  'markets.showTickerInHud': true,
  'markets.quote': 'USDT',

  'workspaces.suspendInactive': true,

  'research.indexPages': false,
  'knowledge.semanticSearch': false,

  'developer.enabled': true,
  'developer.shell': 'powershell',
  'developer.projectRoots': [],

  'performance.mode': 'normal',
  'performance.hudPollMs': 2000,

  'notifications.enabled': true,
  'notifications.categories': {
    browser: true,
    market: true,
    ai: true,
    research: true,
    system: true,
    downloads: true,
    projects: true
  },

  'keyboard.bindings': {},

  'newtab.showClock': true,
  'newtab.showMarkets': true,
  'newtab.showSystem': true,
  'newtab.showRecent': true,
  'newtab.showQuickLinks': true,
  'newtab.quickLinks': [
    { id: 'gh', title: 'GitHub', url: 'https://github.com' },
    { id: 'yt', title: 'YouTube', url: 'https://www.youtube.com' },
    { id: 'gm', title: 'Gmail', url: 'https://mail.google.com' },
    { id: 'tv', title: 'TradingView', url: 'https://www.tradingview.com' },
    { id: 'dc', title: 'Discord', url: 'https://discord.com/app' },
    { id: 'hn', title: 'Hacker News', url: 'https://news.ycombinator.com' }
  ],
  'newtab.widgets': [],

  'advanced.experimental': false,
  'advanced.logLevel': 'info',
  'advanced.tray': false,
  'advanced.checkUpdates': false,
  'advanced.updateRepo': ''
}

export const SUSPEND_MS: Record<SuspendAfter, number> = {
  never: Infinity,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  auto: 20 * 60_000
}

export function searchUrl(settings: Pick<Settings, 'search.engine' | 'search.customTemplate'>, query: string): string {
  const q = encodeURIComponent(query)
  if (settings['search.engine'] === 'custom' && settings['search.customTemplate'].includes('%s')) {
    return settings['search.customTemplate'].replace('%s', q)
  }
  const engine = SEARCH_ENGINES.find((e) => e.id === settings['search.engine']) ?? SEARCH_ENGINES[0]
  return engine.template.replace('%s', q)
}
