import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { convertCase } from '../../src/renderer/src/modules/toolkit/lib/text'

describe('toolkit text case conversion', () => {
  it('title-cases with small words kept lower except at sentence starts', () => {
    expect(convertCase('the lord of the rings', 'title')).toBe('The Lord of the Rings')
    expect(convertCase('war and peace: the novel', 'title')).toBe('War and Peace: The Novel')
    expect(convertCase('  the start. of it', 'title')).toBe('  The Start. Of It')
  })

  it('title-cases large texts quickly', () => {
    const big = 'the quick brown fox and the lazy dog. '.repeat(20000)
    const t0 = Date.now()
    const out = convertCase(big, 'title')
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(out.startsWith('The Quick Brown Fox and the Lazy Dog. The Quick')).toBe(true)
  })
})
