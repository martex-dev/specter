// Weather via Open-Meteo (free, keyless): geocoding + forecast.
// Requests are rate-limited and cached for 10 minutes by services/net.
import type { GeoPlace, WeatherData, WeatherDay, WeatherHour } from '@shared/modules/widgets'
import { fetchJson, setRateLimit } from '../../services/net'

const GEO = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const TTL = 10 * 60_000
/** Our own memo so "last updated" reflects the real fetch time. */
const memo = new Map<string, { at: number; data: WeatherData }>()

export function initWeather(): void {
  setRateLimit('api.open-meteo.com', 2)
  setRateLimit('geocoding-api.open-meteo.com', 2)
}

interface GeoResponse {
  results?: { id: number; name: string; latitude: number; longitude: number; country?: string; country_code?: string; admin1?: string; timezone?: string }[]
}

export async function searchPlaces(query: string): Promise<GeoPlace[]> {
  const q = String(query ?? '').trim().slice(0, 100)
  if (q.length < 2) return []
  const url = `${GEO}?name=${encodeURIComponent(q)}&count=8&language=en&format=json`
  const r = await fetchJson<GeoResponse>(url, { ttl: 24 * 3600_000, timeoutMs: 8000 })
  return (r.results ?? []).map((p) => ({
    id: String(p.id),
    name: p.name,
    admin1: p.admin1,
    country: p.country,
    countryCode: p.country_code,
    lat: p.latitude,
    lon: p.longitude,
    timezone: p.timezone
  }))
}

interface ForecastResponse {
  timezone: string
  utc_offset_seconds: number
  current: {
    time: number
    temperature_2m: number
    relative_humidity_2m?: number
    apparent_temperature?: number
    is_day: number
    precipitation?: number
    weather_code: number
    cloud_cover?: number
    pressure_msl?: number
    wind_speed_10m?: number
    wind_direction_10m?: number
  }
  hourly: { time: number[]; temperature_2m: number[]; precipitation_probability?: (number | null)[]; weather_code: number[]; is_day: number[] }
  daily: {
    time: number[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    sunrise?: number[]
    sunset?: number[]
    precipitation_sum?: (number | null)[]
    precipitation_probability_max?: (number | null)[]
    uv_index_max?: (number | null)[]
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function forecast(place: GeoPlace, force = false): Promise<WeatherData> {
  const lat = Number(place?.lat)
  const lon = Number(place?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Invalid location')
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,uv_index_max',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '7',
    forecast_hours: '24',
    wind_speed_unit: 'kmh'
  })
  const url = `${FORECAST}?${params}`
  const hit = memo.get(url)
  // Cached for 10 minutes; a manual refresh may bypass it, but at most once a minute.
  if (hit && Date.now() - hit.at < (force ? 60_000 : TTL)) return { ...hit.data, place }
  const r = await fetchJson<ForecastResponse & { error?: boolean; reason?: string }>(url, { timeoutMs: 10_000 })
  if (r.error) throw new Error(r.reason || 'Open-Meteo returned an error')
  const h = r.hourly
  const hourly: WeatherHour[] = h.time.map((t, i) => ({
    time: t * 1000,
    temp: h.temperature_2m[i],
    code: h.weather_code[i],
    precipProb: num(h.precipitation_probability?.[i]),
    isDay: h.is_day[i] === 1
  }))
  const d = r.daily
  const daily: WeatherDay[] = d.time.map((t, i) => ({
    date: t * 1000,
    code: d.weather_code[i],
    tMax: d.temperature_2m_max[i],
    tMin: d.temperature_2m_min[i],
    precipSum: num(d.precipitation_sum?.[i]),
    precipProb: num(d.precipitation_probability_max?.[i]),
    sunrise: num(d.sunrise?.[i]) !== null ? d.sunrise![i] * 1000 : null,
    sunset: num(d.sunset?.[i]) !== null ? d.sunset![i] * 1000 : null,
    uvMax: num(d.uv_index_max?.[i])
  }))
  const c = r.current
  const data: WeatherData = {
    place,
    source: 'Open-Meteo',
    fetchedAt: Date.now(),
    timezone: r.timezone,
    utcOffsetSec: r.utc_offset_seconds,
    current: {
      time: c.time * 1000,
      temp: c.temperature_2m,
      apparent: num(c.apparent_temperature) ?? c.temperature_2m,
      humidity: num(c.relative_humidity_2m),
      windKmh: num(c.wind_speed_10m),
      windDir: num(c.wind_direction_10m),
      precipMm: num(c.precipitation),
      pressureHpa: num(c.pressure_msl),
      cloudCover: num(c.cloud_cover),
      code: c.weather_code,
      isDay: c.is_day === 1
    },
    hourly,
    daily
  }
  memo.set(url, { at: data.fetchedAt, data })
  if (memo.size > 50) memo.delete(memo.keys().next().value!)
  return data
}
