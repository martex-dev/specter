// Standard 5-field cron expressions (minute hour day-of-month month day-of-week).
//
// Supported: `*`, lists `a,b`, ranges `a-b`, steps `*/n` and `a-b/n` and `a/n`,
// month names JAN–DEC, weekday names SUN–SAT, `7` = Sunday, `?` (same as `*`)
// and the macros @yearly @annually @monthly @weekly @daily @midnight @hourly.
// Not supported (reported as errors): seconds/years fields, L, W, #, @reboot.
//
// Day matching follows Vixie cron: when both day-of-month and day-of-week are
// restricted, a day matches if EITHER matches.

export interface CronField {
  name: string
  min: number
  max: number
  values: number[]
  /** True when the field was `*` / `?` (unrestricted). */
  any: boolean
  raw: string
}

export interface CronSchedule {
  expr: string
  minute: CronField
  hour: CronField
  dom: CronField
  month: CronField
  dow: CronField
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const CRON_MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
}

export class CronError extends Error {}

function parseValue(s: string, spec: { name: string; min: number; max: number; names?: string[] }): number {
  const up = s.toUpperCase()
  if (spec.names) {
    const i = spec.names.indexOf(up)
    if (i >= 0) return i + (spec.name === 'month' ? 1 : 0)
  }
  if (!/^\d+$/.test(s)) throw new CronError(`Invalid ${spec.name} value "${s}"`)
  const n = Number(s)
  const max = spec.name === 'day of week' ? 7 : spec.max
  if (n < spec.min || n > max) throw new CronError(`${spec.name} value ${n} out of range ${spec.min}–${max}`)
  return n
}

function parseField(raw: string, spec: { name: string; min: number; max: number; names?: string[] }): CronField {
  if (/[LW#]/i.test(raw) && !/^[A-Z]{3}$/i.test(raw)) throw new CronError(`"${raw}": L, W and # are not supported`)
  const set = new Set<number>()
  let any = false
  for (const part of raw.split(',')) {
    if (!part) throw new CronError(`Empty list item in ${spec.name}`)
    const [rangePart, stepPart, extra] = part.split('/')
    if (extra !== undefined) throw new CronError(`Invalid step in "${part}"`)
    let step = 1
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) throw new CronError(`Invalid step "${stepPart}" in ${spec.name}`)
      step = Number(stepPart)
    }
    let lo: number
    let hi: number
    if (rangePart === '*' || rangePart === '?') {
      if (rangePart === '?' && spec.name !== 'day of month' && spec.name !== 'day of week') throw new CronError(`"?" is only allowed in day fields`)
      lo = spec.min
      hi = spec.max
      if (stepPart === undefined && raw.split(',').length === 1) any = true
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-')
      lo = parseValue(a, spec)
      hi = parseValue(b, spec)
      if (hi < lo) throw new CronError(`Range ${rangePart} is backwards in ${spec.name}`)
    } else {
      lo = parseValue(rangePart, spec)
      hi = stepPart !== undefined ? (spec.name === 'day of week' ? 6 : spec.max) : lo
    }
    for (let v = lo; v <= hi; v += step) set.add(spec.name === 'day of week' && v === 7 ? 0 : v)
  }
  return { name: spec.name, min: spec.min, max: spec.max, values: [...set].sort((a, b) => a - b), any, raw }
}

export function parseCron(expr: string): CronSchedule {
  const src = expr.trim()
  if (!src) throw new CronError('Empty expression')
  const lower = src.toLowerCase()
  if (lower === '@reboot') throw new CronError('@reboot has no schedule')
  const expanded = lower.startsWith('@') ? CRON_MACROS[lower] : src
  if (!expanded) throw new CronError(`Unknown macro ${src}`)
  const parts = expanded.split(/\s+/)
  if (parts.length === 6) throw new CronError('6 fields given — seconds/years fields are not supported (use 5 fields)')
  if (parts.length !== 5) throw new CronError(`Expected 5 fields, got ${parts.length}`)
  return {
    expr: src,
    minute: parseField(parts[0], { name: 'minute', min: 0, max: 59 }),
    hour: parseField(parts[1], { name: 'hour', min: 0, max: 23 }),
    dom: parseField(parts[2], { name: 'day of month', min: 1, max: 31 }),
    month: parseField(parts[3], { name: 'month', min: 1, max: 12, names: MONTHS }),
    dow: parseField(parts[4], { name: 'day of week', min: 0, max: 6, names: DAYS })
  }
}

type Zone = 'local' | 'utc'

interface Parts {
  y: number
  mo: number // 1-12
  d: number
  h: number
  mi: number
}

function get(date: Date, tz: Zone): Parts & { dow: number } {
  return tz === 'utc'
    ? { y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate(), h: date.getUTCHours(), mi: date.getUTCMinutes(), dow: date.getUTCDay() }
    : { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes(), dow: date.getDay() }
}

function make(p: Parts, tz: Zone): Date {
  return tz === 'utc' ? new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)) : new Date(p.y, p.mo - 1, p.d, p.h, p.mi)
}

function dayMatches(s: CronSchedule, p: Parts & { dow: number }): boolean {
  const domOk = s.dom.values.includes(p.d)
  const dowOk = s.dow.values.includes(p.dow)
  if (s.dom.any && s.dow.any) return true
  if (s.dom.any) return dowOk
  if (s.dow.any) return domOk
  return domOk || dowOk
}

/** Next `count` run times strictly after `from`. Returns fewer if none within ~5 years. */
export function nextRuns(schedule: CronSchedule | string, from: Date = new Date(), count = 10, tz: Zone = 'local'): Date[] {
  const s = typeof schedule === 'string' ? parseCron(schedule) : schedule
  const out: Date[] = []
  // Start at the next whole minute.
  let t = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000)
  const limit = from.getTime() + 5 * 366 * 86400000
  let guard = 0
  while (out.length < count && t.getTime() <= limit && guard++ < 200000) {
    const p = get(t, tz)
    if (!s.month.values.includes(p.mo)) {
      // Jump to the first day of the next month.
      t = make({ y: p.mo === 12 ? p.y + 1 : p.y, mo: p.mo === 12 ? 1 : p.mo + 1, d: 1, h: 0, mi: 0 }, tz)
      continue
    }
    if (!dayMatches(s, p)) {
      const next = make({ ...p, d: p.d + 1, h: 0, mi: 0 }, tz)
      // Guard against DST days where local midnight may not exist.
      t = next.getTime() > t.getTime() ? next : new Date(t.getTime() + 3600000)
      continue
    }
    if (!s.hour.values.includes(p.h)) {
      const next = make({ ...p, h: p.h + 1, mi: 0 }, tz)
      t = next.getTime() > t.getTime() ? next : new Date(t.getTime() + 3600000)
      continue
    }
    if (!s.minute.values.includes(p.mi)) {
      t = new Date(t.getTime() + 60000)
      continue
    }
    out.push(t)
    t = new Date(t.getTime() + 60000)
  }
  return out
}

// ---------------------------------------------------------------- description

const pad = (n: number) => String(n).padStart(2, '0')

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function listText(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
}

/** Detects "every n starting at lo" fields (e.g. `*\/15`, `5-59/10`). */
function stepOf(f: CronField): { step: number; start: number } | null {
  const m = /^(\*|\d+)(?:-(\d+))?\/(\d+)$/.exec(f.raw)
  if (!m) return null
  return { step: Number(m[3]), start: m[1] === '*' ? f.min : Number(m[1]) }
}

/** Compresses consecutive values into ranges for display. */
function ranges(values: number[], label: (n: number) => string): string {
  const out: string[] = []
  for (let i = 0; i < values.length; ) {
    let j = i
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++
    if (j - i >= 2) out.push(`${label(values[i])} through ${label(values[j])}`)
    else for (let k = i; k <= j; k++) out.push(label(values[k]))
    i = j + 1
  }
  return listText(out)
}

export function describeCron(schedule: CronSchedule | string): string {
  const s = typeof schedule === 'string' ? parseCron(schedule) : schedule
  const { minute, hour, dom, month, dow } = s
  let time: string
  const mStep = stepOf(minute)
  const hStep = stepOf(hour)
  if (minute.values.length === 1 && hour.values.length === 1) {
    time = `At ${pad(hour.values[0])}:${pad(minute.values[0])}`
  } else if (minute.values.length === 1 && hour.values.length > 1 && hour.values.length <= 6 && !hStep) {
    time = `At ${listText(hour.values.map((h) => `${pad(h)}:${pad(minute.values[0])}`))}`
  } else {
    let mPart: string
    if (minute.any) mPart = 'Every minute'
    else if (mStep && mStep.start === 0 && 60 % mStep.step === 0) mPart = `Every ${mStep.step} minutes`
    else if (mStep) mPart = `Every ${mStep.step} minutes starting at minute ${mStep.start}`
    else if (minute.values.length === 1) mPart = `At minute ${minute.values[0]}`
    else mPart = `At minutes ${ranges(minute.values, String)}`
    let hPart = ''
    if (hour.any) hPart = minute.values.length === 1 && !minute.any ? ' past every hour' : ''
    else if (hStep) hPart = ` past every ${hStep.step === 1 ? '' : ordinal(hStep.step) + ' '}hour${hStep.start ? ` from ${pad(hStep.start)}:00` : ''}`
    else if (hour.values.length === 1) hPart = minute.any || mStep ? ` during the ${pad(hour.values[0])}:00 hour` : ` past hour ${hour.values[0]}`
    else hPart = ` past hours ${ranges(hour.values, (h) => pad(h))}`
    time = mPart + hPart
  }
  const parts = [time]
  const domText = dom.any ? '' : stepOf(dom) ? `every ${ordinal(stepOf(dom)!.step)} day of the month` : `on day ${ranges(dom.values, String)} of the month`
  const dowText = dow.any ? '' : `on ${ranges(dow.values, (d) => DAY_NAMES[d])}`
  if (domText && dowText) parts.push(`${domText} or ${dowText}`)
  else if (domText) parts.push(domText)
  else if (dowText) parts.push(dowText)
  if (!month.any) parts.push(`in ${ranges(month.values, (m) => MONTH_NAMES[m - 1])}`)
  return parts.join(', ')
}
