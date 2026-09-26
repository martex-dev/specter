// Compact market surfaces: HUD ticker, new-tab strip, status-bar indicator,
// and the side panel mini watchlist.
import { useMemo, useState } from 'react'
import { CandlestickChart, ExternalLink } from 'lucide-react'
import type { Quote } from '@shared/modules/markets'
import { sourceLabel } from '@shared/modules/markets'
import { activeTab, loadUrl, newTab } from '../../stores/browser'
import { useSetting } from '../../stores/settings'
import { runCommand } from '../../lib/commands'
import { useMarketStatus, useNow, useQuotes, useWatchlists } from './store'
import { ago, compact, Pct, px, Stamp, stampFull, Unavailable } from './ui'

/** Short price for tight spaces: 64,210 · 3,412.5 · 1.234 · 0.00001234 */
export function hudPrice(n: number): string {
  const abs = Math.abs(n)
  const opts: Intl.NumberFormatOptions = abs >= 10_000 ? { maximumFractionDigits: 0 } : abs >= 100 ? { maximumFractionDigits: 1 } : abs >= 1 ? { maximumFractionDigits: 3 } : { maximumSignificantDigits: 4 }
  return new Intl.NumberFormat('en-US', opts).format(n)
}

function tipFor(q: Quote): string {
  return `${q.symbol}/${q.quote} ${px(q.price)} · ${q.changePct24h !== null ? (q.changePct24h >= 0 ? '+' : '') + q.changePct24h.toFixed(2) + '% 24h' : ''}\nSource: ${sourceLabel(q.source)} · ${stampFull(q.fetchedAt)}`
}

export function HudTicker() {
  const symbols = useSetting('markets.tickerSymbols')
  const syms = useMemo(() => symbols.slice(0, 6), [symbols])
  const quotes = useQuotes(syms, { live: false })
  const now = useNow(10_000)
  if (!syms.length) return null
  const latest = syms.map((s) => quotes.get(s)).filter((q): q is Quote => !!q)
  const oldest = latest.length ? Math.min(...latest.map((q) => q.fetchedAt)) : 0
  const stale = oldest && now - oldest > 5 * 60_000
  return (
    <button className={'hud-item mk-hud' + (stale ? ' stale' : '')} onClick={() => runCommand('market.open')} data-tip={latest.length ? latest.map(tipFor).join('\n\n') + '\n\nClick to open Markets' : 'Market data loading or unavailable — click to open Markets'}>
      {syms.map((s) => {
        const q = quotes.get(s)
        return (
          <span key={s} className="mk-hud-cell">
            <span>{s}</span>
            {q ? (
              <>
                <b className="num">{hudPrice(q.price)}</b>
                {q.changePct24h !== null && <Pct v={q.changePct24h} digits={1} className="num" />}
              </>
            ) : (
              <b className="dim">{quotes.error(s) ? 'N/A' : '…'}</b>
            )}
          </span>
        )
      })}
    </button>
  )
}

export function MarketStrip() {
  const show = useSetting('newtab.showMarkets')
  const enabled = useSetting('markets.enabled')
  const symbols = useSetting('markets.tickerSymbols')
  const syms = useMemo(() => symbols.slice(0, 8), [symbols])
  const quotes = useQuotes(syms, { live: false, enabled: show && enabled })
  const now = useNow(5000)
  if (!show || !enabled || !syms.length) return null
  const latest = syms.map((s) => quotes.get(s)).filter((q): q is Quote => !!q)
  const newest = latest.length ? Math.max(...latest.map((q) => q.fetchedAt)) : 0
  const sources = [...new Set(latest.map((q) => sourceLabel(q.source)))]
  const open = (url: string) => {
    const t = activeTab()
    if (t) loadUrl(t.id, url)
    else newTab(url)
  }
  return (
    <div className="ntp-card mk-strip">
      <div className="ntp-card-h">
        <CandlestickChart size={13} className="muted" />
        <span className="label">Markets</span>
        <span className="spacer" />
        <span className="label" data-tip={newest ? stampFull(newest) : undefined}>
          {sources.join(' + ') || '—'} · {newest ? ago(newest, now) : 'loading'}
        </span>
      </div>
      <div className="mk-strip-grid">
        {syms.map((s) => {
          const q = quotes.get(s)
          return (
            <button key={s} className="mk-strip-cell" onClick={() => open('specter://markets/' + s)} data-tip={q ? tipFor(q) : quotes.error(s)}>
              <span className="mono mk-strip-sym">{s}</span>
              {q ? (
                <>
                  <span className="num mk-strip-px">{hudPrice(q.price)}</span>
                  <Pct v={q.changePct24h} className="num mk-strip-chg" />
                </>
              ) : quotes.error(s) ? (
                <Unavailable short reason={quotes.error(s)} />
              ) : (
                <span className="dim">…</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MarketStatusItem() {
  const enabled = useSetting('markets.enabled')
  const st = useMarketStatus()
  if (!enabled || !st || st.mode === 'idle') return null
  const label = st.mode === 'stream' ? (st.streamConnected ? 'LIVE' : 'RECONNECTING') : st.mode === 'poll' ? 'POLL' : 'ALERTS'
  const src = (st.active ?? st.preferred).toUpperCase()
  return (
    <button className="sb-item" onClick={() => runCommand('market.open')} data-tip={`Market data: ${sourceLabel(st.active ?? st.preferred)}${st.fallbackReason ? ` (fallback — ${st.fallbackReason})` : ''}\nMode: ${label}`}>
      <span className={'status-dot ' + (st.fallbackReason ? 'warn' : st.mode === 'stream' && st.streamConnected ? 'ok' : '')} style={{ width: 6, height: 6 }} />
      MKT {label} {src}
    </button>
  )
}

export default function MarketsPanel({ popout }: { popout?: boolean }) {
  const { lists, loaded } = useWatchlists()
  const [listId, setListId] = useState('')
  const list = lists.find((l) => l.id === listId) ?? lists[0]
  const quotes = useQuotes(list?.symbols ?? [], { live: true })
  const st = useMarketStatus()
  const now = useNow(5000)
  if (!loaded) return <div className="empty">Loading…</div>
  if (!list) return <div className="empty">No watchlists.</div>
  const latest = list.symbols.map((s) => quotes.get(s)).filter((q): q is Quote => !!q)
  const newest = latest.length ? Math.max(...latest.map((q) => q.fetchedAt)) : 0
  const openChart = (s: string) => newTab('specter://markets/' + s)
  return (
    <div className={'mk-panel' + (popout ? ' popout' : '')}>
      <div className="mk-panel-h">
        <select className="select mk-input-sm" value={list.id} onChange={(e) => setListId(e.target.value)}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => runCommand('market.open')}>
          <ExternalLink size={12} /> Markets
        </button>
      </div>
      <div className="mk-panel-list">
        {list.symbols.map((s) => {
          const q = quotes.get(s)
          return (
            <button key={s} className="mk-panel-row" onClick={() => openChart(s)} data-tip={q ? tipFor(q) : quotes.error(s)}>
              <span className="mono mk-panel-sym">{s}</span>
              {q ? (
                <>
                  <span className="num mk-panel-px">{px(q.price)}</span>
                  <Pct v={q.changePct24h} className="num mk-panel-chg" />
                  <span className="num dim mk-panel-vol">{q.quoteVolume24h !== null ? compact(q.quoteVolume24h) : ''}</span>
                </>
              ) : quotes.error(s) ? (
                <Unavailable short reason={quotes.error(s)} />
              ) : (
                <span className="dim">…</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="mk-panel-f mono">
        {latest[0] ? <Stamp q={latest.find((q) => q.fetchedAt === newest) ?? latest[0]} /> : <span className="dim">—</span>}
        <span className="spacer" />
        <span className="dim">{st?.mode === 'stream' && st.streamConnected ? 'streaming' : st?.mode ?? ''}</span>
        <span className="dim">{newest ? ago(newest, now) : ''}</span>
      </div>
    </div>
  )
}
