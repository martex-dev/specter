// Currency converter side panel — open.er-api.com (fallback Frankfurter/ECB), favourite pairs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Star, X } from 'lucide-react'
import { fxConvert, parseAmount, type FxRates } from '@shared/modules/widgets'
import { invoke } from '../../lib/ipc'
import { errorText, useKv, useVisibleInterval } from './store'
import { ErrorState, Loading, SourceLine } from './ui'
import './widgets.css'

export type Pair = [string, string]
const DEFAULT_PAIRS: Pair[] = [
  ['EUR', 'USD'],
  ['GBP', 'USD'],
  ['USD', 'JPY']
]

let names: Intl.DisplayNames | null = null
export function currencyName(code: string): string {
  try {
    names ??= new Intl.DisplayNames([navigator.language, 'en'], { type: 'currency' })
    return names.of(code) ?? code
  } catch {
    return code
  }
}

export function fmtRate(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  const digits = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) })
}

export function useRates(): { rates: FxRates | null; error: string | null; loading: boolean; refresh: (force?: boolean) => void } {
  const [rates, setRates] = useState<FxRates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback((force = false) => {
    setLoading(true)
    invoke('widgets:fxRates', force)
      .then((r) => {
        setRates(r)
        setError(null)
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false))
  }, [])
  // Rates change daily; re-check hourly only while visible.
  useVisibleInterval(() => refresh(false), 60 * 60_000)
  return { rates, error, loading, refresh }
}

export function usePairs(): [Pair[], (p: Pair[]) => void] {
  const [raw, set] = useKv<Pair[] | null>('currency.pairs', null)
  return [Array.isArray(raw) ? raw : DEFAULT_PAIRS, set]
}

export default function CurrencyPanel() {
  const { rates, error, loading, refresh } = useRates()
  const [pairs, setPairs] = usePairs()
  const [amount, setAmount] = useState('100')
  const [from, setFrom] = useState('EUR')
  const [to, setTo] = useState('USD')
  const codes = useMemo(() => (rates ? Object.keys(rates.rates).sort() : []), [rates])
  useEffect(() => {
    // Default the target to the user's locale currency when known.
    try {
      const region = new Intl.Locale(navigator.language).maximize().region
      const local = region ? regionCurrency(region) : null
      if (local && local !== 'USD') setFrom(local)
    } catch {
      /* ignore */
    }
  }, [])

  // "1,234.5" → 1234.5 ; "12,5" → 12.5 ; "1.234,5" → 1234.5
  const amt = parseAmount(amount)
  const result = rates ? fxConvert(rates.rates, amt, from, to) : null
  const unit = rates ? fxConvert(rates.rates, 1, from, to) : null
  const isFav = pairs.some(([a, b]) => a === from && b === to)

  return (
    <div className="wg wg-fx">
      <div className="wg-pad">
        {error && !rates && <ErrorState error={error} onRetry={() => refresh(true)} />}
        {!rates && !error && <Loading label="Loading exchange rates…" />}
        {rates && (
          <>
            <div className="wg-fx-card">
              <div className="wg-fx-row">
                <input className="input wg-fx-amt num" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount" />
                <select className="select" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From currency">
                  {codes.map((c) => (
                    <option key={c} value={c}>
                      {c} — {currencyName(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="wg-fx-swap">
                <span className="wg-fx-line" />
                <button
                  className="icon-btn sm"
                  onClick={() => {
                    setFrom(to)
                    setTo(from)
                  }}
                  aria-label="Swap currencies"
                  data-tip="Swap"
                >
                  <ArrowLeftRight size={13} />
                </button>
                <span className="wg-fx-line" />
              </div>
              <div className="wg-fx-row">
                <div className="wg-fx-result num">{result !== null ? fmtRate(result) : '—'}</div>
                <select className="select" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To currency">
                  {codes.map((c) => (
                    <option key={c} value={c}>
                      {c} — {currencyName(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="wg-fx-rate">
                1 {from} = {fmtRate(unit)} {to}
                <span className="spacer" />
                <button
                  className={'icon-btn sm' + (isFav ? ' on' : '')}
                  onClick={() => setPairs(isFav ? pairs.filter(([a, b]) => !(a === from && b === to)) : [...pairs, [from, to] as Pair].slice(-12))}
                  aria-label={isFav ? 'Remove favourite pair' : 'Add favourite pair'}
                  data-tip={isFav ? 'Remove from favourites' : 'Save pair'}
                >
                  <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>
            {rates.stale && <div className="wg-warn-line">{rates.stale}</div>}
            <div className="wg-sec-h">
              <span className="label">Favourite pairs</span>
            </div>
            {pairs.map(([a, b]) => (
              <div
                key={a + b}
                className="wg-pair"
                onClick={() => {
                  setFrom(a)
                  setTo(b)
                }}
              >
                <span className="wg-pair-c mono">
                  {a}/{b}
                </span>
                <span className="dim ellipsis grow">
                  {currencyName(a)} → {currencyName(b)}
                </span>
                <b className="num">{fmtRate(fxConvert(rates.rates, 1, a, b))}</b>
                <button
                  className="icon-btn sm wg-pair-x"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPairs(pairs.filter(([x, y]) => !(x === a && y === b)))
                  }}
                  aria-label={`Remove ${a}/${b}`}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {!pairs.length && <div className="wg-muted-row">Star a pair above to pin it here.</div>}
            <SourceLine
              source={rates.source.split(' (')[0]}
              href={rates.sourceUrl}
              updated={rates.fetchedAt}
              extra={`rates as of ${new Date(rates.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
              onRefresh={() => refresh(true)}
              busy={loading}
            />
            {rates.source.startsWith('ExchangeRate') && (
              <p className="wg-fine">
                Rates by Exchange Rate API. Reference rates updated once a day — not suitable for trading.
              </p>
            )}
            {rates.source.startsWith('Frankfurter') && <p className="wg-fine">European Central Bank reference rates via Frankfurter, published on working days — not suitable for trading.</p>}
          </>
        )}
      </div>
    </div>
  )
}

// Most common region → currency mappings (for a sensible default only).
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', JP: 'JPY', CN: 'CNY', IN: 'INR', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK',
  HU: 'HUF', RO: 'RON', BG: 'BGN', TR: 'TRY', RU: 'RUB', UA: 'UAH', BR: 'BRL', MX: 'MXN', AR: 'ARS', ZA: 'ZAR', KR: 'KRW', SG: 'SGD', HK: 'HKD', IL: 'ILS',
  AE: 'AED', SA: 'SAR', TH: 'THB', ID: 'IDR', MY: 'MYR', PH: 'PHP', VN: 'VND', IS: 'ISK',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', IE: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', HR: 'EUR', LU: 'EUR', MT: 'EUR', CY: 'EUR'
}
function regionCurrency(region: string): string | null {
  return REGION_CURRENCY[region] ?? null
}
