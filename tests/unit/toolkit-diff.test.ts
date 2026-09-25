import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { diffLines, diffStats, diffWords, myersDiff, sideBySide, unifiedText } from '../../src/renderer/src/modules/toolkit/lib/diff'

function lcsLen(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp[a.length][b.length]
}

/** Checks the edit script is well-formed and reproduces both inputs. */
function apply(a: string[], b: string[]) {
  const edits = myersDiff(a, b)
  const outA: string[] = []
  const outB: string[] = []
  let lastA = -1
  let lastB = -1
  for (const e of edits) {
    if (e.op !== 'insert') {
      expect(e.ai).toBe(lastA + 1)
      lastA = e.ai
      outA.push(a[e.ai])
    }
    if (e.op !== 'delete') {
      expect(e.bi).toBe(lastB + 1)
      lastB = e.bi
      outB.push(b[e.bi])
    }
    if (e.op === 'equal') expect(a[e.ai]).toBe(b[e.bi])
  }
  expect(outA).toEqual(a)
  expect(outB).toEqual(b)
  return edits
}

let seed = 42
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

describe('toolkit diff (Myers, linear space)', () => {
  it('handles trivial cases', () => {
    expect(apply([], [])).toEqual([])
    expect(apply(['a'], []).map((e) => e.op)).toEqual(['delete'])
    expect(apply([], ['a']).map((e) => e.op)).toEqual(['insert'])
    expect(apply(['a', 'b'], ['a', 'b']).every((e) => e.op === 'equal')).toBe(true)
  })

  it('is minimal on the classic example', () => {
    const edits = apply('ABCABBA'.split(''), 'CBABAC'.split(''))
    expect(edits.filter((e) => e.op !== 'equal').length).toBe(5)
  })

  it('produces valid minimal scripts on random inputs', () => {
    for (let t = 0; t < 400; t++) {
      const n = Math.floor(rnd() * 25)
      const m = Math.floor(rnd() * 25)
      const alpha = 1 + Math.floor(rnd() * 4)
      const a = Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(rnd() * alpha)))
      const b = Array.from({ length: m }, () => String.fromCharCode(97 + Math.floor(rnd() * alpha)))
      const edits = apply(a, b)
      expect(edits.filter((e) => e.op === 'equal').length).toBe(lcsLen(a, b))
    }
  })

  it('handles large inputs quickly', () => {
    const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`)
    const b = a.filter((_, i) => i % 7 !== 0).map((l, i) => (i % 11 === 0 ? l + ' changed' : l))
    const t0 = Date.now()
    apply(a, b)
    expect(Date.now() - t0).toBeLessThan(5000)
  })

  it('builds line diffs, side-by-side rows and unified text', () => {
    const a = 'one\ntwo\nthree\nfour\n'
    const b = 'one\n2\nthree\nfour\nfive\n'
    const lines = diffLines(a, b)
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1, unchanged: 3 })
    const rows = sideBySide(lines)
    expect(rows[1]).toEqual({ left: { line: 2, text: 'two', op: 'delete' }, right: { line: 2, text: '2', op: 'insert' } })
    expect(rows[4]).toEqual({ left: undefined, right: { line: 5, text: 'five', op: 'insert' } })
    expect(unifiedText(a, b, { context: 1 })).toBe(['--- a', '+++ b', '@@ -1,4 +1,5 @@', ' one', '-two', '+2', ' three', ' four', '+five'].join('\n'))
    expect(unifiedText('a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nc\nd\ne\nf\ng\nH\n', { context: 1 })).toBe(['--- a', '+++ b', '@@ -7,2 +7,2 @@', ' g', '-h', '+H'].join('\n'))
    expect(unifiedText('x\n', 'x\n')).toBe('')
  })

  it('supports ignore-whitespace/case options', () => {
    expect(diffStats(diffLines('Hello  World', 'hello world', { ignoreWhitespace: true, ignoreCase: true })).unchanged).toBe(1)
    expect(diffStats(diffLines('Hello World', 'hello world')).removed).toBe(1)
  })

  it('diffs words within a line', () => {
    expect(diffWords('the quick brown fox', 'the slow brown fox')).toEqual([
      { op: 'equal', text: 'the ' },
      { op: 'delete', text: 'quick' },
      { op: 'insert', text: 'slow' },
      { op: 'equal', text: ' brown fox' }
    ])
  })
})
