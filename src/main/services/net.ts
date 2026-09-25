// Networking layer for SPECTER's own requests to public APIs (never used for
// page traffic). Provides timeouts, per-host rate limiting, exponential
// backoff on retryable failures and an in-memory TTL cache.
import { net } from 'electron'
import { createLogger } from '../logger'

const log = createLogger('net')

interface HostState {
  /** Minimum interval between requests to this host, in ms. */
  minInterval: number
  nextAllowed: number
  backoffUntil: number
  failures: number
}

const hosts = new Map<string, HostState>()
const cache = new Map<string, { expires: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

export function setRateLimit(host: string, requestsPerSecond: number): void {
  const st = hostState(host)
  st.minInterval = Math.ceil(1000 / requestsPerSecond)
}

function hostState(host: string): HostState {
  let st = hosts.get(host)
  if (!st) {
    st = { minInterval: 250, nextAllowed: 0, backoffUntil: 0, failures: 0 }
    hosts.set(host, st)
  }
  return st
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number
  retries?: number
  /** Cache TTL in ms (0 = no cache). */
  ttl?: number
  headers?: Record<string, string>
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, ttl = 0, headers } = opts
  if (ttl > 0) {
    const hit = cache.get(url)
    if (hit && hit.expires > Date.now()) return hit.value as T
  }
  const existing = inflight.get(url)
  if (existing) return existing as Promise<T>

  const p = (async () => {
    const host = new URL(url).host
    const st = hostState(host)
    let attempt = 0
    for (;;) {
      const now = Date.now()
      const wait = Math.max(st.nextAllowed - now, st.backoffUntil - now, 0)
      if (wait > 0) {
        if (wait > 60_000) throw new Error(`${host} is rate-limited; retry later`)
        await sleep(wait)
      }
      st.nextAllowed = Date.now() + st.minInterval
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await net.fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'SPECTER-Browser', ...headers } })
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after')) * 1000
          st.failures++
          st.backoffUntil = Date.now() + (retryAfter || Math.min(60_000, 1000 * 2 ** st.failures))
          throw new HttpError(res.status, `HTTP ${res.status} from ${host}`)
        }
        if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} from ${host}`)
        const data = (await res.json()) as T
        st.failures = 0
        if (ttl > 0) cache.set(url, { expires: Date.now() + ttl, value: data })
        return data
      } catch (err: any) {
        const retryable = err?.name === 'AbortError' || (err instanceof HttpError && (err.status === 429 || err.status >= 500)) || err?.code === 'ECONNRESET' || /net::ERR_(CONNECTION|NETWORK|TIMED_OUT|INTERNET)/.test(String(err?.message))
        if (!retryable || attempt >= retries) {
          if (err?.name === 'AbortError') throw new Error(`Request to ${host} timed out`)
          throw err
        }
        attempt++
        const delay = Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250
        log.debug(`retrying ${host} in ${Math.round(delay)}ms`, { attempt })
        await sleep(delay)
      } finally {
        clearTimeout(timer)
      }
    }
  })()
  inflight.set(url, p)
  try {
    return (await p) as T
  } finally {
    inflight.delete(url)
  }
}

export function clearNetCache(prefix?: string): void {
  if (!prefix) cache.clear()
  else for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k)
}
