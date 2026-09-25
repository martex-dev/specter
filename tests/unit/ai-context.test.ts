import { describe, expect, it } from 'vitest'
import { allocateBudget, contextMeta, fitContext, normalizeText, renderContextBlock, truncateText } from '../../src/main/modules/ai/context'

describe('ai context budgeting', () => {
  it('normalizes whitespace from innerText', () => {
    expect(normalizeText('  a  \t b \r\n\r\n\r\n\n c d  ')).toBe('a b\n\nc d')
  })

  it('leaves short text untouched', () => {
    expect(truncateText('hello', 100)).toEqual({ text: 'hello', truncated: false })
  })

  it('truncates with an explicit marker and stays within the limit', () => {
    const src = 'Sentence one. '.repeat(500)
    const r = truncateText(src, 1000)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(1000)
    expect(r.text).toMatch(/\[truncated — showing the first [\d,]+ of 7,000 characters\]$/)
    // Cut at a sentence boundary, not mid-word.
    expect(r.text.split('\n')[0].endsWith('.')).toBe(true)
  })

  it('water-fills the budget: short items keep everything, long items share the rest', () => {
    expect(allocateBudget([100, 5000, 5000], 3000)).toEqual([100, 1450, 1450])
    expect(allocateBudget([10, 20], 1000)).toEqual([10, 20])
    expect(allocateBudget([], 1000)).toEqual([])
    const a = allocateBudget([9000, 1, 9000, 300], 4000)
    expect(a.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(4000)
    expect(a[1]).toBe(1)
    expect(a[3]).toBe(300)
  })

  it('numbers items C1..Cn and respects the total budget', () => {
    const items = fitContext(
      [
        { kind: 'page', label: 'Big page', url: 'https://example.com', text: 'x '.repeat(20_000) },
        { kind: 'selection', label: 'Sel', text: 'short selection' },
        { kind: 'notes', label: 'Notes', text: 'n'.repeat(30_000) }
      ],
      10_000
    )
    expect(items.map((i) => i.id)).toEqual(['C1', 'C2', 'C3'])
    expect(items[1]).toMatchObject({ text: 'short selection', truncated: false })
    expect(items[0].truncated).toBe(true)
    expect(items[2].truncated).toBe(true)
    const total = items.reduce((n, i) => n + i.text.length, 0)
    expect(total).toBeLessThanOrEqual(10_000)
    const meta = contextMeta(items)
    expect(meta[0]).not.toHaveProperty('text')
    expect(meta[0].chars).toBe(items[0].text.length)
    expect(meta[2].originalChars).toBe(30_000)
  })

  it('renders a delimited block that labels context as data', () => {
    const block = renderContextBlock(fitContext([{ kind: 'page', label: 'Example Domain', url: 'https://example.com/', text: 'Hello world' }]))
    expect(block).toContain('not instructions')
    expect(block).toContain('[C1] Current page: Example Domain <https://example.com/>')
    expect(block).toContain('<<<\nHello world\n>>>')
    expect(renderContextBlock([])).toBe('')
  })

  it('shows a note for items without content', () => {
    const block = renderContextBlock(fitContext([{ kind: 'tab', label: 'Sleeping', url: 'https://a.test', text: '', note: 'tab is sleeping' }]))
    expect(block).toContain('(tab is sleeping)')
  })
})
