import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { bookmarkDropIndex, fillDays, isLoopbackUrl } from '../../src/renderer/src/pages/pageLogic'

describe('bookmarkDropIndex', () => {
  // Folder F sits between bookmarks in stored order; the page lists it first.
  const all = [
    { id: 'root', parentId: null, sort: 0 },
    { id: 'A', parentId: 'root', sort: 0 },
    { id: 'B', parentId: 'root', sort: 1 },
    { id: 'F', parentId: 'root', sort: 2 },
    { id: 'C', parentId: 'root', sort: 3 },
    { id: 'X', parentId: 'other', sort: 0 },
    { id: 'Y', parentId: 'other', sort: 1 }
  ]
  it('uses the stored sibling position, not the folders-first row index', () => {
    // Displayed: F, A, B, C — A is row 1 but sibling 0.
    expect(bookmarkDropIndex(all, 'A')).toBe(0)
    expect(bookmarkDropIndex(all, 'C')).toBe(3)
  })
  it('works for targets in other folders (search results)', () => {
    expect(bookmarkDropIndex(all, 'Y')).toBe(1)
  })
  it('does not depend on array order', () => {
    expect(bookmarkDropIndex([...all].reverse(), 'B')).toBe(1)
  })
  it('appends when the target is unknown', () => {
    expect(bookmarkDropIndex(all, 'nope')).toBe(9999)
  })
})

describe('isLoopbackUrl', () => {
  it('accepts loopback hosts', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true)
    expect(isLoopbackUrl('http://localhost:11434/')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:11434/api')).toBe(true)
    expect(isLoopbackUrl('https://localhost')).toBe(true)
  })
  it('rejects remote hosts that merely start with a loopback name', () => {
    expect(isLoopbackUrl('http://localhost.evil.com')).toBe(false)
    expect(isLoopbackUrl('http://127.0.0.1.nip.io:11434')).toBe(false)
    expect(isLoopbackUrl('http://localhost:11434@evil.com')).toBe(false)
    expect(isLoopbackUrl('http://192.168.1.5:11434')).toBe(false)
  })
})

describe('fillDays', () => {
  it('returns every day oldest-first with zero rows for gaps', () => {
    const now = new Date(2026, 2, 3, 15) // 3 March 2026, local
    const rows = [
      { day: '2026-03-01', visits: 4 },
      { day: '2026-03-03', visits: 2 }
    ]
    const out = fillDays(rows, 5, (day) => ({ day, visits: 0 }), now)
    expect(out.map((d) => d.day)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03'])
    expect(out.map((d) => d.visits)).toEqual([0, 0, 4, 0, 2])
  })
  it('drops rows older than the window', () => {
    const now = new Date(2026, 0, 2, 9)
    expect(fillDays([{ day: '2025-12-01', visits: 9 }], 2, (day) => ({ day, visits: 0 }), now).map((d) => d.visits)).toEqual([0, 0])
  })
})
