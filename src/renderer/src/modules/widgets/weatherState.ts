// Weather — shared renderer state (saved places, units, forecast hook).
import { useCallback, useEffect, useRef, useState } from 'react'
import { cToF, type GeoPlace, type WeatherData } from '@shared/modules/widgets'
import { invoke } from '../../lib/ipc'
import { errorText, useKv, useVisibleInterval } from './store'

export type TempUnit = 'c' | 'f'
export interface WeatherPrefs {
  unit: TempUnit
  selected: string | null
}

const F_LOCALES = /^en-(US|LR|BS|BZ|KY|PW|FM|MH)$|^my\b/i
export const defaultUnit = (): TempUnit => (F_LOCALES.test(navigator.language) ? 'f' : 'c')

const EMPTY: GeoPlace[] = []

export function usePlaces(): [GeoPlace[], (p: GeoPlace[]) => void, boolean] {
  return useKv<GeoPlace[]>('weather.places', EMPTY)
}

export function usePrefs(): [WeatherPrefs, (p: WeatherPrefs) => void] {
  const [raw, set] = useKv<Partial<WeatherPrefs> | null>('weather.prefs', null)
  return [{ unit: raw?.unit === 'f' || raw?.unit === 'c' ? raw.unit : defaultUnit(), selected: raw?.selected ?? null }, set]
}

export function temp(c: number | null | undefined, unit: TempUnit): string {
  if (c === null || c === undefined || !Number.isFinite(c)) return '—'
  return `${Math.round(unit === 'f' ? cToF(c) : c)}°`
}

export function wind(kmh: number | null, unit: TempUnit): string {
  if (kmh === null) return '—'
  return unit === 'f' ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`
}

export function placeLabel(p: GeoPlace): string {
  return [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : null, p.country].filter(Boolean).join(', ')
}

/** Local time at the forecast location. */
export function placeTime(ms: number, tz: string, opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }): string {
  try {
    return new Date(ms).toLocaleTimeString([], { ...opts, timeZone: tz })
  } catch {
    return new Date(ms).toLocaleTimeString([], opts)
  }
}

export function placeDay(ms: number, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short' }): string {
  try {
    return new Date(ms).toLocaleDateString([], { ...opts, timeZone: tz })
  } catch {
    return new Date(ms).toLocaleDateString([], opts)
  }
}

let hour12: boolean | null = null
const hourFmt = new Map<string, Intl.DateTimeFormat>()
/** Compact hour label for charts: "14" or "2p" depending on the user's clock preference. */
export function shortHour(ms: number, tz: string): string {
  hour12 ??= /h1[12]/.test(new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hourCycle ?? '')
  let f = hourFmt.get(tz)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz })
    } catch {
      f = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23' })
    }
    hourFmt.set(tz, f)
  }
  const h = Number(f.formatToParts(new Date(ms)).find((p) => p.type === 'hour')?.value ?? 0) % 24
  return hour12 ? `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` : String(h).padStart(2, '0')
}

const REFRESH_MS = 10 * 60_000

export function useForecast(place: GeoPlace | null): { data: WeatherData | null; error: string | null; loading: boolean; refresh: (force?: boolean) => void } {
  const [data, setData] = useState<WeatherData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const key = place ? `${place.lat.toFixed(3)},${place.lon.toFixed(3)}` : ''
  const seq = useRef(0)
  const placeRef = useRef(place)
  placeRef.current = place

  const refresh = useCallback(
    (force = false) => {
      const p = placeRef.current
      if (!p) return
      const my = ++seq.current
      setLoading(true)
      invoke('weather:forecast', p, force)
        .then((d) => {
          if (my !== seq.current) return
          setData(d)
          setError(null)
        })
        .catch((e) => my === seq.current && setError(errorText(e)))
        .finally(() => my === seq.current && setLoading(false))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )

  useEffect(() => {
    setData((d) => (d && `${d.place.lat.toFixed(3)},${d.place.lon.toFixed(3)}` === key ? d : null))
    setError(null)
  }, [key])

  useVisibleInterval(() => refresh(false), REFRESH_MS, [key])
  return { data, error, loading, refresh }
}

// Omnibox preview (a city looked up via "weather <city>" that isn't saved).
let preview: GeoPlace | null = null
const previewSubs = new Set<() => void>()
export function setPreview(p: GeoPlace | null): void {
  preview = p
  previewSubs.forEach((f) => f())
}
export function usePreview(): GeoPlace | null {
  const [p, setP] = useState(preview)
  useEffect(() => {
    const f = () => setP(preview)
    previewSubs.add(f)
    return () => {
      previewSubs.delete(f)
    }
  }, [])
  return p
}
