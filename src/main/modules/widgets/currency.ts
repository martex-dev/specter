// Currency rates: ExchangeRate-API's open endpoint (open.er-api.com, daily
// updates, attribution required) with Frankfurter (ECB reference rates) as a
// fallback. Cached for an hour; the last good response is persisted so the
// converter still works offline (clearly marked as saved data).
import type { FxRates } from '@shared/modules/widgets'
import { fetchJson, setRateLimit } from '../../services/net'
import { kvGet, kvSet } from './store'

const TTL = 60 * 60_000
let memo: FxRates | null = null

export function initCurrency(): void {
  setRateLimit('open.er-api.com', 1)
  setRateLimit('api.frankfurter.dev', 1)
}

interface ErApi {
  result: string
  base_code: string
  time_last_update_unix: number
  rates: Record<string, number>
  'error-type'?: string
}

interface Frankfurter {
  base: string
  date: string
  rates: Record<string, number>
}

async function fromErApi(): Promise<FxRates> {
  const r = await fetchJson<ErApi>('https://open.er-api.com/v6/latest/USD', { timeoutMs: 10_000, retries: 1 })
  if (r.result !== 'success' || !r.rates) throw new Error(r['error-type'] || 'ExchangeRate-API error')
  return { base: 'USD', rates: { ...r.rates, USD: 1 }, source: 'ExchangeRate-API (open.er-api.com)', sourceUrl: 'https://www.exchangerate-api.com', updatedAt: r.time_last_update_unix * 1000, fetchedAt: Date.now() }
}

async function fromFrankfurter(): Promise<FxRates> {
  const r = await fetchJson<Frankfurter>('https://api.frankfurter.dev/v1/latest?base=USD', { timeoutMs: 10_000, retries: 1 })
  if (!r.rates) throw new Error('Frankfurter error')
  // ECB reference rates are published ~16:00 CET on working days.
  const updatedAt = Date.parse(r.date + 'T16:00:00+01:00')
  return { base: 'USD', rates: { ...r.rates, USD: 1 }, source: 'Frankfurter (ECB)', sourceUrl: 'https://frankfurter.dev', updatedAt: Number.isNaN(updatedAt) ? Date.now() : updatedAt, fetchedAt: Date.now() }
}

export async function fxRates(force = false): Promise<FxRates> {
  if (memo && Date.now() - memo.fetchedAt < (force ? 5 * 60_000 : TTL)) return memo
  const errors: string[] = []
  for (const provider of [fromErApi, fromFrankfurter]) {
    try {
      const r = await provider()
      memo = r
      try {
        kvSet('currency.last', r)
      } catch {
        /* ignore */
      }
      return r
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  const saved = kvGet<FxRates | null>('currency.last', null)
  if (saved?.rates) return { ...saved, stale: `Live rates unavailable (${errors.join('; ')}). Showing rates saved ${new Date(saved.fetchedAt).toLocaleString()}.` }
  throw new Error(`Rates unavailable: ${errors.join('; ')}`)
}
