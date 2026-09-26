// Widgets module — shared types, pure helpers and IPC contract.
//
// Weather (Open-Meteo), news/RSS, world clocks, calendar, speed test
// (Cloudflare), currency (open.er-api.com / Frankfurter), sticky notes and
// countdowns. All network access happens in the main process.

// ---------------------------------------------------------------- weather

export interface GeoPlace {
  id: string
  name: string
  admin1?: string
  country?: string
  countryCode?: string
  lat: number
  lon: number
  timezone?: string
}

export interface WeatherHour {
  /** Unix ms. */
  time: number
  temp: number
  code: number
  precipProb: number | null
  isDay: boolean
}

export interface WeatherDay {
  /** Unix ms of local midnight. */
  date: number
  code: number
  tMax: number
  tMin: number
  precipSum: number | null
  precipProb: number | null
  sunrise: number | null
  sunset: number | null
  uvMax: number | null
}

export interface WeatherData {
  place: GeoPlace
  source: 'Open-Meteo'
  /** When SPECTER fetched it (unix ms). */
  fetchedAt: number
  timezone: string
  utcOffsetSec: number
  current: {
    time: number
    temp: number
    apparent: number
    humidity: number | null
    windKmh: number | null
    windDir: number | null
    precipMm: number | null
    pressureHpa: number | null
    cloudCover: number | null
    code: number
    isDay: boolean
  }
  hourly: WeatherHour[]
  daily: WeatherDay[]
}

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'freezing' | 'snow' | 'showers' | 'snow-showers' | 'thunder' | 'hail' | 'unknown'

/** WMO weather interpretation codes (as used by Open-Meteo). */
export function wmoInfo(code: number): { label: string; kind: WeatherKind } {
  switch (code) {
    case 0:
      return { label: 'Clear sky', kind: 'clear' }
    case 1:
      return { label: 'Mainly clear', kind: 'partly' }
    case 2:
      return { label: 'Partly cloudy', kind: 'partly' }
    case 3:
      return { label: 'Overcast', kind: 'cloudy' }
    case 45:
      return { label: 'Fog', kind: 'fog' }
    case 48:
      return { label: 'Depositing rime fog', kind: 'fog' }
    case 51:
      return { label: 'Light drizzle', kind: 'drizzle' }
    case 53:
      return { label: 'Drizzle', kind: 'drizzle' }
    case 55:
      return { label: 'Dense drizzle', kind: 'drizzle' }
    case 56:
      return { label: 'Light freezing drizzle', kind: 'freezing' }
    case 57:
      return { label: 'Freezing drizzle', kind: 'freezing' }
    case 61:
      return { label: 'Light rain', kind: 'rain' }
    case 63:
      return { label: 'Rain', kind: 'rain' }
    case 65:
      return { label: 'Heavy rain', kind: 'rain' }
    case 66:
      return { label: 'Light freezing rain', kind: 'freezing' }
    case 67:
      return { label: 'Freezing rain', kind: 'freezing' }
    case 71:
      return { label: 'Light snow', kind: 'snow' }
    case 73:
      return { label: 'Snow', kind: 'snow' }
    case 75:
      return { label: 'Heavy snow', kind: 'snow' }
    case 77:
      return { label: 'Snow grains', kind: 'snow' }
    case 80:
      return { label: 'Light showers', kind: 'showers' }
    case 81:
      return { label: 'Showers', kind: 'showers' }
    case 82:
      return { label: 'Violent showers', kind: 'showers' }
    case 85:
      return { label: 'Light snow showers', kind: 'snow-showers' }
    case 86:
      return { label: 'Snow showers', kind: 'snow-showers' }
    case 95:
      return { label: 'Thunderstorm', kind: 'thunder' }
    case 96:
      return { label: 'Thunderstorm, light hail', kind: 'hail' }
    case 99:
      return { label: 'Thunderstorm, heavy hail', kind: 'hail' }
    default:
      return { label: 'Unknown', kind: 'unknown' }
  }
}

export const cToF = (c: number): number => (c * 9) / 5 + 32

/** 16-point compass direction for a wind bearing in degrees. */
export function compass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

// ---------------------------------------------------------------- news

export interface NewsFeed {
  id: string
  url: string
  title: string
  siteUrl: string
  addedAt: number
  lastFetched: number | null
  lastError: string | null
  unread: number
  total: number
}

export interface NewsItem {
  id: string
  feedId: string
  title: string
  link: string
  author: string | null
  summary: string
  published: number | null
  fetchedAt: number
  read: boolean
}

export interface NewsSettings {
  /** Minutes between refreshes while the reader is open. */
  intervalMin: number
  /** Keep at most this many items per feed. */
  keepPerFeed: number
}

export const DEFAULT_NEWS_SETTINGS: NewsSettings = { intervalMin: 30, keepPerFeed: 200 }

export const DEFAULT_FEEDS: { url: string; title: string }[] = [
  { url: 'https://hnrss.org/frontpage', title: 'Hacker News' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', title: 'BBC News — World' },
  { url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', title: 'Ars Technica' }
]

// ---------------------------------------------------------------- calendar

export interface CalEvent {
  id: string
  title: string
  /** Unix ms. For all-day events: local midnight of the first day. */
  start: number
  /** Unix ms (exclusive). For all-day events: local midnight after the last day. */
  end: number
  allDay: boolean
  color: string
  notes: string
  location: string
  /** Minutes before start to remind; null = no reminder. */
  remindMin: number | null
  source: 'local' | 'ics'
  uid: string | null
}

export type CalEventInput = Omit<CalEvent, 'id' | 'source' | 'uid'> & { id?: string }

export interface IcsImportResult {
  file: string
  imported: number
  updated: number
  skipped: number
  recurring: number
}

/** Palette tokens usable for events/notes/countdowns (resolved as CSS variables). */
export const WIDGET_COLORS = ['accent', 'accent-2', 'accent-3', 'ok', 'warn', 'bad', 'info'] as const
export type WidgetColor = (typeof WIDGET_COLORS)[number]

// ---------------------------------------------------------------- speed test

export interface SpeedResult {
  id: string
  at: number
  /** Cloudflare data centre (IATA code), when reported. */
  colo: string | null
  latencyMs: number | null
  jitterMs: number | null
  downMbps: number | null
  upMbps: number | null
  /** Total bytes transferred (down + up). */
  bytes: number
  error?: string
}

export interface SpeedProgress {
  phase: 'latency' | 'download' | 'upload' | 'done' | 'error'
  /** 0..1 overall progress. */
  progress: number
  latencyMs?: number
  jitterMs?: number
  /** Live estimate in the current phase. */
  mbps?: number
  downMbps?: number
  upMbps?: number
  message?: string
}

export interface SpeedSample {
  bytes: number
  ms: number
}

/** Megabits per second for `bytes` transferred in `ms`. */
export function toMbps(bytes: number, ms: number): number {
  if (!(ms > 0) || !(bytes >= 0)) return 0
  return (bytes * 8) / (ms * 1000)
}

/** Linear-interpolated percentile (p in 0..1) of a numeric list. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  const idx = Math.min(1, Math.max(0, p)) * (s.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}

export function median(values: number[]): number {
  return percentile(values, 0.5)
}

/** Mean absolute difference between consecutive latency samples. */
export function jitter(latencies: number[]): number {
  if (latencies.length < 2) return 0
  let sum = 0
  for (let i = 1; i < latencies.length; i++) sum += Math.abs(latencies[i] - latencies[i - 1])
  return sum / (latencies.length - 1)
}

/**
 * Aggregated bandwidth: 90th percentile of per-request throughput, ignoring
 * requests too short to be meaningful (< minMs), like Cloudflare's own test.
 */
export function aggregateBandwidth(samples: SpeedSample[], minMs = 10): number | null {
  const speeds = samples.filter((s) => s.ms >= minMs && s.bytes > 0).map((s) => toMbps(s.bytes, s.ms))
  if (!speeds.length) return null
  return percentile(speeds, 0.9)
}

// ---------------------------------------------------------------- currency

export interface FxRates {
  base: 'USD'
  /** Units of each currency per 1 USD. */
  rates: Record<string, number>
  source: 'ExchangeRate-API (open.er-api.com)' | 'Frankfurter (ECB)'
  sourceUrl: string
  /** Provider's own "last updated" time, unix ms. */
  updatedAt: number
  fetchedAt: number
  /** Set when live providers failed and the last saved rates are returned. */
  stale?: string
}

/**
 * Parses a typed amount in either notation: "1,234.5", "1.234,5", "12,5", "1 234", "1'234.50".
 * When both separators occur the last one is the decimal point; a separator that
 * repeats ("1,234,567" / "1.234.567") groups thousands. Returns NaN for junk.
 */
export function parseAmount(input: string): number {
  const s = input.replace(/[\s  ']/g, '')
  const dot = s.lastIndexOf('.')
  const comma = s.lastIndexOf(',')
  let n = s
  if (dot >= 0 && comma >= 0) n = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (comma >= 0) n = s.indexOf(',') !== comma ? s.replace(/,/g, '') : s.replace(',', '.')
  else if (dot >= 0 && s.indexOf('.') !== dot) n = s.replace(/\./g, '')
  return Number(n)
}

/** Converts `amount` of `from` into `to` via USD cross rates. */
export function fxConvert(rates: Record<string, number>, amount: number, from: string, to: string): number | null {
  const rf = from === 'USD' ? 1 : rates[from]
  const rt = to === 'USD' ? 1 : rates[to]
  if (!rf || !rt || !Number.isFinite(amount)) return null
  return (amount / rf) * rt
}

// ---------------------------------------------------------------- small stored widgets

export interface StickyNote {
  id: string
  text: string
  color: WidgetColor
  pinned?: boolean
  createdAt: number
  updatedAt: number
}

export interface Countdown {
  id: string
  title: string
  /** Unix ms. */
  target: number
  createdAt: number
  color: WidgetColor
  notify: boolean
}

export interface WorldClock {
  id: string
  tz: string
  label?: string
}

export type WidgetId = 'weather' | 'news' | 'clocks' | 'calendar' | 'speedtest' | 'currency' | 'stickies' | 'countdown'

export interface WidgetsConfig {
  dock: Record<WidgetId, boolean>
  newtab: Record<WidgetId, boolean>
}

export const DEFAULT_WIDGETS_CONFIG: WidgetsConfig = {
  dock: { weather: true, news: true, clocks: true, calendar: true, speedtest: false, currency: false, stickies: true, countdown: false },
  newtab: { weather: true, news: false, clocks: false, calendar: false, speedtest: false, currency: false, stickies: true, countdown: false }
}

/** Keys the generic key-value store accepts (everything else is rejected). */
export const WIDGET_KV_KEYS = ['config', 'weather.places', 'weather.prefs', 'clocks', 'stickies', 'countdowns', 'currency.pairs', 'currency.last'] as const
export type WidgetKvKey = (typeof WIDGET_KV_KEYS)[number]

// ---------------------------------------------------------------- IPC contract

declare module '../ipc' {
  interface IpcContract {
    'weather:search': (query: string) => GeoPlace[]
    'weather:forecast': (place: GeoPlace, force?: boolean) => WeatherData

    'news:feeds': () => NewsFeed[]
    'news:addFeed': (url: string) => NewsFeed
    'news:removeFeed': (id: string) => void
    'news:renameFeed': (id: string, title: string) => void
    'news:refresh': (opts?: { feedId?: string; force?: boolean }) => { refreshed: number; errors: { feedId: string; error: string }[] }
    'news:items': (q: { feedId?: string; unreadOnly?: boolean; limit?: number }) => NewsItem[]
    'news:markRead': (q: { ids?: string[]; feedId?: string; all?: boolean; read?: boolean }) => void
    'news:unread': () => number
    'news:settings': () => NewsSettings
    'news:setSettings': (s: Partial<NewsSettings>) => NewsSettings
    'news:resetDefaults': () => NewsFeed[]

    'widgets:kvGet': (key: WidgetKvKey) => unknown
    'widgets:kvSet': (key: WidgetKvKey, value: unknown) => void

    'widgets:calList': (from: number, to: number) => CalEvent[]
    'widgets:calUpcoming': (limit: number) => CalEvent[]
    'widgets:calSave': (ev: CalEventInput) => CalEvent
    'widgets:calDelete': (id: string) => void
    'widgets:calImportIcs': () => IcsImportResult | null

    'widgets:speedRun': (opts: { upload: boolean }) => SpeedResult
    'widgets:speedCancel': () => void
    'widgets:speedHistory': () => SpeedResult[]
    'widgets:speedClear': () => void

    'widgets:fxRates': (force?: boolean) => FxRates
  }
  interface IpcEvents {
    'news:changed': { unread: number }
    'widgets:kvChanged': { key: WidgetKvKey }
    'widgets:calChanged': void
    'widgets:speedProgress': SpeedProgress
  }
}
