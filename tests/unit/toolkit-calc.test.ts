import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { evaluate, formatResult, looksLikeMath, CalcError } from '../../src/renderer/src/modules/toolkit/lib/calc'

const ev = (s: string, vars?: Record<string, number>) => evaluate(s, { vars })

describe('toolkit calculator parser', () => {
  it('handles precedence and associativity', () => {
    expect(ev('2*(3+4)')).toBe(14)
    expect(ev('2+3*4')).toBe(14)
    expect(ev('10-4-3')).toBe(3)
    expect(ev('100/10/5')).toBe(2)
    expect(ev('2^3^2')).toBe(512)
    expect(ev('2**10')).toBe(1024)
    expect(ev('-2^2')).toBe(-4)
    expect(ev('(-2)^2')).toBe(4)
    expect(ev('2^-1')).toBe(0.5)
    expect(ev('--3')).toBe(3)
  })

  it('supports implicit multiplication, constants and functions', () => {
    expect(ev('2pi')).toBeCloseTo(2 * Math.PI)
    expect(ev('3(4+5)')).toBe(27)
    expect(ev('(1+2)(3+4)')).toBe(21)
    expect(ev('sqrt(16) + abs(-3)')).toBe(7)
    expect(ev('max(1, 5, 3)')).toBe(5)
    expect(ev('log(1000)')).toBeCloseTo(3)
    expect(ev('log(8, 2)')).toBeCloseTo(3)
    expect(ev('ln(e)')).toBeCloseTo(1)
    expect(ev('sin(90deg)')).toBeCloseTo(1)
    expect(ev('round(3.14159, 2)')).toBe(3.14)
  })

  it('supports factorial, percent, modulo and number formats', () => {
    expect(ev('5!')).toBe(120)
    expect(ev('200*15%')).toBe(30)
    expect(ev('50%')).toBe(0.5)
    expect(ev('7 % 3')).toBe(1)
    expect(ev('7 mod 4')).toBe(3)
    expect(ev('0xff + 0b11')).toBe(258)
    expect(ev('1e3 + 1_000')).toBe(2000)
    expect(ev('6 × 7 ÷ 2')).toBe(21)
    expect(ev('ans * 2', { ans: 21 })).toBe(42)
  })

  it('rejects invalid input without eval', () => {
    expect(() => ev('2 +')).toThrow(CalcError)
    expect(() => ev('(1+2')).toThrow(/Missing/)
    expect(() => ev('1+2)')).toThrow(/Unbalanced/)
    expect(() => ev('alert(1)')).toThrow(/Unknown name/)
    expect(() => ev('constructor')).toThrow(CalcError)
    expect(() => ev('__proto__')).toThrow(CalcError)
    expect(() => ev('toString')).toThrow(CalcError)
    expect(() => ev('2 $ 3')).toThrow(/Unexpected character/)
    expect(() => ev('sqrt 4')).toThrow(/parentheses/)
    expect(() => ev('max()')).toThrow(/argument/)
    expect(() => ev('2.5!')).toThrow(/Factorial/)
  })

  it('formats results without float noise', () => {
    expect(formatResult(ev('0.1+0.2'))).toBe('0.3')
    expect(formatResult(1 / 3)).toBe('0.33333333333333')
    expect(formatResult(1e21)).toBe('1e+21')
    expect(formatResult(123456)).toBe('123456')
    expect(formatResult(1 / 0)).toBe('∞')
  })

  it('detects math-like omnibox input', () => {
    expect(looksLikeMath('2*(3+4)')).toBe(true)
    expect(looksLikeMath('sqrt(2)')).toBe(true)
    expect(looksLikeMath('10 / 3')).toBe(true)
    expect(looksLikeMath('42')).toBe(false)
    expect(looksLikeMath('hello world')).toBe(false)
    expect(looksLikeMath('2024-01-05')).toBe(false)
    expect(looksLikeMath('192.168.0.1')).toBe(false)
    expect(looksLikeMath('iphone 15')).toBe(false)
    expect(looksLikeMath('c++ 20')).toBe(false)
  })
})
