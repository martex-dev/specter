// Widgets — renderer state: a shared cache over the main-process key-value
// store (live across windows), the widget visibility config, and small hooks.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEFAULT_WIDGETS_CONFIG, type WidgetId, type WidgetKvKey, type WidgetsConfig } from '@shared/modules/widgets'
import { invoke, on } from '../../lib/ipc'

const cache = new Map<WidgetKvKey, unknown>()
const loaded = new Set<WidgetKvKey>()
const inflight = new Map<WidgetKvKey, Promise<void>>()
const subs = new Map<WidgetKvKey, Set<() => void>>()
let listening = false

function emit(key: WidgetKvKey): void {
  subs.get(key)?.forEach((fn) => fn())
}

function load(key: WidgetKvKey): Promise<void> {
  let p = inflight.get(key)
  if (p) return p
  p = invoke('widgets:kvGet', key)
    .then((v) => {
      cache.set(key, v)
      loaded.add(key)
      emit(key)
    })
    .catch(() => {
      loaded.add(key)
      emit(key)
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

function ensureListening(): void {
  if (listening) return
  listening = true
  on('widgets:kvChanged', ({ key }) => {
    if (subs.get(key)?.size) void load(key)
    else loaded.delete(key)
  })
}

function subscribe(key: WidgetKvKey, fn: () => void): () => void {
  ensureListening()
  let set = subs.get(key)
  if (!set) subs.set(key, (set = new Set()))
  set.add(fn)
  if (!loaded.has(key)) void load(key)
  return () => set!.delete(fn)
}

// Stable per-key subscribe functions so useSyncExternalStore doesn't resubscribe each render.
const subFns = new Map<WidgetKvKey, (fn: () => void) => () => void>()
function subFor(key: WidgetKvKey): (fn: () => void) => () => void {
  let f = subFns.get(key)
  if (!f) subFns.set(key, (f = (fn) => subscribe(key, fn)))
  return f
}

/** Reads the cached value synchronously (undefined until loaded). */
export function kvPeek<T>(key: WidgetKvKey): T | undefined {
  const v = cache.get(key)
  return v === null ? undefined : (v as T | undefined)
}

export async function kvRead<T>(key: WidgetKvKey, fallback: T): Promise<T> {
  if (!loaded.has(key)) await load(key)
  return (kvPeek<T>(key) ?? fallback) as T
}

export function kvWrite<T>(key: WidgetKvKey, value: T): void {
  cache.set(key, value)
  loaded.add(key)
  emit(key)
  invoke('widgets:kvSet', key, value).catch(() => undefined)
}

/** Persisted widget value (SQLite via main), shared live across all SPECTER windows. */
export function useKv<T>(key: WidgetKvKey, fallback: T): [T, (v: T) => void, boolean] {
  const sub = subFor(key)
  const snap = useSyncExternalStore(sub, () => cache.get(key))
  const isLoaded = useSyncExternalStore(sub, () => loaded.has(key))
  const value = (snap === null || snap === undefined ? fallback : snap) as T
  return [value, (v: T) => kvWrite(key, v), isLoaded]
}

/** Subscribes to a key outside React (used for dock visibility). */
export function watchKv(key: WidgetKvKey, fn: () => void): () => void {
  return subscribe(key, fn)
}

// ---------------------------------------------------------------- widget config

export function mergeConfig(raw: unknown): WidgetsConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<WidgetsConfig>
  return {
    dock: { ...DEFAULT_WIDGETS_CONFIG.dock, ...(c.dock ?? {}) },
    newtab: { ...DEFAULT_WIDGETS_CONFIG.newtab, ...(c.newtab ?? {}) }
  }
}

export function getConfig(): WidgetsConfig {
  return mergeConfig(cache.get('config'))
}

export function useConfig(): [WidgetsConfig, (c: WidgetsConfig) => void] {
  const [raw, set] = useKv<unknown>('config', null)
  return [mergeConfig(raw), (c) => set(c)]
}

/** False until the stored config has loaded (avoids flashing disabled cards). */
export function useNewTabEnabled(id: WidgetId): boolean {
  const [raw, , isLoaded] = useKv<unknown>('config', null)
  return isLoaded && mergeConfig(raw).newtab[id]
}

// ---------------------------------------------------------------- hooks

/** Re-renders every `ms` while mounted and the window is visible. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (t) return
      setNow(Date.now())
      t = setInterval(() => setNow(Date.now()), ms)
    }
    const stop = () => {
      if (t) clearInterval(t)
      t = null
    }
    const vis = () => (document.hidden ? stop() : start())
    vis()
    document.addEventListener('visibilitychange', vis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', vis)
    }
  }, [ms])
  return now
}

/** Runs `fn` now and every `ms` while mounted and the window is visible (no background polling). */
export function useVisibleInterval(fn: () => void, ms: number, deps: unknown[] = []): void {
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null
    let last = 0
    const tick = () => {
      last = Date.now()
      fn()
    }
    const start = () => {
      if (t) return
      if (Date.now() - last >= ms) tick()
      t = setInterval(tick, ms)
    }
    const stop = () => {
      if (t) clearInterval(t)
      t = null
    }
    const vis = () => (document.hidden ? stop() : start())
    vis()
    document.addEventListener('visibilitychange', vis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', vis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps])
}

const NET_ERRORS: [RegExp, string][] = [
  [/ERR_INTERNET_DISCONNECTED/, 'No internet connection'],
  [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/, 'Server not found (DNS lookup failed)'],
  [/ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED/, 'Could not reach the proxy server'],
  [/ERR_CONNECTION_(REFUSED|RESET|CLOSED|FAILED|ABORTED)|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED/, 'Connection failed'],
  [/ERR_(CONNECTION_)?TIMED_OUT/, 'Connection timed out'],
  [/ERR_CERT_|ERR_SSL_/, 'Secure connection failed (certificate/TLS error)']
]

/** Readable message for an IPC/network error (keeps the net:: code for diagnostics). */
export function errorText(err: unknown): string {
  const s = (err instanceof Error ? err.message : String(err ?? ''))
    // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
  const code = /net::(ERR_[A-Z_]+)/.exec(s)?.[1]
  const hit = code ? NET_ERRORS.find(([re]) => re.test(code)) : undefined
  return hit ? `${hit[1]} (${code})` : s
}

export function isOfflineError(msg: string): boolean {
  return /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|ERR_CONNECTION|ERR_PROXY|ERR_TIMED_OUT|timed out|No internet|Failed to fetch|offline/i.test(msg) || (typeof navigator !== 'undefined' && navigator.onLine === false)
}
