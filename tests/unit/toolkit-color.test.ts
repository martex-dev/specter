import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { contrastRatio, formatRatio, hslToRgb, oklchToRgb, parseColor, rgbToHsl, rgbToOklch, toHex, toHslString, toOklchString, toRgbString, wcag } from '../../src/renderer/src/modules/toolkit/lib/color'

describe('toolkit color conversions', () => {
  it('parses hex, rgb, hsl and oklch syntaxes', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#336699')).toEqual({ r: 51, g: 102, b: 153, a: 1 })
    expect(parseColor('336699cc')!.a).toBeCloseTo(0.8, 2)
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColor('rgba(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(toHex(parseColor('hsl(0 100% 50%)')!)).toBe('#ff0000')
    expect(toHex(parseColor('hsl(120, 100%, 25%)')!)).toBe('#008000')
    expect(toHex(parseColor('oklch(62.8% 0.2577 29.23)')!)).toBe('#ff0000')
    expect(parseColor('nope')).toBeNull()
    expect(parseColor('#12')).toBeNull()
  })

  it('round-trips RGB ↔ HSL', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#336699', '#a3b1ff', '#7f7f7f', '#c0ffee']) {
      const c = parseColor(hex)!
      const back = hslToRgb(rgbToHsl(c))
      expect(toHex({ ...back, a: 1 })).toBe(hex)
    }
    const hsl = rgbToHsl({ r: 51, g: 102, b: 153, a: 1 })
    expect(hsl.h).toBeCloseTo(210, 9)
    expect(hsl.s).toBeCloseTo(50, 9)
    expect(hsl.l).toBeCloseTo(40, 9)
  })

  it('converts to OKLCH with known reference values', () => {
    const red = rgbToOklch({ r: 255, g: 0, b: 0, a: 1 })
    expect(red.l).toBeCloseTo(0.628, 3)
    expect(red.c).toBeCloseTo(0.2577, 3)
    expect(red.h).toBeCloseTo(29.23, 1)
    const white = rgbToOklch({ r: 255, g: 255, b: 255, a: 1 })
    expect(white.l).toBeCloseTo(1, 4)
    expect(white.c).toBeCloseTo(0, 4)
    for (const hex of ['#336699', '#a3b1ff', '#c0ffee', '#123456']) {
      const c = parseColor(hex)!
      const { rgb, inGamut } = oklchToRgb(rgbToOklch(c))
      expect(inGamut).toBe(true)
      expect(toHex({ ...rgb, a: 1 })).toBe(hex)
    }
    expect(oklchToRgb({ l: 0.7, c: 0.37, h: 145 }).inGamut).toBe(false)
  })

  it('formats CSS strings', () => {
    const c = parseColor('#336699')!
    expect(toRgbString(c)).toBe('rgb(51 102 153)')
    expect(toHslString(c)).toBe('hsl(210 50% 40%)')
    expect(toOklchString(c)).toMatch(/^oklch\(\d+(\.\d+)?% 0\.\d+ \d+(\.\d+)?\)$/)
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080')
  })

  it('computes WCAG contrast ratios and levels', () => {
    const black = parseColor('#000')!
    const white = parseColor('#fff')!
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
    // Known pair: #767676 on white is the classic 4.54:1 AA pass.
    const grey = wcag(parseColor('#767676')!, white)
    expect(grey.ratio).toBeCloseTo(4.54, 2)
    expect(grey.aaNormal).toBe(true)
    expect(grey.aaaNormal).toBe(false)
    const light = wcag(parseColor('#777777')!, white)
    expect(light.aaNormal).toBe(false)
    expect(light.aaLarge).toBe(true)
    expect(formatRatio(4.4999)).toBe('4.49:1')
    // Semi-transparent foreground is composited over the background.
    expect(contrastRatio({ r: 0, g: 0, b: 0, a: 0 }, white)).toBeCloseTo(1, 5)
  })
})
