import { describe, expect, it } from 'vitest'
import { parseDuration, parseIcs, parseIcsDate, parseLine, unfold, unescapeText, zonedToUtc } from '../../src/main/modules/widgets/ics'

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:abc-1@test',
  'DTSTART;TZID=Europe/Berlin:20260715T090000',
  'DTEND;TZID=Europe/Berlin:20260715T103000',
  'SUMMARY:Team sync\\, weekly',
  'DESCRIPTION:Line one\\nLine two with a very long text that is folded acr',
  ' oss two lines',
  'LOCATION:Room 1\\; East',
  'RRULE:FREQ=WEEKLY',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'TRIGGER:-PT15M',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:abc-2@test',
  'DTSTART;VALUE=DATE:20261224',
  'DTEND;VALUE=DATE:20261227',
  'SUMMARY:Holidays',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:abc-3@test',
  'DTSTART:20260101T120000Z',
  'DURATION:PT1H30M',
  'SUMMARY:UTC with duration',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:abc-4@test',
  'DTSTART;TZID="Pacific Standard Time":20260301T080000',
  'SUMMARY:Outlook zone',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:abc-5@test',
  'STATUS:CANCELLED',
  'DTSTART:20260101T120000Z',
  'SUMMARY:Cancelled',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:No start',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

describe('widgets ICS parser', () => {
  it('unfolds lines and parses properties with quoted params', () => {
    expect(unfold('A:1\r\n  b\r\nC:2')).toEqual(['A:1 b', 'C:2'])
    expect(parseLine('DTSTART;TZID="Zone: odd":20260101T000000')).toEqual({ name: 'DTSTART', params: { TZID: 'Zone: odd' }, value: '20260101T000000' })
    expect(parseLine('garbage')).toBeNull()
    expect(unescapeText('a\\, b\\; c\\\\ d\\nE')).toBe('a, b; c\\ d\nE')
  })

  it('parses durations', () => {
    expect(parseDuration('PT1H30M')).toBe(5_400_000)
    expect(parseDuration('P1D')).toBe(86_400_000)
    expect(parseDuration('P2W')).toBe(14 * 86_400_000)
    expect(parseDuration('-PT15M')).toBe(-900_000)
    expect(parseDuration('P')).toBeNull()
  })

  it('converts zoned wall-clock times to UTC (incl. DST)', () => {
    expect(zonedToUtc(2026, 7, 15, 9, 0, 0, 'Europe/Berlin')).toBe(Date.UTC(2026, 6, 15, 7)) // CEST = UTC+2
    expect(zonedToUtc(2026, 1, 15, 9, 0, 0, 'Europe/Berlin')).toBe(Date.UTC(2026, 0, 15, 8)) // CET = UTC+1
    expect(zonedToUtc(2026, 3, 1, 8, 0, 0, 'America/Los_Angeles')).toBe(Date.UTC(2026, 2, 1, 16))
    expect(parseIcsDate('20260101T120000Z')).toEqual({ ms: Date.UTC(2026, 0, 1, 12), allDay: false })
    expect(parseIcsDate('20261224', { VALUE: 'DATE' })).toEqual({ ms: new Date(2026, 11, 24).getTime(), allDay: true })
    expect(parseIcsDate('20260101T120000')).toEqual({ ms: new Date(2026, 0, 1, 12).getTime(), allDay: false })
    expect(parseIcsDate('nope')).toBeNull()
  })

  it('reads VEVENTs, skipping alarms, timezones, cancelled and invalid events', () => {
    const r = parseIcs(ICS)
    expect(r.events).toHaveLength(4)
    expect(r.skipped).toBe(2)
    expect(r.recurring).toBe(1)
    const [sync, hol, utc, outlook] = r.events
    expect(sync.uid).toBe('abc-1@test')
    expect(sync.title).toBe('Team sync, weekly')
    expect(sync.notes).toBe('Line one\nLine two with a very long text that is folded across two lines')
    expect(sync.location).toBe('Room 1; East')
    expect(sync.start).toBe(Date.UTC(2026, 6, 15, 7))
    expect(sync.end).toBe(Date.UTC(2026, 6, 15, 8, 30))
    expect(sync.recurring).toBe(true)
    expect(hol.allDay).toBe(true)
    expect(hol.start).toBe(new Date(2026, 11, 24).getTime())
    expect(hol.end).toBe(new Date(2026, 11, 27).getTime())
    expect(utc.end - utc.start).toBe(5_400_000)
    expect(outlook.start).toBe(Date.UTC(2026, 2, 1, 16))
    expect(outlook.end).toBe(outlook.start)
  })

  it('ends all-day events on a local midnight, also across DST changes', () => {
    const ev = (...lines: string[]) => parseIcs(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')).events[0]
    // DST ends / starts in Europe and the US on these dates (25 h / 23 h days).
    for (const [y, m, d] of [
      [2026, 10, 25],
      [2026, 3, 29],
      [2026, 11, 1],
      [2026, 3, 8]
    ]) {
      const ymd = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`
      const next = new Date(y, m - 1, d + 1).getTime()
      expect(ev(`DTSTART;VALUE=DATE:${ymd}`, 'SUMMARY:No end').end).toBe(next)
      expect(ev(`DTSTART;VALUE=DATE:${ymd}`, 'DURATION:P1D').end).toBe(next)
      expect(ev(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${ymd}`).end).toBe(next)
    }
    expect(ev('DTSTART;VALUE=DATE:20261024', 'DURATION:P3D').end).toBe(new Date(2026, 9, 27).getTime())
  })

  it('keeps modified occurrences of a series apart from the series itself', () => {
    const r = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:series@test',
        'DTSTART:20260105T090000Z',
        'RRULE:FREQ=WEEKLY',
        'SUMMARY:Standup',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:series@test',
        'RECURRENCE-ID:20260112T090000Z',
        'DTSTART:20260112T100000Z',
        'SUMMARY:Standup (moved)',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n')
    )
    expect(r.events.map((e) => e.uid)).toEqual(['series@test', 'series@test#20260112T090000Z'])
  })
})
