import { useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { CronError, DAY_NAMES, MONTH_NAMES, describeCron, nextRuns, parseCron, type CronField } from '../lib/cron'
import { relativeTime } from '../lib/time'
import { CopyBtn, ErrorNote, Pane, useToolState } from '../ui'

const PRESETS: [string, string][] = [
  ['*/5 * * * *', 'Every 5 minutes'],
  ['0 * * * *', 'Hourly'],
  ['0 9 * * 1-5', 'Weekdays 09:00'],
  ['30 2 * * *', 'Nightly 02:30'],
  ['0 0 * * 0', 'Weekly (Sun)'],
  ['0 0 1 * *', 'Monthly'],
  ['0 12 1 1,4,7,10 *', 'Quarterly'],
  ['@yearly', '@yearly']
]

function fieldText(f: CronField): string {
  if (f.any) return 'every value'
  const vals = f.values.length > 12 ? `${f.values.slice(0, 12).join(', ')}, … (${f.values.length} values)` : f.values.join(', ')
  if (f.name === 'month') return f.values.map((v) => MONTH_NAMES[v - 1].slice(0, 3)).join(', ')
  if (f.name === 'day of week') return f.values.map((v) => DAY_NAMES[v].slice(0, 3)).join(', ')
  return vals
}

export default function CronTool() {
  const [expr, setExpr] = useToolState('cron.expr', '*/15 9-17 * * 1-5')
  const [tz, setTz] = useToolState<'local' | 'utc'>('cron.tz', 'local')
  const res = useMemo(() => {
    try {
      const s = parseCron(expr)
      const now = new Date()
      return { ok: true as const, s, desc: describeCron(s), runs: nextRuns(s, now, 10, tz), now }
    } catch (err) {
      return { ok: false as const, error: err instanceof CronError ? err.message : String(err) }
    }
  }, [expr, tz])

  const fmt = (d: Date) =>
    tz === 'utc'
      ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      : d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="tk-body">
      <div className="tk-bar">
        <input className="input mono grow" style={{ height: 36, fontSize: 16, letterSpacing: '0.04em' }} value={expr} onChange={(e) => setExpr(e.target.value)} spellCheck={false} aria-label="Cron expression" autoFocus />
        <CopyBtn text={expr} />
        <Seg value={tz} onChange={setTz} options={[{ value: 'local', label: 'Local time' }, { value: 'utc', label: 'UTC' }]} />
      </div>
      <div className="tk-note mono">minute · hour · day-of-month · month · day-of-week</div>
      <div className="tk-bar">
        {PRESETS.map(([e, label]) => (
          <button key={e} className={'btn sm' + (expr === e ? ' primary' : '')} onClick={() => setExpr(e)} data-tip={e}>
            {label}
          </button>
        ))}
      </div>
      {!res.ok ? (
        <div className="tk-pane" style={{ flex: 'none' }}>
          <ErrorNote>
            <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
            {res.error}
          </ErrorNote>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: '14px 16px', fontSize: 16, fontWeight: 500 }}>
            “{res.desc}”
          </div>
          <div className="tk-split" style={{ flex: 'none' }}>
            <Pane label={`Next ${res.runs.length} runs · ${tz === 'utc' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone}`}>
              {res.runs.length ? (
                <div className="tk-kv">
                  {res.runs.map((d, i) => (
                    <div key={i} className="tk-kv-row">
                      <span className="mono dim" style={{ width: 22 }}>
                        {i + 1}
                      </span>
                      <span className="tk-kv-v mono">{fmt(d)}</span>
                      <span className="dim" style={{ fontSize: 11.5 }}>
                        {relativeTime(d, res.now)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">This schedule never fires within the next 5 years (e.g. Feb 31).</div>
              )}
            </Pane>
            <Pane label="Fields">
              <div className="tk-kv">
                {[res.s.minute, res.s.hour, res.s.dom, res.s.month, res.s.dow].map((f) => (
                  <div key={f.name} className="tk-kv-row">
                    <span className="tk-kv-k" style={{ width: 110 }}>
                      {f.name}
                    </span>
                    <span className="mono" style={{ width: 90, color: 'var(--accent)' }}>
                      {f.raw}
                    </span>
                    <span className="tk-kv-v mono">{fieldText(f)}</span>
                  </div>
                ))}
              </div>
              {!res.s.dom.any && !res.s.dow.any && (
                <div className="tk-ok">
                  {res.s.dom.star || res.s.dow.star
                    ? 'Day-of-month and day-of-week are both set and one starts with "*": runs only when both match (standard cron).'
                    : 'Day-of-month and day-of-week are both set: runs when either matches (standard cron).'}
                </div>
              )}
            </Pane>
          </div>
          <div className="tk-note">Standard 5-field cron. Supports * , - / names (JAN, MON) and @macros. Quartz extensions (seconds, L, W, #) are not supported.</div>
        </>
      )}
    </div>
  )
}
