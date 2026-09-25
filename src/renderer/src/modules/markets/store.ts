// Renderer-side market data cache. Components subscribe with the symbols they
// display; the main process streams/polls only while at least one visible
// component is subscribed.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MarketStatus, MarketTick, Quote, Watchlist } from '@shared/modules/markets'
import { invoke, on } from '../../lib/ipc'
import { useSetting } from '../../stores/settings'

const quotes = new Map<string, Quote>()
const errors = new Map<string, string>()
let status: MarketStatus | null = null
let version = 0
const listeners = new Set<() => void>()
let wired = false

function bump(): void {
  version++
  listeners.forEach((l) => l())
}

function apply(t: MarketTick | null | undefined): void {
  if (!t) return
  for (const q of t.quotes) {
    quotes.set(q.symbol, q)
    errors.delete(q.symbol)
  }
  for (const e of t.errors) if (!quotes.has(e.symbol) || Date.now() - quotes.get(e.symbol)!.fetchedAt > 120_000) errors.set(e.symbol, e.error)
  bump()
}

function wire(): void {
  if (wired) return
  wired = true
  on('market:tick', apply)
  on('market:status', (s) => {
    status = s
    bump()
  })
  invoke('market:status')
    .then((s) => {
      status = s
      bump()
    })
    .catch(() => undefined)
}

function subscribeStore(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useMarketVersion(): number {
  return useSyncExternalStore(subscribeStore, () => version)
}

/** True while the window is visible (minimized/hidden windows stop subscriptions). */
export function usePageVisible(): boolean {
  const [vis, setVis] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const f = () => setVis(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  return vis
}

let seq = 0

export interface QuoteAccess {
  get: (symbol: string) => Quote | undefined
  error: (symbol: string) => string | undefined
  version: number
}

/**
 * Subscribes to live quotes for `symbols` while mounted and visible.
 * `live: true` allows streaming (pages, panels); HUD-style readouts use polling.
 */
export function useQuotes(symbols: string[], opts: { live?: boolean; enabled?: boolean } = {}): QuoteAccess {
  const marketsOn = useSetting('markets.enabled')
  const visible = usePageVisible()
  const active = marketsOn && visible && opts.enabled !== false && symbols.length > 0
  const key = symbols.join(',')
  const live = !!opts.live
  useEffect(() => {
    if (!active) return
    wire()
    const id = `sub_${Date.now().toString(36)}_${++seq}`
    let alive = true
    invoke('market:subscribe', id, key.split(','), { live })
      .then((t) => alive && apply(t))
      .catch(() => undefined)
    return () => {
      alive = false
      invoke('market:unsubscribe', id).catch(() => undefined)
    }
  }, [active, key, live])
  const v = useMarketVersion()
  return { get: (s) => quotes.get(s), error: (s) => errors.get(s), version: v }
}

export function useMarketStatus(): MarketStatus | null {
  useEffect(() => wire(), [])
  useMarketVersion()
  return status
}

export function cachedQuote(symbol: string): Quote | undefined {
  return quotes.get(symbol)
}

export function useWatchlists(): { lists: Watchlist[]; loaded: boolean; reload: () => void } {
  const [lists, setLists] = useState<Watchlist[]>([])
  const [loaded, setLoaded] = useState(false)
  const reload = () =>
    invoke('market:watchlists')
      .then((l) => {
        setLists(l)
        setLoaded(true)
        knownSymbols = new Set(l.flatMap((w) => w.symbols))
      })
      .catch(() => setLoaded(true))
  useEffect(() => {
    reload()
    return on('market:watchlistsChanged', () => reload())
  }, [])
  return { lists, loaded, reload }
}

/** Symbols in any watchlist (kept fresh for the omnibox). */
let knownSymbols = new Set<string>()
let knownLoadedAt = 0
export async function watchedSymbols(): Promise<Set<string>> {
  if (Date.now() - knownLoadedAt > 30_000) {
    knownLoadedAt = Date.now()
    try {
      const l = await invoke('market:watchlists')
      knownSymbols = new Set(l.flatMap((w) => w.symbols))
    } catch {
      /* keep previous */
    }
  }
  return knownSymbols
}

/** Re-renders every `ms` so relative times ("12s ago") stay honest. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function useDebounced<T>(value: T, ms = 600): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
