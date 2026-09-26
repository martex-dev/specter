// World clocks — time-zone math via Intl (no network).
import type { WorldClock } from '@shared/modules/widgets'

export interface ClocksState {
  mode: 'analog' | 'digital'
  zones: WorldClock[]
}

export const DEFAULT_CLOCKS: ClocksState = {
  mode: 'analog',
  zones: [
    { id: 'z1', tz: 'America/New_York' },
    { id: 'z2', tz: 'Europe/London' },
    { id: 'z3', tz: 'Asia/Tokyo' }
  ]
}

/** Current names for zones Chromium still lists under their old names. */
const RENAMED: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Europe/Kiev': 'Europe/Kyiv',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Africa/Asmera': 'Africa/Asmara'
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function allZones(): string[] {
  try {
    // Chromium's list has no "UTC" and uses old names (Asia/Calcutta, Europe/Kiev), so
    // searching "UTC", "Kolkata" or "Kyiv" found nothing.
    const list = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone').map((z) => (RENAMED[z] && validZone(RENAMED[z]) ? RENAMED[z] : z))
    return list.includes('UTC') ? list : ['UTC', ...list]
  } catch {
    return ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney']
  }
}

export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

export function zoneCity(tz: string): string {
  return tz.split('/').pop()!.replace(/_/g, ' ')
}

/** Wall-clock parts in a zone. */
const fmtCache = new Map<string, Intl.DateTimeFormat>()
function partsFormat(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    fmtCache.set(tz, f)
  }
  return f
}

export function zoneParts(ms: number, tz: string): { h: number; m: number; s: number; y: number; mo: number; d: number } {
  let f: Intl.DateTimeFormat
  try {
    f = partsFormat(tz)
  } catch {
    f = partsFormat('UTC')
  }
  const p: Record<string, number> = {}
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return { h: p.hour % 24, m: p.minute, s: p.second, y: p.year, mo: p.month, d: p.day }
}

/** UTC offset of a zone at an instant, in minutes. */
export function zoneOffsetMin(ms: number, tz: string): number {
  const p = zoneParts(ms, tz)
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.m, p.s) - Math.floor(ms / 1000) * 1000) / 60_000)
}

export function fmtOffset(min: number): string {
  if (min === 0) return 'same time'
  const sign = min > 0 ? '+' : '−'
  const a = Math.abs(min)
  const h = Math.floor(a / 60)
  const m = a % 60
  return `${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}h`
}

export function utcLabel(min: number): string {
  const sign = min >= 0 ? '+' : '−'
  const a = Math.abs(min)
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`
}

/** −1 / 0 / +1 calendar-day difference of the zone vs. local. */
export function dayShift(ms: number, tz: string): number {
  const z = zoneParts(ms, tz)
  const l = new Date(ms)
  const a = Date.UTC(z.y, z.mo - 1, z.d)
  const b = Date.UTC(l.getFullYear(), l.getMonth(), l.getDate())
  return Math.round((a - b) / 86_400_000)
}

export const isDaytime = (h: number): boolean => h >= 6 && h < 18
