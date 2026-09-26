// Markets, crypto & finance module — shared types, IPC contract and pure math.
//
// Everything in this file is side-effect free so it can be unit tested and
// used by both the main process and the renderer.
//
// Data flow: Provider → Normalizer → Cache → Event Bus → UI.
// Nothing here ever fabricates a value: unknown numbers are `null` and the UI
// renders them as "—" / "Unavailable" with the reason.

// ---------------------------------------------------------------- providers

export type ProviderId = 'binance' | 'coinbase' | 'coingecko'
export const PROVIDERS: ProviderId[] = ['binance', 'coinbase', 'coingecko']

export const SOURCE_LABEL: Record<string, string> = {
  binance: 'Binance',
  coinbase: 'Coinbase Exchange',
  coingecko: 'CoinGecko',
  'binance-futures': 'Binance Futures',
  dexscreener: 'DexScreener',
  goplus: 'GoPlus Security',
  'er-api': 'ExchangeRate-API (open.er-api.com)',
  frankfurter: 'Frankfurter (ECB)',
  local: 'Local'
}

export function sourceLabel(id: string | undefined | null): string {
  if (!id) return 'Unknown'
  return SOURCE_LABEL[id] ?? id
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w'
export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w']
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 }

// ---------------------------------------------------------------- quotes

export interface Quote {
  /** Base asset, e.g. "BTC". */
  symbol: string
  /** Quote currency actually used by the source (USDT, USD…). */
  quote: string
  /** Source-specific instrument id (BTCUSDT, BTC-USD, bitcoin). */
  pair: string
  price: number
  open24h: number | null
  change24h: number | null
  changePct24h: number | null
  high24h: number | null
  low24h: number | null
  /** 24h volume in base units (null when the source only reports quote volume). */
  volume24h: number | null
  /** 24h volume in quote currency. */
  quoteVolume24h: number | null
  source: ProviderId
  /** Timestamp of the data point as reported by the source (or fetch time when the source gives none). */
  ts: number
  fetchedAt: number
  /** True when the last update arrived over a streaming connection. */
  live?: boolean
  // Enrichment (optional, each with its own source)
  marketCap?: number | null
  marketCapSource?: string
  marketCapTs?: number
  fundingRate?: number | null
  nextFundingTime?: number | null
  openInterest?: number | null
  derivSource?: string
  derivTs?: number
  derivNote?: string
}

export interface QuoteError {
  symbol: string
  error: string
}

export interface MarketTick {
  quotes: Quote[]
  errors: QuoteError[]
}

export interface ProviderHealth {
  id: ProviderId | 'binance-futures'
  label: string
  /** null = not contacted yet in this session. */
  ok: boolean | null
  lastOk?: number
  lastError?: string
  lastErrorAt?: number
  latencyMs?: number
  /** Provider skipped until this time after failures (backoff). */
  cooldownUntil?: number
}

export interface MarketStatus {
  enabled: boolean
  preferred: ProviderId
  /** Provider that served the most recent quotes. */
  active: ProviderId | null
  /** Set when data is coming from a fallback provider. */
  fallbackReason?: string
  providers: ProviderHealth[]
  mode: 'idle' | 'stream' | 'poll' | 'background'
  streamConnected: boolean
  symbols: string[]
  quote: string
  updatedAt: number
}

export interface Candle {
  /** Unix seconds (UTC) of candle open. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface CandlesResult {
  symbol: string
  timeframe: Timeframe
  candles: Candle[]
  source: ProviderId | null
  quote: string
  fetchedAt: number
  hasVolume: boolean
  note?: string
  error?: string
}

export interface Watchlist {
  id: string
  name: string
  symbols: string[]
  sort: number
  createdAt: number
}

// ---------------------------------------------------------------- alerts

export type AlertKind = 'price_above' | 'price_below' | 'change_above' | 'change_below' | 'volume_above'

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  price_above: 'Price above',
  price_below: 'Price below',
  change_above: '24h change % above',
  change_below: '24h change % below',
  volume_above: '24h volume (quote) above'
}

export interface AlertRule {
  id: string
  symbol: string
  kind: AlertKind
  threshold: number
  enabled: boolean
  /** false = one-shot (disables itself after firing). */
  repeat: boolean
  /** Minimum minutes between repeated triggers. */
  cooldownMin: number
  note?: string
  createdAt: number
  lastTriggeredAt: number | null
  triggerCount: number
}

export interface AlertInput {
  symbol: string
  kind: AlertKind
  threshold: number
  repeat?: boolean
  cooldownMin?: number
  note?: string
}

export interface AlertEvent {
  id: string
  alertId: string
  symbol: string
  message: string
  value: number
  price: number
  source: string
  ts: number
}

export function alertValue(kind: AlertKind, q: Quote): number | null {
  switch (kind) {
    case 'price_above':
    case 'price_below':
      return isFinite(q.price) ? q.price : null
    case 'change_above':
    case 'change_below':
      return q.changePct24h
    case 'volume_above':
      return q.quoteVolume24h
  }
}

/** Evaluates one rule against a quote. Pure — the caller persists state changes. */
export function evaluateAlert(rule: AlertRule, q: Quote, now: number): { fire: boolean; value: number | null; message?: string } {
  if (!rule.enabled || rule.symbol !== q.symbol) return { fire: false, value: null }
  const value = alertValue(rule.kind, q)
  if (value === null || !isFinite(value)) return { fire: false, value: null }
  let hit = false
  switch (rule.kind) {
    case 'price_above':
    case 'change_above':
    case 'volume_above':
      hit = value >= rule.threshold
      break
    case 'price_below':
    case 'change_below':
      hit = value <= rule.threshold
      break
  }
  if (!hit) return { fire: false, value }
  if (rule.lastTriggeredAt !== null) {
    if (!rule.repeat) return { fire: false, value }
    if (now - rule.lastTriggeredAt < Math.max(0, rule.cooldownMin) * 60_000) return { fire: false, value }
  }
  const unit = rule.kind.startsWith('change') ? '%' : ''
  const shown = rule.kind.startsWith('change') ? value.toFixed(2) : fmtPlain(value)
  const message = `${rule.symbol} ${ALERT_KIND_LABEL[rule.kind].toLowerCase()} ${fmtPlain(rule.threshold)}${unit} — now ${shown}${unit} (${q.quote}, ${sourceLabel(q.source)})`
  return { fire: true, value, message }
}

function fmtPlain(n: number): string {
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8
  return String(Number(n.toFixed(digits)))
}

// ---------------------------------------------------------------- portfolio (average-cost method)

export type TxType = 'buy' | 'sell' | 'transfer_in' | 'transfer_out'

export const TX_LABEL: Record<TxType, string> = { buy: 'Buy', sell: 'Sell', transfer_in: 'Transfer in', transfer_out: 'Transfer out' }

export interface PortfolioTx {
  id: string
  asset: string
  type: TxType
  quantity: number
  /** Unit price in the portfolio currency (for transfer_in: cost basis per unit). */
  price: number
  fee: number
  date: number
  note?: string
}

export type PortfolioTxInput = Omit<PortfolioTx, 'id'>

export interface Holding {
  asset: string
  quantity: number
  avgCost: number
  costBasis: number
  realizedPnl: number
  fees: number
  txCount: number
}

export interface HoldingsResult {
  holdings: Holding[]
  realizedTotal: number
  feesTotal: number
  warnings: string[]
}

const EPS = 1e-12

/**
 * Average-cost method: each buy adds (qty × price + fee) to the cost basis;
 * each sell realizes (qty × price − fee) − qty × average cost. Transfers in
 * add quantity at the stated per-unit cost basis; transfers out remove quantity
 * at average cost (fees on transfers out are realized as a loss).
 */
export function computeHoldings(txs: PortfolioTx[]): HoldingsResult {
  const map = new Map<string, Holding>()
  const warnings: string[] = []
  const sorted = [...txs].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id))
  for (const t of sorted) {
    const asset = t.asset.toUpperCase()
    let h = map.get(asset)
    if (!h) {
      h = { asset, quantity: 0, avgCost: 0, costBasis: 0, realizedPnl: 0, fees: 0, txCount: 0 }
      map.set(asset, h)
    }
    h.txCount++
    const fee = Math.max(0, t.fee || 0)
    const qty = Math.max(0, t.quantity)
    h.fees += fee
    if (t.type === 'buy' || t.type === 'transfer_in') {
      h.costBasis += qty * t.price + fee
      h.quantity += qty
    } else {
      let q = qty
      if (q > h.quantity + EPS) {
        warnings.push(`${asset}: ${TX_LABEL[t.type].toLowerCase()} of ${q} on ${new Date(t.date).toISOString().slice(0, 10)} exceeds holdings (${h.quantity}); clamped.`)
        q = h.quantity
      }
      const avg = h.quantity > EPS ? h.costBasis / h.quantity : 0
      if (t.type === 'sell') h.realizedPnl += q * t.price - fee - q * avg
      else h.realizedPnl -= fee
      h.costBasis -= q * avg
      h.quantity -= q
      if (h.quantity < EPS) {
        h.quantity = 0
        h.costBasis = 0
      }
    }
    h.avgCost = h.quantity > EPS ? h.costBasis / h.quantity : 0
  }
  const holdings = [...map.values()]
  return {
    holdings,
    realizedTotal: holdings.reduce((s, h) => s + h.realizedPnl, 0),
    feesTotal: holdings.reduce((s, h) => s + h.fees, 0),
    warnings
  }
}

export function unrealizedPnl(h: Holding, price: number | null | undefined): { value: number | null; pnl: number | null; pct: number | null } {
  if (price === null || price === undefined || !isFinite(price)) return { value: null, pnl: null, pct: null }
  const value = h.quantity * price
  const pnl = value - h.costBasis
  return { value, pnl, pct: h.costBasis > EPS ? (pnl / h.costBasis) * 100 : null }
}

// ---------------------------------------------------------------- paper trading

export interface PaperAccount {
  startingBalance: number
  cash: number
  /** Fee rate applied to notional (e.g. 0.001 = 0.1%). */
  feeRate: number
  quote: string
  createdAt: number
  resetAt: number
}

export interface PaperPosition {
  symbol: string
  qty: number
  /** Average entry price including buy fees. */
  avgPrice: number
}

export interface PaperTrade {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  fee: number
  notional: number
  /** Realized P/L for sells (null for buys). */
  realizedPnl: number | null
  source: string
  quote: string
  ts: number
}

export interface PaperState {
  account: PaperAccount
  positions: PaperPosition[]
  trades: PaperTrade[]
  equity: { ts: number; equity: number }[]
}

export interface PaperOrderInput {
  symbol: string
  side: 'buy' | 'sell'
  /** Quantity in base units, or… */
  qty?: number
  /** …notional in quote currency (converted at the fill price). */
  notional?: number
}

export type PaperExecResult =
  | { ok: true; cash: number; positions: PaperPosition[]; trade: Omit<PaperTrade, 'id' | 'source' | 'quote' | 'ts'> }
  | { ok: false; error: string }

/**
 * Simulated market order at a real price. Long-only spot: sells are limited
 * to the position held (no shorting, no leverage). Fees are charged on
 * notional and included in the position's average entry price.
 */
export function executePaperOrder(cash: number, positions: PaperPosition[], order: PaperOrderInput, price: number, feeRate: number): PaperExecResult {
  if (!isFinite(price) || price <= 0) return { ok: false, error: 'No valid market price' }
  const symbol = order.symbol.toUpperCase()
  let qty = order.qty ?? (order.notional !== undefined ? order.notional / price : NaN)
  if (!isFinite(qty) || qty <= 0) return { ok: false, error: 'Enter a positive quantity or amount' }
  const pos = positions.find((p) => p.symbol === symbol)
  const next = positions.map((p) => ({ ...p }))
  if (order.side === 'buy') {
    const notional = qty * price
    const fee = notional * feeRate
    if (notional + fee > cash + 1e-9) return { ok: false, error: `Insufficient virtual cash: need ${(notional + fee).toFixed(2)}, have ${cash.toFixed(2)}` }
    const p = next.find((x) => x.symbol === symbol)
    if (p) {
      const cost = p.qty * p.avgPrice + notional + fee
      p.qty += qty
      p.avgPrice = cost / p.qty
    } else next.push({ symbol, qty, avgPrice: (notional + fee) / qty })
    return { ok: true, cash: cash - notional - fee, positions: next, trade: { symbol, side: 'buy', qty, price, fee, notional, realizedPnl: null } }
  }
  if (!pos || pos.qty <= EPS) return { ok: false, error: `No ${symbol} position to sell (paper trading is long-only)` }
  if (qty > pos.qty * (1 + 1e-9)) {
    if (order.notional !== undefined && qty <= pos.qty * 1.0001) qty = pos.qty
    else return { ok: false, error: `Cannot sell ${qty} ${symbol}; position is ${pos.qty}` }
  }
  qty = Math.min(qty, pos.qty)
  const notional = qty * price
  const fee = notional * feeRate
  const realized = notional - fee - qty * pos.avgPrice
  const p = next.find((x) => x.symbol === symbol)!
  p.qty -= qty
  const remaining = p.qty <= pos.qty * 1e-9 ? next.filter((x) => x.symbol !== symbol) : next
  return { ok: true, cash: cash + notional - fee, positions: remaining, trade: { symbol, side: 'sell', qty, price, fee, notional, realizedPnl: realized } }
}

/** Maximum peak-to-trough decline of a series, as a positive fraction (0.25 = −25%). */
export function maxDrawdown(values: number[]): number {
  let peak = -Infinity
  let mdd = 0
  for (const v of values) {
    if (!isFinite(v)) continue
    if (v > peak) peak = v
    if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak)
  }
  return mdd
}

export interface PaperStats {
  closedTrades: number
  wins: number
  losses: number
  winRate: number | null
  realizedPnl: number
  fees: number
  totalReturnPct: number | null
  maxDrawdownPct: number
}

export function paperStats(trades: PaperTrade[], equity: number[], startingBalance: number, currentEquity: number | null): PaperStats {
  const closed = trades.filter((t) => t.side === 'sell' && t.realizedPnl !== null)
  const wins = closed.filter((t) => (t.realizedPnl ?? 0) > 0).length
  const losses = closed.filter((t) => (t.realizedPnl ?? 0) <= 0).length
  const series = [startingBalance, ...equity, ...(currentEquity !== null ? [currentEquity] : [])]
  return {
    closedTrades: closed.length,
    wins,
    losses,
    winRate: closed.length ? wins / closed.length : null,
    realizedPnl: closed.reduce((s, t) => s + (t.realizedPnl ?? 0), 0),
    fees: trades.reduce((s, t) => s + t.fee, 0),
    totalReturnPct: currentEquity !== null && startingBalance > 0 ? (currentEquity / startingBalance - 1) * 100 : null,
    maxDrawdownPct: maxDrawdown(series) * 100
  }
}

// ---------------------------------------------------------------- finance toolkit (pure formulas)

export const fin = {
  /** FV = P(1 + r/n)^(n·t) + C·((1 + r/n)^(n·t) − 1)/(r/n), contributions at the end of each period. */
  compound(principal: number, annualRatePct: number, years: number, periodsPerYear: number, contributionPerPeriod = 0): { future: number; contributed: number; interest: number } {
    const n = Math.max(1, periodsPerYear)
    const r = annualRatePct / 100 / n
    const periods = n * years
    const growth = Math.pow(1 + r, periods)
    const fvContrib = r === 0 ? contributionPerPeriod * periods : contributionPerPeriod * ((growth - 1) / r)
    const future = principal * growth + fvContrib
    const contributed = principal + contributionPerPeriod * periods
    return { future, contributed, interest: future - contributed }
  },
  /** Units = (account × risk%) / |entry − stop|. */
  positionSize(account: number, riskPct: number, entry: number, stop: number): { riskAmount: number; units: number; positionValue: number; accountPct: number } | null {
    const perUnit = Math.abs(entry - stop)
    if (!(perUnit > 0) || !(entry > 0)) return null
    const riskAmount = account * (riskPct / 100)
    const units = riskAmount / perUnit
    const positionValue = units * entry
    return { riskAmount, units, positionValue, accountPct: account > 0 ? (positionValue / account) * 100 : 0 }
  },
  /** (to − from) / |from| × 100. */
  percentChange(from: number, to: number): number | null {
    if (from === 0 || !isFinite(from) || !isFinite(to)) return null
    return ((to - from) / Math.abs(from)) * 100
  },
  /** (end / start)^(1/years) − 1. */
  cagr(start: number, end: number, years: number): number | null {
    if (!(start > 0) || !(end >= 0) || !(years > 0)) return null
    return (Math.pow(end / start, 1 / years) - 1) * 100
  },
  /** Drawdown = (peak − trough)/peak; recovery needed = peak/trough − 1. */
  drawdown(peak: number, trough: number): { drawdownPct: number; recoveryPct: number | null } | null {
    if (!(peak > 0) || trough < 0) return null
    return { drawdownPct: ((peak - trough) / peak) * 100, recoveryPct: trough > 0 ? (peak / trough - 1) * 100 : null }
  },
  /** R = |target − entry| / |entry − stop|; break-even win rate = 1 / (1 + R). */
  riskReward(entry: number, stop: number, target: number): { risk: number; reward: number; ratio: number; breakevenWinRate: number; side: 'long' | 'short' } | null {
    const risk = Math.abs(entry - stop)
    const reward = Math.abs(target - entry)
    if (!(risk > 0)) return null
    const side = target >= entry ? 'long' : 'short'
    if ((side === 'long' && stop >= entry) || (side === 'short' && stop <= entry)) return null
    const ratio = reward / risk
    return { risk, reward, ratio, breakevenWinRate: (1 / (1 + ratio)) * 100, side }
  },
  /**
   * Isolated-margin liquidation estimate (linear contracts, ignores fees & funding):
   * long ≈ entry × (1 − 1/L + mmr), short ≈ entry × (1 + 1/L − mmr).
   */
  liquidation(entry: number, leverage: number, side: 'long' | 'short', maintenanceMarginPct = 0.5): { price: number; distancePct: number } | null {
    if (!(entry > 0) || !(leverage >= 1)) return null
    const mmr = maintenanceMarginPct / 100
    const price = side === 'long' ? entry * (1 - 1 / leverage + mmr) : entry * (1 + 1 / leverage - mmr)
    return { price: Math.max(0, price), distancePct: (Math.abs(entry - price) / entry) * 100 }
  },
  /** P/L = (exit − entry) × qty (reversed for shorts) − fees. */
  profitLoss(entry: number, exit: number, qty: number, side: 'long' | 'short', fees = 0): { pnl: number; pct: number | null } {
    const gross = (side === 'long' ? exit - entry : entry - exit) * qty
    const pnl = gross - fees
    const cost = entry * qty
    return { pnl, pct: cost > 0 ? (pnl / cost) * 100 : null }
  },
  /** Current weight vs target weight and the trade needed to rebalance each line. */
  allocation(rows: { name: string; value: number; targetPct: number }[]): { total: number; rows: { name: string; value: number; currentPct: number; targetPct: number; delta: number }[]; targetSum: number } {
    const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0)
    const targetSum = rows.reduce((s, r) => s + r.targetPct, 0)
    return {
      total,
      targetSum,
      rows: rows.map((r) => ({ name: r.name, value: r.value, currentPct: total > 0 ? (r.value / total) * 100 : 0, targetPct: r.targetPct, delta: (total * r.targetPct) / 100 - r.value }))
    }
  },
  /** amount × rate[to] / rate[from], where rates are quoted against one common base. */
  convert(amount: number, from: string, to: string, base: string, rates: Record<string, number>): number | null {
    const rf = from === base ? 1 : rates[from]
    const rt = to === base ? 1 : rates[to]
    if (!rf || !rt || !isFinite(amount)) return null
    return (amount / rf) * rt
  }
}

// ---------------------------------------------------------------- crypto research

export type RiskStatus = 'CHECKED' | 'WARNING' | 'UNKNOWN' | 'DATA UNAVAILABLE'

export interface RiskIndicator {
  id: string
  label: string
  status: RiskStatus
  detail: string
  source?: string
}

export interface DexPair {
  chainId: string
  dexId: string
  url: string
  pairAddress: string
  baseSymbol: string
  baseName: string
  baseAddress: string
  quoteSymbol: string
  priceUsd: number | null
  liquidityUsd: number | null
  volume24h: number | null
  priceChange24h: number | null
  buys24h: number | null
  sells24h: number | null
  fdv: number | null
  marketCap: number | null
  pairCreatedAt: number | null
  labels: string[]
}

export interface TokenSecurity {
  chainId: string
  address: string
  isOpenSource: boolean | null
  isProxy: boolean | null
  isMintable: boolean | null
  isHoneypot: boolean | null
  buyTaxPct: number | null
  sellTaxPct: number | null
  holderCount: number | null
  /** Share of supply held by the 10 largest holders, excluding burn and locked addresses (percent). */
  top10Pct: number | null
  ownerAddress: string | null
  fetchedAt: number
}

export interface CoinInfo {
  id: string
  symbol: string
  name: string
  image: string | null
  price: number | null
  marketCap: number | null
  fdv: number | null
  volume24h: number | null
  change24hPct: number | null
  rank: number | null
  circulating: number | null
  totalSupply: number | null
  maxSupply: number | null
  genesisDate: string | null
  categories: string[]
  homepage: string | null
  platforms: { chain: string; address: string }[]
  explorers: string[]
  lastUpdated: number | null
}

export interface ResearchSource {
  name: string
  ok: boolean
  fetchedAt: number
  detail?: string
}

export interface ResearchResult {
  query: string
  kind: 'coin' | 'token' | 'none'
  coin: CoinInfo | null
  token: { chainId: string; address: string; symbol: string; name: string } | null
  pairs: DexPair[]
  pairsNote?: string
  security: TokenSecurity | null
  securityNote?: string
  liquiditySnapshot: { liquidityUsd: number; ts: number } | null
  risk: RiskIndicator[]
  sources: ResearchSource[]
  fetchedAt: number
  error?: string
}

const DAY = 86_400_000

/**
 * Research indicators, never a verdict. CHECKED means "looked at this, nothing
 * flagged by the rule shown" — not that the asset is safe.
 */
export function computeRiskIndicators(input: {
  pairs: DexPair[]
  security: TokenSecurity | null
  securityNote?: string
  previousLiquidity: { liquidityUsd: number; ts: number } | null
  now: number
  nativeAsset?: boolean
}): RiskIndicator[] {
  const { pairs, security, previousLiquidity, now } = input
  const out: RiskIndicator[] = []
  const na = (id: string, label: string, detail: string, source?: string): RiskIndicator => ({ id, label, status: 'DATA UNAVAILABLE', detail, source })
  const noPairs = input.nativeAsset ? 'Native asset without a token contract — DEX pair data not applicable.' : 'No DEX pairs found on DexScreener.'
  const liq = pairs.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0)
  const vol = pairs.reduce((s, p) => s + (p.volume24h ?? 0), 0)
  const hasLiq = pairs.some((p) => p.liquidityUsd !== null)

  // Liquidity level
  if (!pairs.length || !hasLiq) out.push(na('liquidity', 'Liquidity level', pairs.length ? 'Pairs found but liquidity not reported.' : noPairs, 'DexScreener'))
  else if (liq < 50_000) out.push({ id: 'liquidity', label: 'Liquidity level', status: 'WARNING', detail: `Total DEX liquidity ≈ $${compact(liq)} (< $50K): large orders can move price substantially.`, source: 'DexScreener' })
  else out.push({ id: 'liquidity', label: 'Liquidity level', status: 'CHECKED', detail: `Total DEX liquidity ≈ $${compact(liq)} across ${pairs.length} pair${pairs.length === 1 ? '' : 's'}.`, source: 'DexScreener' })

  // Liquidity change vs. an earlier local snapshot (DexScreener has no liquidity history)
  if (!hasLiq) out.push(na('liquidity_change', 'Liquidity change', 'No current liquidity figure to compare.', 'DexScreener'))
  else if (!previousLiquidity || now - previousLiquidity.ts < 3_600_000) {
    out.push({ id: 'liquidity_change', label: 'Liquidity change', status: 'UNKNOWN', detail: previousLiquidity ? 'Earlier local snapshot is less than 1h old; re-check later to compare.' : 'No earlier local snapshot. SPECTER stores one now; research again later to see the change.', source: 'Local snapshots' })
  } else {
    const ch = previousLiquidity.liquidityUsd > 0 ? ((liq - previousLiquidity.liquidityUsd) / previousLiquidity.liquidityUsd) * 100 : null
    const age = humanAge(now - previousLiquidity.ts)
    if (ch === null) out.push({ id: 'liquidity_change', label: 'Liquidity change', status: 'UNKNOWN', detail: 'Earlier snapshot had zero liquidity.', source: 'Local snapshots' })
    else if (ch <= -30) out.push({ id: 'liquidity_change', label: 'Liquidity change', status: 'WARNING', detail: `Liquidity fell ${ch.toFixed(1)}% since your snapshot ${age} ago.`, source: 'Local snapshots + DexScreener' })
    else out.push({ id: 'liquidity_change', label: 'Liquidity change', status: 'CHECKED', detail: `Liquidity ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}% since your snapshot ${age} ago.`, source: 'Local snapshots + DexScreener' })
  }

  // Volume relative to liquidity
  if (!pairs.length || !hasLiq || liq <= 0) out.push(na('volume_liquidity', 'Volume vs liquidity', pairs.length ? 'Liquidity not reported.' : noPairs, 'DexScreener'))
  else {
    const ratio = vol / liq
    if (ratio > 5) out.push({ id: 'volume_liquidity', label: 'Volume vs liquidity', status: 'WARNING', detail: `24h volume is ${ratio.toFixed(1)}× liquidity — unusually high turnover (possible wash trading or a volatile event).`, source: 'DexScreener' })
    else out.push({ id: 'volume_liquidity', label: 'Volume vs liquidity', status: 'CHECKED', detail: `24h volume ${ratio.toFixed(2)}× liquidity.`, source: 'DexScreener' })
  }

  // Pair age
  const created = pairs.map((p) => p.pairCreatedAt).filter((x): x is number => typeof x === 'number' && x > 0)
  if (!pairs.length) out.push(na('pair_age', 'Pair age', noPairs, 'DexScreener'))
  else if (!created.length) out.push({ id: 'pair_age', label: 'Pair age', status: 'UNKNOWN', detail: 'Pair creation time not reported.', source: 'DexScreener' })
  else {
    const oldest = Math.min(...created)
    const age = now - oldest
    if (age < 7 * DAY) out.push({ id: 'pair_age', label: 'Pair age', status: 'WARNING', detail: `Oldest pair is only ${humanAge(age)} old.`, source: 'DexScreener' })
    else out.push({ id: 'pair_age', label: 'Pair age', status: 'CHECKED', detail: `Oldest pair created ${humanAge(age)} ago (${new Date(oldest).toISOString().slice(0, 10)}).`, source: 'DexScreener' })
  }

  // Sell activity (buys without sells can indicate transfer restrictions)
  const buys = pairs.reduce((s, p) => s + (p.buys24h ?? 0), 0)
  const sells = pairs.reduce((s, p) => s + (p.sells24h ?? 0), 0)
  if (!pairs.length || pairs.every((p) => p.buys24h === null)) out.push(na('sell_activity', 'Buy/sell activity', pairs.length ? 'Transaction counts not reported.' : noPairs, 'DexScreener'))
  else if (buys >= 20 && sells === 0) out.push({ id: 'sell_activity', label: 'Buy/sell activity', status: 'WARNING', detail: `${buys} buys and no sells in 24h — sells may be restricted.`, source: 'DexScreener' })
  else out.push({ id: 'sell_activity', label: 'Buy/sell activity', status: 'CHECKED', detail: `24h: ${buys} buys / ${sells} sells.`, source: 'DexScreener' })

  // Contract checks from GoPlus (free, keyless)
  const secNote = input.securityNote ?? 'No free keyless source available for this chain.'
  if (!security) {
    out.push(na('contract_verified', 'Contract source verified', secNote, 'GoPlus Security'))
    out.push(na('holder_concentration', 'Holder concentration', secNote, 'GoPlus Security'))
    out.push(na('transfer_flags', 'Honeypot / tax flags', secNote, 'GoPlus Security'))
  } else {
    if (security.isOpenSource === null) out.push({ id: 'contract_verified', label: 'Contract source verified', status: 'UNKNOWN', detail: 'Not reported.', source: 'GoPlus Security' })
    else if (security.isOpenSource) out.push({ id: 'contract_verified', label: 'Contract source verified', status: 'CHECKED', detail: `Source code is published/verified${security.isProxy ? ' (proxy contract — logic can be upgraded)' : ''}${security.isMintable ? '; contract is mintable' : ''}.`, source: 'GoPlus Security' })
    else out.push({ id: 'contract_verified', label: 'Contract source verified', status: 'WARNING', detail: 'Source code is not verified — behaviour cannot be inspected.', source: 'GoPlus Security' })

    if (security.top10Pct === null) out.push({ id: 'holder_concentration', label: 'Holder concentration', status: 'UNKNOWN', detail: 'Holder list not reported.', source: 'GoPlus Security' })
    else if (security.top10Pct > 50) out.push({ id: 'holder_concentration', label: 'Holder concentration', status: 'WARNING', detail: `Top 10 holders own ${security.top10Pct.toFixed(1)}% of supply (excl. burn/locked).${security.holderCount ? ` ${security.holderCount.toLocaleString('en-US')} holders.` : ''}`, source: 'GoPlus Security' })
    else out.push({ id: 'holder_concentration', label: 'Holder concentration', status: 'CHECKED', detail: `Top 10 holders own ${security.top10Pct.toFixed(1)}% of supply (excl. burn/locked; may include exchanges).${security.holderCount ? ` ${security.holderCount.toLocaleString('en-US')} holders.` : ''}`, source: 'GoPlus Security' })

    const taxes = [security.buyTaxPct, security.sellTaxPct].filter((x): x is number => x !== null)
    if (security.isHoneypot === null && !taxes.length) out.push({ id: 'transfer_flags', label: 'Honeypot / tax flags', status: 'UNKNOWN', detail: 'Not reported.', source: 'GoPlus Security' })
    else if (security.isHoneypot || taxes.some((t) => t > 10)) out.push({ id: 'transfer_flags', label: 'Honeypot / tax flags', status: 'WARNING', detail: `${security.isHoneypot ? 'Flagged as possible honeypot. ' : ''}Buy tax ${fmtTax(security.buyTaxPct)}, sell tax ${fmtTax(security.sellTaxPct)}.`, source: 'GoPlus Security' })
    else out.push({ id: 'transfer_flags', label: 'Honeypot / tax flags', status: 'CHECKED', detail: `Not flagged as honeypot. Buy tax ${fmtTax(security.buyTaxPct)}, sell tax ${fmtTax(security.sellTaxPct)}.`, source: 'GoPlus Security' })
  }
  return out
}

function fmtTax(t: number | null): string {
  return t === null ? 'unknown' : `${t.toFixed(1)}%`
}

function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(0)
}

export function humanAge(ms: number): string {
  const d = ms / DAY
  if (d >= 365) return `${(d / 365).toFixed(1)}y`
  if (d >= 1) return `${Math.floor(d)}d`
  const h = ms / 3_600_000
  if (h >= 1) return `${Math.floor(h)}h`
  return `${Math.max(1, Math.floor(ms / 60_000))}m`
}

export const CHAIN_EXPLORERS: Record<string, { name: string; token: string; address: string }> = {
  ethereum: { name: 'Etherscan', token: 'https://etherscan.io/token/', address: 'https://etherscan.io/address/' },
  bsc: { name: 'BscScan', token: 'https://bscscan.com/token/', address: 'https://bscscan.com/address/' },
  arbitrum: { name: 'Arbiscan', token: 'https://arbiscan.io/token/', address: 'https://arbiscan.io/address/' },
  polygon: { name: 'PolygonScan', token: 'https://polygonscan.com/token/', address: 'https://polygonscan.com/address/' },
  base: { name: 'BaseScan', token: 'https://basescan.org/token/', address: 'https://basescan.org/address/' },
  optimism: { name: 'Optimistic Etherscan', token: 'https://optimistic.etherscan.io/token/', address: 'https://optimistic.etherscan.io/address/' },
  avalanche: { name: 'Snowtrace', token: 'https://snowtrace.io/token/', address: 'https://snowtrace.io/address/' },
  solana: { name: 'Solscan', token: 'https://solscan.io/token/', address: 'https://solscan.io/account/' },
  tron: { name: 'Tronscan', token: 'https://tronscan.org/#/token20/', address: 'https://tronscan.org/#/address/' }
}

export function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim())
}

export function looksLikeAddress(s: string): boolean {
  const t = s.trim()
  return isEvmAddress(t) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(t)
}

// ---------------------------------------------------------------- FX

export interface FxRates {
  base: string
  rates: Record<string, number>
  source: 'er-api' | 'frankfurter'
  sourceUrl: string
  /** When the provider last updated the rates. */
  updatedAt: number | null
  fetchedAt: number
}

// ---------------------------------------------------------------- symbols

/** Well-known CoinGecko ids; anything else is resolved via CoinGecko search and cached. */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  TON: 'the-open-network',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  DOT: 'polkadot',
  POL: 'polygon-ecosystem-token',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  SHIB: 'shiba-inu',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  XLM: 'stellar',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  SUI: 'sui',
  PEPE: 'pepe',
  FIL: 'filecoin',
  ETC: 'ethereum-classic',
  HBAR: 'hedera-hashgraph',
  ICP: 'internet-computer',
  AAVE: 'aave',
  INJ: 'injective-protocol',
  XMR: 'monero',
  USDT: 'tether',
  USDC: 'usd-coin',
  WIF: 'dogwifcoin',
  SEI: 'sei-network',
  TIA: 'celestia',
  RENDER: 'render-token',
  HYPE: 'hyperliquid',
  TAO: 'bittensor',
  ENA: 'ethena',
  ONDO: 'ondo-finance',
  KAS: 'kaspa',
  BONK: 'bonk',
  FET: 'fetch-ai',
  ALGO: 'algorand',
  VET: 'vechain',
  MKR: 'maker',
  CRO: 'crypto-com-chain',
  JUP: 'jupiter-exchange-solana'
}

export const KNOWN_SYMBOLS = Object.keys(COINGECKO_IDS)

export function normalizeSymbol(input: string): string | null {
  const s = input.trim().replace(/^\$/, '').toUpperCase()
  return /^[A-Z0-9]{1,15}$/.test(s) ? s : null
}

export const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'LINK']

/**
 * Parses a user-typed number. Accepts "1,234.5", "1.234,5", "0,001" (decimal
 * comma) and "1 234,5". A lone comma is a thousands separator only when it
 * groups digits like "1,234" / "12,345,678" (never "0,001" or "1,5").
 */
export function parseNum(s: string): number {
  let t = String(s ?? '').trim().replace(/[\s_'  ]/g, '')
  if (!t) return NaN
  const comma = t.lastIndexOf(',')
  const dot = t.lastIndexOf('.')
  if (comma !== -1 && dot !== -1) t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (comma !== -1) t = /^[+-]?[1-9]\d{0,2}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.')
  return Number(t)
}

// ---------------------------------------------------------------- IPC contract

declare module '../ipc' {
  interface IpcContract {
    'market:status': () => MarketStatus
    'market:subscribe': (subId: string, symbols: string[], opts?: { live?: boolean }) => MarketTick
    'market:unsubscribe': (subId: string) => void
    'market:quotes': (symbols: string[], opts?: { maxAgeMs?: number }) => MarketTick
    'market:candles': (symbol: string, timeframe: Timeframe) => CandlesResult
    'market:validate': (symbol: string) => { ok: boolean; symbol: string; source?: ProviderId; error?: string }
    'market:checkProviders': () => ProviderHealth[]
    'market:watchlists': () => Watchlist[]
    'market:watchlistCreate': (name: string, symbols?: string[]) => Watchlist
    'market:watchlistRename': (id: string, name: string) => void
    'market:watchlistDelete': (id: string) => void
    'market:watchlistSetSymbols': (id: string, symbols: string[]) => void

    'alerts:list': () => AlertRule[]
    'alerts:create': (input: AlertInput) => AlertRule
    'alerts:update': (id: string, patch: Partial<Pick<AlertRule, 'enabled' | 'repeat' | 'cooldownMin' | 'threshold' | 'note'>>) => void
    'alerts:delete': (id: string) => void
    'alerts:log': (limit?: number) => AlertEvent[]
    'alerts:clearLog': () => void

    'portfolio:list': () => PortfolioTx[]
    'portfolio:add': (tx: PortfolioTxInput) => PortfolioTx
    'portfolio:update': (id: string, tx: PortfolioTxInput) => void
    'portfolio:delete': (id: string) => void

    'paper:state': () => PaperState
    'paper:order': (order: PaperOrderInput) => { ok: boolean; error?: string; trade?: PaperTrade }
    'paper:reset': (opts: { startingBalance: number; feeRate: number }) => PaperState

    'crypto:research': (query: string) => ResearchResult

    'finance:fx': (base: string) => FxRates
  }
  interface IpcEvents {
    'market:tick': MarketTick
    'market:status': MarketStatus
    'market:watchlistsChanged': void
    'alerts:triggered': AlertEvent
    'alerts:changed': void
    'paper:changed': void
    'portfolio:changed': void
  }
}
