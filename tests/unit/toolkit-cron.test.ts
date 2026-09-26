import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { describeCron, nextRuns, parseCron } from '../../src/renderer/src/modules/toolkit/lib/cron'

const iso = (ds: Date[]) => ds.map((d) => d.toISOString().slice(0, 16))
const from = new Date('2025-01-30T10:07:30Z') // a Thursday

describe('toolkit cron helper', () => {
  it('parses fields, names, ranges, steps and macros', () => {
    const s = parseCron('*/15 9-17 * JAN,MAR mon-fri')
    expect(s.minute.values).toEqual([0, 15, 30, 45])
    expect(s.hour.values).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(s.month.values).toEqual([1, 3])
    expect(s.dow.values).toEqual([1, 2, 3, 4, 5])
    expect(parseCron('0 0 * * 7').dow.values).toEqual([0])
    expect(parseCron('@daily').minute.values).toEqual([0])
    expect(parseCron('5/20 * * * *').minute.values).toEqual([5, 25, 45])
  })

  it('reports errors', () => {
    expect(() => parseCron('* * * *')).toThrow(/5 fields/)
    expect(() => parseCron('0 0 * * * *')).toThrow(/seconds/)
    expect(() => parseCron('60 * * * *')).toThrow(/out of range/)
    expect(() => parseCron('0 0 L * *')).toThrow(/not supported/)
    expect(() => parseCron('5-1 * * * *')).toThrow(/backwards/)
  })

  it('computes next run times (UTC)', () => {
    expect(iso(nextRuns('*/15 * * * *', from, 3, 'utc'))).toEqual(['2025-01-30T10:15', '2025-01-30T10:30', '2025-01-30T10:45'])
    expect(iso(nextRuns('0 9 * * 1-5', from, 3, 'utc'))).toEqual(['2025-01-31T09:00', '2025-02-03T09:00', '2025-02-04T09:00'])
    expect(iso(nextRuns('0 0 1 * *', from, 2, 'utc'))).toEqual(['2025-02-01T00:00', '2025-03-01T00:00'])
    expect(iso(nextRuns('0 12 29 2 *', from, 1, 'utc'))).toEqual(['2028-02-29T12:00'])
    expect(iso(nextRuns('30 10 31 * *', from, 3, 'utc'))).toEqual(['2025-01-31T10:30', '2025-03-31T10:30', '2025-05-31T10:30'])
    // DOM and DOW both restricted → either matches (Vixie cron).
    expect(iso(nextRuns('0 0 1 * 1', from, 3, 'utc'))).toEqual(['2025-02-01T00:00', '2025-02-03T00:00', '2025-02-10T00:00'])
    expect(nextRuns('0 0 31 2 *', from, 1, 'utc')).toEqual([])
  })

  it('computes local-time runs', () => {
    const runs = nextRuns('0 9 * * *', new Date(2025, 0, 30, 10, 0), 2)
    expect(runs[0].getHours()).toBe(9)
    expect(runs[0].getDate()).toBe(31)
    expect(runs[1].getDate()).toBe(1)
  })

  it('describes schedules in English', () => {
    expect(describeCron('* * * * *')).toBe('Every minute')
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes')
    expect(describeCron('0 9 * * 1-5')).toBe('At 09:00, on Monday through Friday')
    expect(describeCron('30 8,12,18 * * *')).toBe('At 08:30, 12:30 and 18:30')
    expect(describeCron('0 */2 * * *')).toBe('At minute 0 past every 2nd hour')
    expect(describeCron('0 0 1 1 *')).toBe('At 00:00, on day 1 of the month, in January')
    expect(describeCron('@hourly')).toBe('At minute 0 past every hour')
  })

  it('accepts month / weekday names that contain L or W', () => {
    expect(parseCron('0 9 * * MON,WED,FRI').dow.values).toEqual([1, 3, 5])
    expect(parseCron('0 9 * * WED-FRI').dow.values).toEqual([3, 4, 5])
    expect(parseCron('0 9 * JUL-DEC *').month.values).toEqual([7, 8, 9, 10, 11, 12])
    expect(parseCron('0 9 * APR,JUL *').month.values).toEqual([4, 7])
    expect(() => parseCron('0 0 * * 5L')).toThrow(/not supported/)
    expect(() => parseCron('0 0 LW * *')).toThrow(/not supported/)
    expect(() => parseCron('0 0 * * FRI#2')).toThrow(/not supported/)
  })

  it('describes ranges with steps without dropping the range end', () => {
    expect(describeCron('0-30/15 * * * *')).toBe('At minutes 0, 15 and 30')
    expect(describeCron('0 9-17/2 * * *')).toBe('At 09:00, 11:00, 13:00, 15:00 and 17:00')
    expect(describeCron('5-59/10 * * * *')).toBe('Every 10 minutes starting at minute 5')
  })

  it('ANDs day-of-month and day-of-week when one starts with * (Vixie cron)', () => {
    // */2 day-of-month with Monday: only odd-numbered Mondays.
    expect(iso(nextRuns('0 0 */2 * 1', from, 3, 'utc'))).toEqual(['2025-02-03T00:00', '2025-02-17T00:00', '2025-03-03T00:00'])
    expect(describeCron('0 0 */2 * 1')).toBe('At 00:00, every 2nd day of the month, but only on Monday')
    // Explicit lists on both still OR.
    expect(describeCron('0 0 1 * 1')).toBe('At 00:00, on day 1 of the month or on Monday')
  })
})
