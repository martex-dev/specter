// Alert rules UI (rules are evaluated in the main process).
import { useEffect, useState } from 'react'
import { Bell, BellOff, Trash2 } from 'lucide-react'
import type { AlertEvent, AlertKind, AlertRule } from '@shared/modules/markets'
import { ALERT_KIND_LABEL, alertValue, normalizeSymbol } from '@shared/modules/markets'
import { invoke, on } from '../../lib/ipc'
import { toast } from '../../stores/ui'
import { Switch } from '../../components/ui'
import type { QuoteAccess } from './store'
import { ago, compact, Field, parseNum, px, stampFull } from './ui'

export function useAlerts(): { rules: AlertRule[]; log: AlertEvent[]; reload: () => void } {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [log, setLog] = useState<AlertEvent[]>([])
  const reload = () => {
    invoke('alerts:list').then(setRules).catch(() => undefined)
    invoke('alerts:log', 30).then(setLog).catch(() => undefined)
  }
  useEffect(() => {
    reload()
    const a = on('alerts:changed', reload)
    const b = on('alerts:triggered', reload)
    return () => {
      a()
      b()
    }
  }, [])
  return { rules, log, reload }
}

function fmtThreshold(kind: AlertKind, v: number): string {
  if (kind.startsWith('change')) return `${v}%`
  if (kind === 'volume_above') return compact(v)
  return px(v)
}

export function AlertsSection({ quotes, defaultSymbol, prefill, onSymbols }: { quotes: QuoteAccess; defaultSymbol: string; prefill: { symbol: string; n: number } | null; onSymbols: (s: string[]) => void }) {
  const { rules, log } = useAlerts()
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [kind, setKind] = useState<AlertKind>('price_above')
  const [threshold, setThreshold] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [cooldown, setCooldown] = useState('60')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!prefill) return
    setSymbol(prefill.symbol)
    const q = quotes.get(prefill.symbol)
    if (q) setThreshold(String(Number(q.price.toPrecision(6))))
  }, [prefill?.n])

  const key = [...new Set(rules.map((r) => r.symbol))].sort().join(',')
  useEffect(() => onSymbols(key ? key.split(',') : []), [key])

  const q = quotes.get(symbol)
  const current = q ? alertValue(kind, q) : null

  const create = async () => {
    const sym = normalizeSymbol(symbol)
    const t = parseNum(threshold)
    if (!sym) return toast({ kind: 'warn', title: 'Enter a valid symbol' })
    if (!isFinite(t)) return toast({ kind: 'warn', title: 'Enter a numeric threshold' })
    try {
      await invoke('alerts:create', { symbol: sym, kind, threshold: t, repeat, cooldownMin: Math.max(1, parseNum(cooldown) || 60), note: note.trim() || undefined })
      toast({ kind: 'ok', title: `Alert armed: ${sym} ${ALERT_KIND_LABEL[kind].toLowerCase()} ${fmtThreshold(kind, t)}` })
      setNote('')
    } catch (e: any) {
      toast({ kind: 'error', title: 'Could not create alert', body: String(e?.message ?? e) })
    }
  }

  return (
    <div className="card mk-card">
      <div className="card-h">
        <Bell size={14} className="accent" />
        <span className="section-title" style={{ margin: 0 }}>
          Alerts
        </span>
        <span className="dim mono" style={{ fontSize: 11 }}>
          Local rules · evaluated in SPECTER on incoming data · notifications stay on this machine
        </span>
      </div>
      <div className="mk-alerts">
        <form
          className="mk-alert-form"
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Symbol" width={96}>
              <input className="input mono" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={15} />
            </Field>
            <Field label="Condition" width={200}>
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}>
                {(Object.keys(ALERT_KIND_LABEL) as AlertKind[]).map((k) => (
                  <option key={k} value={k}>
                    {ALERT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={kind.startsWith('change') ? 'Threshold (%)' : kind === 'volume_above' ? `Threshold (${q?.quote ?? 'quote'})` : `Threshold (${q?.quote ?? 'price'})`} width={150}>
              <input className="input mono num" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={current !== null ? String(Number(current.toPrecision(6))) : ''} />
            </Field>
          </div>
          <div className="mk-hint">
            Now: {current !== null ? <b className="mono">{kind.startsWith('change') ? current.toFixed(2) + '%' : kind === 'volume_above' ? compact(current) : px(current)}</b> : q ? 'not reported by this source' : 'no data for this symbol yet'}
            {q && kind === 'volume_above' && q.quoteVolume24h === null && ' — the current source reports base volume only'}
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6 }}>
              <Switch on={repeat} onChange={setRepeat} label="Repeat" />
              <span>{repeat ? 'Repeating' : 'One-shot'}</span>
            </label>
            {repeat && (
              <label className="row" style={{ gap: 6 }}>
                <span className="label">Cooldown</span>
                <input className="input mono mk-input-sm" style={{ width: 64 }} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
                <span className="muted">min</span>
              </label>
            )}
            <input className="input grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={200} />
            <button className="btn primary sm" type="submit">
              Create alert
            </button>
          </div>
        </form>

        <div className="mk-table-wrap">
          {rules.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>
              No alert rules yet.
            </div>
          ) : (
            <table className="table mk-table">
              <thead>
                <tr>
                  <th>On</th>
                  <th>Symbol</th>
                  <th>Condition</th>
                  <th className="r">Now</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th className="r">Fired</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const rq = quotes.get(r.symbol)
                  const v = rq ? alertValue(r.kind, rq) : null
                  const fired = r.lastTriggeredAt !== null
                  return (
                    <tr key={r.id} className={r.enabled ? '' : 'mk-off'}>
                      <td>
                        <Switch on={r.enabled} onChange={(on) => invoke('alerts:update', r.id, { enabled: on })} label="Enabled" />
                      </td>
                      <td className="mono">
                        <b>{r.symbol}</b>
                      </td>
                      <td data-tip={r.note}>
                        {ALERT_KIND_LABEL[r.kind]} <b className="mono">{fmtThreshold(r.kind, r.threshold)}</b>
                      </td>
                      <td className="r num mono">{v === null ? '—' : r.kind.startsWith('change') ? v.toFixed(2) + '%' : r.kind === 'volume_above' ? compact(v) : px(v)}</td>
                      <td className="mono dim">{r.repeat ? `Repeat · ${r.cooldownMin}m` : 'One-shot'}</td>
                      <td>{!r.enabled ? <span className="badge">{fired && !r.repeat ? 'Fired · off' : 'Disabled'}</span> : <span className="badge ok">Armed</span>}</td>
                      <td className="r mono dim" data-tip={fired ? stampFull(r.lastTriggeredAt!) : undefined}>
                        {r.triggerCount ? `${r.triggerCount}× · ${ago(r.lastTriggeredAt)}` : '—'}
                      </td>
                      <td className="r">
                        <button className="icon-btn sm" onClick={() => invoke('alerts:delete', r.id)} data-tip="Delete rule" aria-label="Delete rule">
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="mk-alert-log">
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="label">Recent triggers</span>
          <span className="spacer" />
          {log.length > 0 && (
            <button className="btn sm ghost" onClick={() => invoke('alerts:clearLog')}>
              Clear
            </button>
          )}
        </div>
        {log.length === 0 ? (
          <div className="dim mono" style={{ fontSize: 11.5 }}>
            <BellOff size={11} /> Nothing triggered yet. With no market view open, enabled alerts are still checked every 60 s via REST (no streaming).
          </div>
        ) : (
          log.slice(0, 8).map((e) => (
            <div key={e.id} className="mk-log-row">
              <span className="mono dim" data-tip={stampFull(e.ts)}>
                {new Date(e.ts).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
