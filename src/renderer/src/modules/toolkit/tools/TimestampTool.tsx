import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { allZones, dayOfYear, formatInZone, formatOffset, isoWeek, localZone, parseTimeInput, relativeTime, zoneOffsetMinutes, zonedToDate, type TsUnit } from '../lib/time'
import { CopyBtn, KV, Pane, useToolState } from '../ui'

function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const pad = (n: number) => String(n).padStart(2, '0')

export default function TimestampTool() {
  const now = useNow()
  const [input, setInput] = useToolState('ts.input', String(Math.floor(Date.now() / 1000)))
  const [unit, setUnit] = useToolState<TsUnit | 'auto'>('ts.unit', 'auto')
  const [zones, setZones] = useToolState<string[]>('ts.zones', ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'])
  const [addZone, setAddZone] = useState('')
  const local = localZone()
  const zoneList = useMemo(() => allZones(), [])

  const parsed = useMemo(() => parseTimeInput(input, unit === 'auto' ? undefined : unit), [input, unit])
  const d = parsed?.date

  // Builder: wall-clock time in a zone → instant.
  const [bDate, setBDate] = useToolState('ts.bdate', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
  const [bTime, setBTime] = useToolState('ts.btime', '09:00:00')
  const [bZone, setBZone] = useToolState('ts.bzone', local)
  const built = useMemo(() => {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bDate)
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(bTime)
    if (!dm || !tm) return null
    try {
      return zonedToDate(+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], +(tm[3] ?? 0), bZone)
    } catch {
      return null
    }
  }, [bDate, bTime, bZone])

  const nowS = Math.floor(now.getTime() / 1000)

  return (
    <div className="tk-body">
      <div className="grid-2" style={{ flex: 'none' }}>
        <div className="card stat" style={{ padding: '10px 14px' }}>
          <div className="label">Now · unix seconds</div>
          <div className="row">
            <div className="mono" style={{ fontSize: 22 }}>{nowS}</div>
            <CopyBtn text={String(nowS)} />
            <button className="btn sm ghost" onClick={() => setInput(String(nowS))}>
              Use
            </button>
          </div>
        </div>
        <div className="card stat" style={{ padding: '10px 14px' }}>
          <div className="label">Now · unix milliseconds</div>
          <div className="row">
            <div className="mono" style={{ fontSize: 22 }}>{now.getTime()}</div>
            <CopyBtn text={String(now.getTime())} />
            <button className="btn sm ghost" onClick={() => setInput(String(now.getTime()))}>
              Use
            </button>
          </div>
        </div>
      </div>

      <div className="tk-bar">
        <input className="input mono grow" style={{ height: 34, fontSize: 14 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="1735689600, 1735689600000, 2025-01-01T00:00:00Z, now…" aria-label="Timestamp or date" autoFocus />
        <select className="select" style={{ height: 34 }} value={unit} onChange={(e) => setUnit(e.target.value as TsUnit | 'auto')} aria-label="Unit">
          <option value="auto">Auto-detect</option>
          <option value="s">Seconds</option>
          <option value="ms">Milliseconds</option>
          <option value="us">Microseconds</option>
          <option value="ns">Nanoseconds</option>
        </select>
      </div>

      {!d ? (
        <div className="tk-pane" style={{ flex: 'none' }}>
          <div className="tk-error">{input.trim() ? 'Not a recognised timestamp or date.' : 'Enter a timestamp or date.'}</div>
        </div>
      ) : (
        <div className="tk-split" style={{ flex: 'none' }}>
          <Pane label={`Interpreted as ${parsed!.kind}`}>
            <KV
              rows={[
                ['Unix seconds', Math.floor(d.getTime() / 1000), String(Math.floor(d.getTime() / 1000))],
                ['Unix ms', d.getTime(), String(d.getTime())],
                ['ISO 8601 (UTC)', d.toISOString(), d.toISOString()],
                [`Local (${local})`, `${formatInZone(d, local)} ${formatOffset(zoneOffsetMinutes(d, local))}`, `${formatInZone(d, local)}`],
                ['RFC 2822', d.toUTCString(), d.toUTCString()],
                ['Relative', relativeTime(d, now)],
                ['Weekday', d.toLocaleDateString('en-US', { weekday: 'long' })],
                ['Day of year / ISO week', `${dayOfYear(d)} · W${String(isoWeek(d).week).padStart(2, '0')} ${isoWeek(d).year}`]
              ]}
            />
          </Pane>
          <Pane
            label="Time zones"
            actions={
              <div className="row" style={{ gap: 4 }}>
                <input className="input" list="tk-tz-list" style={{ height: 24, width: 170, fontSize: 11.5 }} placeholder="Add zone…" value={addZone} onChange={(e) => setAddZone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && zoneList.includes(addZone) && (setZones([...zones.filter((z) => z !== addZone), addZone]), setAddZone(''))} aria-label="Add time zone" />
                <datalist id="tk-tz-list">
                  {zoneList.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
                <button
                  className="icon-btn sm"
                  disabled={!zoneList.includes(addZone)}
                  onClick={() => {
                    setZones([...zones.filter((z) => z !== addZone), addZone])
                    setAddZone('')
                  }}
                  aria-label="Add zone"
                >
                  <Plus size={12} />
                </button>
              </div>
            }
          >
            <div className="tk-kv">
              {zones.map((z) => {
                let v: string
                try {
                  v = `${formatInZone(d, z)}  ${formatOffset(zoneOffsetMinutes(d, z))}`
                } catch {
                  v = 'Unknown zone'
                }
                return (
                  <div key={z} className="tk-kv-row">
                    <span className="tk-kv-k">{z}</span>
                    <span className="tk-kv-v mono">{v}</span>
                    <button className="icon-btn sm" onClick={() => setZones(zones.filter((x) => x !== z))} aria-label={`Remove ${z}`}>
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          </Pane>
        </div>
      )}

      <Pane label="Build a timestamp from a wall-clock time" style={{ flex: 'none' }}>
        <div className="row" style={{ padding: 10, flexWrap: 'wrap' }}>
          <input className="input mono" type="date" value={bDate} onChange={(e) => setBDate(e.target.value)} aria-label="Date" />
          <input className="input mono" type="time" step={1} value={bTime} onChange={(e) => setBTime(e.target.value)} aria-label="Time" />
          <select className="select" value={bZone} onChange={(e) => setBZone(e.target.value)} aria-label="Time zone" style={{ maxWidth: 240 }}>
            {[local, ...zoneList.filter((z) => z !== local)].map((z) => (
              <option key={z} value={z}>
                {z}
                {z === local ? ' (local)' : ''}
              </option>
            ))}
          </select>
          {built ? (
            <>
              <span className="mono">→ {Math.floor(built.getTime() / 1000)}</span>
              <CopyBtn text={String(Math.floor(built.getTime() / 1000))} title="Copy unix seconds" />
              <span className="mono dim">{built.toISOString()}</span>
              <CopyBtn text={built.toISOString()} title="Copy ISO" />
              <button className="btn sm ghost" onClick={() => setInput(String(Math.floor(built.getTime() / 1000)))}>
                Inspect
              </button>
            </>
          ) : (
            <span className="bad">Invalid date/time</span>
          )}
        </div>
      </Pane>
    </div>
  )
}
