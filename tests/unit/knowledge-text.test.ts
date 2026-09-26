import { describe, expect, it } from 'vitest'
import { chunkText, excerptOf, ftsMatch, linkContext, normalizeText, parseTags, parseWikiLinks, replaceWikiLinks, safeFileName } from '@shared/modules/knowledge'

describe('chunkText', () => {
  it('returns nothing for empty text and one chunk for short text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  ')).toEqual([])
    expect(chunkText('Hello world.')).toEqual(['Hello world.'])
  })

  it('splits long text into ~size chunks that overlap', () => {
    const sentences = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} talks about browsers and engines.`)
    const text = sentences.join(' ')
    const chunks = chunkText(text, 800, 150)
    expect(chunks.length).toBeGreaterThan(5)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800)
    // All but the last chunk are reasonably full.
    for (const c of chunks.slice(0, -1)) expect(c.length).toBeGreaterThan(400)
    // Consecutive chunks share text (overlap).
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1].slice(-60)
      const word = tail.split(' ').filter((w) => w.length > 3)[1]
      expect(chunks[i].includes(word)).toBe(true)
    }
    // Every sentence survives in at least one chunk.
    for (const s of sentences) expect(chunks.some((c) => c.includes(s))).toBe(true)
  })

  it('prefers sentence / paragraph boundaries', () => {
    const para = 'A'.repeat(500) + '. ' + 'B'.repeat(200) + '.\n\n' + 'C'.repeat(600) + '.'
    const chunks = chunkText(para, 800, 100)
    expect(chunks[0].endsWith('.')).toBe(true)
  })

  it('terminates on text without any spaces', () => {
    const chunks = chunkText('x'.repeat(5000), 800, 150)
    expect(chunks.length).toBeGreaterThanOrEqual(6)
    expect(chunks.join('').length).toBeGreaterThanOrEqual(5000)
  })

  it('normalizes whitespace', () => {
    expect(normalizeText('  a \t b\r\n\r\n\r\n\r\nc  ')).toBe('a b\n\nc')
  })
})

describe('wiki links', () => {
  it('parses [[Title]] and [[Title|alias]], unique and trimmed', () => {
    const md = 'See [[Web browser]] and [[ web   browser ]] plus [[Rendering engine|engines]].\nAlso [[Chromium]].'
    expect(parseWikiLinks(md)).toEqual(['Web browser', 'Rendering engine', 'Chromium'])
  })

  it('ignores links inside code', () => {
    const md = 'Real [[One]]\n\n```\n[[Not a link]]\n```\nand `[[Inline]]` but [[Two]]'
    expect(parseWikiLinks(md)).toEqual(['One', 'Two'])
  })

  it('does not treat nested or empty brackets as links', () => {
    expect(parseWikiLinks('[[]] [[a\nb]] [x](y)')).toEqual([])
  })

  it('replaces links outside code with rendered output', () => {
    const out = replaceWikiLinks('a [[X|label]] `[[Y]]`', (t, l) => `<${t}:${l}>`)
    expect(out).toBe('a <X:label> `[[Y]]`')
  })

  it('gives backlink context for the referencing line', () => {
    const md = '# Intro\n- Browsers use a [[Rendering engine|engine]] to draw pages\nOther line'
    expect(linkContext(md, 'rendering ENGINE')).toBe('Browsers use a engine to draw pages')
    expect(linkContext(md, 'missing')).toBe('')
    expect(linkContext('A **web browser** uses [[Engine]] and [x](http://y)', 'engine')).toBe('A web browser uses Engine and x')
  })

  it('makes plain excerpts', () => {
    expect(excerptOf('# Title\n\nSome **bold** [link](http://x) and [[Note|alias]].')).toBe('Title Some bold link and alias.')
  })

  it('parses tags', () => {
    expect(parseTags('#Research, ai  ml,ai')).toEqual(['research', 'ai', 'ml'])
  })
})

describe('ftsMatch', () => {
  it('quotes tokens and prefixes the last one', () => {
    expect(ftsMatch('web browser')).toBe('"web" "browser"*')
    expect(ftsMatch('web browser', true)).toBe('"web" OR "browser"*')
    expect(ftsMatch('how do programs show websites to people', true)).toBe('"programs" OR "show" OR "websites" OR "people"*')
    expect(ftsMatch('to be', true)).toBe('"to" OR "be"*')
  })
  it('strips FTS syntax characters', () => {
    expect(ftsMatch('"a" OR b*')).toBe('"a" "OR" "b"*')
    expect(ftsMatch('  ')).toBe('')
  })
})

describe('safeFileName', () => {
  it('replaces illegal characters and falls back to Untitled', () => {
    expect(safeFileName('a/b:c*?')).toBe('a_b_c__')
    expect(safeFileName('')).toBe('Untitled')
    expect(safeFileName('   ')).toBe('Untitled')
  })
  it('avoids Windows reserved device names', () => {
    expect(safeFileName('CON')).toBe('_CON')
    expect(safeFileName('nul')).toBe('_nul')
    expect(safeFileName('Com1')).toBe('_Com1')
    expect(safeFileName('LPT9.txt')).toBe('_LPT9.txt')
    expect(safeFileName('Console')).toBe('Console')
    expect(safeFileName('Auxiliary notes')).toBe('Auxiliary notes')
  })
  it('drops trailing dots and spaces', () => {
    expect(safeFileName('Notes...')).toBe('Notes')
    expect(safeFileName('...')).toBe('Untitled')
    expect(safeFileName('x'.repeat(200) + '.', 10)).toBe('x'.repeat(10))
  })
})
