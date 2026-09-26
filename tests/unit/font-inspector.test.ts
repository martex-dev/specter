import { describe, expect, it } from 'vitest'
import {
  clipText,
  cssSnippet,
  formatFamily,
  formatFontStack,
  lineHeightRatio,
  matchStackEntry,
  parseCssColor,
  parseFontStack,
  tallyFamilies,
  tidyLength,
  toHex,
  weightName
} from '@shared/fontInspector'

describe('font stacks', () => {
  it('splits quoted and unquoted families', () => {
    expect(parseFontStack('"Helvetica Neue", Arial, sans-serif')).toEqual([
      { name: 'Helvetica Neue', generic: false },
      { name: 'Arial', generic: false },
      { name: 'sans-serif', generic: true }
    ])
    expect(parseFontStack("Segoe   UI ,'Inter',system-ui")).toEqual([
      { name: 'Segoe UI', generic: false },
      { name: 'Inter', generic: false },
      { name: 'system-ui', generic: true }
    ])
  })

  it('treats a quoted generic keyword as a family name', () => {
    expect(parseFontStack('"serif", serif')).toEqual([
      { name: 'serif', generic: false },
      { name: 'serif', generic: true }
    ])
  })

  it('keeps commas and escaped quotes inside quoted names', () => {
    expect(parseFontStack('"Foo, Bar", \'It\\\'s\', monospace').map((f) => f.name)).toEqual(['Foo, Bar', "It's", 'monospace'])
  })

  it('handles empty and degenerate input', () => {
    expect(parseFontStack('')).toEqual([])
    expect(parseFontStack(' , ,')).toEqual([])
    expect(parseFontStack('"unterminated')).toEqual([{ name: 'unterminated', generic: false }])
  })

  it('formats families, quoting only when needed', () => {
    expect(formatFamily({ name: 'Arial', generic: false })).toBe('Arial')
    expect(formatFamily({ name: 'Segoe UI', generic: false })).toBe('Segoe UI')
    expect(formatFamily({ name: 'serif', generic: true })).toBe('serif')
    expect(formatFamily({ name: 'serif', generic: false })).toBe('"serif"')
    expect(formatFamily({ name: '3Dumb', generic: false })).toBe('"3Dumb"')
    expect(formatFamily({ name: 'Say "hi"', generic: false })).toBe('"Say \\"hi\\""')
    const stack = '"Helvetica Neue", Arial, "Noto Sans JP", sans-serif'
    expect(formatFontStack(parseFontStack(stack))).toBe('Helvetica Neue, Arial, Noto Sans JP, sans-serif')
    expect(parseFontStack(formatFontStack(parseFontStack('"Foo, Bar", "serif", serif')))).toEqual(parseFontStack('"Foo, Bar", "serif", serif'))
  })

  it('matches a platform font to its stack entry', () => {
    const stack = parseFontStack('Inter, "Segoe UI", sans-serif')
    expect(matchStackEntry(stack, 'segoe ui')).toBe(1)
    expect(matchStackEntry(stack, 'Arial')).toBe(-1)
    expect(matchStackEntry(parseFontStack('sans-serif'), 'sans-serif')).toBe(-1)
  })
})

describe('colours', () => {
  it('parses computed colour forms', () => {
    expect(parseCssColor('rgb(26, 26, 26)')).toEqual({ r: 26, g: 26, b: 26, a: 1 })
    expect(parseCssColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseCssColor('rgb(10 20 30 / 25%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 })
    expect(parseCssColor('rgb(100% 0% 50%)')).toEqual({ r: 255, g: 0, b: 128, a: 1 })
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseCssColor('#11223380')!.a).toBeCloseTo(0.502, 3)
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('rejects what it cannot convert', () => {
    expect(parseCssColor('oklch(0.6 0.2 30)')).toBeNull()
    expect(parseCssColor('rgb(1, 2)')).toBeNull()
    expect(parseCssColor('rgb(a, b, c)')).toBeNull()
    expect(parseCssColor('#12345')).toBeNull()
  })

  it('formats hex, with alpha only when translucent', () => {
    expect(toHex({ r: 26, g: 26, b: 26, a: 1 })).toBe('#1a1a1a')
    expect(toHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080')
    expect(toHex({ r: 300, g: -4, b: 12.6, a: 1 })).toBe('#ff000d')
    expect(toHex(parseCssColor('rgb(163, 177, 255)')!)).toBe('#a3b1ff')
  })
})

describe('type metrics', () => {
  it('names weights', () => {
    expect(weightName('400')).toBe('Regular')
    expect(weightName(700)).toBe('Bold')
    expect(weightName('100')).toBe('Thin')
    expect(weightName('950')).toBe('Black')
    expect(weightName('590')).toBe('Semi Bold')
    expect(weightName('normal')).toBe('Regular')
    expect(weightName('bold')).toBe('Bold')
    expect(weightName('lighter')).toBe('lighter')
  })

  it('computes line-height ratios', () => {
    expect(lineHeightRatio('24px', '16px')).toBe('1.5')
    expect(lineHeightRatio('20.8px', '16px')).toBe('1.3')
    expect(lineHeightRatio('normal', '16px')).toBeNull()
    expect(lineHeightRatio('24px', '0px')).toBeNull()
  })

  it('tidies computed lengths', () => {
    expect(tidyLength('15.99999px')).toBe('16px')
    expect(tidyLength('0.16px')).toBe('0.16px')
    expect(tidyLength('-0.3333px')).toBe('-0.33px')
    expect(tidyLength('normal')).toBe('normal')
  })
})

describe('CSS snippet', () => {
  const base = { family: '"Inter", system-ui, sans-serif', size: '16px', weight: '400', style: 'normal', lineHeight: '24px', letterSpacing: 'normal', color: 'rgb(26, 26, 26)' }

  it('reproduces the text style and skips defaults', () => {
    expect(cssSnippet(base)).toBe(['font-family: Inter, system-ui, sans-serif;', 'font-size: 16px;', 'font-weight: 400;', 'line-height: 24px;', 'color: #1a1a1a;'].join('\n'))
  })

  it('includes non-default style and spacing, and keeps colours it cannot convert', () => {
    const css = cssSnippet({ ...base, style: 'italic', letterSpacing: '0.4px', lineHeight: 'normal', color: 'oklch(0.6 0.2 30)' })
    expect(css).toContain('font-style: italic;')
    expect(css).toContain('letter-spacing: 0.4px;')
    expect(css).toContain('line-height: normal;')
    expect(css).toContain('color: oklch(0.6 0.2 30);')
  })
})

describe('page summary', () => {
  it('clips sample text', () => {
    expect(clipText('  hello\n\n  world  ', 40)).toBe('hello world')
    expect(clipText('abcdefghij', 5)).toBe('abcd…')
  })

  it('tallies families by use', () => {
    const t = tallyFamilies([
      { family: 'Inter', stack: 'Inter, sans-serif', weight: '400', sample: 'Body copy' },
      { family: 'Georgia', stack: 'Georgia, serif', weight: '700', sample: 'Headline' },
      { family: 'Inter', stack: 'Inter, sans-serif', weight: '600', sample: 'Button' },
      { family: 'Inter', stack: '"Inter", Arial', weight: '400', sample: '' }
    ])
    expect(t.map((x) => [x.family, x.count])).toEqual([
      ['Inter', 3],
      ['Georgia', 1]
    ])
    expect(t[0].sample).toBe('Body copy')
    expect(t[0].stacks).toEqual(['Inter, sans-serif', '"Inter", Arial'])
    expect(t[0].weights).toEqual(['400', '600'])
  })
})
