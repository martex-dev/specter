import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { convert, findUnit, parseConversion, formatUnitValue, unitsIn, type UnitCategory } from '../../src/renderer/src/modules/toolkit/lib/units'

describe('toolkit unit conversions', () => {
  it('converts length, mass, time, speed, area, volume', () => {
    expect(convert(10, 'km', 'mi')).toBeCloseTo(6.21371192, 6)
    expect(convert(1, 'in', 'cm')).toBeCloseTo(2.54, 10)
    expect(convert(1, 'lb', 'kg')).toBeCloseTo(0.45359237, 10)
    expect(convert(90, 'min', 'h')).toBe(1.5)
    expect(convert(100, 'km/h', 'm/s')).toBeCloseTo(27.7777778, 6)
    expect(convert(1, 'ha', 'm²')).toBe(10000)
    expect(convert(1, 'gal', 'l')).toBeCloseTo(3.785411784, 9)
    expect(convert(1, 'acre', 'sqft')).toBeCloseTo(43560, 6)
  })

  it('converts temperatures (affine)', () => {
    expect(convert(100, 'C', 'F')).toBeCloseTo(212, 10)
    expect(convert(32, '°F', '°C')).toBeCloseTo(0, 10)
    expect(convert(0, 'K', 'C')).toBeCloseTo(-273.15, 10)
    expect(convert(-40, 'F', 'C')).toBeCloseTo(-40, 10)
  })

  it('distinguishes decimal and binary data sizes, bytes and bits', () => {
    expect(convert(1, 'GB', 'MB')).toBe(1000)
    expect(convert(1, 'GiB', 'MiB')).toBe(1024)
    expect(convert(1, 'GB', 'GiB')).toBeCloseTo(0.931322575, 8)
    expect(convert(1, 'B', 'bit')).toBe(8)
    expect(findUnit('gb')?.id).toBe('GB')
    expect(findUnit('mb')?.id).toBe('MB')
    expect(findUnit('kb')?.id).toBe('kB')
    expect(findUnit('Mb')?.id).toBe('Mbit')
    expect(convert(100, 'Mbit', 'MB')).toBe(12.5)
  })

  it('rejects cross-category conversions', () => {
    expect(() => convert(1, 'kg', 'm')).toThrow(/Cannot convert/)
  })

  it('round-trips every unit through its base', () => {
    for (const cat of ['length', 'mass', 'temperature', 'data', 'time', 'speed', 'area', 'volume'] as UnitCategory[]) {
      const units = unitsIn(cat)
      for (const u of units) expect(convert(convert(12.5, u, units[0]), units[0], u)).toBeCloseTo(12.5, 8)
    }
  })

  it('parses natural conversion queries', () => {
    const r = parseConversion('10 km to mi')!
    expect(r.from.id).toBe('km')
    expect(r.to.id).toBe('mi')
    expect(r.result).toBeCloseTo(6.2137, 3)
    expect(parseConversion('72 °F in C')!.result).toBeCloseTo(22.2222, 3)
    expect(parseConversion('5 GB as MiB')!.result).toBeCloseTo(4768.37, 1)
    expect(parseConversion('1,000 m to km')!.result).toBe(1)
    expect(parseConversion('1 in in cm')!.result).toBeCloseTo(2.54)
    expect(parseConversion('3 feet to meters')!.result).toBeCloseTo(0.9144)
    expect(parseConversion('10 km to kg')).toBeNull()
    expect(parseConversion('how to cook rice')).toBeNull()
    expect(formatUnitValue(6.213711922373339)).toBe('6.213711922')
  })
})
