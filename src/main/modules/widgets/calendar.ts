// Local calendar (SQLite), ICS import, and the reminder scheduler that also
// fires countdown notifications. The scheduler uses a single timer armed for
// the next due reminder — no polling.
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { WIDGET_COLORS, type CalEvent, type CalEventInput, type Countdown, type IcsImportResult } from '@shared/modules/widgets'
import { all, get, metaGet, metaSet, run, tx, uid } from '../../db'
import { broadcast } from '../../ipc'
import { createLogger } from '../../logger'
import { notify } from '../../services/notifications'
import { parseIcs } from './ics'
import { kvGet, onKvChanged } from './store'

const log = createLogger('widgets.calendar')

type EventRow = {
  id: string
  title: string
  start_at: number
  end_at: number
  all_day: number
  color: string
  notes: string
  location: string
  remind_min: number | null
  source: 'local' | 'ics'
  uid: string | null
}

const toEvent = (r: EventRow): CalEvent => ({
  id: r.id,
  title: r.title,
  start: r.start_at,
  end: r.end_at,
  allDay: r.all_day === 1,
  color: r.color,
  notes: r.notes,
  location: r.location,
  remindMin: r.remind_min,
  source: r.source,
  uid: r.uid
})

const COLS = 'id, title, start_at, end_at, all_day, color, notes, location, remind_min, source, uid'

export function listEvents(from: number, to: number): CalEvent[] {
  // Ends are exclusive: yesterday's all-day event (ending at today's midnight) is not
  // part of today. Zero-length events count when they start inside the range.
  return all<EventRow>(
    `SELECT ${COLS} FROM wg_events WHERE start_at < ? AND (end_at > ? OR start_at >= ?) ORDER BY all_day DESC, start_at LIMIT 2000`,
    Number(to),
    Number(from),
    Number(from)
  ).map(toEvent)
}

export function upcomingEvents(limit: number): CalEvent[] {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return all<EventRow>(`SELECT ${COLS} FROM wg_events WHERE end_at > ? ORDER BY start_at LIMIT ?`, Math.max(Date.now(), startOfToday.getTime()), Math.max(1, Math.min(100, Number(limit) || 10))).map(toEvent)
}

function clean(ev: CalEventInput): Omit<CalEvent, 'id' | 'source' | 'uid'> {
  const start = Number(ev.start)
  let end = Number(ev.end)
  if (!Number.isFinite(start)) throw new Error('Invalid start time')
  if (!Number.isFinite(end) || end < start) end = ev.allDay ? start + 86_400_000 : start
  const remind = ev.remindMin === null || ev.remindMin === undefined ? null : Math.max(0, Math.min(10080, Math.round(Number(ev.remindMin))))
  return {
    title: String(ev.title ?? '').trim().slice(0, 300) || '(untitled event)',
    start,
    end,
    allDay: !!ev.allDay,
    color: (WIDGET_COLORS as readonly string[]).includes(ev.color) ? ev.color : 'accent',
    notes: String(ev.notes ?? '').slice(0, 4000),
    location: String(ev.location ?? '').slice(0, 300),
    remindMin: Number.isFinite(remind as number) ? remind : null
  }
}

export function saveEvent(input: CalEventInput): CalEvent {
  const e = clean(input)
  const now = Date.now()
  const existing = input.id ? get<EventRow & { notified_at: number | null }>(`SELECT ${COLS}, notified_at FROM wg_events WHERE id = ?`, input.id) : undefined
  let id: string
  if (existing) {
    id = existing.id
    // Re-arm the reminder when its timing changed.
    const rearm = existing.start_at !== e.start || existing.remind_min !== e.remindMin
    run(
      `UPDATE wg_events SET title=?, start_at=?, end_at=?, all_day=?, color=?, notes=?, location=?, remind_min=?, updated_at=?${rearm ? ', notified_at=NULL' : ''} WHERE id=?`,
      e.title,
      e.start,
      e.end,
      e.allDay ? 1 : 0,
      e.color,
      e.notes,
      e.location,
      e.remindMin,
      now,
      id
    )
  } else {
    id = uid('ev_')
    run(
      "INSERT INTO wg_events(id, title, start_at, end_at, all_day, color, notes, location, remind_min, source, uid, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,'local',NULL,?,?)",
      id,
      e.title,
      e.start,
      e.end,
      e.allDay ? 1 : 0,
      e.color,
      e.notes,
      e.location,
      e.remindMin,
      now,
      now
    )
  }
  changed()
  return toEvent(get<EventRow>(`SELECT ${COLS} FROM wg_events WHERE id = ?`, id)!)
}

export function deleteEvent(id: string): void {
  run('DELETE FROM wg_events WHERE id = ?', String(id))
  changed()
}

export async function importIcs(e: Electron.IpcMainInvokeEvent): Promise<IcsImportResult | null> {
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { title: 'Import calendar (.ics)', properties: ['openFile' as const], filters: [{ name: 'iCalendar', extensions: ['ics', 'ical', 'ifb', 'icalendar'] }] }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const file = r.canceled ? null : r.filePaths[0]
  if (!file) return null
  if (statSync(file).size > 20 * 1024 * 1024) throw new Error('File is larger than 20 MB')
  const parsed = parseIcs(readFileSync(file, 'utf8'))
  if (!parsed.events.length && !parsed.skipped) throw new Error('No events found in that file')
  let imported = 0
  let updated = 0
  const now = Date.now()
  tx(() => {
    for (const ev of parsed.events.slice(0, 5000)) {
      const exists = ev.uid ? get<{ id: string }>('SELECT id FROM wg_events WHERE uid = ?', ev.uid) : undefined
      if (exists) {
        run('UPDATE wg_events SET title=?, start_at=?, end_at=?, all_day=?, notes=?, location=?, updated_at=? WHERE id=?', ev.title, ev.start, ev.end, ev.allDay ? 1 : 0, ev.notes, ev.location, now, exists.id)
        updated++
      } else {
        run(
          "INSERT INTO wg_events(id, title, start_at, end_at, all_day, color, notes, location, remind_min, source, uid, created_at, updated_at) VALUES(?,?,?,?,?,'accent-2',?,?,NULL,'ics',?,?,?)",
          uid('ev_'),
          ev.title,
          ev.start,
          ev.end,
          ev.allDay ? 1 : 0,
          ev.notes,
          ev.location,
          ev.uid,
          now,
          now
        )
        imported++
      }
    }
  })
  log.info(`imported ${imported} events (${updated} updated) from ${basename(file)}`)
  changed()
  return { file: basename(file), imported, updated, skipped: parsed.skipped, recurring: parsed.recurring }
}

export function eventCount(): number {
  return Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM wg_events')?.n ?? 0)
}

function changed(): void {
  broadcast('widgets:calChanged', undefined)
  scheduleReminders()
}

// ---------------------------------------------------------------- reminders

/** Reminders missed by more than this (app was closed) are dropped silently. */
const GRACE = 10 * 60_000
const MAX_TIMER = 6 * 3600_000
let timer: NodeJS.Timeout | null = null

function fmtTime(ms: number, allDay: boolean): string {
  const d = new Date(ms)
  if (allDay) return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

function notifiedCountdowns(): Record<string, number> {
  try {
    return JSON.parse(metaGet('widgets:countdownsNotified') ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function fireDue(): void {
  const now = Date.now()
  const due = all<EventRow>(
    `SELECT ${COLS} FROM wg_events WHERE remind_min IS NOT NULL AND notified_at IS NULL
       AND start_at - remind_min * 60000 <= ? AND start_at - remind_min * 60000 > ?`,
    now + 1000,
    now - GRACE
  )
  for (const r of due) {
    const mins = r.remind_min ?? 0
    notify({ category: 'browser', title: r.title, body: `${mins ? `In ${mins >= 60 ? Math.round(mins / 60) + ' h' : mins + ' min'} · ` : ''}${fmtTime(r.start_at, r.all_day === 1)}${r.location ? ' · ' + r.location : ''}` })
    run('UPDATE wg_events SET notified_at = ? WHERE id = ?', now, r.id)
  }
  // Silently mark long-missed reminders so they are not considered again.
  run('UPDATE wg_events SET notified_at = ? WHERE remind_min IS NOT NULL AND notified_at IS NULL AND start_at - remind_min * 60000 <= ?', now, now - GRACE)

  const sent = notifiedCountdowns()
  let dirty = false
  for (const c of kvGet<Countdown[]>('countdowns', [])) {
    if (!c?.notify || sent[c.id] === c.target) continue
    if (c.target <= now + 1000 && c.target > now - GRACE) {
      notify({ category: 'browser', title: `${c.title} — now`, body: 'Countdown reached.' })
      sent[c.id] = c.target
      dirty = true
    }
  }
  if (dirty) metaSet('widgets:countdownsNotified', JSON.stringify(sent))
}

export function scheduleReminders(): void {
  if (timer) clearTimeout(timer)
  timer = null
  try {
    fireDue()
    const now = Date.now()
    const nextEv = get<{ due: number }>(
      'SELECT MIN(start_at - remind_min * 60000) AS due FROM wg_events WHERE remind_min IS NOT NULL AND notified_at IS NULL AND start_at - remind_min * 60000 > ?',
      now
    )?.due
    const sent = notifiedCountdowns()
    const nextCd = kvGet<Countdown[]>('countdowns', [])
      .filter((c) => c?.notify && c.target > now && sent[c.id] !== c.target)
      .reduce<number | null>((m, c) => (m === null || c.target < m ? c.target : m), null)
    const next = [nextEv ?? null, nextCd].filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)[0]
    if (next === undefined) return
    timer = setTimeout(scheduleReminders, Math.max(500, Math.min(MAX_TIMER, next - now)))
  } catch (err) {
    log.warn('reminder scheduling failed', err)
  }
}

export function initCalendar(): void {
  onKvChanged('countdowns', scheduleReminders)
}
