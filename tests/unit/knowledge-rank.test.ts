import { describe, expect, it } from 'vitest'
import { cosine, formatCitation, formatCitationList, formatPublished, hybridRank, noteToMarkdown, topKCosine } from '@shared/modules/knowledge'

const accessed = new Date(2026, 8, 25, 12, 0, 0).getTime() // September 25, 2026 (local)

describe('citations', () => {
  it('formats a web page without author or date (APA 7: title first, n.d.)', () => {
    const c = formatCitation({ url: 'https://en.wikipedia.org/wiki/Web_browser', title: 'Web browser', siteName: 'Wikipedia', accessedAt: accessed })
    expect(c).toBe('Web browser. (n.d.). Wikipedia. Retrieved September 25, 2026, from https://en.wikipedia.org/wiki/Web_browser')
  })

  it('puts the author first and formats the published date', () => {
    const c = formatCitation({ url: 'https://example.com/a', title: 'How engines work?', author: 'By Jane Doe', published: '2024-03-05', accessedAt: accessed })
    expect(c).toBe('Jane Doe. (2024, March 5). How engines work? example.com. Retrieved September 25, 2026, from https://example.com/a')
  })

  it('falls back to the hostname for the site and the URL for the title', () => {
    const c = formatCitation({ url: 'https://www.example.org/x', title: '', accessedAt: accessed })
    expect(c.startsWith('https://www.example.org/x. (n.d.). example.org. Retrieved')).toBe(true)
  })

  it('formats partial dates', () => {
    expect(formatPublished('2021')).toBe('2021')
    expect(formatPublished('2021-07')).toBe('2021, July')
    expect(formatPublished('2021-07-09T10:00:00Z')).toBe('2021, July 9')
    expect(formatPublished('')).toBe('n.d.')
    expect(formatPublished('Spring 2020')).toBe('Spring 2020')
  })

  it('sorts the reference list alphabetically and skips url-less sources', () => {
    const list = formatCitationList([
      { url: 'https://b.com', title: 'Zeta', accessedAt: accessed },
      { url: 'https://a.com', title: 'alpha', accessedAt: accessed },
      { url: '', title: 'No url', accessedAt: accessed }
    ])
    expect(list).toHaveLength(2)
    expect(list[0].startsWith('alpha.')).toBe(true)
  })
})

describe('cosine similarity', () => {
  it('computes cosine for vectors', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1)
    expect(cosine(new Float32Array([3, 4]), new Float32Array([6, 8]))).toBeCloseTo(1)
    expect(cosine([0, 0], [1, 1])).toBe(0)
    expect(cosine([], [])).toBe(0)
  })

  it('returns top-k by similarity', () => {
    const top = topKCosine([1, 0], [
      { id: 1, vec: [0, 1] },
      { id: 2, vec: [1, 0.1] },
      { id: 3, vec: [1, 1] }
    ], 2)
    expect(top.map((t) => t.id)).toEqual([2, 3])
  })
})

describe('hybrid ranking', () => {
  it('is pure keyword ranking when there are no semantic scores', () => {
    const r = hybridRank({ keyword: [{ id: 1, bm25: -2 }, { id: 2, bm25: -8 }, { id: 3, bm25: -5 }], semantic: [] })
    expect(r.map((x) => x.id)).toEqual([2, 3, 1])
    expect(r[0].score).toBeCloseTo(1)
    expect(r.every((x) => x.semantic === 0 && x.score > 0)).toBe(true)
  })

  it('combines keyword and semantic evidence', () => {
    const r = hybridRank(
      {
        keyword: [{ id: 1, bm25: -9 }, { id: 2, bm25: -3 }],
        semantic: [{ id: 2, cos: 0.9 }, { id: 3, cos: 0.8 }, { id: 4, cos: 0.2 }]
      },
      0.5,
      0.35
    )
    const ids = r.map((x) => x.id)
    // 4 is below the similarity floor and has no keyword match → dropped.
    expect(ids).not.toContain(4)
    // 2 matches both ways and beats the keyword-only best hit.
    expect(ids[0]).toBe(2)
    expect(ids).toContain(3)
    const two = r.find((x) => x.id === 2)!
    expect(two.keyword).toBeGreaterThan(0)
    expect(two.semantic).toBeGreaterThan(0)
    // Semantic-only hit has no keyword component.
    expect(r.find((x) => x.id === 3)!.keyword).toBe(0)
  })

  it('weights semantic evidence with alpha', () => {
    const input = { keyword: [{ id: 1, bm25: -5 }], semantic: [{ id: 2, cos: 0.95 }] }
    expect(hybridRank(input, 0.2)[0].id).toBe(1)
    expect(hybridRank(input, 0.9)[0].id).toBe(2)
  })
})

describe('markdown export', () => {
  it('writes YAML front matter', () => {
    const md = noteToMarkdown({ title: 'A "quoted" title', body: 'Body\n\n', tags: ['x', 'y'], createdAt: 0, updatedAt: 0, sourceUrl: 'https://e.com' })
    expect(md).toBe('---\ntitle: "A \\"quoted\\" title"\ntags: ["x", "y"]\nsource: "https://e.com"\ncreated: 1970-01-01T00:00:00.000Z\nupdated: 1970-01-01T00:00:00.000Z\n---\nBody\n')
  })
})
