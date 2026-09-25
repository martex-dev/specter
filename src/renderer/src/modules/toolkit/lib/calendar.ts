// "Add to calendar" helpers: Google / Outlook links and RFC 5545 ICS files.

export interface CalEvent {
  title: string
  start: Date
  end: Date
  allDay?: boolean
  location?: string
  description?: string
  url?: string
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 20250102T030405Z */
export function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** 20250102 (local calendar date) */
export function dateStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function allDayEnd(ev: CalEvent): Date {
  // All-day end dates are exclusive: an event on the 2nd ends on the 3rd.
  const e = new Date(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate())
  const s = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate())
  if (e <= s) return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1)
  return new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1)
}

function details(ev: CalEvent): string {
  return [ev.description, ev.url].filter(Boolean).join('\n\n')
}

export function googleCalendarUrl(ev: CalEvent): string {
  const dates = ev.allDay ? `${dateStamp(ev.start)}/${dateStamp(allDayEnd(ev))}` : `${utcStamp(ev.start)}/${utcStamp(ev.end)}`
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates })
  if (details(ev)) p.set('details', details(ev))
  if (ev.location) p.set('location', ev.location)
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

export function outlookCalendarUrl(ev: CalEvent, kind: 'live' | 'office' = 'live'): string {
  const host = kind === 'office' ? 'https://outlook.office.com' : 'https://outlook.live.com'
  const p = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: ev.title })
  if (ev.allDay) {
    p.set('startdt', `${ev.start.getFullYear()}-${pad(ev.start.getMonth() + 1)}-${pad(ev.start.getDate())}`)
    const e = allDayEnd(ev)
    p.set('enddt', `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`)
    p.set('allday', 'true')
  } else {
    p.set('startdt', ev.start.toISOString())
    p.set('enddt', ev.end.toISOString())
    p.set('allday', 'false')
  }
  if (details(ev)) p.set('body', details(ev))
  if (ev.location) p.set('location', ev.location)
  return `${host}/calendar/0/deeplink/compose?${p.toString()}`
}

/** Escapes TEXT values (RFC 5545 §3.3.11). */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Folds content lines to at most 75 octets (continuation lines start with a space). */
export function icsFold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = out.length === 0 ? 75 : 74
    if (bytes + n > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.map((l, i) => (i === 0 ? l : ' ' + l)).join('\r\n')
}

export function buildIcs(ev: CalEvent, opts: { uid?: string; now?: Date } = {}): string {
  const now = opts.now ?? new Date()
  const uid = opts.uid ?? `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}@specter.local`
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SPECTER//Toolkit//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utcStamp(now)}`]
  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(ev.start)}`, `DTEND;VALUE=DATE:${dateStamp(allDayEnd(ev))}`)
  } else {
    lines.push(`DTSTART:${utcStamp(ev.start)}`, `DTEND:${utcStamp(ev.end)}`)
  }
  lines.push(`SUMMARY:${icsEscape(ev.title)}`)
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`)
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`)
  if (ev.url) lines.push(`URL:${ev.url}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(icsFold).join('\r\n') + '\r\n'
}
