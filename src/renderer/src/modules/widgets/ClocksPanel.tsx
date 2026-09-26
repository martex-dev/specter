// World clocks side panel — analog or digital, day/night and offset hints.
import { useMemo, useState } from 'react'
import { Moon, Pencil, Plus, Search, Sun, X } from 'lucide-react'
import { Seg } from '../../components/ui'
import { promptText } from '../../components/prompt'
import { DEFAULT_CLOCKS, allZones, dayShift, fmtOffset, isDaytime, localZone, utcLabel, zoneCity, zoneOffsetMin, zoneParts, type ClocksState } from './clocks'
import { useKv, useNow } from './store'
import './widgets.css'

export function AnalogClock({ ms, tz, size = 64, seconds = true }: { ms: number; tz: string; size?: number; seconds?: boolean }) {
  const p = zoneParts(ms, tz)
  const day = isDaytime(p.h)
  const hA = ((p.h % 12) + p.m / 60) * 30
  const mA = (p.m + p.s / 60) * 6
  const sA = p.s * 6
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={'wg-analog' + (day ? ' day' : ' night')} aria-hidden="true">
      <circle cx="50" cy="50" r="47" className="wg-analog-face" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1={i % 3 === 0 ? 7 : 9} x2="50" y2="14" transform={`rotate(${i * 30} 50 50)`} className={i % 3 === 0 ? 'wg-tick major' : 'wg-tick'} />
      ))}
      <line x1="50" y1="50" x2="50" y2="27" transform={`rotate(${hA} 50 50)`} className="wg-hand h" />
      <line x1="50" y1="50" x2="50" y2="15" transform={`rotate(${mA} 50 50)`} className="wg-hand m" />
      {seconds && <line x1="50" y1="58" x2="50" y2="12" transform={`rotate(${sA} 50 50)`} className="wg-hand s" />}
      <circle cx="50" cy="50" r="3" className="wg-hub" />
    </svg>
  )
}

export function ZoneRow({ tz, label, ms, mode, onRemove, onRename }: { tz: string; label?: string; ms: number; mode: 'analog' | 'digital'; onRemove?: () => void; onRename?: () => void }) {
  const p = zoneParts(ms, tz)
  const day = isDaytime(p.h)
  const diff = zoneOffsetMin(ms, tz) - zoneOffsetMin(ms, localZone())
  const shift = dayShift(ms, tz)
  let time = ''
  let date = ''
  try {
    time = new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz })
    date = new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })
  } catch {
    time = 'Invalid zone'
  }
  return (
    <div className={'wg-zone' + (mode === 'analog' ? ' analog' : '')}>
      {mode === 'analog' && <AnalogClock ms={ms} tz={tz} size={58} />}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="wg-zone-city ellipsis">{label || zoneCity(tz)}</div>
        <div className="wg-zone-meta ellipsis">
          {date}
          {shift !== 0 && <span className="wg-zone-shift">{shift > 0 ? ' · tomorrow' : ' · yesterday'}</span>} · {utcLabel(zoneOffsetMin(ms, tz))}
        </div>
      </div>
      <div className="wg-zone-right">
        <div className="wg-zone-time num">{time}</div>
        <div className="wg-zone-diff">
          {day ? <Sun size={11} className="wg-sun" /> : <Moon size={11} className="wg-moon" />} {fmtOffset(diff)}
        </div>
      </div>
      {(onRemove || onRename) && (
        <div className="wg-zone-actions">
          {onRename && (
            <button className="icon-btn sm" onClick={onRename} aria-label="Rename" data-tip="Rename">
              <Pencil size={11} />
            </button>
          )}
          {onRemove && (
            <button className="icon-btn sm" onClick={onRemove} aria-label="Remove" data-tip="Remove">
              <X size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function useClocks(): [ClocksState, (s: ClocksState) => void] {
  const [raw, set] = useKv<ClocksState | null>('clocks', null)
  return [raw && Array.isArray(raw.zones) ? raw : DEFAULT_CLOCKS, set]
}

export default function ClocksPanel() {
  const [state, setState] = useClocks()
  const now = useNow(1000)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const zones = useMemo(allZones, [])
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, '_')
    if (!s) return []
    return zones.filter((z) => z.toLowerCase().includes(s)).slice(0, 30)
  }, [q, zones])
  const local = localZone()
  const lp = zoneParts(now, local)

  const add = (tz: string) => {
    if (!state.zones.some((z) => z.tz === tz)) setState({ ...state, zones: [...state.zones, { id: 'z' + Date.now().toString(36), tz }] })
    setQ('')
    setAdding(false)
  }

  return (
    <div className="wg wg-clocks">
      <div className="wg-toolbar">
        <Seg<'analog' | 'digital'>
          value={state.mode}
          options={[
            { value: 'analog', label: 'Analog' },
            { value: 'digital', label: 'Digital' }
          ]}
          onChange={(mode) => setState({ ...state, mode })}
        />
        <span className="spacer" />
        <button className={'btn sm' + (adding ? '' : ' ghost')} onClick={() => setAdding(!adding)}>
          <Plus size={12} /> Add city
        </button>
      </div>
      <div className="wg-pad">
        <div className="wg-local">
          {state.mode === 'analog' ? <AnalogClock ms={now} tz={local} size={92} /> : null}
          <div>
            <div className="wg-local-time num">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div className="dim">
              {new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <div className="wg-zone-meta">
              {isDaytime(lp.h) ? <Sun size={11} className="wg-sun" /> : <Moon size={11} className="wg-moon" />} {zoneCity(local)} · {utcLabel(zoneOffsetMin(now, local))} · local
            </div>
          </div>
        </div>
        {adding && (
          <div className="wg-search" style={{ marginBottom: 10 }}>
            <div className="wg-search-box">
              <Search size={13} />
              <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="City or zone, e.g. Berlin, Sydney, UTC" aria-label="Time zone search" onKeyDown={(e) => e.key === 'Enter' && matches[0] && add(matches[0])} />
            </div>
            {matches.length > 0 && (
              <div className="wg-search-results">
                {matches.map((z) => (
                  <button key={z} className="wg-search-item" onClick={() => add(z)}>
                    <span className="ellipsis grow">{zoneCity(z)}</span>
                    <span className="dim mono" style={{ fontSize: 10 }}>
                      {z} · {utcLabel(zoneOffsetMin(now, z))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="wg-zones">
          {state.zones.map((z) => (
            <ZoneRow
              key={z.id}
              tz={z.tz}
              label={z.label}
              ms={now}
              mode={state.mode}
              onRemove={() => setState({ ...state, zones: state.zones.filter((x) => x.id !== z.id) })}
              onRename={async () => {
                const label = await promptText({ title: 'Clock label', label: 'Label', initial: z.label || zoneCity(z.tz), placeholder: zoneCity(z.tz) })
                if (label !== null) setState({ ...state, zones: state.zones.map((x) => (x.id === z.id ? { ...x, label: label.trim() || undefined } : x)) })
              }}
            />
          ))}
          {!state.zones.length && <div className="wg-muted-row">No cities yet — add one above.</div>}
        </div>
        <p className="wg-fine">Times are computed locally from your system’s time-zone database (Intl). Sun/moon marks 06:00–18:00 local time in each city.</p>
      </div>
    </div>
  )
}
