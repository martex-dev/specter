// Currency conversion rates from free keyless sources, cached for an hour.
import type { FxRates } from '@shared/modules/markets'
import { fetchJson } from '../../services/net'
import { describeError } from './providers'

export async function fxRates(baseRaw: string): Promise<FxRates> {
  const base = (baseRaw || 'USD').trim().toUpperCase().slice(0, 3)
  if (!/^[A-Z]{3}$/.test(base)) throw new Error('Invalid currency code')
  const errors: string[] = []
  try {
    const url = `https://open.er-api.com/v6/latest/${base}`
    const r = await fetchJson<{ result: string; base_code: string; rates: Record<string, number>; time_last_update_unix?: number; 'error-type'?: string }>(url, { ttl: 3_600_000, timeoutMs: 10000 })
    if (r.result === 'success' && r.rates) return { base: r.base_code || base, rates: r.rates, source: 'er-api', sourceUrl: 'https://www.exchangerate-api.com', updatedAt: r.time_last_update_unix ? r.time_last_update_unix * 1000 : null, fetchedAt: Date.now() }
    errors.push(`open.er-api.com: ${r['error-type'] ?? 'unexpected response'}`)
  } catch (err) {
    errors.push(`open.er-api.com: ${describeError(err)}`)
  }
  try {
    const url = `https://api.frankfurter.dev/v1/latest?base=${base}`
    const r = await fetchJson<{ base: string; date: string; rates: Record<string, number> }>(url, { ttl: 3_600_000, timeoutMs: 10000 })
    // Frankfurter publishes daily ECB reference rates; only the date is known.
    const updated = Date.parse(r.date + 'T00:00:00Z')
    return { base: r.base, rates: { ...r.rates, [r.base]: 1 }, source: 'frankfurter', sourceUrl: 'https://frankfurter.dev', updatedAt: isFinite(updated) ? updated : null, fetchedAt: Date.now() }
  } catch (err) {
    errors.push(`frankfurter.dev: ${describeError(err)}`)
  }
  throw new Error(`Exchange rates unavailable — ${errors.join('; ')}`)
}
