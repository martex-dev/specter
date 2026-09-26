// New-tab cards (rendered inside `.ntp-widgets` on specter://newtab and in the cockpit dashboard).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { fxConvert, wmoInfo, type NewsItem, type SpeedResult, type WidgetId } from '@shared/modules/widgets'
import { invoke, on } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { Favicon } from '../../components/ui'
import { openSidePanel } from '../../stores/ui'
import { widgetMeta } from './catalog'
import { useNews, openItem } from './NewsPanel'
import { EventRow, startOfDay, useEvents, useUpcoming } from './CalendarPanel'
import { ZoneRow, useClocks } from './ClocksPanel'
import { CountdownCard, useCountdowns } from './CountdownPanel'
import { fmtRate, usePairs, useRates } from './CurrencyPanel'
import { fmtMbps } from './SpeedPanel'
import { NoteCard, newNote, sortNotes, useStickies } from './StickiesPanel'
import { PlaceSearch } from './WeatherPanel'
import { ErrorState, SourceLine, WeatherGlyph, siteFavicon } from './ui'
import { useNow, useVisibleInterval } from './store'
import { placeDay, placeLabel, temp, useForecast, usePlaces, usePrefs } from './weatherState'
import './widgets.css'

function Card({ id, children, extra }: { id: WidgetId; children: ReactNode; extra?: ReactNode }) {
  const m = widgetMeta(id)
  return (
    <div className="ntp-card wg-ntp">
      <div className="ntp-card-h">
        <m.icon size={13} className="muted" />
        <span className="label">{m.title}</span>
        <span className="spacer" />
        {extra}
        <button className="icon-btn sm" onClick={() => openSidePanel(m.panelId)} aria-label={`Open ${m.title}`} data-tip={`Open ${m.title}`}>
          <ChevronRight size={13} />
        </button>
      </div>
      {children}
    </div>
  )
}

function WeatherCardInner() {
  const [places, setPlaces, loaded] = usePlaces()
  const [prefs, setPrefs] = usePrefs()
  const place = places.find((p) => p.id === prefs.selected) ?? places[0] ?? null
  const { data, error, loading, refresh } = useForecast(place)
  if (!loaded) return null
  if (!place)
    return (
      <Card id="weather">
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
          Set a city to see local weather.
        </div>
        <PlaceSearch
          onPick={(p) => {
            setPlaces([p])
            setPrefs({ ...prefs, selected: p.id })
          }}
        />
      </Card>
    )
  return (
    <Card id="weather">
      {error && !data && <ErrorState error={error} onRetry={() => refresh(true)} compact />}
      {data && (
        <>
          <div className="wg-ntp-wx">
            <WeatherGlyph code={data.current.code} isDay={data.current.isDay} size={34} />
            <div className="wg-ntp-wx-t num">{temp(data.current.temp, prefs.unit)}</div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis">{wmoInfo(data.current.code).label}</div>
              <div className="dim ellipsis" style={{ fontSize: 11.5 }}>
                {placeLabel(place)}
              </div>
            </div>
          </div>
          <div className="wg-ntp-days">
            {data.daily.slice(0, 5).map((d, i) => (
              <div key={d.date}>
                <span className="dim">{i === 0 ? 'Today' : placeDay(d.date + 12 * 3600_000, data.timezone)}</span>
                <WeatherGlyph code={d.code} size={15} />
                <span className="num">
                  {temp(d.tMax, prefs.unit)} <span className="dim">{temp(d.tMin, prefs.unit)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {!data && !error && <div className="wg-muted-row">Loading forecast…</div>}
      <SourceLine source="Open-Meteo" updated={data?.fetchedAt} busy={loading} />
    </Card>
  )
}

function NewsCardInner() {
  const filter = useMemo(() => ({ unreadOnly: true, limit: 6 }), [])
  const { feeds, items, error } = useNews(filter)
  const [interval, setIntervalMin] = useState(30)
  useEffect(() => {
    invoke('news:settings')
      .then((s) => setIntervalMin(s.intervalMin))
      .catch(() => undefined)
  }, [])
  useVisibleInterval(() => void invoke('news:refresh', {}).catch(() => undefined), interval * 60_000, [interval])
  const feedById = new Map(feeds.map((f) => [f.id, f]))
  const last = feeds.reduce((m, f) => Math.max(m, f.lastFetched ?? 0), 0)
  return (
    <Card id="news">
      {error && <ErrorState error={error} compact />}
      {items?.length === 0 && <div className="wg-muted-row">All caught up.</div>}
      {items?.map((it: NewsItem) => {
        const f = feedById.get(it.feedId)
        return (
          <div key={it.id} className="list-row" onClick={(e) => openItem(it, e.ctrlKey)} title={it.title}>
            <Favicon src={siteFavicon(f?.siteUrl || it.link)} url={f?.siteUrl || it.link} size={14} />
            <span className="ellipsis grow">{it.title}</span>
            <span className="dim" style={{ fontSize: 10.5, flex: 'none' }}>
              {timeAgo(it.published ?? it.fetchedAt)}
            </span>
          </div>
        )
      })}
      <SourceLine source={`${feeds.length} feeds`} updated={last || null} />
    </Card>
  )
}

function ClocksCardInner() {
  const [state] = useClocks()
  const now = useNow(15_000)
  return (
    <Card id="clocks">
      {state.zones.slice(0, 5).map((z) => (
        <ZoneRow key={z.id} tz={z.tz} label={z.label} ms={now} mode="digital" />
      ))}
      {!state.zones.length && <div className="wg-muted-row">No cities yet.</div>}
    </Card>
  )
}

function CalendarCardInner() {
  const now = useNow(60_000)
  const today = startOfDay(now)
  // Next local midnight (a DST day is 23 or 25 hours long).
  const tomorrow = startOfDay(today + 36 * 3600_000)
  const { events } = useEvents(today, tomorrow)
  const upcoming = useUpcoming(4).filter((e) => e.start >= tomorrow)
  return (
    <Card id="calendar">
      <div className="wg-ntp-sub">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      {events.length ? events.slice(0, 4).map((e) => <EventRow key={e.id} e={e} onClick={() => openSidePanel('wg-calendar')} />) : <div className="wg-muted-row">Nothing scheduled today.</div>}
      {upcoming.length > 0 && (
        <>
          <div className="wg-ntp-sub" style={{ marginTop: 6 }}>
            Next
          </div>
          {upcoming.slice(0, 2).map((e) => (
            <EventRow key={e.id} e={e} showDate onClick={() => openSidePanel('wg-calendar')} />
          ))}
        </>
      )}
    </Card>
  )
}

function SpeedCardInner() {
  const [last, setLast] = useState<SpeedResult | null | undefined>(undefined)
  useEffect(() => {
    const load = () =>
      invoke('widgets:speedHistory')
        .then((h) => setLast(h[0] ?? null))
        .catch(() => setLast(null))
    load()
    return on('widgets:speedProgress', (p) => (p.phase === 'done' || p.phase === 'error') && load())
  }, [])
  return (
    <Card id="speedtest">
      {last ? (
        <div className="wg-ntp-speed">
          <div>
            <span className="label">Down</span>
            <b className="num">{fmtMbps(last.downMbps)}</b>
          </div>
          <div>
            <span className="label">Up</span>
            <b className="num">{fmtMbps(last.upMbps)}</b>
          </div>
          <div>
            <span className="label">Ping</span>
            <b className="num">{last.latencyMs !== null ? last.latencyMs.toFixed(0) : '—'}</b>
          </div>
        </div>
      ) : (
        <div className="wg-muted-row">{last === null ? 'No speed tests yet.' : 'Loading…'}</div>
      )}
      <div className="wg-source">
        <span className="ellipsis">{last ? `Cloudflare · ${timeAgo(last.at)}${last.colo ? ' · ' + last.colo : ''} · Mbps` : 'Cloudflare speed test · runs only on click'}</span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => openSidePanel('wg-speedtest')}>
          Run test
        </button>
      </div>
    </Card>
  )
}

function CurrencyCardInner() {
  const { rates, error, loading } = useRates()
  const [pairs] = usePairs()
  return (
    <Card id="currency">
      {error && !rates && <ErrorState error={error} compact />}
      {rates &&
        pairs.slice(0, 5).map(([a, b]) => (
          <div key={a + b} className="wg-pair compact" onClick={() => openSidePanel('wg-currency')}>
            <span className="wg-pair-c mono">
              {a}/{b}
            </span>
            <span className="spacer" />
            <b className="num">{fmtRate(fxConvert(rates.rates, 1, a, b))}</b>
          </div>
        ))}
      {rates && <SourceLine source={rates.source.split(' (')[0]} updated={rates.fetchedAt} busy={loading} />}
    </Card>
  )
}

function StickiesCardInner() {
  const [notes, setNotes, loaded] = useStickies()
  const [fresh, setFresh] = useState<string | null>(null)
  if (!loaded) return null
  const shown = sortNotes(notes).slice(0, 4)
  return (
    <Card
      id="stickies"
      extra={
        <button
          className="icon-btn sm"
          onClick={() => {
            const n = newNote(notes)
            setFresh(n.id)
            setNotes([...notes, n])
          }}
          aria-label="New note"
          data-tip="New note"
        >
          <Plus size={13} />
        </button>
      }
    >
      {shown.length ? (
        <div className="wg-notes compact">
          {shown.map((n) => (
            <NoteCard key={n.id} note={n} compact autoFocus={n.id === fresh} />
          ))}
        </div>
      ) : (
        <div className="wg-muted-row">No notes yet — press + to jot something down.</div>
      )}
    </Card>
  )
}

function CountdownCardInner() {
  const [list] = useCountdowns()
  const now = useNow(1000)
  const upcoming = list.filter((c) => c.target > now).sort((a, b) => a.target - b.target)
  return (
    <Card id="countdown">
      {upcoming.length ? upcoming.slice(0, 3).map((c) => <CountdownCard key={c.id} c={c} now={now} compact />) : <div className="wg-muted-row">No upcoming countdowns.</div>}
    </Card>
  )
}

export const NewTabWeather = WeatherCardInner
export const NewTabNews = NewsCardInner
export const NewTabClocks = ClocksCardInner
export const NewTabCalendar = CalendarCardInner
export const NewTabSpeed = SpeedCardInner
export const NewTabCurrency = CurrencyCardInner
export const NewTabStickies = StickiesCardInner
export const NewTabCountdown = CountdownCardInner
