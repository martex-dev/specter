// Minimal iCalendar (RFC 5545) VEVENT reader for importing local .ics files.
//
// Supports line unfolding, escaped text, DATE and DATE-TIME values (UTC,
// floating and TZID-qualified, including common Windows zone names used by
// Outlook), DTEND or DURATION, and skips cancelled events. Recurrence rules
// are not expanded: a recurring event is imported as its first occurrence and
// counted so the UI can say so. Pure — unit-tested directly.

export interface IcsEvent {
  uid: string | null
  title: string
  start: number
  end: number
  allDay: boolean
  location: string
  notes: string
  recurring: boolean
}

export interface IcsParseResult {
  events: IcsEvent[]
  skipped: number
  recurring: number
}

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

/** Joins folded lines (CRLF/LF followed by a space or tab). */
export function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.length > 0)
}

export function parseLine(line: string): Prop | null {
  // NAME;PARAM=VAL;PARAM="quoted:val":VALUE — the first unquoted ':' ends the params.
  let inQuote = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts: string[] = []
  let cur = ''
  inQuote = false
  for (const c of head) {
    if (c === '"') inQuote = !inQuote
    if (c === ';' && !inQuote) {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  parts.push(cur)
  const name = parts[0].trim().toUpperCase()
  if (!name) return null
  const params: Record<string, string> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value }
}

export function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

// Windows time-zone names (Outlook exports) → IANA.
const WINDOWS_TZ: Record<string, string> = {
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Pacific Standard Time': 'America/Bogota',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Egypt Standard Time': 'Africa/Cairo'
}

function validZone(tz: string): string | null {
  // Also accept prefixed ids such as "/mozilla.org/20050126_1/Europe/Berlin".
  const tail = /([A-Za-z_]+\/[A-Za-z_+-]+)$/.exec(tz)?.[1]
  for (const cand of [WINDOWS_TZ[tz.trim()], tz.trim(), tail]) {
    if (!cand) continue
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: cand })
      return cand
    } catch {
      /* try next */
    }
  }
  return null
}

/** Offset of `tz` from UTC at instant `ms`, in ms (positive east of Greenwich). */
export function zoneOffset(ms: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** Converts a wall-clock time in `tz` to a UTC instant. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  let ms = guess - zoneOffset(guess, tz)
  const off2 = zoneOffset(ms, tz)
  if (guess - off2 !== ms) ms = guess - off2
  return ms
}

/** Parses a DATE or DATE-TIME value. Returns null when unparseable. */
export function parseIcsDate(value: string, params: Record<string, string> = {}): { ms: number; allDay: boolean } | null {
  const v = value.trim()
  const dm = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (dm || params.VALUE === 'DATE') {
    const m = dm ?? /^(\d{4})(\d{2})(\d{2})/.exec(v)
    if (!m) return null
    return { ms: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime(), allDay: true }
  }
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(v)
  if (!t) return null
  const [y, mo, d, h, mi, s] = [t[1], t[2], t[3], t[4], t[5], t[6] ?? '0'].map(Number)
  if (t[7]) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false }
  const tz = params.TZID ? validZone(params.TZID) : null
  if (tz) return { ms: zonedToUtc(y, mo, d, h, mi, s, tz), allDay: false }
  // Floating time (or unknown zone): interpret in the local zone.
  return { ms: new Date(y, mo - 1, d, h, mi, s).getTime(), allDay: false }
}

/** ISO-8601 duration as used by iCalendar (e.g. P1D, PT1H30M, P2W, -PT15M) in ms. */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v.trim())
  if (!m || v.trim().length < 3) return null
  const [, sign, w, d, h, mi, s] = m
  const ms = ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0)) * 1000
  return sign === '-' ? -ms : ms
}

export function parseIcs(text: string): IcsParseResult {
  const lines = unfold(text)
  const events: IcsEvent[] = []
  let skipped = 0
  let recurring = 0
  let cur: Prop[] | null = null
  let nested = 0 // depth of sub-components inside VEVENT (VALARM…)
  for (const line of lines) {
    const p = parseLine(line)
    if (!p) continue
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase()
      if (what === 'VEVENT' && !cur) {
        cur = []
        nested = 0
      } else if (cur) nested++
      continue
    }
    if (p.name === 'END') {
      const what = p.value.trim().toUpperCase()
      if (cur && nested > 0) nested--
      else if (cur && what === 'VEVENT') {
        const ev = buildEvent(cur)
        if (ev) {
          events.push(ev)
          if (ev.recurring) recurring++
        } else skipped++
        cur = null
      }
      continue
    }
    if (cur && nested === 0) cur.push(p)
  }
  return { events, skipped, recurring }
}

function buildEvent(props: Prop[]): IcsEvent | null {
  const get = (n: string) => props.find((p) => p.name === n)
  if ((get('STATUS')?.value ?? '').trim().toUpperCase() === 'CANCELLED') return null
  const ds = get('DTSTART')
  if (!ds) return null
  const start = parseIcsDate(ds.value, ds.params)
  if (!start) return null
  let end: number | null = null
  const de = get('DTEND')
  if (de) end = parseIcsDate(de.value, de.params)?.ms ?? null
  const du = end === null ? get('DURATION') : undefined
  const dur = du ? parseDuration(du.value) : null
  if (start.allDay) {
    // All-day ends are local midnights: count calendar days (a DST day is 23 or 25 h long),
    // and an end on or before the start (some exporters repeat DTSTART) means one day.
    if (end === null || end <= start.ms) {
      const d = new Date(start.ms)
      d.setDate(d.getDate() + Math.max(1, Math.round((dur ?? 0) / 86_400_000)))
      end = d.getTime()
    }
  } else {
    if (end === null && dur !== null) end = start.ms + dur
    if (end === null || end < start.ms) end = start.ms
  }
  const title = unescapeText(get('SUMMARY')?.value ?? '').trim() || '(untitled event)'
  const uid = get('UID')?.value.trim() || null
  // A modified occurrence of a recurring event shares the series UID; keep it apart
  // so it doesn't overwrite the series' own (first) event on import.
  const rid = get('RECURRENCE-ID')?.value.trim()
  return {
    uid: uid && rid ? `${uid}#${rid}` : uid,
    title: title.slice(0, 300),
    start: start.ms,
    end,
    allDay: start.allDay,
    location: unescapeText(get('LOCATION')?.value ?? '').trim().slice(0, 300),
    notes: unescapeText(get('DESCRIPTION')?.value ?? '').trim().slice(0, 4000),
    recurring: !!get('RRULE') || !!get('RDATE')
  }
}
