// specter://finance — small, fast local calculators. Only currency conversion
// uses the network (free keyless FX source, shown with its timestamp).
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Plus, RefreshCw, X } from 'lucide-react'
import type { FxRates } from '@shared/modules/markets'
import { fin, sourceLabel } from '@shared/modules/markets'
import type { PageProps } from '../../pages/registry'
import { invoke } from '../../lib/ipc'
import { setSetting, useSetting } from '../../stores/settings'
import { Seg } from '../../components/ui'
import { money, PageHeader, parseNum, qty, stampFull } from './ui'

function useNum(initial: string): [string, (s: string) => void, number] {
  const [s, set] = useState(initial)
  return [s, set, parseNum(s)]
}

function NumIn({ label, value, onChange, suffix, width = 130 }: { label: string; value: string; onChange: (s: string) => void; suffix?: string; width?: number }) {
  return (
    <label className="mk-field" style={{ width }}>
      <span className="label">{label}</span>
      <span className="mk-inwrap">
        <input className="input mono num" value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" />
        {suffix && <span className="mk-suffix mono">{suffix}</span>}
      </span>
    </label>
  )
}

function Calc({ title, formula, children, result }: { title: string; formula: ReactNode; children: ReactNode; result: ReactNode }) {
  return (
    <div className="card mk-card mk-calc">
      <div className="card-h">
        <span className="section-title" style={{ margin: 0 }}>
          {title}
        </span>
      </div>
      <div className="card-b col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {children}
        </div>
        <div className="mk-result">{result}</div>
        <div className="mk-formula">{formula}</div>
      </div>
    </div>
  )
}

function R({ label, value, cls = '' }: { label: string; value: ReactNode; cls?: string }) {
  return (
    <div className="mk-r">
      <span className="label">{label}</span>
      <b className={'num ' + cls}>{value}</b>
    </div>
  )
}

const invalid = <span className="dim">Enter valid inputs</span>
const pct = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !isFinite(n) ? '—' : `${n.toFixed(d)}%`)

export default function FinancePage(_: PageProps) {
  return (
    <div className="page wide mk-page">
      <PageHeader kicker="Finance · Toolkit" title="Finance toolkit" sub="Local calculators — nothing leaves this machine except the optional exchange-rate lookup. Estimates for education, not financial advice." />
      <div className="mk-calcgrid">
        <Compound />
        <PositionSize />
        <RiskReward />
        <Liquidation />
        <ProfitLoss />
        <PctChange />
        <Cagr />
        <Drawdown />
        <Allocation />
        <Fx />
      </div>
    </div>
  )
}

function Compound() {
  const [p, setP, P] = useNum('10000')
  const [r, setR, Rv] = useNum('7')
  const [y, setY, Y] = useNum('10')
  const [n, setN] = useState('12')
  const [c, setC, Cv] = useNum('0')
  const ok = P >= 0 && isFinite(Rv) && Y >= 0 && isFinite(Cv)
  const out = ok ? fin.compound(P, Rv, Y, Number(n), Cv) : null
  return (
    <Calc
      title="Compound interest"
      formula={
        <>
          FV = P·(1 + r/n)<sup>n·t</sup> + C·((1 + r/n)<sup>n·t</sup> − 1)/(r/n). Contributions C are added at the end of each compounding period.
        </>
      }
      result={
        out ? (
          <>
            <R label="Future value" value={money(out.future)} />
            <R label="Contributed" value={money(out.contributed)} />
            <R label="Interest earned" value={money(out.interest)} cls="up" />
          </>
        ) : (
          invalid
        )
      }
    >
      <NumIn label="Principal" value={p} onChange={setP} />
      <NumIn label="Annual rate" value={r} onChange={setR} suffix="%" width={100} />
      <NumIn label="Years" value={y} onChange={setY} width={80} />
      <label className="mk-field" style={{ width: 130 }}>
        <span className="label">Compounding</span>
        <select className="select" value={n} onChange={(e) => setN(e.target.value)}>
          <option value="1">Yearly</option>
          <option value="4">Quarterly</option>
          <option value="12">Monthly</option>
          <option value="52">Weekly</option>
          <option value="365">Daily</option>
        </select>
      </label>
      <NumIn label="Contribution / period" value={c} onChange={setC} width={150} />
    </Calc>
  )
}

function PositionSize() {
  const [a, setA, A] = useNum('10000')
  const [r, setR, Rv] = useNum('1')
  const [e, setE, E] = useNum('100')
  const [s, setS, S] = useNum('95')
  const out = fin.positionSize(A, Rv, E, S)
  return (
    <Calc
      title="Position sizing"
      formula={<>Units = (account × risk %) ÷ |entry − stop|. Position value = units × entry. Risk is the loss if the stop fills exactly (no slippage/fees).</>}
      result={
        out ? (
          <>
            <R label="Risk amount" value={money(out.riskAmount)} cls="down" />
            <R label="Units" value={qty(out.units)} />
            <R label="Position value" value={money(out.positionValue)} />
            <R label="% of account" value={pct(out.accountPct, 1)} cls={out.accountPct > 100 ? 'warn' : ''} />
          </>
        ) : (
          invalid
        )
      }
    >
      <NumIn label="Account size" value={a} onChange={setA} />
      <NumIn label="Risk per trade" value={r} onChange={setR} suffix="%" width={110} />
      <NumIn label="Entry" value={e} onChange={setE} width={110} />
      <NumIn label="Stop loss" value={s} onChange={setS} width={110} />
    </Calc>
  )
}

function RiskReward() {
  const [e, setE, E] = useNum('100')
  const [s, setS, S] = useNum('95')
  const [t, setT, T] = useNum('115')
  const out = fin.riskReward(E, S, T)
  return (
    <Calc
      title="Risk / reward"
      formula={<>R = |target − entry| ÷ |entry − stop|. Break-even win rate = 1 ÷ (1 + R): the share of trades you must win to not lose money at this R (before fees).</>}
      result={
        out ? (
          <>
            <R label="Ratio" value={`1 : ${out.ratio.toFixed(2)}`} />
            <R label="Side" value={out.side.toUpperCase()} />
            <R label="Risk / reward per unit" value={`${money(out.risk)} / ${money(out.reward)}`} />
            <R label="Break-even win rate" value={pct(out.breakevenWinRate, 1)} />
          </>
        ) : (
          <span className="dim">Stop must be on the opposite side of entry from the target</span>
        )
      }
    >
      <NumIn label="Entry" value={e} onChange={setE} width={110} />
      <NumIn label="Stop" value={s} onChange={setS} width={110} />
      <NumIn label="Target" value={t} onChange={setT} width={110} />
    </Calc>
  )
}

function Liquidation() {
  const [e, setE, E] = useNum('60000')
  const [l, setL, L] = useNum('10')
  const [m, setM, M] = useNum('0.5')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const out = fin.liquidation(E, L, side, M)
  return (
    <Calc
      title="Leverage / liquidation estimate"
      formula={
        <>
          Isolated margin, linear contract: long ≈ entry × (1 − 1/L + mmr), short ≈ entry × (1 + 1/L − mmr). Ignores fees, funding and tiered maintenance margin — exchanges differ; treat as a rough estimate.
        </>
      }
      result={
        out ? (
          <>
            <R label="Est. liquidation" value={money(out.price)} cls="down" />
            <R label="Distance" value={pct(out.distancePct)} />
            <R label="Initial margin" value={pct(100 / L)} />
          </>
        ) : (
          invalid
        )
      }
    >
      <Seg<'long' | 'short'>
        value={side}
        onChange={setSide}
        options={[
          { value: 'long', label: 'Long' },
          { value: 'short', label: 'Short' }
        ]}
      />
      <NumIn label="Entry" value={e} onChange={setE} width={120} />
      <NumIn label="Leverage" value={l} onChange={setL} suffix="×" width={90} />
      <NumIn label="Maint. margin" value={m} onChange={setM} suffix="%" width={110} />
    </Calc>
  )
}

function ProfitLoss() {
  const [e, setE, E] = useNum('100')
  const [x, setX, X] = useNum('110')
  const [q, setQ, Q] = useNum('10')
  const [f, setF, F] = useNum('0')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const ok = isFinite(E) && isFinite(X) && isFinite(Q) && isFinite(F)
  const out = ok ? fin.profitLoss(E, X, Q, side, F) : null
  return (
    <Calc
      title="Profit / loss"
      formula={<>P/L = (exit − entry) × quantity − fees (reversed for shorts). Return % is P/L ÷ (entry × quantity).</>}
      result={
        out ? (
          <>
            <R label="P/L" value={(out.pnl >= 0 ? '+' : '') + money(out.pnl)} cls={out.pnl >= 0 ? 'up' : 'down'} />
            <R label="Return" value={pct(out.pct)} cls={(out.pct ?? 0) >= 0 ? 'up' : 'down'} />
          </>
        ) : (
          invalid
        )
      }
    >
      <Seg<'long' | 'short'>
        value={side}
        onChange={setSide}
        options={[
          { value: 'long', label: 'Long' },
          { value: 'short', label: 'Short' }
        ]}
      />
      <NumIn label="Entry" value={e} onChange={setE} width={100} />
      <NumIn label="Exit" value={x} onChange={setX} width={100} />
      <NumIn label="Quantity" value={q} onChange={setQ} width={100} />
      <NumIn label="Total fees" value={f} onChange={setF} width={100} />
    </Calc>
  )
}

function PctChange() {
  const [a, setA, A] = useNum('80')
  const [b, setB, B] = useNum('100')
  const out = fin.percentChange(A, B)
  const back = fin.percentChange(B, A)
  return (
    <Calc
      title="Percentage change"
      formula={<>Change % = (new − old) ÷ |old| × 100. Note the asymmetry: a −20% move needs +25% to recover.</>}
      result={
        out !== null ? (
          <>
            <R label="Change" value={(out >= 0 ? '+' : '') + pct(out)} cls={out >= 0 ? 'up' : 'down'} />
            <R label="Reverse move" value={back !== null ? (back >= 0 ? '+' : '') + pct(back) : '—'} />
          </>
        ) : (
          invalid
        )
      }
    >
      <NumIn label="From" value={a} onChange={setA} />
      <NumIn label="To" value={b} onChange={setB} />
    </Calc>
  )
}

function Cagr() {
  const [s, setS, S] = useNum('10000')
  const [e, setE, E] = useNum('25000')
  const [y, setY, Y] = useNum('5')
  const out = fin.cagr(S, E, Y)
  return (
    <Calc title="CAGR" formula={<>CAGR = (end ÷ start)<sup>1/years</sup> − 1 — the constant yearly rate that turns start into end.</>} result={out !== null ? <R label="CAGR" value={pct(out)} cls={out >= 0 ? 'up' : 'down'} /> : invalid}>
      <NumIn label="Start value" value={s} onChange={setS} />
      <NumIn label="End value" value={e} onChange={setE} />
      <NumIn label="Years" value={y} onChange={setY} width={80} />
    </Calc>
  )
}

function Drawdown() {
  const [p, setP, P] = useNum('100')
  const [t, setT, T] = useNum('65')
  const out = fin.drawdown(P, T)
  return (
    <Calc
      title="Drawdown"
      formula={<>Drawdown = (peak − trough) ÷ peak. Gain needed to recover = peak ÷ trough − 1.</>}
      result={
        out ? (
          <>
            <R label="Drawdown" value={'−' + pct(out.drawdownPct)} cls="down" />
            <R label="Gain to recover" value={out.recoveryPct !== null ? '+' + pct(out.recoveryPct) : '∞'} cls="up" />
          </>
        ) : (
          invalid
        )
      }
    >
      <NumIn label="Peak" value={p} onChange={setP} />
      <NumIn label="Trough" value={t} onChange={setT} />
    </Calc>
  )
}

function Allocation() {
  const [rows, setRows] = useState([
    { name: 'BTC', value: '6000', target: '50' },
    { name: 'ETH', value: '3000', target: '30' },
    { name: 'Cash', value: '1000', target: '20' }
  ])
  const parsed = rows.map((r) => ({ name: r.name || '—', value: parseNum(r.value) || 0, targetPct: parseNum(r.target) || 0 }))
  const out = fin.allocation(parsed)
  const set = (i: number, k: 'name' | 'value' | 'target', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <Calc
      title="Portfolio allocation / rebalance"
      formula={<>Current weight = value ÷ total. Trade to rebalance = total × target % − value (positive = buy, negative = sell).</>}
      result={
        <div className="col" style={{ gap: 4, width: '100%' }}>
          <table className="table mk-table mk-mini">
            <thead>
              <tr>
                <th>Line</th>
                <th className="r">Value</th>
                <th className="r">Current</th>
                <th className="r">Target</th>
                <th className="r">Rebalance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input className="input mk-input-sm" style={{ width: 80 }} value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
                  </td>
                  <td className="r">
                    <input className="input mk-input-sm mono num" style={{ width: 90 }} value={r.value} onChange={(e) => set(i, 'value', e.target.value)} />
                  </td>
                  <td className="r num">{pct(out.rows[i]?.currentPct, 1)}</td>
                  <td className="r">
                    <input className="input mk-input-sm mono num" style={{ width: 56 }} value={r.target} onChange={(e) => set(i, 'target', e.target.value)} />
                  </td>
                  <td className={'r num ' + ((out.rows[i]?.delta ?? 0) >= 0 ? 'up' : 'down')}>{out.rows[i] ? (out.rows[i].delta >= 0 ? '+' : '') + money(out.rows[i].delta) : '—'}</td>
                  <td className="r">
                    <button className="icon-btn sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length <= 1} aria-label="Remove line">
                      <X size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button className="btn sm ghost" onClick={() => setRows([...rows, { name: '', value: '0', target: '0' }])} disabled={rows.length >= 12}>
              <Plus size={12} /> Line
            </button>
            <span className="spacer" />
            <span className="mono">Total {money(out.total)}</span>
            <span className={'mono ' + (Math.abs(out.targetSum - 100) > 0.01 ? 'warn' : 'dim')}>targets sum {out.targetSum.toFixed(1)}%</span>
          </div>
        </div>
      }
    >
      <span className="dim" style={{ fontSize: 12 }}>
        Enter each holding's value and target weight.
      </span>
    </Calc>
  )
}

function Fx() {
  const enabled = useSetting('markets.enabled')
  const [amount, setAmount, A] = useNum('100')
  const [from, setFrom] = useState('USD')
  const [to, setTo] = useState('EUR')
  const [rates, setRates] = useState<FxRates | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => {
    setBusy(true)
    setErr(null)
    invoke('finance:fx', 'USD')
      .then(setRates)
      .catch((e) => setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    if (enabled) load()
  }, [enabled])
  const codes = rates ? Object.keys(rates.rates).sort() : ['USD', 'EUR']
  const out = rates ? fin.convert(A, from, to, rates.base, rates.rates) : null
  const unit = rates ? fin.convert(1, from, to, rates.base, rates.rates) : null
  return (
    <Calc
      title="Currency conversion"
      formula={
        rates ? (
          <>
            amount × rate[to] ÷ rate[from], rates quoted against {rates.base}. Source: {sourceLabel(rates.source)} · rates {rates.source === 'frankfurter' && rates.updatedAt ? `for ${new Date(rates.updatedAt).toISOString().slice(0, 10)}` : rates.updatedAt ? `updated ${stampFull(rates.updatedAt)}` : 'update time not reported'} · fetched {stampFull(rates.fetchedAt)}. Reference rates, not what a bank or exchange will quote.
          </>
        ) : (
          <>Uses free keyless reference rates (open.er-api.com, fallback Frankfurter/ECB).</>
        )
      }
      result={
        !enabled ? (
          <div className="col" style={{ gap: 6 }}>
            <span className="dim">Exchange rates need a network request; market tools are disabled.</span>
            <button className="btn sm" onClick={() => setSetting('markets.enabled', true)}>
              Enable market tools
            </button>
          </div>
        ) : err ? (
          <div className="col" style={{ gap: 6 }}>
            <span className="warn">Unavailable — {err}</span>
            <button className="btn sm" onClick={load}>
              Retry
            </button>
          </div>
        ) : out !== null ? (
          <>
            <R label={`${qty(A)} ${from} =`} value={`${money(out, out < 1 ? 6 : 2)} ${to}`} />
            <R label="Rate" value={unit !== null ? `1 ${from} = ${Number(unit.toPrecision(6))} ${to}` : '—'} />
          </>
        ) : (
          <span className="dim">{busy ? 'Loading rates…' : codes.includes(from) && codes.includes(to) ? invalid : 'Unknown currency code'}</span>
        )
      }
    >
      <NumIn label="Amount" value={amount} onChange={setAmount} width={120} />
      <label className="mk-field" style={{ width: 96 }}>
        <span className="label">From</span>
        <select className="select mono" value={from} onChange={(e) => setFrom(e.target.value)}>
          {codes.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <button
        className="icon-btn"
        onClick={() => {
          setFrom(to)
          setTo(from)
        }}
        aria-label="Swap"
        data-tip="Swap"
      >
        <ArrowLeftRight size={14} />
      </button>
      <label className="mk-field" style={{ width: 96 }}>
        <span className="label">To</span>
        <select className="select mono" value={to} onChange={(e) => setTo(e.target.value)}>
          {codes.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {enabled && (
        <button className="icon-btn" onClick={load} disabled={busy} aria-label="Reload rates" data-tip="Reload rates (cached for 1 hour)">
          <RefreshCw size={13} className={busy ? 'spin' : ''} />
        </button>
      )}
    </Calc>
  )
}
