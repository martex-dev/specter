// Binance public WebSocket (24h mini-ticker) with reconnect + exponential
// backoff. Only runs while something market-related is visible.
import type { Quote } from '@shared/modules/markets'
import { createLogger } from '../../logger'
import { normalizeBinanceMiniTicker, type BinanceMiniTicker } from './normalize'

const log = createLogger('markets:ws')
const WS_BASE = 'wss://stream.binance.com:9443/stream?streams='

export class BinanceStream {
  private ws: WebSocket | null = null
  private key = ''
  private symbols: string[] = []
  private quote = 'USDT'
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  connected = false
  lastError: string | null = null
  lastMessageAt = 0

  constructor(
    private onQuote: (q: Quote) => void,
    private onState: () => void
  ) {}

  /** Sets the streamed symbols; reconnects only when the set changes. */
  set(symbols: string[], quote: string): void {
    const syms = [...new Set(symbols)].filter((s) => s !== quote).sort()
    const key = syms.join(',') + '|' + quote
    if (!syms.length) return this.stop()
    if (key === this.key && (this.ws || this.timer)) return
    const hadSocket = !!this.ws
    this.key = key
    this.symbols = syms
    this.quote = quote
    this.retry = 0
    if (!hadSocket) return this.open()
    // Symbol set changed while connected (e.g. navigating between views):
    // keep the current socket briefly so rapid changes cause one reconnect.
    if (this.timer) clearTimeout(this.timer)
    const gen = this.generation
    this.timer = setTimeout(() => {
      this.timer = null
      if (gen === this.generation && this.symbols.length) this.open()
    }, 1500)
  }

  stop(): void {
    this.key = ''
    this.symbols = []
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
    if (this.connected) {
      this.connected = false
      this.onState()
    }
  }

  get active(): boolean {
    return this.symbols.length > 0
  }

  private open(): void {
    const gen = ++this.generation
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    if (typeof WebSocket === 'undefined') {
      this.lastError = 'WebSocket not available in this runtime'
      return
    }
    const bySymbol = new Map(this.symbols.map((s) => [(s + this.quote).toUpperCase(), s]))
    const url = WS_BASE + this.symbols.map((s) => `${(s + this.quote).toLowerCase()}@miniTicker`).join('/')
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err) {
      this.lastError = String((err as Error)?.message ?? err)
      this.scheduleReconnect(gen)
      return
    }
    this.ws = ws
    const quote = this.quote
    ws.onopen = () => {
      if (gen !== this.generation) return
      this.retry = 0
      this.connected = true
      this.lastError = null
      log.info(`stream connected (${this.symbols.length} symbols)`)
      this.onState()
    }
    ws.onmessage = (ev) => {
      if (gen !== this.generation) return
      try {
        const msg = JSON.parse(String(ev.data)) as { data?: BinanceMiniTicker }
        const d = msg.data
        if (!d || d.e !== '24hrMiniTicker') return
        const base = bySymbol.get(d.s)
        if (!base) return
        const now = Date.now()
        this.lastMessageAt = now
        const q = normalizeBinanceMiniTicker(d, base, quote, now)
        if (q) this.onQuote(q)
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onerror = () => {
      if (gen !== this.generation) return
      this.lastError = 'WebSocket error'
    }
    ws.onclose = (ev) => {
      if (gen !== this.generation) return
      this.ws = null
      const was = this.connected
      this.connected = false
      if (ev.code !== 1000) this.lastError = `closed (${ev.code}${ev.reason ? ' ' + ev.reason : ''})`
      if (was) this.onState()
      this.scheduleReconnect(gen)
    }
  }

  private scheduleReconnect(gen: number): void {
    if (!this.symbols.length || gen !== this.generation) return
    const delay = Math.min(60_000, 1000 * 2 ** this.retry) + Math.random() * 500
    this.retry = Math.min(this.retry + 1, 8)
    log.debug(`reconnecting in ${Math.round(delay)}ms`)
    this.timer = setTimeout(() => {
      this.timer = null
      if (gen === this.generation && this.symbols.length) this.open()
    }, delay)
    this.onState()
  }
}
