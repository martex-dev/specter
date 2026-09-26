// Market data hub: Provider → Normalizer → Cache → Event Bus → UI.
//
// - Provider selection with automatic per-symbol fallback (preferred first).
// - Health tracking with exponential cooldown (geo-blocks back off longest).
// - Subscriptions from UI surfaces are ref-counted; with no visible
//   subscriber the hub stops streaming and polling. Enabled alerts keep a
//   slow background REST check (no socket).
// - Updates are batched and broadcast as 'market:tick'.
import { webContents } from 'electron'
import type { MarketStatus, MarketTick, ProviderHealth, ProviderId, Quote, QuoteError } from '@shared/modules/markets'
import { COINGECKO_IDS, PROVIDERS, sourceLabel } from '@shared/modules/markets'
import { broadcast } from '../../ipc'
import { bus } from '../../bus'
import { createLogger } from '../../logger'
import { fetchJson } from '../../services/net'
import { getSetting } from '../../services/settings'
import { coinGeckoMarkets, describeError, HOSTS, isBlockedStatus, PROVIDER_IMPL, searchCoinGeckoId, setCoinGeckoResolver } from './providers'
import { normalizePremiumIndex } from './normalize'
import { BinanceStream } from './stream'
import { cachedCoinGeckoId, storeCoinGeckoId } from './store'

const log = createLogger('markets')

interface Sub {
  wcId: number
  symbols: string[]
  live: boolean
}

const subs = new Map<string, Sub>()
const trackedWc = new Set<number>()
const cache = new Map<string, Quote>()
const errors = new Map<string, string>()
const extras = new Map<string, Partial<Quote>>()
let alertSymbols: string[] = []
let alertHandler: ((quotes: Quote[]) => void) | null = null

const health = new Map<ProviderHealth['id'], ProviderHealth & { failures: number }>()
for (const id of [...PROVIDERS, 'binance-futures'] as const) health.set(id, { id, label: sourceLabel(id), ok: null, failures: 0 })

let active: ProviderId | null = null
let fallbackReason: string | undefined
let mode: MarketStatus['mode'] = 'idle'
let pollTimer: ReturnType<typeof setTimeout> | null = null
let polling = false
/** A poll was requested while one was in flight; run again right after it. */
let repoll = false
let pollDueAt = 0
let lastMcapAt = 0
let lastDerivAt = 0
let lastBusAt = 0

const stream = new BinanceStream(
  (q) => {
    storeQuote(q)
    queueTick([cache.get(q.symbol)!], [])
  },
  () => {
    scheduleStatus()
    // When the socket drops, REST polling tightens up automatically.
    if (!stream.connected && mode === 'stream') reschedule(2000)
  }
)

export const isEnabled = (): boolean => getSetting('markets.enabled')
export const settingQuote = (): string => (getSetting('markets.quote') || 'USDT').trim().toUpperCase() || 'USDT'
const preferred = (): ProviderId => {
  const p = getSetting('markets.provider')
  return PROVIDERS.includes(p) ? p : 'binance'
}

// ---------------------------------------------------------------- CoinGecko id resolution

const resolving = new Map<string, Promise<string | null>>()
setCoinGeckoResolver(async (symbol) => {
  if (COINGECKO_IDS[symbol]) return COINGECKO_IDS[symbol]
  const cached = cachedCoinGeckoId(symbol)
  if (cached !== undefined) return cached
  let p = resolving.get(symbol)
  if (!p) {
    p = searchCoinGeckoId(symbol)
      .then((id) => {
        storeCoinGeckoId(symbol, id)
        return id
      })
      .finally(() => resolving.delete(symbol))
    resolving.set(symbol, p)
  }
  return p
})

// ---------------------------------------------------------------- health

function markOk(id: ProviderHealth['id'], latencyMs?: number): void {
  const h = health.get(id)!
  const changed = h.ok !== true
  h.ok = true
  h.failures = 0
  h.lastOk = Date.now()
  h.cooldownUntil = undefined
  if (latencyMs !== undefined) h.latencyMs = latencyMs
  if (changed) scheduleStatus()
}

function markFail(id: ProviderHealth['id'], err: unknown): void {
  const h = health.get(id)!
  h.ok = false
  h.failures++
  h.lastError = describeError(err)
  h.lastErrorAt = Date.now()
  const base = isBlockedStatus(err) ? 15 * 60_000 : 15_000 * 2 ** Math.min(h.failures - 1, 5)
  h.cooldownUntil = Date.now() + Math.min(base, 15 * 60_000)
  log.warn(`${h.label} failed: ${h.lastError}`)
  scheduleStatus()
}

function providerOrder(): ProviderId[] {
  const pref = preferred()
  const order = [pref, ...PROVIDERS.filter((p) => p !== pref)]
  const now = Date.now()
  const ready = order.filter((p) => !((health.get(p)!.cooldownUntil ?? 0) > now))
  return ready.length ? ready : order
}

export function providerHealth(): ProviderHealth[] {
  return [...health.values()].map(({ failures: _f, ...h }) => ({ ...h }))
}

// ---------------------------------------------------------------- cache

function storeQuote(q: Quote): void {
  const prev = cache.get(q.symbol)
  const ex = extras.get(q.symbol)
  const merged: Quote = { ...q }
  // Keep enrichment from other sources unless this quote brings its own.
  if (merged.marketCap === undefined) {
    if (ex?.marketCap !== undefined) Object.assign(merged, { marketCap: ex.marketCap, marketCapSource: ex.marketCapSource, marketCapTs: ex.marketCapTs })
    else if (prev?.marketCap !== undefined) Object.assign(merged, { marketCap: prev.marketCap, marketCapSource: prev.marketCapSource, marketCapTs: prev.marketCapTs })
  }
  if (ex?.derivSource) Object.assign(merged, { fundingRate: ex.fundingRate, nextFundingTime: ex.nextFundingTime, openInterest: ex.openInterest, derivSource: ex.derivSource, derivTs: ex.derivTs, derivNote: ex.derivNote })
  cache.set(q.symbol, merged)
  errors.delete(q.symbol)
}

export function cachedQuote(symbol: string): Quote | undefined {
  return cache.get(symbol)
}

// ---------------------------------------------------------------- fetch with fallback

export async function fetchQuotes(symbols: string[], maxAgeMs = 0): Promise<MarketTick> {
  if (!isEnabled()) return { quotes: [], errors: symbols.map((s) => ({ symbol: s, error: 'Market tools are disabled in Settings' })) }
  const now = Date.now()
  const out: Quote[] = []
  let need: string[] = []
  for (const s of [...new Set(symbols)]) {
    const c = cache.get(s)
    if (c && maxAgeMs > 0 && now - c.fetchedAt <= maxAgeMs) out.push(c)
    else need.push(s)
  }
  const reasons = new Map<string, string[]>()
  const served = new Map<ProviderId, number>()
  const pref = preferred()
  let prefFailure: string | undefined
  const quote = settingQuote()
  for (const p of providerOrder()) {
    if (!need.length) break
    const t0 = Date.now()
    try {
      const r = await PROVIDER_IMPL[p].quotes(need, quote)
      markOk(p, Date.now() - t0)
      for (const q of r.quotes) {
        storeQuote(q)
        out.push(cache.get(q.symbol)!)
      }
      served.set(p, (served.get(p) ?? 0) + r.quotes.length)
      for (const m of r.missing) reasons.set(m.symbol, [...(reasons.get(m.symbol) ?? []), m.reason])
      need = r.missing.map((m) => m.symbol)
    } catch (err) {
      markFail(p, err)
      const msg = `${sourceLabel(p)}: ${describeError(err)}`
      if (p === pref) prefFailure = msg
      for (const s of need) reasons.set(s, [...(reasons.get(s) ?? []), msg])
    }
  }
  if (!served.has(pref) && (health.get(pref)!.cooldownUntil ?? 0) > Date.now() && !prefFailure) prefFailure = `${sourceLabel(pref)}: ${health.get(pref)!.lastError ?? 'temporarily skipped after failures'}`
  const errs: QuoteError[] = need.map((s) => ({ symbol: s, error: `Unavailable — ${(reasons.get(s) ?? ['no provider returned data']).join('; ')}` }))
  for (const e of errs) errors.set(e.symbol, e.error)
  if (served.size) {
    const top = [...served.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const prevActive = active
    active = top
    fallbackReason = top !== pref ? prefFailure ?? `${sourceLabel(pref)} did not list these symbols` : undefined
    if (prevActive !== active) scheduleStatus()
  }
  return { quotes: out, errors: errs }
}

// ---------------------------------------------------------------- enrichment (market cap, funding, open interest)

async function refreshMarketCaps(symbols: string[]): Promise<void> {
  const h = health.get('coingecko')!
  if ((h.cooldownUntil ?? 0) > Date.now()) return
  const ids = new Map<string, string>()
  for (const s of symbols) {
    const id = COINGECKO_IDS[s] ?? cachedCoinGeckoId(s)
    if (id) ids.set(id, s)
  }
  try {
    const rows = !ids.size ? [] : await coinGeckoMarkets([...ids.keys()], 240_000)
    if (ids.size) markOk('coingecko')
    const touched: Quote[] = []
    for (const r of rows) {
      const s = ids.get(r.id)
      if (!s) continue
      const ts = r.last_updated ? Date.parse(r.last_updated) : Date.now()
      const ex = { ...(extras.get(s) ?? {}), marketCap: typeof r.market_cap === 'number' && r.market_cap > 0 ? r.market_cap : null, marketCapSource: 'coingecko', marketCapTs: isFinite(ts) ? ts : Date.now() }
      extras.set(s, ex)
      const c = cache.get(s)
      if (c) {
        const next = { ...c, marketCap: ex.marketCap, marketCapSource: ex.marketCapSource, marketCapTs: ex.marketCapTs }
        cache.set(s, next)
        touched.push(next)
      }
    }
    // Symbols CoinGecko doesn't cover: record "not reported" so they don't trigger refetches.
    for (const s of symbols) if (!extras.get(s)?.marketCapSource) extras.set(s, { ...(extras.get(s) ?? {}), marketCap: null, marketCapSource: 'coingecko', marketCapTs: Date.now() })
    if (touched.length) queueTick(touched, [])
  } catch (err) {
    markFail('coingecko', err)
  }
}

async function refreshDerivatives(symbols: string[]): Promise<void> {
  const h = health.get('binance-futures')!
  if ((h.cooldownUntil ?? 0) > Date.now()) return
  const t0 = Date.now()
  try {
    const rows = await fetchJson<any[]>(`${HOSTS.binanceFutures}/fapi/v1/premiumIndex`, { ttl: 55_000, timeoutMs: 10000 })
    markOk('binance-futures', Date.now() - t0)
    const idx = normalizePremiumIndex(rows)
    const touched: Quote[] = []
    await Promise.all(
      symbols.slice(0, 30).map(async (s) => {
        const pair = `${s}USDT`
        const p = idx.get(pair)
        let oi: number | null = null
        let note: string | undefined
        if (!p) note = `No ${pair} perpetual on Binance Futures`
        else {
          try {
            const r = await fetchJson<{ openInterest: string }>(`${HOSTS.binanceFutures}/fapi/v1/openInterest?symbol=${pair}`, { ttl: 55_000, timeoutMs: 8000 })
            const n = Number(r.openInterest)
            oi = isFinite(n) ? n : null
          } catch {
            note = 'Open interest request failed'
          }
        }
        const ex: Partial<Quote> = { ...(extras.get(s) ?? {}), fundingRate: p?.fundingRate ?? null, nextFundingTime: p?.nextFundingTime ?? null, openInterest: oi, derivSource: 'binance-futures', derivTs: p?.ts ?? Date.now(), derivNote: note }
        extras.set(s, ex)
        const c = cache.get(s)
        if (c) {
          const next = { ...c, ...ex }
          cache.set(s, next)
          touched.push(next)
        }
      })
    )
    if (touched.length) queueTick(touched, [])
  } catch (err) {
    markFail('binance-futures', err)
    for (const s of symbols) {
      const ex: Partial<Quote> = { ...(extras.get(s) ?? {}), fundingRate: null, openInterest: null, nextFundingTime: null, derivSource: 'binance-futures', derivTs: Date.now(), derivNote: `Binance Futures unavailable: ${describeError(err)}` }
      extras.set(s, ex)
    }
  }
}

// ---------------------------------------------------------------- batching + events

let pendingQuotes = new Map<string, Quote>()
let pendingErrors = new Map<string, string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function queueTick(quotes: Quote[], errs: QuoteError[]): void {
  for (const q of quotes) pendingQuotes.set(q.symbol, q)
  for (const e of errs) pendingErrors.set(e.symbol, e.error)
  if (!flushTimer) flushTimer = setTimeout(flush, 400)
}

function flush(): void {
  flushTimer = null
  const quotes = [...pendingQuotes.values()]
  const errs = [...pendingErrors.entries()].map(([symbol, error]) => ({ symbol, error }))
  pendingQuotes = new Map()
  pendingErrors = new Map()
  if (!quotes.length && !errs.length) return
  broadcast('market:tick', { quotes, errors: errs })
  if (quotes.length && alertHandler) {
    try {
      alertHandler(quotes)
    } catch (err) {
      log.error('alert evaluation failed', err)
    }
  }
  if (quotes.length && Date.now() - lastBusAt > 15_000) {
    lastBusAt = Date.now()
    bus.emit('MARKET_UPDATED', { symbols: quotes.map((q) => q.symbol) })
  }
}

let statusTimer: ReturnType<typeof setTimeout> | null = null
function scheduleStatus(): void {
  if (statusTimer) return
  statusTimer = setTimeout(() => {
    statusTimer = null
    broadcast('market:status', status())
  }, 250)
}

export function status(): MarketStatus {
  return {
    enabled: isEnabled(),
    preferred: preferred(),
    active,
    fallbackReason,
    providers: providerHealth(),
    mode,
    streamConnected: stream.connected,
    symbols: wanted().all,
    quote: settingQuote(),
    updatedAt: Date.now()
  }
}

// ---------------------------------------------------------------- subscriptions + scheduling

function wanted(): { all: string[]; visible: string[]; live: boolean } {
  const visible = new Set<string>()
  let live = false
  for (const s of subs.values()) {
    for (const sym of s.symbols) visible.add(sym)
    if (s.live) live = true
  }
  const all = new Set([...visible, ...alertSymbols])
  return { all: [...all], visible: [...visible], live }
}

export function subscribe(subId: string, wcId: number, symbols: string[], live: boolean): MarketTick {
  if (!trackedWc.has(wcId)) {
    const wc = webContents.fromId(wcId)
    if (wc) {
      trackedWc.add(wcId)
      const drop = () => {
        for (const [id, s] of subs) if (s.wcId === wcId) subs.delete(id)
        reschedule(0)
      }
      wc.once('destroyed', () => {
        trackedWc.delete(wcId)
        drop()
      })
      // A crashed UI renderer is reloaded in place (same webContents): its old
      // subscriptions can never be unsubscribed and would keep streaming.
      wc.on('render-process-gone', drop)
      wc.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) drop()
      })
    }
  }
  const syms = [...new Set(symbols)].slice(0, 100)
  const prev = subs.get(subId)
  subs.set(subId, { wcId, symbols: syms, live })
  const snapshot: MarketTick = { quotes: syms.map((s) => cache.get(s)).filter((q): q is Quote => !!q), errors: syms.filter((s) => errors.has(s)).map((s) => ({ symbol: s, error: errors.get(s)! })) }
  const changed = !prev || prev.live !== live || prev.symbols.join() !== syms.join()
  const missing = syms.some((s) => !cache.has(s) || Date.now() - cache.get(s)!.fetchedAt > 60_000)
  if (changed) reschedule(missing ? 30 : 500)
  return snapshot
}

export function unsubscribe(subId: string): void {
  if (subs.delete(subId)) reschedule(200)
}

export function setAlertWatch(symbols: string[], handler: (quotes: Quote[]) => void): void {
  alertSymbols = [...new Set(symbols)]
  alertHandler = handler
  reschedule(1000)
}

function pollDelay(): number {
  const w = wanted()
  const battery = getSetting('performance.mode') === 'battery'
  if (!w.visible.length) return battery ? 180_000 : 60_000
  if (!w.live) return battery ? 60_000 : 15_000
  if (stream.connected) return 30_000
  if (active === 'coingecko') return 60_000
  return battery ? 30_000 : 10_000
}

export function reschedule(delay?: number): void {
  if (!isEnabled()) {
    stopAll()
    return
  }
  const w = wanted()
  if (!w.all.length) {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
    stream.stop()
    if (mode !== 'idle') {
      mode = 'idle'
      scheduleStatus()
    }
    return
  }
  // Stream only for visible live surfaces, only when Binance is the preferred source and healthy.
  const useStream = w.live && preferred() === 'binance' && !((health.get('binance')!.cooldownUntil ?? 0) > Date.now())
  if (useStream) stream.set(w.visible, PROVIDER_IMPL.binance.quoteFor(settingQuote()))
  else stream.stop()
  const nextMode: MarketStatus['mode'] = useStream ? 'stream' : w.visible.length ? 'poll' : 'background'
  if (nextMode !== mode) {
    mode = nextMode
    scheduleStatus()
  }
  // Keep an already-scheduled poll if it is due sooner (e.g. a new subscriber's immediate fetch).
  const due = Date.now() + (delay ?? pollDelay())
  if (pollTimer && pollDueAt <= due) return
  if (pollTimer) clearTimeout(pollTimer)
  pollDueAt = due
  pollTimer = setTimeout(pollOnce, Math.max(0, due - Date.now()))
}

async function pollOnce(): Promise<void> {
  pollTimer = null
  if (polling) {
    repoll = true
    return
  }
  polling = true
  repoll = false
  try {
    const w = wanted()
    if (!w.all.length || !isEnabled()) return
    const maxAge = stream.connected ? 5_000 : 0
    const tick = await fetchQuotes(w.all, maxAge)
    queueTick(
      tick.quotes.filter((q) => !stream.connected || !q.live),
      tick.errors
    )
    if (w.live && w.visible.length) {
      const now = Date.now()
      // Refresh on schedule, or sooner (≥20 s apart) when newly visible symbols lack enrichment.
      const needMcap = w.visible.some((s) => !extras.get(s)?.marketCapSource)
      const needDeriv = w.visible.some((s) => !extras.get(s)?.derivSource)
      if (now - lastMcapAt > 300_000 || (needMcap && now - lastMcapAt > 20_000)) {
        lastMcapAt = now
        void refreshMarketCaps(w.visible)
      }
      if (now - lastDerivAt > 60_000 || (needDeriv && now - lastDerivAt > 20_000)) {
        lastDerivAt = now
        void refreshDerivatives(w.visible)
      }
    }
  } catch (err) {
    log.error('poll failed', err)
  } finally {
    polling = false
    if (isEnabled()) reschedule(repoll ? 50 : undefined)
    repoll = false
  }
}

export function stopAll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  stream.stop()
  if (mode !== 'idle') {
    mode = 'idle'
    scheduleStatus()
  }
}

/** Settings changed (provider / quote / enabled): drop caches and restart. */
export function resetHub(): void {
  cache.clear()
  errors.clear()
  extras.clear()
  active = null
  fallbackReason = undefined
  lastMcapAt = 0
  lastDerivAt = 0
  for (const h of health.values()) h.cooldownUntil = undefined
  stream.stop()
  scheduleStatus()
  reschedule(50)
}

// ---------------------------------------------------------------- diagnostics probes

export async function probe(id: ProviderHealth['id']): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const t0 = Date.now()
  try {
    if (id === 'binance-futures') await fetchJson(`${HOSTS.binanceFutures}/fapi/v1/ping`, { timeoutMs: 6000, retries: 0 })
    else await PROVIDER_IMPL[id].ping()
    const latencyMs = Date.now() - t0
    markOk(id, latencyMs)
    return { ok: true, latencyMs }
  } catch (err) {
    markFail(id, err)
    return { ok: false, error: describeError(err) }
  }
}

export function streamInfo(): { connected: boolean; lastError: string | null; lastMessageAt: number } {
  return { connected: stream.connected, lastError: stream.lastError, lastMessageAt: stream.lastMessageAt }
}
