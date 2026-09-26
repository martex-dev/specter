import { describe, expect, it } from 'vitest'
import { aggregateBandwidth, compass, cToF, fxConvert, jitter, median, percentile, toMbps, wmoInfo } from '@shared/modules/widgets'

describe('widgets WMO weather codes', () => {
  it('maps every documented WMO code to a label and icon kind', () => {
    const codes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]
    for (const c of codes) {
      const w = wmoInfo(c)
      expect(w.kind).not.toBe('unknown')
      expect(w.label.length).toBeGreaterThan(2)
    }
    expect(wmoInfo(0)).toEqual({ label: 'Clear sky', kind: 'clear' })
    expect(wmoInfo(2).kind).toBe('partly')
    expect(wmoInfo(45).kind).toBe('fog')
    expect(wmoInfo(65).kind).toBe('rain')
    expect(wmoInfo(75).kind).toBe('snow')
    expect(wmoInfo(95).kind).toBe('thunder')
    expect(wmoInfo(99).kind).toBe('hail')
    expect(wmoInfo(4).kind).toBe('unknown')
  })

  it('converts temperature and wind direction', () => {
    expect(cToF(0)).toBe(32)
    expect(cToF(100)).toBe(212)
    expect(cToF(-40)).toBe(-40)
    expect(compass(0)).toBe('N')
    expect(compass(360)).toBe('N')
    expect(compass(90)).toBe('E')
    expect(compass(225)).toBe('SW')
    expect(compass(-45)).toBe('NW')
  })
})

describe('widgets speed-test math', () => {
  it('computes Mbps from bytes and milliseconds', () => {
    expect(toMbps(1_000_000, 1000)).toBe(8) // 1 MB in 1 s = 8 Mbit/s
    expect(toMbps(12_500_000, 100)).toBe(1000)
    expect(toMbps(100, 0)).toBe(0)
  })

  it('computes percentiles, median and jitter', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(percentile([10, 20, 30, 40, 50], 0.9)).toBeCloseTo(46, 10)
    expect(Number.isNaN(percentile([], 0.5))).toBe(true)
    expect(jitter([10, 12, 11, 15])).toBeCloseTo((2 + 1 + 4) / 3, 10)
    expect(jitter([10])).toBe(0)
  })

  it('aggregates bandwidth as the 90th percentile, ignoring too-short samples', () => {
    const samples = [
      { bytes: 1_000_000, ms: 1000 }, // 8
      { bytes: 1_000_000, ms: 500 }, // 16
      { bytes: 1_000_000, ms: 250 }, // 32
      { bytes: 100, ms: 1 } // ignored (< 10 ms)
    ]
    expect(aggregateBandwidth(samples)).toBeCloseTo(percentile([8, 16, 32], 0.9), 10)
    expect(aggregateBandwidth([])).toBeNull()
  })
})

describe('widgets currency conversion', () => {
  const rates = { EUR: 0.9, GBP: 0.8, JPY: 150 }
  it('converts through USD cross rates', () => {
    expect(fxConvert(rates, 100, 'USD', 'EUR')).toBeCloseTo(90, 10)
    expect(fxConvert(rates, 90, 'EUR', 'USD')).toBeCloseTo(100, 10)
    expect(fxConvert(rates, 0.8, 'GBP', 'JPY')).toBeCloseTo(150, 10)
    expect(fxConvert(rates, 1, 'EUR', 'XXX')).toBeNull()
  })
})
