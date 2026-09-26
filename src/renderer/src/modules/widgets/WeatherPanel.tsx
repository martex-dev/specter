// Weather side panel — Open-Meteo current conditions, next 24 h and 7 days.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Droplets, Gauge, MapPin, Plus, Search, Sun, Sunrise, Sunset, Thermometer, Umbrella, Wind, X } from 'lucide-react'
import { compass, wmoInfo, type GeoPlace, type WeatherData } from '@shared/modules/widgets'
import { invoke } from '../../lib/ipc'
import { Seg } from '../../components/ui'
import { toast } from '../../stores/ui'
import { errorText } from './store'
import { ErrorState, Loading, SourceLine, WeatherGlyph } from './ui'
import { placeDay, placeLabel, placeTime, setPreview, shortHour, temp, useForecast, usePlaces, usePrefs, usePreview, wind, type TempUnit } from './weatherState'
import './widgets.css'

export function PlaceSearch({ onPick, autoFocus, placeholder = 'Search a city…' }: { onPick: (p: GeoPlace) => void; autoFocus?: boolean; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeoPlace[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    const text = q.trim()
    if (text.length < 2) {
      setResults([])
      setError(null)
      return
    }
    const my = ++seq.current
    const t = setTimeout(() => {
      setBusy(true)
      invoke('weather:search', text)
        .then((r) => {
          if (my !== seq.current) return
          setResults(r)
          setError(r.length ? null : 'No matching places')
        })
        .catch((e) => my === seq.current && setError(errorText(e)))
        .finally(() => my === seq.current && setBusy(false))
    }, 350)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="wg-search">
      <div className="wg-search-box">
        <Search size={13} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label="Search places" onKeyDown={(e) => e.key === 'Enter' && results[0] && (onPick(results[0]), setQ(''))} />
      </div>
      {(results.length > 0 || error || busy) && q.trim().length >= 2 && (
        <div className="wg-search-results">
          {busy && !results.length && <div className="wg-muted-row">Searching Open-Meteo…</div>}
          {error && !busy && <div className="wg-muted-row">{error}</div>}
          {results.map((r) => (
            <button
              key={r.id}
              className="wg-search-item"
              onClick={() => {
                onPick(r)
                setQ('')
              }}
            >
              <MapPin size={13} />
              <span className="ellipsis grow">{placeLabel(r)}</span>
              <span className="dim mono" style={{ fontSize: 10 }}>
                {r.lat.toFixed(2)}, {r.lon.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function HourlyChart({ data, unit }: { data: WeatherData; unit: TempUnit }) {
  const hours = data.hourly.slice(0, 24)
  const W = 336
  const H = 118
  const top = 26
  const bottom = 80
  const temps = hours.map((h) => h.temp)
  const lo = Math.min(...temps)
  const hi = Math.max(...temps)
  const range = hi - lo || 1
  const x = (i: number) => 8 + (i / Math.max(1, hours.length - 1)) * (W - 16)
  const y = (t: number) => bottom - ((t - lo) / range) * (bottom - top)
  const line = hours.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h.temp).toFixed(1)}`).join(' ')
  const area = `${line} L${x(hours.length - 1).toFixed(1)},${bottom + 4} L${x(0).toFixed(1)},${bottom + 4} Z`
  if (hours.length < 2) return null
  return (
    <svg className="wg-hourly" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Temperature and precipitation chance, next 24 hours">
      <defs>
        <linearGradient id="wg-hourly-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {hours.map((h, i) =>
        h.precipProb ? <rect key={'p' + i} x={x(i) - 4} y={H - 12 - (h.precipProb / 100) * 22} width={8} height={(h.precipProb / 100) * 22} rx={1.5} fill="var(--info)" opacity={0.55} /> : null
      )}
      <path d={area} fill="url(#wg-hourly-fill)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      {hours.map((h, i) =>
        i % 3 === 0 ? (
          <g key={i}>
            <circle cx={x(i)} cy={y(h.temp)} r={2.2} fill="var(--bg-1)" stroke="var(--accent)" strokeWidth={1.4} />
            <text x={x(i)} y={y(h.temp) - 7} textAnchor="middle" className="wg-hourly-t">
              {temp(h.temp, unit)}
            </text>
            <text x={x(i)} y={H - 1} textAnchor="middle" className="wg-hourly-h">
              {i === 0 ? 'Now' : shortHour(h.time, data.timezone)}
            </text>
          </g>
        ) : null
      )}
      <line x1={8} x2={W - 8} y1={H - 12} y2={H - 12} stroke="var(--line)" />
    </svg>
  )
}

function HourlyIcons({ data, unit }: { data: WeatherData; unit: TempUnit }) {
  return (
    <div className="wg-hour-strip">
      {data.hourly
        .slice(0, 24)
        .filter((_, i) => i % 2 === 0)
        .map((h) => (
          <div key={h.time} className="wg-hour" title={`${wmoInfo(h.code).label}${h.precipProb !== null ? ` · ${h.precipProb}% precipitation` : ''}`}>
            <span className="wg-hour-h">{shortHour(h.time, data.timezone)}</span>
            <WeatherGlyph code={h.code} isDay={h.isDay} size={16} />
            <span className="wg-hour-t">{temp(h.temp, unit)}</span>
          </div>
        ))}
    </div>
  )
}

function Daily({ data, unit }: { data: WeatherData; unit: TempUnit }) {
  const lo = Math.min(...data.daily.map((d) => d.tMin))
  const hi = Math.max(...data.daily.map((d) => d.tMax))
  const span = hi - lo || 1
  return (
    <div className="wg-days">
      {data.daily.map((d, i) => (
        <div key={d.date} className="wg-day" title={wmoInfo(d.code).label}>
          <span className="wg-day-n">{i === 0 ? 'Today' : placeDay(d.date + 12 * 3600_000, data.timezone)}</span>
          <WeatherGlyph code={d.code} size={16} />
          <span className="wg-day-p">{d.precipProb ? `${d.precipProb}%` : ''}</span>
          <span className="wg-day-lo num">{temp(d.tMin, unit)}</span>
          <span className="wg-range">
            <span style={{ left: `${((d.tMin - lo) / span) * 100}%`, right: `${100 - ((d.tMax - lo) / span) * 100}%` }} />
          </span>
          <span className="wg-day-hi num">{temp(d.tMax, unit)}</span>
        </div>
      ))}
    </div>
  )
}

export function WeatherView({ data, unit }: { data: WeatherData; unit: TempUnit }) {
  const c = data.current
  const w = wmoInfo(c.code)
  const today = data.daily[0]
  return (
    <>
      <div className="wg-wx-now">
        <div className="wg-wx-icon">
          <WeatherGlyph code={c.code} isDay={c.isDay} size={46} />
        </div>
        <div className="grow">
          <div className="wg-wx-temp num">{temp(c.temp, unit)}</div>
          <div className="wg-wx-cond">{w.label}</div>
          <div className="dim" style={{ fontSize: 11.5 }}>
            Feels like {temp(c.apparent, unit)}
            {today ? ` · H ${temp(today.tMax, unit)} L ${temp(today.tMin, unit)}` : ''}
          </div>
        </div>
      </div>
      <div className="wg-wx-stats">
        <div>
          <Droplets size={13} />
          <span className="label">Humidity</span>
          <b className="num">{c.humidity !== null ? `${Math.round(c.humidity)}%` : '—'}</b>
        </div>
        <div>
          <Wind size={13} />
          <span className="label">Wind</span>
          <b className="num">
            {wind(c.windKmh, unit)}
            {c.windDir !== null ? ` ${compass(c.windDir)}` : ''}
          </b>
        </div>
        <div>
          <Umbrella size={13} />
          <span className="label">Precip.</span>
          <b className="num">{c.precipMm !== null ? `${c.precipMm} mm` : '—'}</b>
        </div>
        <div>
          <Gauge size={13} />
          <span className="label">Pressure</span>
          <b className="num">{c.pressureHpa !== null ? `${Math.round(c.pressureHpa)} hPa` : '—'}</b>
        </div>
        <div>
          <Sun size={13} />
          <span className="label">UV max</span>
          <b className="num">{today?.uvMax !== null && today?.uvMax !== undefined ? today.uvMax.toFixed(1) : '—'}</b>
        </div>
        <div>
          {today?.sunrise && c.time < today.sunrise ? <Sunrise size={13} /> : <Sunset size={13} />}
          <span className="label">{today?.sunrise && c.time < today.sunrise ? 'Sunrise' : 'Sunset'}</span>
          <b className="num">{today?.sunrise && c.time < today.sunrise ? placeTime(today.sunrise, data.timezone) : today?.sunset ? placeTime(today.sunset, data.timezone) : '—'}</b>
        </div>
      </div>
      <div className="wg-sec-h">
        <span className="label">Next 24 hours</span>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 10.5 }}>
          <span className="wg-key" style={{ background: 'var(--accent)' }} /> temp <span className="wg-key" style={{ background: 'var(--info)', marginLeft: 6 }} /> rain chance
        </span>
      </div>
      <HourlyChart data={data} unit={unit} />
      <HourlyIcons data={data} unit={unit} />
      <div className="wg-sec-h">
        <span className="label">7 days</span>
      </div>
      <Daily data={data} unit={unit} />
    </>
  )
}

export default function WeatherPanel() {
  const [places, setPlaces, placesLoaded] = usePlaces()
  const [prefs, setPrefs] = usePrefs()
  const preview = usePreview()
  const [adding, setAdding] = useState(false)
  const selected = useMemo(() => preview ?? places.find((p) => p.id === prefs.selected) ?? places[0] ?? null, [preview, places, prefs.selected])
  const { data, error, loading, refresh } = useForecast(selected)

  const add = (p: GeoPlace) => {
    setPreview(null)
    setAdding(false)
    if (places.some((x) => x.id === p.id)) {
      setPrefs({ ...prefs, selected: p.id })
      return
    }
    if (places.length >= 12) {
      toast({ kind: 'warn', title: 'Up to 12 saved places' })
      return
    }
    setPlaces([...places, p])
    setPrefs({ ...prefs, selected: p.id })
  }
  const remove = (p: GeoPlace) => {
    const next = places.filter((x) => x.id !== p.id)
    setPlaces(next)
    if (prefs.selected === p.id) setPrefs({ ...prefs, selected: next[0]?.id ?? null })
  }

  const noPlaces = placesLoaded && !places.length && !preview
  return (
    <div className="wg wg-weather">
      <div className="wg-toolbar">
        <div className="wg-chips">
          {places.map((p) => (
            <button
              key={p.id}
              className={'wg-chip' + (selected?.id === p.id && !preview ? ' on' : '')}
              onClick={() => {
                setPreview(null)
                setPrefs({ ...prefs, selected: p.id })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                remove(p)
              }}
              title={`${placeLabel(p)} — right-click to remove`}
            >
              {p.name}
              {selected?.id === p.id && !preview && (
                <X
                  size={11}
                  className="wg-chip-x"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(p)
                  }}
                  aria-label={`Remove ${p.name}`}
                />
              )}
            </button>
          ))}
          <button className={'wg-chip add' + (adding ? ' on' : '')} onClick={() => setAdding(!adding)} aria-label="Add place" data-tip="Add a place">
            <Plus size={12} />
          </button>
        </div>
        <span className="spacer" />
        <Seg<TempUnit>
          value={prefs.unit}
          options={[
            { value: 'c', label: '°C' },
            { value: 'f', label: '°F' }
          ]}
          onChange={(u) => setPrefs({ ...prefs, unit: u })}
        />
      </div>

      {(adding || noPlaces) && (
        <div className="wg-pad">
          {noPlaces && (
            <div className="wg-hint">
              <Thermometer size={14} /> Add a city to see its weather. Searches go to Open-Meteo’s free geocoding API.
            </div>
          )}
          <PlaceSearch onPick={add} autoFocus />
        </div>
      )}

      {preview && (
        <div className="wg-banner">
          <MapPin size={13} /> Previewing <b>{placeLabel(preview)}</b>
          <span className="spacer" />
          <button className="btn sm primary" onClick={() => add(preview)}>
            Save
          </button>
          <button className="icon-btn sm" onClick={() => setPreview(null)} aria-label="Close preview">
            <X size={12} />
          </button>
        </div>
      )}

      {selected && (
        <div className="wg-pad">
          <div className="wg-place">
            <MapPin size={12} />
            <span className="ellipsis">{placeLabel(selected)}</span>
            <span className="spacer" />
            {data && <span className="dim mono" style={{ fontSize: 10.5 }}>{placeTime(Date.now(), data.timezone)} local</span>}
          </div>
          {error && !data && <ErrorState error={error} onRetry={() => refresh(true)} />}
          {!data && !error && <Loading label="Loading forecast…" />}
          {data && <WeatherView data={data} unit={prefs.unit} />}
          {error && data && <div className="wg-warn-line">Refresh failed: {error}</div>}
          <SourceLine
            source="Open-Meteo"
            href="https://open-meteo.com/"
            updated={data?.fetchedAt}
            extra={data ? `model ${placeTime(data.current.time, data.timezone)}` : undefined}
            onRefresh={() => refresh(true)}
            busy={loading}
          />
        </div>
      )}
    </div>
  )
}
