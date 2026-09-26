// Small shared UI pieces for the markets module.
import type { ReactNode } from 'react'
import { AlertTriangle, Power, Radio } from 'lucide-react'
import type { MarketStatus, Quote } from '@shared/modules/markets'
import { sourceLabel } from '@shared/modules/markets'
import { formatCompact, formatPrice } from '../../lib/format'
import { setSetting } from '../../stores/settings'
import { useNow } from './store'

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

export function stamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function stampFull(ts: number): string {
  return new Date(ts).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Price with sensible precision (significant digits for micro-prices); em dash when unknown. */
export function px(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  if (n !== 0 && Math.abs(n) < 0.0001) return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(n)
  return formatPrice(n)
}

export function money(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
}

export function qty(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 6 : 8 }).format(n)
}

export function compact(n: number | null | undefined): string {
  return formatCompact(n)
}

export function signed(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return (n > 0 ? '+' : '') + money(n, digits)
}

export function Pct({ v, digits = 2, className = '' }: { v: number | null | undefined; digits?: number; className?: string }) {
  if (v === null || v === undefined || !isFinite(v)) return <span className={'dim ' + className}>—</span>
  return <span className={(v > 0 ? 'up ' : v < 0 ? 'down ' : 'muted ') + className}>{(v > 0 ? '+' : '') + v.toFixed(digits)}%</span>
}

export function Signed({ v, digits = 2, suffix = '' }: { v: number | null | undefined; digits?: number; suffix?: string }) {
  if (v === null || v === undefined || !isFinite(v)) return <span className="dim">—</span>
  return (
    <span className={v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}>
      {signed(v, digits)}
      {suffix}
    </span>
  )
}

/** Source + last-updated micro label with full detail in the tooltip. */
export function Stamp({ q, className = '' }: { q: Pick<Quote, 'source' | 'ts' | 'fetchedAt' | 'live' | 'quote' | 'pair'> | undefined; className?: string }) {
  const now = useNow(1000)
  if (!q) return <span className={'mono dim mk-stamp ' + className}>—</span>
  const tip = `Source: ${sourceLabel(q.source)} (${q.pair}, ${q.quote})${q.live ? ' · live stream' : ''}\nData time: ${stampFull(q.ts)}\nReceived: ${stampFull(q.fetchedAt)}`
  const stale = now - q.fetchedAt > 5 * 60_000
  return (
    <span className={'mono mk-stamp ' + (stale ? 'warn ' : '') + className} data-tip={tip}>
      {q.live && <i className="mk-live" />}
      {sourceLabel(q.source).split(' ')[0].toUpperCase()} · {ago(q.fetchedAt, now)}
    </span>
  )
}

export function Unavailable({ reason, short = false }: { reason?: string; short?: boolean }) {
  return (
    <span className="mk-na" data-tip={reason ?? 'Data unavailable'}>
      <AlertTriangle size={11} /> {short ? 'N/A' : 'Unavailable'}
    </span>
  )
}

export function StatusLine({ status }: { status: MarketStatus | null }) {
  const now = useNow(5000)
  if (!status) return null
  const pref = sourceLabel(status.preferred)
  const act = status.active ? sourceLabel(status.active) : null
  const modeLabel = status.mode === 'stream' ? (status.streamConnected ? 'LIVE STREAM' : 'STREAM RECONNECTING') : status.mode === 'poll' ? 'POLLING' : status.mode === 'background' ? 'ALERTS ONLY' : 'IDLE'
  const cooling = status.providers.filter((p) => p.ok === false && (p.cooldownUntil ?? 0) > now)
  return (
    <div className="mk-statusline">
      <span className={'status-dot ' + (status.mode === 'stream' && status.streamConnected ? 'ok' : status.active ? 'ok' : 'hollow')} />
      <span className="label">Source</span>
      <b className="mono">{(act ?? pref).toUpperCase()}</b>
      <span className="label" data-tip={status.mode === 'stream' ? 'Binance public WebSocket (24h mini ticker) + REST backup every 30s' : status.mode === 'poll' ? 'REST polling via rate-limited requests' : 'No market view is visible'}>
        <Radio size={10} /> {modeLabel}
      </span>
      <span className="label">Quote {status.quote}</span>
      {status.fallbackReason && (
        <span className="badge warn" data-tip={status.fallbackReason}>
          Fallback from {pref}
        </span>
      )}
      {cooling.length > 0 && !status.fallbackReason && (
        <span className="badge warn" data-tip={cooling.map((c) => `${c.label}: ${c.lastError}`).join('\n')}>
          {cooling.length} provider{cooling.length > 1 ? 's' : ''} backing off
        </span>
      )}
    </div>
  )
}

export function DisabledNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page">
      <div className="empty" style={{ marginTop: 60 }}>
        <Power size={28} />
        <div style={{ fontSize: 15, color: 'var(--fg-0)', fontWeight: 600 }}>{title} is off</div>
        <div style={{ maxWidth: 440 }}>Market tools are disabled, so SPECTER makes no market-data requests. {children}</div>
        <button className="btn primary" onClick={() => setSetting('markets.enabled', true)}>
          Enable market tools
        </button>
      </div>
    </div>
  )
}

export function PageHeader({ kicker, title, sub, right }: { kicker: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-h mk-page-h">
      <div className="grow">
        <div className="page-kicker">{kicker}</div>
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

export function Field({ label, children, hint, width }: { label: string; children: ReactNode; hint?: ReactNode; width?: number | string }) {
  return (
    <label className="mk-field" style={width ? { width } : undefined}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mk-hint">{hint}</span>}
    </label>
  )
}

/** Parses a user-typed number (decimal comma or point, optional grouping). */
export { parseNum } from '@shared/modules/markets'
