// specter://paper[/SYMBOL] — PAPER TRADING simulator. Virtual money only.
import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, RotateCcw } from 'lucide-react'
import type { PaperState } from '@shared/modules/markets'
import { normalizeSymbol, paperStats, sourceLabel } from '@shared/modules/markets'
import type { PageProps } from '../../pages/registry'
import { invoke, on } from '../../lib/ipc'
import { useSetting } from '../../stores/settings'
import { toast } from '../../stores/ui'
import { confirmAction } from '../../components/prompt'
import { Seg } from '../../components/ui'
import { LineChart } from './Chart'
import { useDebounced, useMarketStatus, useQuotes } from './store'
import { DisabledNotice, Field, money, PageHeader, parseNum, Pct, px, qty, Signed, Stamp, stampFull, StatusLine, Unavailable } from './ui'

export default function PaperPage(props: PageProps) {
  const enabled = useSetting('markets.enabled')
  if (!enabled) return <DisabledNotice title="Paper trading">Paper trading fills simulated orders at real market prices, so it needs market data.</DisabledNotice>
  return <Paper {...props} />
}

function Paper({ sub }: PageProps) {
  const [state, setState] = useState<PaperState | null>(null)
  const status = useMarketStatus()
  const reload = () => invoke('paper:state').then(setState).catch(() => undefined)
  useEffect(() => {
    reload()
    return on('paper:changed', reload)
  }, [])

  const [symbol, setSymbol] = useState(() => normalizeSymbol(sub) ?? 'BTC')
  const lookup = useDebounced(normalizeSymbol(symbol) ?? '', 500)
  const posSymbols = state?.positions.map((p) => p.symbol) ?? []
  const quotes = useQuotes([...new Set([...(lookup ? [lookup] : []), ...posSymbols])], { live: true })

  const acc = state?.account
  const priced = (state?.positions ?? []).map((p) => {
    const q = quotes.get(p.symbol)
    const value = q ? p.qty * q.price : null
    const pnl = value !== null ? value - p.qty * p.avgPrice : null
    return { p, q, value, pnl, pct: pnl !== null && p.avgPrice > 0 ? (pnl / (p.qty * p.avgPrice)) * 100 : null }
  })
  const allPriced = priced.every((x) => x.value !== null)
  const equity = acc && allPriced ? acc.cash + priced.reduce((s, x) => s + (x.value ?? 0), 0) : null
  const stats = useMemo(() => (state && acc ? paperStats(state.trades, state.equity.map((e) => e.equity), acc.startingBalance, equity) : null), [state, equity])
  const points = useMemo(() => {
    if (!state || !acc) return []
    const pts = [{ time: acc.resetAt / 1000, value: acc.startingBalance }, ...state.equity.map((e) => ({ time: e.ts / 1000, value: e.equity }))]
    if (equity !== null) pts.push({ time: Date.now() / 1000, value: equity })
    return pts
  }, [state, equity !== null ? Math.round(equity) : null])

  if (!state || !acc) return <div className="page wide mk-page empty">Loading paper account…</div>

  return (
    <div className="page wide mk-page">
      <PageHeader kicker="Markets · Simulator" title="Paper trading" sub={<StatusLine status={status} />} />
      <div className="mk-paper-banner">
        <FlaskConical size={16} />
        <b>PAPER TRADING</b>
        <span>Simulated orders with a virtual balance, filled at the current real last-traded price. Nothing is ever sent to an exchange. No spread, slippage or funding is modelled; long-only spot.</span>
      </div>

      <div className="grid-4 mk-stats">
        <div className="card stat">
          <div className="label">Equity ({acc.quote})</div>
          <div className="v num">{equity !== null ? money(equity) : <Unavailable reason="A position has no current price" />}</div>
          <div className="s">
            cash {money(acc.cash)} · start {money(acc.startingBalance)}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Total return</div>
          <div className="v num">
            <Pct v={stats?.totalReturnPct} />
          </div>
          <div className="s">
            realized <Signed v={stats?.realizedPnl} /> · fees {money(stats?.fees)}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Win rate</div>
          <div className="v num">{stats?.winRate !== null && stats?.winRate !== undefined ? (stats.winRate * 100).toFixed(1) + '%' : '—'}</div>
          <div className="s">
            {stats?.wins ?? 0}W / {stats?.losses ?? 0}L of {stats?.closedTrades ?? 0} closing trades
          </div>
        </div>
        <div className="card stat">
          <div className="label">Max drawdown</div>
          <div className="v num down">{stats ? `−${stats.maxDrawdownPct.toFixed(2)}%` : '—'}</div>
          <div className="s">on equity recorded at each trade + now</div>
        </div>
      </div>

      <div className="mk-split">
        <OrderTicket symbol={symbol} setSymbol={setSymbol} lookup={lookup} quotes={quotes} cash={acc.cash} feeRate={acc.feeRate} positionQty={state.positions.find((p) => p.symbol === lookup)?.qty ?? 0} />
        <div className="card mk-card grow">
          <div className="card-h">
            <span className="section-title" style={{ margin: 0 }}>
              Equity curve
            </span>
            <span className="dim mono" style={{ fontSize: 11 }}>
              {acc.quote} · since {new Date(acc.resetAt).toLocaleDateString()}
            </span>
          </div>
          <div style={{ padding: '6px 8px' }}>{points.length > 1 ? <LineChart points={points} height={220} /> : <div className="empty">Place a trade to start the curve.</div>}</div>
        </div>
      </div>

      <div className="card mk-card">
        <div className="card-h">
          <span className="section-title" style={{ margin: 0 }}>
            Positions
          </span>
        </div>
        {priced.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            No open paper positions.
          </div>
        ) : (
          <div className="mk-table-wrap">
            <table className="table mk-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="r">Quantity</th>
                  <th className="r">Avg entry</th>
                  <th className="r">Price</th>
                  <th className="r">Value</th>
                  <th className="r">Unrealized P/L</th>
                  <th>Source · updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {priced.map(({ p, q, value, pnl, pct }) => (
                  <tr key={p.symbol}>
                    <td className="mono">
                      <b>{p.symbol}</b>
                    </td>
                    <td className="r num">{qty(p.qty)}</td>
                    <td className="r num" data-tip="Includes buy fees">
                      {px(p.avgPrice)}
                    </td>
                    <td className="r num">{q ? px(q.price) : <Unavailable short reason={quotes.error(p.symbol)} />}</td>
                    <td className="r num">{money(value)}</td>
                    <td className="r num">
                      <Signed v={pnl} /> <Pct v={pct} className="mk-sub" />
                    </td>
                    <td>
                      <Stamp q={q} />
                    </td>
                    <td className="r">
                      <button
                        className="btn sm"
                        disabled={!q}
                        onClick={async () => {
                          if (!(await confirmAction(`Close paper position?`, `PAPER SELL ${qty(p.qty)} ${p.symbol} at the current market price (≈ ${q ? px(q.price) : '—'}).`, 'Paper sell'))) return
                          const r = await invoke('paper:order', { symbol: p.symbol, side: 'sell', qty: p.qty })
                          if (r.ok && r.trade) toast({ kind: 'ok', title: `PAPER SELL filled`, body: `${qty(r.trade.qty)} ${r.trade.symbol} @ ${px(r.trade.price)} (${sourceLabel(r.trade.source)})` })
                          else toast({ kind: 'error', title: 'Paper order rejected', body: r.error })
                        }}
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mk-card">
        <div className="card-h">
          <span className="section-title" style={{ margin: 0 }}>
            Trade history
          </span>
          <span className="dim mono" style={{ fontSize: 11 }}>
            {state.trades.length}
          </span>
        </div>
        {state.trades.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            No paper trades yet.
          </div>
        ) : (
          <div className="mk-table-wrap" style={{ maxHeight: 380 }}>
            <table className="table mk-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>Symbol</th>
                  <th className="r">Quantity</th>
                  <th className="r">Fill price</th>
                  <th className="r">Notional</th>
                  <th className="r">Fee</th>
                  <th className="r">Realized P/L</th>
                  <th>Price source</th>
                </tr>
              </thead>
              <tbody>
                {state.trades.map((t) => (
                  <tr key={t.id}>
                    <td className="mono dim" data-tip={stampFull(t.ts)}>
                      {new Date(t.ts).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td>
                      <span className={'badge ' + (t.side === 'buy' ? 'ok' : 'bad')}>Paper {t.side}</span>
                    </td>
                    <td className="mono">
                      <b>{t.symbol}</b>
                    </td>
                    <td className="r num">{qty(t.qty)}</td>
                    <td className="r num">{px(t.price)}</td>
                    <td className="r num">{money(t.notional)}</td>
                    <td className="r num">{money(t.fee, 4)}</td>
                    <td className="r num">{t.realizedPnl === null ? <span className="dim">—</span> : <Signed v={t.realizedPnl} />}</td>
                    <td className="mono dim">
                      {sourceLabel(t.source)} · {t.quote}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ResetCard startingBalance={acc.startingBalance} feeRate={acc.feeRate} />
    </div>
  )
}

/** Rounds down to 8 significant digits (rounding up could make a "100%" buy cost more than the cash). */
function floorSig(x: number): number {
  if (!(x > 0) || !isFinite(x)) return 0
  const p = 10 ** (7 - Math.floor(Math.log10(x)))
  return Number((Math.floor(x * p) / p).toPrecision(8))
}

function OrderTicket({ symbol, setSymbol, lookup, quotes, cash, feeRate, positionQty }: { symbol: string; setSymbol: (s: string) => void; lookup: string; quotes: ReturnType<typeof useQuotes>; cash: number; feeRate: number; positionQty: number }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [mode, setMode] = useState<'qty' | 'notional'>('notional')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const q = lookup ? quotes.get(lookup) : undefined
  const n = parseNum(amount)
  const estQty = q && isFinite(n) && n > 0 ? (mode === 'qty' ? n : n / q.price) : null
  const estNotional = estQty !== null && q ? estQty * q.price : null
  const estFee = estNotional !== null ? estNotional * feeRate : null

  const fill = (frac: number) => {
    if (!q) return
    if (side === 'buy') {
      const notional = (cash * frac) / (1 + feeRate)
      setAmount(mode === 'notional' ? String(Math.floor(notional * 100) / 100) : String(floorSig(notional / q.price)))
    } else {
      if (frac === 1) {
        // An amount would be re-converted at the (moved) fill price and either leave dust or exceed the position.
        setMode('qty')
        setAmount(String(positionQty))
        return
      }
      const qn = positionQty * frac
      setAmount(mode === 'qty' ? String(qn) : String(Math.floor(qn * q.price * 100) / 100))
    }
  }

  const submit = async () => {
    if (!lookup || !isFinite(n) || n <= 0) return
    setBusy(true)
    try {
      const r = await invoke('paper:order', { symbol: lookup, side, ...(mode === 'qty' ? { qty: n } : { notional: n }) })
      if (r.ok && r.trade) {
        toast({ kind: 'ok', title: `PAPER ${side.toUpperCase()} filled`, body: `${qty(r.trade.qty)} ${r.trade.symbol} @ ${px(r.trade.price)} ${r.trade.quote} · fee ${money(r.trade.fee, 4)} · ${sourceLabel(r.trade.source)}` })
        setAmount('')
      } else toast({ kind: 'error', title: 'Paper order rejected', body: r.error })
    } catch (e: any) {
      toast({ kind: 'error', title: 'Paper order failed', body: String(e?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mk-card mk-ticket">
      <div className="card-h">
        <span className="section-title" style={{ margin: 0 }}>
          Order ticket
        </span>
        <span className="badge warn">Paper</span>
      </div>
      <form
        className="card-b col"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <Field label="Symbol" width={100}>
            <input className="input mono" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={15} />
          </Field>
          <div className="col grow" style={{ gap: 2 }}>
            <span className="label">Market price</span>
            {q ? (
              <div className="row" style={{ gap: 8 }}>
                <b className="num mono" style={{ fontSize: 16 }}>
                  {px(q.price)}
                </b>
                <span className="mono dim">{q.quote}</span>
                <Pct v={q.changePct24h} />
              </div>
            ) : lookup && quotes.error(lookup) ? (
              <Unavailable reason={quotes.error(lookup)} />
            ) : (
              <span className="dim mono">{lookup ? 'Loading…' : '—'}</span>
            )}
            {q && <Stamp q={q} />}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Seg<'buy' | 'sell'>
            value={side}
            onChange={setSide}
            options={[
              { value: 'buy', label: <span className="up">Buy</span> },
              { value: 'sell', label: <span className="down">Sell</span> }
            ]}
          />
          <Seg<'qty' | 'notional'>
            value={mode}
            onChange={(m) => {
              setMode(m)
              setAmount('')
            }}
            options={[
              { value: 'notional', label: `Amount (${q?.quote ?? 'quote'})` },
              { value: 'qty', label: `Quantity (${lookup || 'base'})` }
            ]}
          />
        </div>
        <input className="input mono num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={mode === 'qty' ? '0.01' : '1000'} />
        <div className="row" style={{ gap: 6 }}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <button key={f} type="button" className="btn sm ghost" disabled={!q || (side === 'sell' && positionQty <= 0)} onClick={() => fill(f)}>
              {f * 100}%
            </button>
          ))}
          <span className="spacer" />
          <span className="dim mono" style={{ fontSize: 11 }}>
            {side === 'buy' ? `cash ${money(cash)}` : `position ${qty(positionQty)}`}
          </span>
        </div>
        <div className="mk-est mono">
          <span>≈ {estQty !== null ? qty(estQty) : '—'} {lookup}</span>
          <span>notional {money(estNotional)}</span>
          <span>fee {money(estFee, 4)} ({(feeRate * 100).toFixed(2)}%)</span>
        </div>
        <button className={'btn ' + (side === 'buy' ? 'mk-buy' : 'mk-sell')} type="submit" disabled={busy || !q || !(n > 0)}>
          {busy ? 'Filling…' : `Place PAPER ${side.toUpperCase()} · market`}
        </button>
        <div className="mk-hint">The fill uses a fresh quote (≤ 5 s old) fetched when you submit; it may differ slightly from the price shown.</div>
      </form>
    </div>
  )
}

function ResetCard({ startingBalance, feeRate }: { startingBalance: number; feeRate: number }) {
  const [bal, setBal] = useState(String(startingBalance))
  const [fee, setFee] = useState(String(feeRate * 100))
  return (
    <div className="card mk-card">
      <div className="card-h">
        <span className="section-title" style={{ margin: 0 }}>
          Paper account
        </span>
      </div>
      <form
        className="card-b row mk-form-row"
        onSubmit={async (e) => {
          e.preventDefault()
          const b = parseNum(bal)
          const f = parseNum(fee) / 100
          if (!(await confirmAction('Reset paper account?', `Deletes all paper positions, trades and equity history, and starts again with ${money(b)} virtual cash at a ${(f * 100).toFixed(2)}% fee.`, 'Reset', true))) return
          try {
            await invoke('paper:reset', { startingBalance: b, feeRate: f })
            toast({ kind: 'ok', title: 'Paper account reset' })
          } catch (err: any) {
            toast({ kind: 'error', title: 'Reset failed', body: String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
          }
        }}
      >
        <Field label="Starting balance" width={160}>
          <input className="input mono num" value={bal} onChange={(e) => setBal(e.target.value)} />
        </Field>
        <Field label="Fee per trade (%)" width={130}>
          <input className="input mono num" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <button className="btn danger" type="submit">
          <RotateCcw size={13} /> Reset account
        </button>
        <span className="mk-hint">Virtual funds only. Resetting clears history; statistics start over.</span>
      </form>
    </div>
  )
}
