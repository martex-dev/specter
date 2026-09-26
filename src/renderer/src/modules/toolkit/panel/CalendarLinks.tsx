import { useMemo, useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { invoke } from '../../../lib/ipc'
import { newTab } from '../../../stores/browser'
import { toast } from '../../../stores/ui'
import { buildIcs, googleCalendarUrl, outlookCalendarUrl, type CalEvent } from '../lib/calendar'
import { CopyBtn } from '../ui'

const pad = (n: number) => String(n).padStart(2, '0')
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export default function CalendarLinks() {
  const start0 = new Date(Date.now() + 3600000)
  start0.setMinutes(0, 0, 0)
  // One hour later — may be the next day (a 23:00 start ends at 00:00 tomorrow).
  const end0 = new Date(start0.getTime() + 3600000)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(dateStr(start0))
  const [time, setTime] = useState(`${pad(start0.getHours())}:00`)
  const [endDate, setEndDate] = useState(dateStr(end0))
  const [endTime, setEndTime] = useState(`${pad(end0.getHours())}:00`)
  const [allDay, setAllDay] = useState(false)
  const [location, setLocation] = useState('')
  const [details, setDetails] = useState('')

  const ev: CalEvent | null = useMemo(() => {
    const s = new Date(`${date}T${allDay ? '00:00' : time}`)
    const e = new Date(`${endDate}T${allDay ? '00:00' : endTime}`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null
    return { title: title.trim() || 'Untitled event', start: s, end: e < s ? s : e, allDay, location: location.trim() || undefined, description: details.trim() || undefined }
  }, [title, date, time, endDate, endTime, allDay, location, details])
  const endBeforeStart = ev && !allDay && new Date(`${endDate}T${endTime}`) < ev.start

  const links = ev
    ? [
        { name: 'Google Calendar', url: googleCalendarUrl(ev) },
        { name: 'Outlook.com', url: outlookCalendarUrl(ev, 'live') },
        { name: 'Outlook (Microsoft 365)', url: outlookCalendarUrl(ev, 'office') }
      ]
    : []

  const saveIcs = async () => {
    if (!ev) return
    const name = (ev.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'event') + '.ics'
    const path = await invoke('app:saveFile', name, buildIcs(ev)).catch(() => null)
    if (path) toast({ kind: 'ok', title: 'Calendar file saved', body: path })
  }

  const field = (label: string, el: React.ReactNode) => (
    <label className="tkp-field">
      <span className="label">{label}</span>
      {el}
    </label>
  )

  return (
    <>
      {field('Title', <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Team sync" autoFocus />)}
      <label className="row" style={{ gap: 6, fontSize: 12 }}>
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All-day
      </label>
      <div className="row">
        {field('Starts', <input className="input mono" type="date" value={date} onChange={(e) => setDate(e.target.value)} />)}
        {!allDay && field(' ', <input className="input mono" type="time" value={time} onChange={(e) => setTime(e.target.value)} />)}
      </div>
      <div className="row">
        {field('Ends', <input className="input mono" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />)}
        {!allDay && field(' ', <input className="input mono" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />)}
      </div>
      {endBeforeStart && <div className="warn" style={{ fontSize: 11.5 }}>End is before start — the event will use the start time.</div>}
      {field('Location', <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room 4 or https://meet…" />)}
      {field('Details', <textarea className="textarea" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />)}
      <button className="btn primary" onClick={saveIcs} disabled={!ev}>
        <Download size={13} /> Save .ics file
      </button>
      {links.length > 0 && (
        <div className="tkp-list">
          {links.map((l) => (
            <div key={l.name} className="tkp-item">
              <span className="grow">{l.name}</span>
              <CopyBtn text={l.url} title="Copy link" />
              <button className="icon-btn sm" onClick={() => newTab(l.url)} data-tip="Open in a new tab" aria-label={`Open ${l.name}`}>
                <ExternalLink size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="tk-note">Links are built locally; event details are only sent to Google/Microsoft if you open a link. The .ics file works with any calendar app.</div>
    </>
  )
}
