// Sidebar web apps (messengers, music, AI chats…) — shared types, the built-in
// catalog, IPC contract augmentation and pure helpers (unread-title parsing,
// URL / name validation, user-agent strings). Everything here is side-effect
// free so it can be unit tested.

declare module '../ipc' {
  interface IpcContract {
    /** Apps of the active profile, in dock order. */
    'webapps:list': () => WebApp[]
    /** Insert (no id / unknown id) or patch (known id) an app. Returns the stored app. */
    'webapps:save': (input: WebAppInput) => WebApp
    'webapps:delete': (id: string) => void
    /** New dock order (ids of the active profile's apps). */
    'webapps:reorder': (ids: string[]) => void
    /** Favicon cache (host → favicon URL) learned from pages the apps loaded. */
    'webapps:icons': () => Record<string, string>
    /** Marks a guest webContents as a sidebar app (main then ignores its beforeunload so it can't block closing). */
    'webapps:guest': (wcId: number) => void
  }
  interface IpcEvents {
    'webapps:changed': { profileId: string }
  }
}

export type WebAppCategory = 'chat' | 'music' | 'social' | 'ai' | 'work' | 'video'

export interface CatalogApp {
  id: string
  name: string
  url: string
  /** Brand colour for the letter-tile fallback icon. */
  color: string
  category: WebAppCategory
  /** Load with a mobile user agent by default (compact layouts that suit a sidebar). */
  mobile?: boolean
  /** Default panel width. */
  width?: number
  /** Title carries song names rather than unread counts; badge parsing off by default. */
  noBadges?: boolean
  /** Playback needs Widevine DRM, which stock Electron does not ship. */
  drm?: boolean
  /** Short description shown in the picker. */
  blurb: string
}

export interface WebApp {
  id: string
  /** Catalog entry this app came from, or null for a custom app. */
  catalogId: string | null
  name: string
  /** Home URL. */
  url: string
  /** Cached favicon URL reported by the page itself (never a third-party service). */
  icon: string | null
  color: string
  /** Mobile user agent. */
  mobile: boolean
  muted: boolean
  /** Page zoom factor (1 = 100%). */
  zoom: number
  /** Toast when the unread count rises while the panel is closed. */
  notify: boolean
  /** Parse the page title for unread counts. */
  badges: boolean
  /** Panel width override in px (null = default). */
  width: number | null
  sort: number
  createdAt: number
}

export type WebAppInput = Partial<Omit<WebApp, 'createdAt' | 'sort'>>

export const WEBAPP_CATEGORIES: { id: WebAppCategory; label: string }[] = [
  { id: 'chat', label: 'Messengers' },
  { id: 'music', label: 'Music' },
  { id: 'ai', label: 'AI assistants' },
  { id: 'social', label: 'Social' },
  { id: 'work', label: 'Productivity' },
  { id: 'video', label: 'Video' }
]

export const WEBAPP_CATALOG: CatalogApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com/', color: '#25D366', category: 'chat', width: 460, blurb: 'Chats from WhatsApp Web (link with your phone)' },
  { id: 'telegram', name: 'Telegram', url: 'https://web.telegram.org/a/', color: '#2AABEE', category: 'chat', width: 420, blurb: 'Telegram Web' },
  { id: 'discord', name: 'Discord', url: 'https://discord.com/app', color: '#5865F2', category: 'chat', width: 520, blurb: 'Servers, DMs and voice' },
  { id: 'messenger', name: 'Messenger', url: 'https://www.messenger.com/', color: '#0A7CFF', category: 'chat', width: 440, blurb: 'Facebook Messenger' },
  { id: 'slack', name: 'Slack', url: 'https://app.slack.com/client', color: '#4A154B', category: 'work', width: 520, blurb: 'Workspaces and channels' },
  { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/', color: '#1DB954', category: 'music', width: 420, noBadges: true, drm: true, blurb: 'Spotify Web Player' },
  { id: 'ytmusic', name: 'YouTube Music', url: 'https://music.youtube.com/', color: '#FF0033', category: 'music', width: 420, noBadges: true, blurb: 'Music, playlists and mixes' },
  { id: 'applemusic', name: 'Apple Music', url: 'https://music.apple.com/', color: '#FA243C', category: 'music', width: 420, noBadges: true, drm: true, blurb: 'Apple Music on the web' },
  { id: 'soundcloud', name: 'SoundCloud', url: 'https://soundcloud.com/', color: '#FF5500', category: 'music', width: 420, noBadges: true, blurb: 'Tracks, mixes and podcasts' },
  { id: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv/', color: '#9146FF', category: 'video', width: 480, noBadges: true, blurb: 'Live streams and chat' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', color: '#10A37F', category: 'ai', width: 460, noBadges: true, blurb: 'OpenAI ChatGPT' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/', color: '#D97757', category: 'ai', width: 460, noBadges: true, blurb: 'Anthropic Claude' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', color: '#4E86F7', category: 'ai', width: 460, noBadges: true, blurb: 'Google Gemini' },
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/mail/', color: '#EA4335', category: 'work', width: 520, blurb: 'Mail with unread count' },
  { id: 'gcalendar', name: 'Google Calendar', url: 'https://calendar.google.com/calendar/', color: '#4285F4', category: 'work', width: 480, noBadges: true, blurb: 'Your schedule' },
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so/', color: '#37352F', category: 'work', width: 520, noBadges: true, blurb: 'Docs and notes' },
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/', color: '#E1306C', category: 'social', mobile: true, width: 420, blurb: 'Feed and DMs (mobile layout)' },
  { id: 'x', name: 'X', url: 'https://x.com/home', color: '#0F1419', category: 'social', mobile: true, width: 420, blurb: 'X / Twitter (mobile layout)' },
  { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/', color: '#FF4500', category: 'social', mobile: true, width: 440, blurb: 'Communities (mobile layout)' },
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/', color: '#111111', category: 'video', width: 440, noBadges: true, blurb: 'Short videos' }
]

export function catalogApp(id: string | null | undefined): CatalogApp | undefined {
  return id ? WEBAPP_CATALOG.find((c) => c.id === id) : undefined
}

// ------------------------------------------------------------------ unread badges

/** Unread state whose exact count is unknown (e.g. "• Discord", "* Slack"). */
export const UNREAD_DOT = -1

const INBOX_WORDS = '(?:inbox|posteingang|bo[iî]te de r[ée]ception|bandeja de entrada|posta in arrivo|caixa de entrada|входящие|mail|messages?|chats?|notifications?)'
const RE_LEADING = /^\s*[([](\d{1,5})\+?[)\]]\s*/
const RE_WORDS =
  /(?:^|[\s|·•:,\-–—(])(\d{1,5})\+?\s+(?:unread|new|ungelesen|non lus?|no le[ií]dos?|non letti|непрочитанн\S*)(?:\s+(?:messages?|items?|notifications?|chats?|conversations?|mentions?))?(?=\s*(?:$|[|·•:,)\-–—]))/i
const RE_INBOX = new RegExp('^\\s*' + INBOX_WORDS + '\\s*\\((\\d{1,5})\\+?\\)', 'i')
const RE_DOT = /^\s*(?:[•●◉⦁]|\*|!)\s/

/**
 * Parses unread counts that web apps put in their document title:
 * "(3) WhatsApp", "[12] Telegram", "Discord | 5 unread", "Inbox (12) - me@x.com - Gmail".
 * Returns 0 when there is nothing unread, a positive count, or UNREAD_DOT when the
 * title only flags "something unread" ("• Discord", "* Slack | general").
 */
export function parseUnread(title: string | null | undefined): number {
  if (!title) return 0
  const t = title.slice(0, 300)
  let m = RE_LEADING.exec(t)
  if (m) return clampCount(m[1])
  m = RE_INBOX.exec(t)
  if (m) return clampCount(m[1])
  m = RE_WORDS.exec(t)
  if (m) return clampCount(m[1])
  if (RE_DOT.test(t)) return UNREAD_DOT
  return 0
}

function clampCount(s: string): number {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 99999) : 0
}

/** Label for a dock badge: "" for a dot, "99+" beyond 99. */
export function badgeLabel(n: number): string {
  if (n <= 0) return ''
  return n > 99 ? '99+' : String(n)
}

// ------------------------------------------------------------------ validation

const PRIVATE_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i

/**
 * Normalises user input into an http(s) URL suitable as a web app home page.
 * Adds https:// when the scheme is missing (http:// for localhost / private IPs).
 * Returns null for anything that isn't a plain web URL (javascript:, file:, specter://,
 * credentials in the URL, hosts without a dot…).
 */
export function normalizeAppUrl(input: string | null | undefined): string | null {
  let s = (input ?? '').trim()
  if (!s || s.length > 2048 || /\s/.test(s)) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null // mailto:, javascript:, data: …
    const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '')
    s = (PRIVATE_HOST.test(host) ? 'http://' : 'https://') + s
  }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null
  const host = u.hostname
  if (!host) return null
  if (!PRIVATE_HOST.test(host) && !host.includes('.') && !host.startsWith('[')) return null
  if (/^[.-]|[.-]$/.test(host)) return null
  return u.href
}

/** Cleans a display name; falls back to a name derived from the URL. */
export function cleanAppName(name: string | null | undefined, url?: string): string {
  const n = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (n) return n
  return url ? nameFromUrl(url) : 'Web app'
}

export function nameFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^(www|web|app|m|mobile)\./i, '')
    const label = h.split('.')[0] || h
    return label.charAt(0).toUpperCase() + label.slice(1)
  } catch {
    return 'Web app'
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Favicon-cache key: host including a non-default port (so localhost apps don't share icons). */
export function iconKey(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** True when the page host is the app's home host or one is a subdomain of the other. */
export function sameAppHost(pageUrl: string, homeUrl: string): boolean {
  const a = iconKey(pageUrl)
  const b = iconKey(homeUrl)
  if (!a || !b) return false
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a)
}

export function originOfUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : ''
  } catch {
    return ''
  }
}

/** Letter shown on the fallback icon tile. */
export function appLetter(name: string): string {
  const ch = [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c))
  return (ch ?? '?').toUpperCase()
}

/** Deterministic tile colour for custom apps. */
export function colorFor(seed: string): string {
  const palette = ['#5b8def', '#e0795b', '#3fb68b', '#b276e8', '#d9a441', '#e05b8f', '#4fb3c8', '#8f9bb3']
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return palette[h % palette.length]
}

export function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)
}

/** Allowed zoom factors for web app panels. */
export const WEBAPP_ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]

export function clampZoom(z: unknown): number {
  const n = typeof z === 'number' && Number.isFinite(z) ? z : 1
  return Math.min(3, Math.max(0.25, Math.round(n * 100) / 100))
}

/** Picks the best favicon from a page-favicon-updated list (prefers svg/png, skips data: blobs over 64 KB). */
export function pickFavicon(favicons: string[] | null | undefined): string | null {
  const list = (favicons ?? []).filter((f) => typeof f === 'string' && (/^https?:\/\//i.test(f) || (f.startsWith('data:image/') && f.length < 65536)))
  if (!list.length) return null
  return list.find((f) => /\.svg(\?|$)/i.test(f)) ?? list.find((f) => /\.png(\?|$)/i.test(f)) ?? list[0]
}

// ------------------------------------------------------------------ user agents

/** Major Chrome version from a UA string ("152"), or "152" when absent. */
export function chromeMajor(ua: string): string {
  return /Chrome\/(\d+)/.exec(ua)?.[1] ?? '152'
}

/**
 * Desktop UA without Electron / app tokens. Some sites (Google sign-in, WhatsApp)
 * refuse or degrade embedded-browser user agents.
 */
export function desktopUserAgent(ua: string): string {
  return ua
    .replace(/\s(?!(?:Chrome|Safari|AppleWebKit|Mobile|Version|Gecko|Firefox|Edg)\/)[A-Za-z][\w.-]*\/[\w.+-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Chrome-on-Android UA (reduced form) matching the embedded Chromium version. */
export function mobileUserAgent(ua: string): string {
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor(ua)}.0.0.0 Mobile Safari/537.36`
}
