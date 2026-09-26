// Calendar side panel — month view, local events (SQLite), agenda, ICS import, reminders.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, CalendarDays, ChevronLeft, ChevronRight, FileUp, MapPin, Plus, Trash2 } from 'lucide-react'
import type { CalEvent, CalEventInput, WidgetColor } from '@shared/modules/widgets'
import { invoke, on } from '../../lib/ipc'
import { Switch } from '../../components/ui'
import { confirmAction } from '../../components/prompt'
import { toast } from '../../stores/ui'
import { errorText, useNow } from './store'
import { ColorDots, colorVar } from './ui'
import './widgets.css'

const DAY = 86_400_000

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function addDays(ms: number, n: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

function weekStart(): number {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }
    const fd = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay
    if (fd) return fd % 7 // 1 = Monday … 7 = Sunday → JS 0 = Sunday
  } catch {
    /* ignore */
  }
  return 1
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateInput = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const timeInput = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromInputs(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = (time || '00:00').split(':').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, h || 0, mi || 0).getTime()
}

export function fmtEventTime(e: CalEvent): string {
  if (e.allDay) {
    const days = Math.round((startOfDay(e.end) - startOfDay(e.start)) / DAY)
    return days > 1 ? `All day · ${days} days` : 'All day'
  }
  const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return e.end > e.start ? `${t(e.start)} – ${t(e.end)}` : t(e.start)
}

/** Events overlapping [from, to), live-updated. */
export function useEvents(from: number, to: number): { events: CalEvent[]; error: string | null; reload: () => void } {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    invoke('widgets:calList', from, to)
      .then((e) => {
        setEvents(e)
        setError(null)
      })
      .catch((e) => setError(errorText(e)))
  }, [from, to])
  useEffect(() => {
    reload()
    return on('widgets:calChanged', reload)
  }, [reload])
  return { events, error, reload }
}

export function useUpcoming(limit: number): CalEvent[] {
  const [events, setEvents] = useState<CalEvent[]>([])
  useEffect(() => {
    const load = () =>
      invoke('widgets:calUpcoming', limit)
        .then(setEvents)
        .catch(() => undefined)
    load()
    return on('widgets:calChanged', load)
  }, [limit])
  return events
}

const REMINDERS: [string, number | null][] = [
  ['No reminder', null],
  ['At start', 0],
  ['5 min before', 5],
  ['15 min before', 15],
  ['30 min before', 30],
  ['1 hour before', 60],
  ['1 day before', 1440]
]

interface Draft {
  id?: string
  title: string
  date: string
  endDate: string
  start: string
  end: string
  allDay: boolean
  color: WidgetColor
  remindMin: number | null
  location: string
  notes: string
  source?: 'local' | 'ics'
  /** Timed events: whole days from the start date to the end date (multi-day events). */
  span: number
}

function draftFor(day: number, e?: CalEvent): Draft {
  if (e) {
    const lastDay = e.allDay ? addDays(e.end, -1) : e.end
    let span = e.allDay ? 0 : Math.max(0, Math.round((startOfDay(e.end) - startOfDay(e.start)) / DAY))
    // An overnight event (23:00 → 01:00) is handled by the "end before start" rule in save().
    if (span === 1 && timeInput(e.end) <= timeInput(e.start)) span = 0
    return { id: e.id, title: e.title, date: dateInput(e.start), endDate: dateInput(Math.max(e.start, lastDay)), start: timeInput(e.start), end: timeInput(e.end), allDay: e.allDay, color: e.color as WidgetColor, remindMin: e.remindMin, location: e.location, notes: e.notes, source: e.source, span }
  }
  const now = new Date()
  const h = Math.min(22, now.getHours() + 1)
  return { title: '', date: dateInput(day), endDate: dateInput(day), start: `${pad(h)}:00`, end: `${pad(h + 1)}:00`, allDay: false, color: 'accent', remindMin: 15, location: '', notes: '', span: 0 }
}

function Editor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState(draft)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const save = async () => {
    if (busy) return // Enter held down / pressed twice would save duplicates
    const start = d.allDay ? fromInputs(d.date, '00:00') : fromInputs(d.date, d.start)
    // Timed events keep their day span, so saving a multi-day event doesn't cut it to one day.
    let end = d.allDay ? addDays(fromInputs(d.endDate || d.date, '00:00'), 1) : fromInputs(dateInput(addDays(fromInputs(d.date, '00:00'), d.span)), d.end)
    if (!d.allDay && end < start) end = addDays(end, 1) // e.g. 23:00 → 01:00
    if (d.allDay && end <= start) end = addDays(start, 1)
    const input: CalEventInput = { id: d.id, title: d.title.trim() || '(untitled event)', start, end, allDay: d.allDay, color: d.color, remindMin: d.remindMin, location: d.location, notes: d.notes }
    setBusy(true)
    try {
      await invoke('widgets:calSave', input)
      onClose()
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save event', body: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  const del = async () => {
    if (!d.id) return
    if (!(await confirmAction('Delete this event?', d.title, 'Delete', true))) return
    await invoke('widgets:calDelete', d.id).catch(() => undefined)
    onClose()
  }
  return (
    <div className="wg-editor" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <input className="input wg-editor-title" autoFocus value={d.title} onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="Event title" aria-label="Title" />
      <div className="wg-form-row">
        <span className="label">All day</span>
        <Switch on={d.allDay} onChange={(v) => set({ allDay: v })} label="All day" />
        <span className="spacer" />
        <ColorDots value={d.color} onChange={(c) => set({ color: c })} size={13} />
      </div>
      <div className="wg-form-row">
        <input type="date" className="input" value={d.date} onChange={(e) => set({ date: e.target.value, endDate: e.target.value > d.endDate ? e.target.value : d.endDate })} aria-label="Date" />
        {d.allDay ? (
          <>
            <span className="dim">to</span>
            <input type="date" className="input" value={d.endDate} min={d.date} onChange={(e) => set({ endDate: e.target.value })} aria-label="End date" />
          </>
        ) : (
          <>
            <input type="time" className="input" value={d.start} onChange={(e) => set({ start: e.target.value })} aria-label="Start time" />
            <span className="dim">–</span>
            <input type="time" className="input" value={d.end} onChange={(e) => set({ end: e.target.value })} aria-label="End time" />
          </>
        )}
      </div>
      <div className="wg-form-row">
        <Bell size={13} className="dim" />
        <select className="select grow" value={d.remindMin === null ? '' : String(d.remindMin)} onChange={(e) => set({ remindMin: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Reminder">
          {REMINDERS.map(([l, v]) => (
            <option key={l} value={v === null ? '' : String(v)}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="wg-form-row">
        <MapPin size={13} className="dim" />
        <input className="input grow" value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder="Location" aria-label="Location" />
      </div>
      <textarea className="textarea" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes" aria-label="Notes" />
      <div className="wg-form-row">
        {d.id && (
          <button className="btn sm danger" onClick={del}>
            <Trash2 size={12} /> Delete
          </button>
        )}
        {d.source === 'ics' && <span className="dim" style={{ fontSize: 11 }}>Imported</span>}
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn sm primary" onClick={save} disabled={busy}>
          Save
        </button>
      </div>
      {d.remindMin !== null && <p className="wg-fine">Reminders appear as SPECTER notifications while SPECTER is running.</p>}
    </div>
  )
}

export function EventRow({ e, onClick, showDate }: { e: CalEvent; onClick?: () => void; showDate?: boolean }) {
  return (
    <button className="wg-event" onClick={onClick} style={{ ['--c' as string]: colorVar(e.color) }}>
      <span className="wg-event-bar" />
      <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
        <div className="ellipsis wg-event-t">{e.title}</div>
        <div className="ellipsis wg-event-m">
          {showDate ? new Date(e.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' : ''}
          {fmtEventTime(e)}
          {e.location ? ` · ${e.location}` : ''}
        </div>
      </div>
      {e.remindMin !== null && <Bell size={11} className="dim" />}
    </button>
  )
}

export default function CalendarPanel() {
  const now = useNow(60_000)
  const today = startOfDay(now)
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  })
  const [selected, setSelected] = useState(today)
  const [draft, setDraft] = useState<Draft | null>(null)
  const ws = useMemo(weekStart, [])
  const m = new Date(month)
  const gridStart = addDays(month, -((m.getDay() - ws + 7) % 7))
  const gridEnd = addDays(gridStart, 42)
  const { events, error } = useEvents(gridStart, gridEnd)
  const upcoming = useUpcoming(6)

  const byDay = useMemo(() => {
    const map = new Map<number, CalEvent[]>()
    for (const e of events) {
      // Start at the grid: a long event that began months ago still covers these days.
      let d = Math.max(startOfDay(e.start), gridStart)
      const last = e.allDay ? addDays(e.end, -1) : Math.max(e.start, e.end - 1)
      let guard = 0
      while (d <= last && guard++ < 62) {
        if (d >= gridStart && d < gridEnd) map.set(d, [...(map.get(d) ?? []), e])
        d = addDays(d, 1)
      }
    }
    return map
  }, [events, gridStart, gridEnd])

  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(addDays(gridStart, i)).toLocaleDateString(undefined, { weekday: 'narrow' }))
  const dayEvents = byDay.get(selected) ?? []

  const importIcs = async () => {
    try {
      const r = await invoke('widgets:calImportIcs')
      if (!r) return
      toast({
        kind: 'ok',
        title: `Imported ${r.imported} event${r.imported === 1 ? '' : 's'} from ${r.file}`,
        body: [r.updated ? `${r.updated} updated` : '', r.skipped ? `${r.skipped} skipped (cancelled or invalid)` : '', r.recurring ? `${r.recurring} recurring event${r.recurring === 1 ? '' : 's'} imported as the first occurrence only` : ''].filter(Boolean).join(' · ') || undefined
      })
    } catch (e) {
      toast({ kind: 'error', title: 'Import failed', body: errorText(e) })
    }
  }

  return (
    <div className="wg wg-cal">
      <div className="wg-toolbar">
        <button className="icon-btn sm" onClick={() => setMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1).getTime())} aria-label="Previous month">
          <ChevronLeft size={14} />
        </button>
        <div className="wg-cal-title">{m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
        <button className="icon-btn sm" onClick={() => setMonth(new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime())} aria-label="Next month">
          <ChevronRight size={14} />
        </button>
        <span className="spacer" />
        <button
          className="btn sm ghost"
          onClick={() => {
            const d = new Date()
            setMonth(new Date(d.getFullYear(), d.getMonth(), 1).getTime())
            setSelected(today)
          }}
        >
          Today
        </button>
        <button className="icon-btn sm" onClick={importIcs} data-tip="Import .ics file" aria-label="Import ICS file">
          <FileUp size={13} />
        </button>
        <button className="icon-btn sm" onClick={() => setDraft(draftFor(selected))} data-tip="New event" aria-label="New event">
          <Plus size={14} />
        </button>
      </div>
      <div className="wg-pad">
        <div className="wg-month" role="grid" aria-label="Month">
          {weekdays.map((w, i) => (
            <div key={'h' + i} className="wg-wd">
              {w}
            </div>
          ))}
          {Array.from({ length: 42 }, (_, i) => {
            const d = addDays(gridStart, i)
            const dd = new Date(d)
            const evs = byDay.get(d) ?? []
            const cls = ['wg-dcell', dd.getMonth() !== m.getMonth() ? 'out' : '', d === today ? 'today' : '', d === selected ? 'sel' : '', dd.getDay() === 0 || dd.getDay() === 6 ? 'we' : ''].filter(Boolean).join(' ')
            return (
              <button key={d} className={cls} onClick={() => setSelected(d)} onDoubleClick={() => setDraft(draftFor(d))} aria-label={dd.toDateString() + (evs.length ? `, ${evs.length} events` : '')} aria-selected={d === selected}>
                <span className="wg-dnum">{dd.getDate()}</span>
                <span className="wg-ddots">
                  {evs.slice(0, 3).map((e) => (
                    <i key={e.id} style={{ background: colorVar(e.color) }} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
        {error && <div className="wg-warn-line">{error}</div>}

        {draft ? (
          <Editor key={draft.id ?? 'new' + draft.date} draft={draft} onClose={() => setDraft(null)} />
        ) : (
          <>
            <div className="wg-sec-h">
              <span className="label">{selected === today ? 'Today' : new Date(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
              <span className="spacer" />
              <button className="btn sm ghost" onClick={() => setDraft(draftFor(selected))}>
                <Plus size={12} /> Event
              </button>
            </div>
            {dayEvents.length ? dayEvents.map((e) => <EventRow key={e.id} e={e} onClick={() => setDraft(draftFor(selected, e))} />) : <div className="wg-muted-row">Nothing scheduled.</div>}
            <div className="wg-sec-h">
              <span className="label">Upcoming</span>
            </div>
            {upcoming.length ? (
              upcoming.map((e) => (
                <EventRow
                  key={e.id}
                  e={e}
                  showDate
                  onClick={() => {
                    const d = startOfDay(e.start)
                    setSelected(d)
                    setMonth(new Date(new Date(d).getFullYear(), new Date(d).getMonth(), 1).getTime())
                  }}
                />
              ))
            ) : (
              <div className="empty" style={{ padding: 18 }}>
                <CalendarDays size={20} />
                <div>No upcoming events. Double-click a day to add one, or import an .ics file.</div>
              </div>
            )}
          </>
        )}
        <p className="wg-fine">Stored locally on this device. ICS import reads single events (VEVENT); recurring events are imported as their first occurrence.</p>
      </div>
    </div>
  )
}
