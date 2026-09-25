// Timestamp parsing and time-zone helpers built on Intl.

export type TsUnit = 's' | 'ms' | 'us' | 'ns'

export interface ParsedTime {
  date: Date
  /** How the input was interpreted. */
  kind: string
}

/** Interprets unix timestamps (auto-detecting s/ms/µs/ns by magnitude), ISO/RFC dates and "now". */
export function parseTimeInput(input: string, forceUnit?: TsUnit): ParsedTime | null {
  const s = input.trim()
  if (!s) return null
  if (/^now$/i.test(s)) return { date: new Date(), kind: 'Current time' }
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    const digits = s.replace(/^-/, '').split('.')[0].length
    const unit: TsUnit = forceUnit ?? (digits <= 11 ? 's' : digits <= 14 ? 'ms' : digits <= 17 ? 'us' : 'ns')
    const ms = unit === 's' ? n * 1000 : unit === 'ms' ? n : unit === 'us' ? n / 1000 : n / 1e6
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    const names = { s: 'Unix seconds', ms: 'Unix milliseconds', us: 'Unix microseconds', ns: 'Unix nanoseconds' }
    return { date: d, kind: names[unit] }
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return { date: d, kind: /Z|[+-]\d{2}:?\d{2}$/.test(s) ? 'Date string with offset' : 'Date string (local time)' }
  return null
}

/** Offset of `zone` from UTC at instant `d`, in minutes (e.g. +120 for CEST). */
export function zoneOffsetMinutes(d: Date, zone: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second))
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000)
}

export function formatOffset(min: number): string {
  const sign = min < 0 ? '-' : '+'
  const a = Math.abs(min)
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

/** Converts a wall-clock time in `zone` to an instant. */
export function zonedToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  // Two iterations settle DST transitions.
  let t = guess - zoneOffsetMinutes(new Date(guess), zone) * 60000
  t = guess - zoneOffsetMinutes(new Date(t), zone) * 60000
  return new Date(t)
}

/** Formats an instant in `zone` as "YYYY-MM-DD HH:MM:SS". */
export function formatInZone(d: Date, zone: string): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

export function relativeTime(d: Date, now: Date = new Date()): string {
  const diff = (d.getTime() - now.getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const abs = Math.abs(diff)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31556952],
    ['month', 2629746],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1]
  ]
  for (const [u, s] of units) if (abs >= s || u === 'second') return rtf.format(Math.round(diff / s), u)
  return ''
}

/** ISO 8601 week number and week-year. */
export function isoWeek(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { week: Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7), year: t.getUTCFullYear() }
}

export function dayOfYear(d: Date): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000)
}

export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney']
  }
}

// ---------------------------------------------------------------- UUID

/** RFC 9562 UUIDv7: 48-bit unix ms timestamp + random bits. */
export function uuidV7(now = Date.now(), rand: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  const b = rand(16)
  let t = now
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256
    t = Math.floor(t / 256)
  }
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export interface UuidInfo {
  valid: boolean
  version?: number
  variant?: string
  /** For v1/v6/v7: embedded timestamp. */
  time?: Date
  nil?: boolean
  max?: boolean
}

export function inspectUuid(s: string): UuidInfo {
  const m = /^\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i.exec(s.trim())
  if (!m) return { valid: false }
  const hex = m.slice(1).join('').toLowerCase()
  if (/^0+$/.test(hex)) return { valid: true, nil: true }
  if (/^f+$/.test(hex)) return { valid: true, max: true }
  const version = parseInt(hex[12], 16)
  const v = parseInt(hex[16], 16)
  const variant = v < 8 ? 'NCS (reserved)' : v < 12 ? 'RFC 9562' : v < 14 ? 'Microsoft (reserved)' : 'Future (reserved)'
  let time: Date | undefined
  if (version === 7) time = new Date(parseInt(hex.slice(0, 12), 16))
  else if (version === 1 || version === 6) {
    // 60-bit count of 100ns intervals since 1582-10-15.
    const ts = version === 1 ? hex.slice(13, 16) + hex.slice(8, 12) + hex.slice(0, 8) : hex.slice(0, 12) + hex.slice(13, 16)
    const n = BigInt('0x' + ts)
    time = new Date(Number((n - 122192928000000000n) / 10000n))
  }
  return { valid: true, version, variant, time }
}
