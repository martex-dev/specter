// Normalizers: raw public-API payloads → SPECTER's Quote / Candle / DexPair
// shapes. Pure functions (no I/O, no electron) so they are unit tested.
// Missing or malformed numbers become null — never guessed.
import type { Candle, CoinInfo, DexPair, Quote, Timeframe, TokenSecurity } from '@shared/modules/markets'

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) ? n : null
}

// ---------------------------------------------------------------- Binance

export interface BinanceTicker24h {
  symbol: string
  lastPrice: string
  openPrice: string
  priceChange: string
  priceChangePercent: string
  highPrice: string
  lowPrice: string
  volume: string
  quoteVolume: string
  closeTime: number
}

export function normalizeBinanceTicker(t: BinanceTicker24h, base: string, quote: string, fetchedAt: number): Quote | null {
  const price = num(t.lastPrice)
  if (price === null || price <= 0) return null
  return {
    symbol: base,
    quote,
    pair: t.symbol,
    price,
    open24h: num(t.openPrice),
    change24h: num(t.priceChange),
    changePct24h: num(t.priceChangePercent),
    high24h: num(t.highPrice),
    low24h: num(t.lowPrice),
    volume24h: num(t.volume),
    quoteVolume24h: num(t.quoteVolume),
    source: 'binance',
    ts: typeof t.closeTime === 'number' ? Math.min(t.closeTime, fetchedAt) : fetchedAt,
    fetchedAt
  }
}

/** Binance 24hr mini ticker stream payload (`<symbol>@miniTicker`). */
export interface BinanceMiniTicker {
  e: string
  E: number
  s: string
  c: string
  o: string
  h: string
  l: string
  v: string
  q: string
}

export function normalizeBinanceMiniTicker(m: BinanceMiniTicker, base: string, quote: string, now: number): Quote | null {
  const price = num(m.c)
  const open = num(m.o)
  if (price === null || price <= 0) return null
  const change = open !== null ? price - open : null
  return {
    symbol: base,
    quote,
    pair: m.s,
    price,
    open24h: open,
    change24h: change,
    changePct24h: open ? ((price - open) / open) * 100 : null,
    high24h: num(m.h),
    low24h: num(m.l),
    volume24h: num(m.v),
    quoteVolume24h: num(m.q),
    source: 'binance',
    ts: typeof m.E === 'number' ? m.E : now,
    fetchedAt: now,
    live: true
  }
}

/** Binance kline row: [openTime, open, high, low, close, volume, closeTime, …]. */
export function normalizeBinanceKlines(rows: unknown[][]): Candle[] {
  const out: Candle[] = []
  for (const r of rows) {
    const time = num(r[0])
    const o = num(r[1])
    const h = num(r[2])
    const l = num(r[3])
    const c = num(r[4])
    if (time === null || o === null || h === null || l === null || c === null) continue
    out.push({ time: Math.floor(time / 1000), open: o, high: h, low: l, close: c, volume: num(r[5]) })
  }
  return out.sort((a, b) => a.time - b.time)
}

export const BINANCE_INTERVAL: Record<Timeframe, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w' }

// ---------------------------------------------------------------- Coinbase Exchange

export interface CoinbaseStats {
  open: string
  high: string
  low: string
  last: string
  volume: string
}

export function normalizeCoinbaseStats(s: CoinbaseStats, base: string, quote: string, productId: string, fetchedAt: number): Quote | null {
  const price = num(s.last)
  if (price === null || price <= 0) return null
  const open = num(s.open)
  const vol = num(s.volume)
  return {
    symbol: base,
    quote,
    pair: productId,
    price,
    open24h: open,
    change24h: open !== null ? price - open : null,
    changePct24h: open ? ((price - open) / open) * 100 : null,
    high24h: num(s.high),
    low24h: num(s.low),
    volume24h: vol,
    // Coinbase reports base volume only; quote volume ≈ volume × last is an estimate, so leave it unknown.
    quoteVolume24h: null,
    source: 'coinbase',
    ts: fetchedAt,
    fetchedAt
  }
}

/** Coinbase candle row: [time(sec), low, high, open, close, volume] — newest first. */
export function normalizeCoinbaseCandles(rows: number[][]): Candle[] {
  const out: Candle[] = []
  for (const r of rows) {
    const [t, l, h, o, c, v] = r.map((x) => num(x))
    if (t === null || l === null || h === null || o === null || c === null) continue
    out.push({ time: t, open: o, high: h, low: l, close: c, volume: v })
  }
  return out.sort((a, b) => a.time - b.time)
}

export const COINBASE_GRANULARITY: Partial<Record<Timeframe, number>> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 }

/**
 * Aggregates candles into larger buckets (e.g. 1h → 4h, 1d → 1w). Buckets are
 * aligned to UTC (weeks start Monday, like Binance). Partial buckets at the
 * start are dropped so every candle is complete except the latest.
 */
export function aggregateCandles(candles: Candle[], bucketSec: number, weekly = false): Candle[] {
  const bucketOf = (t: number) => {
    if (!weekly) return Math.floor(t / bucketSec) * bucketSec
    // Unix epoch was a Thursday; shift so buckets start on Monday 00:00 UTC.
    const monday = 4 * 86400
    return Math.floor((t - monday) / 604800) * 604800 + monday
  }
  const child = candles.length > 1 ? candles[1].time - candles[0].time : 0
  const perBucket = child > 0 ? Math.round((weekly ? 604800 : bucketSec) / child) : 0
  const out: (Candle & { n: number })[] = []
  for (const c of candles) {
    const b = bucketOf(c.time)
    const last = out[out.length - 1]
    if (last && last.time === b) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
      last.volume = last.volume !== null && c.volume !== null ? last.volume + c.volume : null
      last.n++
    } else out.push({ time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, n: 1 })
  }
  if (out.length > 1 && perBucket > 0 && out[0].n < perBucket) out.shift()
  return out.map(({ n: _n, ...c }) => c)
}

// ---------------------------------------------------------------- CoinGecko

export interface CoinGeckoMarket {
  id: string
  symbol: string
  name: string
  current_price: number | null
  market_cap: number | null
  total_volume: number | null
  high_24h: number | null
  low_24h: number | null
  price_change_24h: number | null
  price_change_percentage_24h: number | null
  last_updated: string | null
}

export function normalizeCoinGeckoMarket(m: CoinGeckoMarket, base: string, quote: string, fetchedAt: number): Quote | null {
  const price = num(m.current_price)
  if (price === null || price <= 0) return null
  const change = num(m.price_change_24h)
  const ts = m.last_updated ? Date.parse(m.last_updated) : NaN
  return {
    symbol: base,
    quote,
    pair: m.id,
    price,
    open24h: change !== null ? price - change : null,
    change24h: change,
    changePct24h: num(m.price_change_percentage_24h),
    high24h: num(m.high_24h),
    low24h: num(m.low_24h),
    volume24h: null,
    quoteVolume24h: num(m.total_volume),
    source: 'coingecko',
    ts: isFinite(ts) ? ts : fetchedAt,
    fetchedAt,
    marketCap: num(m.market_cap),
    marketCapSource: 'coingecko',
    marketCapTs: isFinite(ts) ? ts : fetchedAt
  }
}

/** CoinGecko /ohlc rows: [ms, open, high, low, close] (no volume). */
export function normalizeCoinGeckoOhlc(rows: number[][]): Candle[] {
  const out: Candle[] = []
  const seen = new Set<number>()
  for (const r of rows) {
    const [t, o, h, l, c] = r.map((x) => num(x))
    if (t === null || o === null || h === null || l === null || c === null) continue
    const time = Math.floor(t / 1000)
    if (seen.has(time)) continue
    seen.add(time)
    out.push({ time, open: o, high: h, low: l, close: c, volume: null })
  }
  return out.sort((a, b) => a.time - b.time)
}

export function pickCoinGeckoSearch(coins: { id: string; symbol: string; market_cap_rank: number | null }[], symbol: string): string | null {
  const s = symbol.toUpperCase()
  const exact = coins.filter((c) => c.symbol?.toUpperCase() === s)
  if (!exact.length) return null
  exact.sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))
  return exact[0].id
}

export function normalizeCoinGeckoCoin(c: any): CoinInfo {
  const md = c?.market_data ?? {}
  const platforms: { chain: string; address: string }[] = []
  for (const [chain, address] of Object.entries((c?.platforms ?? {}) as Record<string, string>)) {
    if (chain && typeof address === 'string' && address) platforms.push({ chain, address })
  }
  const lu = c?.last_updated ? Date.parse(c.last_updated) : NaN
  return {
    id: String(c?.id ?? ''),
    symbol: String(c?.symbol ?? '').toUpperCase(),
    name: String(c?.name ?? ''),
    image: c?.image?.small ?? c?.image?.thumb ?? null,
    price: num(md.current_price?.usd),
    marketCap: num(md.market_cap?.usd) || null,
    fdv: num(md.fully_diluted_valuation?.usd),
    volume24h: num(md.total_volume?.usd),
    change24hPct: num(md.price_change_percentage_24h),
    rank: num(c?.market_cap_rank),
    circulating: num(md.circulating_supply),
    totalSupply: num(md.total_supply),
    maxSupply: num(md.max_supply),
    genesisDate: typeof c?.genesis_date === 'string' ? c.genesis_date : null,
    categories: Array.isArray(c?.categories) ? c.categories.filter((x: unknown) => typeof x === 'string').slice(0, 8) : [],
    homepage: Array.isArray(c?.links?.homepage) ? (c.links.homepage.find((u: unknown) => typeof u === 'string' && /^https?:\/\//.test(u)) ?? null) : null,
    platforms,
    explorers: Array.isArray(c?.links?.blockchain_site) ? c.links.blockchain_site.filter((u: unknown) => typeof u === 'string' && /^https:\/\//.test(u) && !u.includes('<')).map((u: string) => u.trim()).slice(0, 6) : [],
    lastUpdated: isFinite(lu) ? lu : null
  }
}

/** CoinGecko asset platform id → DexScreener chain id. */
export const CG_PLATFORM_TO_CHAIN: Record<string, string> = {
  ethereum: 'ethereum',
  'binance-smart-chain': 'bsc',
  'arbitrum-one': 'arbitrum',
  'polygon-pos': 'polygon',
  base: 'base',
  'optimistic-ethereum': 'optimism',
  avalanche: 'avalanche',
  solana: 'solana',
  tron: 'tron'
}
export const CHAIN_TO_CG_PLATFORM: Record<string, string> = Object.fromEntries(Object.entries(CG_PLATFORM_TO_CHAIN).map(([k, v]) => [v, k]))

// ---------------------------------------------------------------- DexScreener

export function normalizeDexPair(p: any): DexPair | null {
  if (!p || typeof p !== 'object' || !p.pairAddress) return null
  return {
    chainId: String(p.chainId ?? ''),
    dexId: String(p.dexId ?? ''),
    url: typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : '',
    pairAddress: String(p.pairAddress),
    baseSymbol: String(p.baseToken?.symbol ?? ''),
    baseName: String(p.baseToken?.name ?? ''),
    baseAddress: String(p.baseToken?.address ?? ''),
    quoteSymbol: String(p.quoteToken?.symbol ?? ''),
    priceUsd: num(p.priceUsd),
    liquidityUsd: num(p.liquidity?.usd),
    volume24h: num(p.volume?.h24),
    priceChange24h: num(p.priceChange?.h24),
    buys24h: num(p.txns?.h24?.buys),
    sells24h: num(p.txns?.h24?.sells),
    fdv: num(p.fdv),
    marketCap: num(p.marketCap),
    pairCreatedAt: num(p.pairCreatedAt),
    labels: Array.isArray(p.labels) ? p.labels.map(String) : []
  }
}

export function normalizeDexPairs(payload: any, limit = 30): DexPair[] {
  const raw = Array.isArray(payload?.pairs) ? payload.pairs : Array.isArray(payload) ? payload : []
  return raw
    .map(normalizeDexPair)
    .filter((p: DexPair | null): p is DexPair => !!p)
    .sort((a: DexPair, b: DexPair) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
    .slice(0, limit)
}

// ---------------------------------------------------------------- GoPlus

export const GOPLUS_CHAIN: Record<string, string> = {
  ethereum: '1',
  bsc: '56',
  arbitrum: '42161',
  polygon: '137',
  base: '8453',
  optimism: '10',
  avalanche: '43114'
}

const BURN = new Set(['0x000000000000000000000000000000000000dead', '0x0000000000000000000000000000000000000000'])

export function normalizeGoPlus(payload: any, chainId: string, address: string, fetchedAt: number): TokenSecurity | null {
  const res = payload?.result
  if (!res || typeof res !== 'object') return null
  const r = res[address.toLowerCase()] ?? Object.values(res)[0]
  if (!r || typeof r !== 'object') return null
  const flag = (v: unknown): boolean | null => (v === '1' || v === 1 ? true : v === '0' || v === 0 ? false : null)
  const tax = (v: unknown): number | null => {
    const n = num(v)
    return n === null ? null : n * 100
  }
  let top10Pct: number | null = null
  if (Array.isArray(r.holders) && r.holders.length) {
    const eligible = r.holders.filter((h: any) => !BURN.has(String(h?.address ?? '').toLowerCase()) && !(h?.is_locked === 1 || h?.is_locked === '1'))
    top10Pct = eligible.slice(0, 10).reduce((s: number, h: any) => s + (num(h?.percent) ?? 0), 0) * 100
  }
  return {
    chainId,
    address,
    isOpenSource: flag(r.is_open_source),
    isProxy: flag(r.is_proxy),
    isMintable: flag(r.is_mintable),
    isHoneypot: flag(r.is_honeypot),
    buyTaxPct: tax(r.buy_tax),
    sellTaxPct: tax(r.sell_tax),
    holderCount: num(r.holder_count),
    top10Pct,
    ownerAddress: typeof r.owner_address === 'string' && r.owner_address ? r.owner_address : null,
    fetchedAt
  }
}

// ---------------------------------------------------------------- Binance futures

export function normalizePremiumIndex(rows: any[]): Map<string, { fundingRate: number | null; nextFundingTime: number | null; markPrice: number | null; ts: number | null }> {
  const out = new Map<string, { fundingRate: number | null; nextFundingTime: number | null; markPrice: number | null; ts: number | null }>()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.symbol) continue
    out.set(String(r.symbol), { fundingRate: num(r.lastFundingRate), nextFundingTime: num(r.nextFundingTime), markPrice: num(r.markPrice), ts: num(r.time) })
  }
  return out
}
