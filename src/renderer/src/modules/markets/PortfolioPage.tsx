// specter://portfolio — manual, local portfolio tracker (average-cost method).
import { useEffect, useMemo, useState } from 'react'
import { Briefcase, Pencil, Trash2 } from 'lucide-react'
import type { PortfolioTx, TxType } from '@shared/modules/markets'
import { computeHoldings, normalizeSymbol, TX_LABEL, unrealizedPnl } from '@shared/modules/markets'
import type { PageProps } from '../../pages/registry'
import { invoke, on } from '../../lib/ipc'
import { useSetting } from '../../stores/settings'
import { toast } from '../../stores/ui'
import { confirmAction } from '../../components/prompt'
import { Seg } from '../../components/ui'
import { useDebounced, useMarketStatus, useQuotes } from './store'
import { DisabledNotice, Field, money, PageHeader, parseNum, Pct, px, qty, Signed, Stamp, StatusLine, Unavailable } from './ui'

export default function PortfolioPage(props: PageProps) {
  const enabled = useSetting('markets.enabled')
  if (!enabled) return <DisabledNotice title="Portfolio">Your transactions stay stored locally; enabling fetches current prices.</DisabledNotice>
  return <Portfolio {...props} />
}

const PALETTE = ['var(--accent)', 'var(--up)', 'var(--info)', 'var(--warn)', '#c792ea', '#f78c6c', '#89ddff', '#ffcb6b', '#82aaff', 'var(--fg-2)']

function todayInput(ts = Date.now()): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Portfolio(_: PageProps) {
  const [txs, setTxs] = useState<PortfolioTx[]>([])
  const [editing, setEditing] = useState<PortfolioTx | null>(null)
  const status = useMarketStatus()
  const reload = () => invoke('portfolio:list').then(setTxs).catch(() => undefined)
  useEffect(() => {
    reload()
    return on('portfolio:changed', reload)
  }, [])

  const res = useMemo(() => computeHoldings(txs), [txs])
  const open = res.holdings.filter((h) => h.quantity > 0)
  const quotes = useQuotes(
    open.map((h) => h.asset),
    { live: true }
  )
  const priced = open.map((h) => {
    const q = quotes.get(h.asset)
    return { h, q, u: unrealizedPnl(h, q?.price) }
  })
  const allPriced = priced.every((p) => p.u.value !== null)
  const totalValue = priced.reduce((s, p) => s + (p.u.value ?? 0), 0)
  const totalCost = priced.reduce((s, p) => s + p.h.costBasis, 0)
  const unrealized = priced.reduce((s, p) => s + (p.u.pnl ?? 0), 0)
  const quoteCcy = priced.find((p) => p.q)?.q?.quote ?? 'USD'

  return (
    <div className="page wide mk-page">
      <PageHeader kicker="Markets · Portfolio" title="Portfolio" sub={<StatusLine status={status} />} />
      <div className="mk-note">
        <Briefcase size={13} /> Manual tracker — records live only in SPECTER's local database. No exchange or wallet connection, no real-money execution. P/L uses the <b>average-cost method</b>; prices are current market prices in the displayed quote currency ({quoteCcy}), so enter transaction prices in that currency.
      </div>

      <div className="grid-4 mk-stats">
        <div className="card stat">
          <div className="label">Market value</div>
          <div className="v num">{open.length ? (allPriced ? money(totalValue) : <Unavailable reason="Some holdings have no current price" />) : '—'}</div>
          <div className="s">{open.length} open position{open.length === 1 ? '' : 's'}</div>
        </div>
        <div className="card stat">
          <div className="label">Cost basis</div>
          <div className="v num">{money(totalCost)}</div>
          <div className="s">incl. buy fees</div>
        </div>
        <div className="card stat">
          <div className="label">Unrealized P/L</div>
          <div className="v num">{allPriced && open.length ? <Signed v={unrealized} /> : '—'}</div>
          <div className="s">{allPriced && totalCost > 0 ? <Pct v={(unrealized / totalCost) * 100} /> : 'at current prices'}</div>
        </div>
        <div className="card stat">
          <div className="label">Realized P/L</div>
          <div className="v num">
            <Signed v={res.realizedTotal} />
          </div>
          <div className="s">fees paid {money(res.feesTotal)}</div>
        </div>
      </div>

      {res.warnings.length > 0 && (
        <div className="mk-note warn">
          {res.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <div className="mk-split">
        <div className="card mk-card grow">
          <div className="card-h">
            <span className="section-title" style={{ margin: 0 }}>
              Holdings
            </span>
          </div>
          {res.holdings.length === 0 ? (
            <div className="empty">No transactions yet. Add your first one below.</div>
          ) : (
            <div className="mk-table-wrap">
              <table className="table mk-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="r">Quantity</th>
                    <th className="r">Avg cost</th>
                    <th className="r">Price</th>
                    <th className="r">Value</th>
                    <th className="r">Unrealized</th>
                    <th className="r">Realized</th>
                    <th className="r">Alloc.</th>
                    <th>Source · updated</th>
                  </tr>
                </thead>
                <tbody>
                  {res.holdings.map((h) => {
                    const q = quotes.get(h.asset)
                    const u = unrealizedPnl(h, q?.price)
                    const closed = h.quantity === 0
                    return (
                      <tr key={h.asset} className={closed ? 'mk-off' : ''}>
                        <td className="mono">
                          <b>{h.asset}</b> {closed && <span className="badge">closed</span>}
                        </td>
                        <td className="r num">{qty(h.quantity)}</td>
                        <td className="r num">{closed ? '—' : px(h.avgCost)}</td>
                        <td className="r num">{closed ? '—' : q ? px(q.price) : quotes.error(h.asset) ? <Unavailable short reason={quotes.error(h.asset)} /> : '…'}</td>
                        <td className="r num">{closed ? '—' : money(u.value)}</td>
                        <td className="r num">
                          {closed ? (
                            '—'
                          ) : (
                            <>
                              <Signed v={u.pnl} /> <Pct v={u.pct} className="mk-sub" />
                            </>
                          )}
                        </td>
                        <td className="r num">
                          <Signed v={h.realizedPnl} />
                        </td>
                        <td className="r num">{!closed && u.value !== null && totalValue > 0 && allPriced ? ((u.value / totalValue) * 100).toFixed(1) + '%' : '—'}</td>
                        <td>{closed ? <span className="dim mono">—</span> : <Stamp q={q} />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card mk-card mk-alloc">
          <div className="card-h">
            <span className="section-title" style={{ margin: 0 }}>
              Allocation
            </span>
            <span className="dim mono" style={{ fontSize: 11 }}>
              by market value
            </span>
          </div>
          <div className="card-b">
            {!open.length ? (
              <div className="dim">No open positions.</div>
            ) : !allPriced ? (
              <Unavailable reason="Allocation needs a current price for every holding" />
            ) : (
              <AllocationChart rows={priced.map((p) => ({ name: p.h.asset, value: p.u.value ?? 0 })).sort((a, b) => b.value - a.value)} total={totalValue} />
            )}
          </div>
        </div>
      </div>

      <TxForm key={editing?.id ?? 'new'} editing={editing} onDone={() => setEditing(null)} />

      <div className="card mk-card">
        <div className="card-h">
          <span className="section-title" style={{ margin: 0 }}>
            Transactions
          </span>
          <span className="dim mono" style={{ fontSize: 11 }}>
            {txs.length}
          </span>
        </div>
        {txs.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            No transactions.
          </div>
        ) : (
          <div className="mk-table-wrap" style={{ maxHeight: 420 }}>
            <table className="table mk-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Asset</th>
                  <th className="r">Quantity</th>
                  <th className="r">Price</th>
                  <th className="r">Fee</th>
                  <th className="r">Total</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="mono dim">{new Date(t.date).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>
                      <span className={'badge ' + (t.type === 'buy' ? 'ok' : t.type === 'sell' ? 'bad' : '')}>{TX_LABEL[t.type]}</span>
                    </td>
                    <td className="mono">
                      <b>{t.asset}</b>
                    </td>
                    <td className="r num">{qty(t.quantity)}</td>
                    <td className="r num">{px(t.price)}</td>
                    <td className="r num">{money(t.fee)}</td>
                    <td className="r num">{money(t.quantity * t.price)}</td>
                    <td className="ellipsis muted" style={{ maxWidth: 220 }}>
                      {t.note}
                    </td>
                    <td className="r mk-rowact">
                      <button className="icon-btn sm" onClick={() => setEditing(t)} data-tip="Edit" aria-label="Edit">
                        <Pencil size={12} />
                      </button>
                      <button
                        className="icon-btn sm"
                        onClick={async () => {
                          if (await confirmAction('Delete transaction?', `${TX_LABEL[t.type]} ${t.quantity} ${t.asset} @ ${t.price}`, 'Delete', true)) invoke('portfolio:delete', t.id)
                        }}
                        data-tip="Delete"
                        aria-label="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function AllocationChart({ rows, total }: { rows: { name: string; value: number }[]; total: number }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="mk-allocbar">
        {rows.map((r, i) => (
          <i key={r.name} style={{ width: `${(r.value / total) * 100}%`, background: PALETTE[i % PALETTE.length] }} data-tip={`${r.name} · ${((r.value / total) * 100).toFixed(1)}%`} />
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={r.name} className="row mk-alloc-row">
          <span className="mk-swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
          <b className="mono">{r.name}</b>
          <span className="spacer" />
          <span className="num muted">{money(r.value)}</span>
          <span className="num" style={{ width: 52, textAlign: 'right' }}>
            {((r.value / total) * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

function TxForm({ editing, onDone }: { editing: PortfolioTx | null; onDone: () => void }) {
  const [type, setType] = useState<TxType>(editing?.type ?? 'buy')
  const [asset, setAsset] = useState(editing?.asset ?? '')
  const [quantity, setQuantity] = useState(editing ? String(editing.quantity) : '')
  const [price, setPrice] = useState(editing ? String(editing.price) : '')
  const [fee, setFee] = useState(editing ? String(editing.fee) : '0')
  const [date, setDate] = useState(todayInput(editing?.date))
  const [note, setNote] = useState(editing?.note ?? '')
  const sym = normalizeSymbol(asset)
  const lookup = useDebounced(sym)
  const quotes = useQuotes(lookup ? [lookup] : [], { live: false })
  const q = sym && sym === lookup ? quotes.get(sym) : undefined

  const submit = async () => {
    const tx = { asset: sym ?? '', type, quantity: parseNum(quantity), price: parseNum(price), fee: parseNum(fee || '0'), date: new Date(date).getTime(), note: note.trim() || undefined }
    try {
      if (editing) await invoke('portfolio:update', editing.id, tx)
      else await invoke('portfolio:add', tx)
      toast({ kind: 'ok', title: editing ? 'Transaction updated' : `${TX_LABEL[type]} recorded`, body: `${tx.quantity} ${tx.asset} @ ${tx.price}` })
      if (!editing) {
        setQuantity('')
        setNote('')
      }
      onDone()
    } catch (e: any) {
      toast({ kind: 'error', title: 'Could not save transaction', body: String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  return (
    <div className="card mk-card">
      <div className="card-h">
        <span className="section-title" style={{ margin: 0 }}>
          {editing ? 'Edit transaction' : 'Add transaction'}
        </span>
        {editing && (
          <button className="btn sm ghost" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
      <form
        className="card-b row mk-form-row"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Type">
          <Seg<TxType>
            value={type}
            onChange={setType}
            options={[
              { value: 'buy', label: 'Buy' },
              { value: 'sell', label: 'Sell' },
              { value: 'transfer_in', label: 'In' },
              { value: 'transfer_out', label: 'Out' }
            ]}
          />
        </Field>
        <Field label="Asset" width={90}>
          <input className="input mono" value={asset} onChange={(e) => setAsset(e.target.value.toUpperCase())} placeholder="BTC" maxLength={15} />
        </Field>
        <Field label="Quantity" width={120}>
          <input className="input mono num" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0.5" />
        </Field>
        <Field label={type === 'transfer_in' ? 'Cost basis / unit' : 'Price / unit'} width={140} hint={q ? <button type="button" className="mk-linkbtn" onClick={() => setPrice(String(q.price))}>use current {px(q.price)}</button> : undefined}>
          <input className="input mono num" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Fee" width={90}>
          <input className="input mono num" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <Field label="Date" width={190}>
          <input className="input mono" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note" width={180}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
        <button className="btn primary" type="submit" disabled={!sym || !quantity}>
          {editing ? 'Save' : 'Add'}
        </button>
      </form>
    </div>
  )
}
