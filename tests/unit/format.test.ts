import { describe, expect, it } from 'vitest'
import { pct } from '../../src/renderer/src/lib/format'

describe('pct', () => {
  it('signs by the rounded value', () => {
    expect(pct(0)).toBe('0.00%')
    expect(pct(-0.001)).toBe('0.00%')
    expect(pct(0.004)).toBe('0.00%')
    expect(pct(1.234)).toBe('+1.23%')
    expect(pct(-1.26, 1)).toBe('-1.3%')
  })
  it('handles missing values', () => {
    expect(pct(null)).toBe('—')
    expect(pct(NaN)).toBe('—')
  })
})
