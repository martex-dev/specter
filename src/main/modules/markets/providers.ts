// MarketDataProvider implementations over free, keyless public APIs.
// All REST traffic goes through net.ts (timeouts, per-host rate limits,
// exponential backoff on 429/5xx, TTL cache).
import { fetchJson, HttpError, setRateLimit } from '../../services/net'
import type { Candle, ProviderId, Quote, Timeframe } from '@shared/modules/markets'
import { COINGECKO_IDS, TIMEFRAME_SECONDS } from '@shared/modules/markets'
import {
  aggregateCandles,
  BINANCE_INTERVAL,
  COINBASE_GRANULARITY,
  normalizeBinanceKlines,
  normalizeBinanceTicker,
  normalizeCoinbaseCandles,
  normalizeCoinbaseStats,
  normalizeCoinGeckoMarket,
  normalizeCoinGeckoOhlc,
  pickCoinGeckoSearch,
  type BinanceTicker24h,
  type CoinbaseStats,
  type CoinGeckoMarket
} from './normalize'

export const HOSTS = {
  binance: 'https://api.binance.com',
  binanceFutures: 'https://fapi.binance.com',
  coinbase: 'https://api.exchange.coinbase.com',
  coingecko: 'https://api.coingecko.com/api/v3',
  dexscreener: 'https://api.dexscreener.com',
  goplus: 'https://api.gopluslabs.io'
}

let limitsSet = false
export function applyRateLimits(): void {
  if (limitsSet) return
  limitsSet = true
  setRateLimit('api.binance.com', 8)
  setRateLimit('fapi.binance.com', 4)
  setRateLimit('api.exchange.coinbase.com', 5)
  // CoinGecko's free tier allows only a handful of calls per minute.
  setRateLimit('api.coingecko.com', 0.25)
  setRateLimit('api.dexscreener.com', 3)
  setRateLimit('api.gopluslabs.io', 0.5)
  setRateLimit('open.er-api.com', 1)
  setRateLimit('api.frankfurter.dev', 1)
}

export interface QuotesResponse {
  quotes: Quote[]
  /** Symbols this provider does not list (not an outage). */
  missing: { symbol: string; reason: string }[]
}

export interface CandlesResponse {
  candles: Candle[]
  quote: string
  hasVolume: boolean
  note?: string
}

export interface MarketDataProvider {
  id: ProviderId
  /** Quote currency this provider uses for the configured quote. */
  quoteFor(settingQuote: string): string
  quotes(symbols: string[], settingQuote: string): Promise<QuotesResponse>
  supportsTimeframe(tf: Timeframe): boolean
  candles(symbol: string, tf: Timeframe, settingQuote: string): Promise<CandlesResponse>
  /** Lightweight reachability probe; resolves on success. */
  ping(): Promise<void>
}

/** Error for symbols a provider does not carry (so fallback is per-symbol, not a provider outage). */
export class NotListedError extends Error {}

export function isBlockedStatus(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 451 || err.status === 403)
}

export function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 451) return 'HTTP 451 — unavailable in this region'
    if (err.status === 403) return 'HTTP 403 — access refused (possibly geo-blocked)'
    if (err.status === 429) return 'HTTP 429 — rate limited'
    return err.message
  }
  const m = err instanceof Error ? err.message : String(err)
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED/.test(m)) return 'Offline or DNS failure'
  return m.replace(/^Error:\s*/, '').slice(0, 160)
}

// ---------------------------------------------------------------- Binance

const binanceInvalid = new Map<string, number>()

export const binance: MarketDataProvider = {
  id: 'binance',
  quoteFor: (q) => (q === 'USD' ? 'USDT' : q),
  async quotes(symbols, settingQuote) {
    const quote = this.quoteFor(settingQuote)
    const now = Date.now()
    const missing: QuotesResponse['missing'] = []
    const wanted = symbols.filter((s) => {
      const bad = binanceInvalid.get(s + quote)
      if (bad && bad > now) {
        missing.push({ symbol: s, reason: `${s}${quote} not listed on Binance` })
        return false
      }
      return s !== quote
    })
    for (const s of symbols) if (s === quote) missing.push({ symbol: s, reason: `${s} is the quote currency` })
    if (!wanted.length) return { quotes: [], missing }
    const pairs = wanted.map((s) => s + quote)
    const fetchedAt = Date.now()
    try {
      const url = `${HOSTS.binance}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(pairs))}`
      const rows = await fetchJson<BinanceTicker24h[]>(url, { ttl: 2000, timeoutMs: 8000 })
      const byPair = new Map(rows.map((r) => [r.symbol, r]))
      const quotes: Quote[] = []
      for (const s of wanted) {
        const r = byPair.get(s + quote)
        const q = r ? normalizeBinanceTicker(r, s, quote, fetchedAt) : null
        if (q) quotes.push(q)
        else missing.push({ symbol: s, reason: `${s}${quote} not returned by Binance` })
      }
      return { quotes, missing }
    } catch (err) {
      // One invalid symbol fails the whole batch (HTTP 400): retry individually.
      if (!(err instanceof HttpError) || err.status !== 400) throw err
      const quotes: Quote[] = []
      for (const s of wanted) {
        try {
          const r = await fetchJson<BinanceTicker24h>(`${HOSTS.binance}/api/v3/ticker/24hr?symbol=${s}${quote}`, { ttl: 2000, timeoutMs: 8000 })
          const q = normalizeBinanceTicker(r, s, quote, Date.now())
          if (q) quotes.push(q)
        } catch (e) {
          if (e instanceof HttpError && e.status === 400) {
            binanceInvalid.set(s + quote, Date.now() + 3_600_000)
            missing.push({ symbol: s, reason: `${s}${quote} not listed on Binance` })
          } else throw e
        }
      }
      return { quotes, missing }
    }
  },
  supportsTimeframe: () => true,
  async candles(symbol, tf, settingQuote) {
    const quote = this.quoteFor(settingQuote)
    try {
      const rows = await fetchJson<unknown[][]>(`${HOSTS.binance}/api/v3/klines?symbol=${symbol}${quote}&interval=${BINANCE_INTERVAL[tf]}&limit=500`, { ttl: tf === '1m' ? 4000 : 15000, timeoutMs: 10000 })
      return { candles: normalizeBinanceKlines(rows), quote, hasVolume: true }
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) throw new NotListedError(`${symbol}${quote} not listed on Binance`)
      throw err
    }
  },
  async ping() {
    await fetchJson(`${HOSTS.binance}/api/v3/ping`, { timeoutMs: 6000, retries: 0 })
  }
}

// ---------------------------------------------------------------- Coinbase Exchange

const coinbaseMissing = new Map<string, number>()

export const coinbase: MarketDataProvider = {
  id: 'coinbase',
  quoteFor: (q) => (q === 'USDT' ? 'USD' : q),
  async quotes(symbols, settingQuote) {
    const quote = this.quoteFor(settingQuote)
    const quotes: Quote[] = []
    const missing: QuotesResponse['missing'] = []
    let lastErr: unknown = null
    let okCount = 0
    const now = Date.now()
    await Promise.all(
      symbols.map(async (s) => {
        const id = `${s}-${quote}`
        const bad = coinbaseMissing.get(id)
        if (s === quote || (bad && bad > now)) {
          missing.push({ symbol: s, reason: `${id} not listed on Coinbase` })
          return
        }
        try {
          const st = await fetchJson<CoinbaseStats>(`${HOSTS.coinbase}/products/${id}/stats`, { ttl: 4000, timeoutMs: 8000 })
          const q = normalizeCoinbaseStats(st, s, quote, id, Date.now())
          okCount++
          if (q) quotes.push(q)
          else missing.push({ symbol: s, reason: `${id}: no price in response` })
        } catch (err) {
          if (err instanceof HttpError && (err.status === 404 || err.status === 400)) {
            coinbaseMissing.set(id, Date.now() + 3_600_000)
            missing.push({ symbol: s, reason: `${id} not listed on Coinbase` })
            okCount++
          } else lastErr = err
        }
      })
    )
    // Every request failed for transport reasons → provider outage.
    if (lastErr && okCount === 0) throw lastErr
    if (lastErr) for (const s of symbols) if (!quotes.some((q) => q.symbol === s) && !missing.some((m) => m.symbol === s)) missing.push({ symbol: s, reason: `Coinbase: ${describeError(lastErr)}` })
    return { quotes, missing }
  },
  // 4h and 1w are aggregated locally from 1h / 1D candles.
  supportsTimeframe: () => true,
  async candles(symbol, tf, settingQuote) {
    const quote = this.quoteFor(settingQuote)
    const id = `${symbol}-${quote}`
    const direct = COINBASE_GRANULARITY[tf]
    const gran = direct ?? (tf === '4h' ? 3600 : 86400)
    try {
      const rows = await fetchJson<number[][]>(`${HOSTS.coinbase}/products/${id}/candles?granularity=${gran}`, { ttl: tf === '1m' ? 4000 : 15000, timeoutMs: 10000 })
      let candles = normalizeCoinbaseCandles(rows)
      let note: string | undefined
      if (!direct) {
        candles = tf === '4h' ? aggregateCandles(candles, TIMEFRAME_SECONDS['4h']) : aggregateCandles(candles, TIMEFRAME_SECONDS['1w'], true)
        note = `${tf} candles aggregated locally from Coinbase ${tf === '4h' ? '1h' : '1D'} candles`
      }
      return { candles, quote, hasVolume: true, note }
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 400)) throw new NotListedError(`${id} not listed on Coinbase`)
      throw err
    }
  },
  async ping() {
    await fetchJson(`${HOSTS.coinbase}/time`, { timeoutMs: 6000, retries: 0 })
  }
}

// ---------------------------------------------------------------- CoinGecko

/** Resolves a ticker to a CoinGecko id (built-in map → persisted cache → search). */
export type IdResolver = (symbol: string) => Promise<string | null>

let resolveId: IdResolver = async (s) => COINGECKO_IDS[s] ?? null
export function setCoinGeckoResolver(fn: IdResolver): void {
  resolveId = fn
}

export async function searchCoinGeckoId(symbol: string): Promise<string | null> {
  const r = await fetchJson<{ coins: { id: string; symbol: string; market_cap_rank: number | null }[] }>(`${HOSTS.coingecko}/search?query=${encodeURIComponent(symbol)}`, { ttl: 86_400_000, timeoutMs: 10000 })
  return pickCoinGeckoSearch(r.coins ?? [], symbol)
}

export async function coinGeckoMarkets(ids: string[], ttl = 55_000): Promise<CoinGeckoMarket[]> {
  if (!ids.length) return []
  const sorted = [...new Set(ids)].sort()
  return fetchJson<CoinGeckoMarket[]>(`${HOSTS.coingecko}/coins/markets?vs_currency=usd&ids=${sorted.map(encodeURIComponent).join(',')}&per_page=250&price_change_percentage=24h`, { ttl, timeoutMs: 12000 })
}

export const coingecko: MarketDataProvider = {
  id: 'coingecko',
  quoteFor: () => 'USD',
  async quotes(symbols) {
    const missing: QuotesResponse['missing'] = []
    const idFor = new Map<string, string>()
    for (const s of symbols) {
      const id = await resolveId(s)
      if (id) idFor.set(s, id)
      else missing.push({ symbol: s, reason: `${s} not found on CoinGecko` })
    }
    if (!idFor.size) return { quotes: [], missing }
    const rows = await coinGeckoMarkets([...idFor.values()])
    const byId = new Map(rows.map((r) => [r.id, r]))
    const quotes: Quote[] = []
    const fetchedAt = Date.now()
    for (const [s, id] of idFor) {
      const r = byId.get(id)
      const q = r ? normalizeCoinGeckoMarket(r, s, 'USD', fetchedAt) : null
      if (q) quotes.push(q)
      else missing.push({ symbol: s, reason: `CoinGecko returned no market data for ${id}` })
    }
    return { quotes, missing }
  },
  // The free /ohlc endpoint only offers fixed granularities; 14 days → 4h candles.
  supportsTimeframe: (tf) => tf === '4h',
  async candles(symbol, tf) {
    if (tf !== '4h') throw new NotListedError(`CoinGecko's free OHLC endpoint has no ${tf} candles`)
    const id = await resolveId(symbol)
    if (!id) throw new NotListedError(`${symbol} not found on CoinGecko`)
    const rows = await fetchJson<number[][]>(`${HOSTS.coingecko}/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=14`, { ttl: 300_000, timeoutMs: 12000 })
    return { candles: normalizeCoinGeckoOhlc(rows), quote: 'USD', hasVolume: false, note: 'CoinGecko OHLC has no volume data' }
  },
  async ping() {
    await fetchJson(`${HOSTS.coingecko}/ping`, { timeoutMs: 6000, retries: 0 })
  }
}

export const PROVIDER_IMPL: Record<ProviderId, MarketDataProvider> = { binance, coinbase, coingecko }
