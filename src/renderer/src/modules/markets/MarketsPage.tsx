// specter://markets[/SYMBOL] — watchlists, main chart and alerts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BookOpen, Briefcase, Calculator, CandlestickChart, FlaskConical, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { CandlesResult, Quote, Timeframe, Watchlist } from '@shared/modules/markets'
import { normalizeSymbol, sourceLabel, TIMEFRAME_SECONDS, TIMEFRAMES } from '@shared/modules/markets'
import type { PageProps } from '../../pages/registry'
import { invoke } from '../../lib/ipc'
import { newTab } from '../../stores/browser'
import { useSetting } from '../../stores/settings'
import { toast } from '../../stores/ui'
import { confirmAction, promptText } from '../../components/prompt'
import { Seg } from '../../components/ui'
import { ChartAttribution, PriceChart, type ChartKind } from './Chart'
import { AlertsSection } from './Alerts'
import { useMarketStatus, useNow, usePageVisible, useQuotes, useWatchlists, type QuoteAccess } from './store'
import { ago, compact, DisabledNotice, PageHeader, Pct, px, qty, Stamp, stampFull, StatusLine, Unavailable } from './ui'

const prefs = {
  get<T extends string>(k: string, d: T): T {
    try {
      return (localStorage.getItem('mk:' + k) as T) || d
    } catch {
      return d
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem('mk:' + k, v)
    } catch {
      /* ignore */
    }
  }
}

export default function MarketsPage(props: PageProps) {
  const enabled = useSetting('markets.enabled')
  if (!enabled) return <DisabledNotice title="Markets" />
  return <Markets {...props} />
}

function Markets({ sub, query }: PageProps) {
  const { lists, loaded } = useWatchlists()
  const [listId, setListId] = useState<string>(() => prefs.get('list', ''))
  const list = lists.find((l) => l.id === listId) ?? lists[0]
  const [symbol, setSymbol] = useState<string>(() => normalizeSymbol(sub) ?? prefs.get('symbol', 'BTC'))
  const [alertPrefill, setAlertPrefill] = useState<{ symbol: string; n: number } | null>(null)
  const [alertSymbols, setAlertSymbols] = useState<string[]>([])
  const alertsRef = useRef<HTMLDivElement>(null)
  const status = useMarketStatus()

  useEffect(() => {
    const s = normalizeSymbol(sub)
    if (s) setSymbol(s)
  }, [sub])
  useEffect(() => prefs.set('symbol', symbol), [symbol])
  useEffect(() => {
    if (query.get('view') === 'alerts') setTimeout(() => alertsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
  }, [query])

  const symbols = useMemo(() => [...new Set([symbol, ...(list?.symbols ?? []), ...alertSymbols])], [symbol, list, alertSymbols])
  const quotes = useQuotes(symbols, { live: true })

  const selectList = (id: string) => {
    setListId(id)
    prefs.set('list', id)
  }

  return (
    <div className="page wide mk-page">
      <PageHeader
        kicker="Markets"
        title="Markets"
        sub={<StatusLine status={status} />}
        right={
          <div className="row">
            <button className="btn sm ghost" onClick={() => newTab('specter://portfolio')}>
              <Briefcase size={13} /> Portfolio
            </button>
            <button className="btn sm ghost" onClick={() => newTab('specter://paper')}>
              <FlaskConical size={13} /> Paper trading
            </button>
            <button className="btn sm ghost" onClick={() => newTab('specter://crypto/' + symbol)}>
              <BookOpen size={13} /> Research
            </button>
            <button className="btn sm ghost" onClick={() => newTab('specter://finance')}>
              <Calculator size={13} /> Toolkit
            </button>
          </div>
        }
      />

      <ChartCard
        symbol={symbol}
        q={quotes.get(symbol)}
        err={quotes.error(symbol)}
        onAlert={() => {
          setAlertPrefill({ symbol, n: Date.now() })
          alertsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
      />

      {loaded && list ? (
        <WatchlistCard
          lists={lists}
          list={list}
          onSelectList={selectList}
          quotes={quotes}
          selected={symbol}
          onSelect={setSymbol}
          onAlert={(s) => {
            setAlertPrefill({ symbol: s, n: Date.now() })
            alertsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        />
      ) : (
        <div className="card mk-card">
          <div className="empty">Loading watchlists…</div>
        </div>
      )}

      <div ref={alertsRef} style={{ scrollMarginTop: 16 }}>
        <AlertsSection quotes={quotes} defaultSymbol={symbol} prefill={alertPrefill} onSymbols={setAlertSymbols} />
      </div>
      <div className="mk-foot mono">
        Prices from free public APIs ({['binance', 'coinbase', 'coingecko'].map((s) => sourceLabel(s)).join(', ')}), fetched by SPECTER only while a market view is visible. Not investment advice. <ChartAttribution />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- chart

function ChartCard({ symbol, q, err, onAlert }: { symbol: string; q: Quote | undefined; err: string | undefined; onAlert: () => void }) {
  const [tf, setTf] = useState<Timeframe>(() => prefs.get<Timeframe>('tf', '1h'))
  const [kind, setKind] = useState<ChartKind>(() => prefs.get<ChartKind>('kind', 'candles'))
  const [showVol, setShowVol] = useState(() => prefs.get('vol', '1') === '1')
  const [res, setRes] = useState<CandlesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const visible = usePageVisible()
  const now = useNow(5000)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const load = () =>
      invoke('market:candles', symbol, tf)
        .then((r) => {
          if (!alive) return
          setRes(r)
          setLoading(false)
        })
        .catch((e) => {
          if (!alive) return
          setRes({ symbol, timeframe: tf, candles: [], source: null, quote: '', fetchedAt: Date.now(), hasVolume: false, error: String(e?.message ?? e) })
          setLoading(false)
        })
    load()
    if (!visible) return () => void (alive = false)
    const every = tf === '1m' ? 15_000 : tf === '5m' || tf === '15m' ? 30_000 : 60_000
    const t = setInterval(load, every)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [symbol, tf, visible, nonce])

  const current = res && res.symbol === symbol && res.timeframe === tf ? res : null
  // Fold same-source live ticks into the forming candle (never invents new candles).
  const candles = useMemo(() => {
    const arr = current?.candles ?? []
    if (!arr.length || !q || q.source !== current?.source || q.quote !== current.quote) return arr
    const last = arr[arr.length - 1]
    const t = q.ts / 1000
    if (t < last.time || t >= last.time + TIMEFRAME_SECONDS[tf]) return arr
    return [...arr.slice(0, -1), { ...last, close: q.price, high: Math.max(last.high, q.price), low: Math.min(last.low, q.price) }]
  }, [current, q?.price, q?.ts, tf])

  const setPref = <T extends string>(k: string, set: (v: T) => void) => (v: T) => {
    set(v)
    prefs.set(k, v)
  }

  return (
    <div className="card mk-card">
      <div className="mk-quotehead">
        <div className="mk-sym">
          <CandlestickChart size={16} className="accent" />
          <span className="mk-sym-name">{symbol}</span>
          <span className="mono dim">/ {q?.quote ?? current?.quote ?? '—'}</span>
        </div>
        {q ? (
          <>
            <div className="mk-bigpx num">{px(q.price)}</div>
            <div className="mk-chg num">
              <Pct v={q.changePct24h} />
              <span className={'dim ' + ((q.change24h ?? 0) >= 0 ? '' : '')}> {q.change24h !== null ? (q.change24h >= 0 ? '+' : '') + px(q.change24h) : ''}</span>
            </div>
            <div className="mk-kv">
              <span className="label">24h high</span>
              <span className="num">{px(q.high24h)}</span>
            </div>
            <div className="mk-kv">
              <span className="label">24h low</span>
              <span className="num">{px(q.low24h)}</span>
            </div>
            <div className="mk-kv">
              <span className="label">24h vol</span>
              <span className="num">{q.quoteVolume24h !== null ? `${compact(q.quoteVolume24h)} ${q.quote}` : q.volume24h !== null ? `${compact(q.volume24h)} ${q.symbol}` : '—'}</span>
            </div>
            <span className="spacer" />
            <Stamp q={q} />
          </>
        ) : (
          <>
            <span className="spacer" />
            {err ? <Unavailable reason={err} /> : <span className="mono dim">Loading quote…</span>}
          </>
        )}
      </div>
      <div className="mk-toolbar">
        <Seg<Timeframe> value={tf} onChange={setPref<Timeframe>('tf', setTf)} options={TIMEFRAMES.map((t) => ({ value: t, label: t.toUpperCase() }))} />
        <Seg<ChartKind>
          value={kind}
          onChange={setPref<ChartKind>('kind', setKind)}
          options={[
            { value: 'candles', label: 'Candles' },
            { value: 'line', label: 'Line' },
            { value: 'area', label: 'Area' }
          ]}
        />
        <button
          className={'btn sm ' + (showVol ? '' : 'ghost')}
          disabled={!!current && !current.hasVolume}
          onClick={() => {
            setShowVol(!showVol)
            prefs.set('vol', showVol ? '0' : '1')
          }}
          data-tip={current && !current.hasVolume ? 'This source provides no volume for these candles' : 'Toggle volume histogram'}
        >
          Volume
        </button>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={() => setNonce((n) => n + 1)} data-tip="Reload candles" aria-label="Reload candles">
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
        <button className="btn sm" onClick={onAlert}>
          <Bell size={13} /> Alert
        </button>
        <button className="btn sm" onClick={() => newTab('specter://paper/' + symbol)}>
          <FlaskConical size={13} /> Paper trade
        </button>
      </div>
      <div className="mk-chart-wrap">
        <PriceChart candles={candles} kind={kind} showVolume={showVol && (current?.hasVolume ?? true)} resetKey={symbol + tf} height={430} />
        {!candles.length && (
          <div className="mk-chart-empty">
            {loading && !current ? (
              <span className="mono dim">Loading {symbol} {tf} candles…</span>
            ) : current?.error ? (
              <div className="col" style={{ alignItems: 'center', maxWidth: 520, textAlign: 'center' }}>
                <Unavailable reason={current.error} />
                <span className="muted" style={{ fontSize: 12 }}>
                  {current.error}
                </span>
              </div>
            ) : (
              <span className="mono dim">No candles</span>
            )}
          </div>
        )}
      </div>
      <div className="mk-cardfoot mono">
        {current?.source ? (
          <span data-tip={`Fetched ${stampFull(current.fetchedAt)}`}>
            Candles: {sourceLabel(current.source)} · {symbol}/{current.quote} · {tf} · {candles.length} bars · updated {ago(current.fetchedAt, now)}
          </span>
        ) : (
          <span>Candles: —</span>
        )}
        {current?.note && <span className="warn">{current.note}</span>}
        <span className="spacer" />
        <span className="dim">Scroll to zoom · drag to pan · crosshair shows OHLC</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- watchlist

type SortKey = 'symbol' | 'price' | 'change' | 'volume' | 'mcap'

function WatchlistCard({
  lists,
  list,
  onSelectList,
  quotes,
  selected,
  onSelect,
  onAlert
}: {
  lists: Watchlist[]
  list: Watchlist
  onSelectList: (id: string) => void
  quotes: QuoteAccess
  selected: string
  onSelect: (s: string) => void
  onAlert: (s: string) => void
}) {
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)

  const add = async () => {
    const sym = normalizeSymbol(adding)
    if (!sym) return toast({ kind: 'warn', title: 'Invalid symbol', body: 'Use a ticker like BTC, ETH or SOL.' })
    if (list.symbols.includes(sym)) return toast({ kind: 'info', title: `${sym} is already in ${list.name}` })
    setBusy(true)
    try {
      const v = await invoke('market:validate', sym)
      const save = () => invoke('market:watchlistSetSymbols', list.id, [...list.symbols, sym])
      if (v.ok) {
        await save()
        setAdding('')
      } else
        toast({
          kind: 'warn',
          title: `${sym}: no price from any provider`,
          body: v.error,
          action: {
            label: 'Add anyway',
            run: () => {
              save()
              setAdding('')
            }
          }
        })
    } finally {
      setBusy(false)
    }
  }

  const remove = (s: string) => invoke('market:watchlistSetSymbols', list.id, list.symbols.filter((x) => x !== s))
  const move = (s: string, d: -1 | 1) => {
    const i = list.symbols.indexOf(s)
    const j = i + d
    if (j < 0 || j >= list.symbols.length) return
    const next = [...list.symbols]
    ;[next[i], next[j]] = [next[j], next[i]]
    invoke('market:watchlistSetSymbols', list.id, next)
  }

  const rows = useMemo(() => {
    const r = list.symbols.map((s) => ({ s, q: quotes.get(s) }))
    if (!sort) return r
    const val = (x: { s: string; q?: Quote }): number | string => {
      if (sort.key === 'symbol') return x.s
      const q = x.q
      if (!q) return -Infinity
      if (sort.key === 'price') return q.price
      if (sort.key === 'change') return q.changePct24h ?? -Infinity
      if (sort.key === 'volume') return q.quoteVolume24h ?? (q.volume24h !== null ? q.volume24h * q.price : -Infinity)
      return q.marketCap ?? -Infinity
    }
    return [...r].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
  }, [list.symbols, quotes.version, sort])

  const th = (key: SortKey, label: string, right = true) => (
    <th className={right ? 'r' : ''} onClick={() => setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }))} style={{ cursor: 'pointer' }}>
      {label}
      {sort?.key === key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
    </th>
  )

  return (
    <div className="card mk-card">
      <div className="card-h mk-tabs">
        {lists.map((l) => (
          <button key={l.id} className={'mk-tab' + (l.id === list.id ? ' on' : '')} onClick={() => onSelectList(l.id)}>
            {l.name} <span className="dim num">{l.symbols.length}</span>
          </button>
        ))}
        <button
          className="icon-btn sm"
          data-tip="New watchlist"
          aria-label="New watchlist"
          onClick={async () => {
            const name = await promptText({ title: 'New watchlist', label: 'Name', placeholder: 'e.g. L1s, DeFi, Majors' })
            if (name) invoke('market:watchlistCreate', name, []).then((w) => onSelectList(w.id))
          }}
        >
          <Plus size={13} />
        </button>
        <span className="spacer" />
        <button
          className="icon-btn sm"
          data-tip="Rename list"
          aria-label="Rename list"
          onClick={async () => {
            const name = await promptText({ title: 'Rename watchlist', label: 'Name', initial: list.name })
            if (name) invoke('market:watchlistRename', list.id, name)
          }}
        >
          <Pencil size={13} />
        </button>
        <button
          className="icon-btn sm"
          disabled={lists.length <= 1}
          data-tip={lists.length <= 1 ? 'At least one watchlist is required' : 'Delete list'}
          aria-label="Delete list"
          onClick={async () => {
            if (await confirmAction(`Delete “${list.name}”?`, `Removes the list and its ${list.symbols.length} symbols. Alerts are kept.`, 'Delete', true)) invoke('market:watchlistDelete', list.id).then(() => onSelectList(''))
          }}
        >
          <Trash2 size={13} />
        </button>
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <input className="input mk-input-sm mono" placeholder="Add symbol (e.g. AVAX)" value={adding} onChange={(e) => setAdding(e.target.value.toUpperCase())} maxLength={15} />
          <button className="btn sm" disabled={!adding.trim() || busy} type="submit">
            {busy ? 'Checking…' : 'Add'}
          </button>
        </form>
      </div>
      {list.symbols.length === 0 ? (
        <div className="empty">This list is empty. Add a symbol above.</div>
      ) : (
        <div className="mk-table-wrap">
          <table className="table mk-table">
            <thead>
              <tr>
                {th('symbol', 'Symbol', false)}
                {th('price', 'Price')}
                {th('change', '24h %')}
                {th('volume', '24h volume')}
                <th className="r">24h high</th>
                <th className="r">24h low</th>
                {th('mcap', 'Mkt cap')}
                <th className="r" data-tip="Binance USDT-M perpetual funding rate (last), per 8h interval">
                  Funding
                </th>
                <th className="r" data-tip="Binance USDT-M perpetual open interest (notional at last price)">
                  Open int.
                </th>
                <th>Source · updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, q }) => {
                const err = quotes.error(s)
                return (
                  <tr key={s} className={s === selected ? 'sel' : ''} onClick={() => onSelect(s)}>
                    <td>
                      <b className="mono">{s}</b> <span className="dim mono mk-q">{q?.quote ?? ''}</span>
                    </td>
                    {q ? (
                      <>
                        <td className="r num mk-px">{px(q.price)}</td>
                        <td className="r num">
                          <Pct v={q.changePct24h} />
                        </td>
                        <td className="r num" data-tip={q.volume24h !== null ? `${qty(q.volume24h)} ${s}` : undefined}>
                          {q.quoteVolume24h !== null ? compact(q.quoteVolume24h) : q.volume24h !== null ? `${compact(q.volume24h)} ${s}` : '—'}
                        </td>
                        <td className="r num">{px(q.high24h)}</td>
                        <td className="r num">{px(q.low24h)}</td>
                        <td className="r num" data-tip={q.marketCap ? `Market cap (USD) · ${sourceLabel(q.marketCapSource)} · ${q.marketCapTs ? stampFull(q.marketCapTs) : ''}` : q.marketCapSource ? 'Not reported by CoinGecko' : 'Market cap comes from CoinGecko (refreshed every 5 min when available)'}>
                          {q.marketCap ? compact(q.marketCap) : '—'}
                        </td>
                        <td className="r num" data-tip={q.derivNote ?? (q.derivTs ? `Binance Futures · ${stampFull(q.derivTs)}` : 'Loading…')}>
                          {q.fundingRate !== undefined && q.fundingRate !== null ? <span className={q.fundingRate >= 0 ? 'up' : 'down'}>{(q.fundingRate * 100).toFixed(4)}%</span> : '—'}
                        </td>
                        <td className="r num" data-tip={q.openInterest ? `${qty(q.openInterest)} ${s} · Binance Futures` : q.derivNote}>
                          {q.openInterest ? compact(q.openInterest * q.price) : '—'}
                        </td>
                        <td>
                          <Stamp q={q} />
                        </td>
                      </>
                    ) : (
                      <td colSpan={9}>{err ? <Unavailable reason={err} /> : <span className="mono dim">Loading…</span>}</td>
                    )}
                    <td className="r mk-rowact" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn sm" onClick={() => onAlert(s)} data-tip="Create alert" aria-label="Create alert">
                        <Bell size={12} />
                      </button>
                      <button className="icon-btn sm" onClick={() => move(s, -1)} data-tip="Move up" aria-label="Move up">
                        ↑
                      </button>
                      <button className="icon-btn sm" onClick={() => remove(s)} data-tip="Remove from list" aria-label="Remove">
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mk-cardfoot mono">
        <span>{list.symbols.length} symbols · click a row to chart it</span>
        <span className="spacer" />
        <span className="dim">Volume in quote currency · market cap in USD (CoinGecko) · funding / OI: Binance Futures where listed, else “—”</span>
      </div>
    </div>
  )
}
