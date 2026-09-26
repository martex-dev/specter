import { describe, expect, it } from 'vitest'
import { FiltersEngine, Request } from '@ghostery/adblocker'
import { DEFAULT_FILTER_LISTS, FILTER_LISTS, LIST_MAX_AGE_MS, countRules, isAllowlisted, listMaxAge, listMirrors, normalizeSiteHost } from '../../src/shared/adblock'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

describe('filter list catalog', () => {
  it('has unique ids and https URLs from the list maintainers', () => {
    const ids = FILTER_LISTS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of FILTER_LISTS) for (const u of l.urls) expect(u).toMatch(/^https:\/\/(ublockorigin\.github\.io\/uAssets|pgl\.yoyo\.org)\//)
  })
  it('enables ads, privacy, malware and cookie lists by default', () => {
    expect(DEFAULT_SETTINGS['privacy.adblockLists']).toEqual(DEFAULT_FILTER_LISTS)
    expect(DEFAULT_FILTER_LISTS).toEqual(expect.arrayContaining(['easylist', 'ublock', 'easyprivacy', 'badware', 'cookies']))
    expect(DEFAULT_FILTER_LISTS).not.toContain('annoyances')
  })
})

describe('list sources', () => {
  it('falls back to the other uBlock CDN and to easylist.to', () => {
    expect(listMirrors('https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt')).toEqual([
      'https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt',
      'https://ublockorigin.pages.dev/filters/quick-fixes.min.txt'
    ])
    expect(listMirrors('https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt')).toContain('https://easylist.to/easylist/easylist.txt')
    expect(listMirrors('https://pgl.yoyo.org/x')).toEqual(['https://pgl.yoyo.org/x'])
  })
  it('refreshes each list as often as its header asks, within 4 h to 7 days', () => {
    expect(listMaxAge('[Adblock Plus 2.0]\n! Title: x\n! Expires: 12 hours\n||a^')).toBe(12 * 3600_000)
    expect(listMaxAge('! Expires: 6 days (update frequency)')).toBe(6 * 86400_000)
    expect(listMaxAge('! Expires: 1 hours')).toBe(4 * 3600_000)
    expect(listMaxAge('! Expires: 30 days')).toBe(7 * 86400_000)
    expect(listMaxAge('||ads.example^')).toBe(LIST_MAX_AGE_MS)
  })
})

describe('normalizeSiteHost', () => {
  it('reduces URLs and hosts to a bare lower-case host without www', () => {
    expect(normalizeSiteHost('https://www.Example.com/path?q=1')).toBe('example.com')
    expect(normalizeSiteHost('news.ycombinator.com')).toBe('news.ycombinator.com')
    expect(normalizeSiteHost('example.com:8080/x')).toBe('example.com')
    expect(normalizeSiteHost('  WWW.youtube.com ')).toBe('youtube.com')
  })
  it('rejects junk', () => {
    expect(normalizeSiteHost('')).toBe('')
    expect(normalizeSiteHost('not a host')).toBe('')
    expect(normalizeSiteHost('javascript:alert(1)')).toBe('')
  })
})

describe('isAllowlisted', () => {
  const list = ['example.com', 'shop.test.org']
  it('matches the site and its subdomains', () => {
    expect(isAllowlisted('example.com', list)).toBe(true)
    expect(isAllowlisted('www.example.com', list)).toBe(true)
    expect(isAllowlisted('a.b.example.com', list)).toBe(true)
    expect(isAllowlisted('shop.test.org', list)).toBe(true)
  })
  it('does not match look-alikes or parents', () => {
    expect(isAllowlisted('badexample.com', list)).toBe(false)
    expect(isAllowlisted('test.org', list)).toBe(false)
    expect(isAllowlisted('', list)).toBe(false)
    expect(isAllowlisted('example.com', [])).toBe(false)
  })
})

describe('countRules', () => {
  it('skips comments and headers but counts cosmetic rules', () => {
    const text = ['[Adblock Plus 2.0]', '! Title: test', '', '||ads.example.com^', '##.ad-banner', 'example.com##.promo', '# hosts comment', '@@||good.example.com^'].join('\n')
    expect(countRules(text)).toBe(4)
  })
})

describe('filter engine integration', () => {
  const engine = FiltersEngine.parse(['||ads.example.net^', '||tracker.example.org^$third-party', '@@||ads.example.net/allowed/*', 'news.example.com##.sponsored', 'www.example.com##.www-only'].join('\n'))
  const req = (url: string, sourceUrl: string, type = 'script') => Request.fromRawDetails({ url, sourceUrl, type: type as 'script' })

  it('blocks listed hosts and honours exceptions', () => {
    expect(engine.match(req('https://ads.example.net/ad.js', 'https://news.example.com/')).match).toBe(true)
    expect(engine.match(req('https://ads.example.net/allowed/x.js', 'https://news.example.com/')).match).toBe(false)
    expect(engine.match(req('https://cdn.example.com/app.js', 'https://news.example.com/')).match).toBe(false)
  })
  it('applies $third-party only across sites', () => {
    expect(engine.match(req('https://tracker.example.org/t.js', 'https://news.example.com/')).match).toBe(true)
    expect(engine.match(req('https://tracker.example.org/t.js', 'https://www.example.org/')).match).toBe(false)
  })
  it('returns element-hiding CSS for the matching site only', () => {
    const on = engine.getCosmeticsFilters({ url: 'https://news.example.com/', hostname: 'news.example.com', domain: 'example.com' })
    expect(on.styles).toContain('.sponsored')
    const off = engine.getCosmeticsFilters({ url: 'https://other.example.org/', hostname: 'other.example.org', domain: 'example.org' })
    expect(off.styles).not.toContain('.sponsored')
  })
  it('needs the exact host: www.* rules do not match the bare domain', () => {
    // Why services/adblock.ts must not use the shared hostname(), which drops "www.".
    expect(engine.getCosmeticsFilters({ url: 'https://www.example.com/', hostname: 'www.example.com', domain: 'example.com' }).styles).toContain('.www-only')
    expect(engine.getCosmeticsFilters({ url: 'https://example.com/', hostname: 'example.com', domain: 'example.com' }).styles).not.toContain('.www-only')
  })
  it('survives serialization (the on-disk cache)', () => {
    const copy = FiltersEngine.deserialize(engine.serialize())
    expect(copy.match(req('https://ads.example.net/ad.js', 'https://news.example.com/')).match).toBe(true)
  })
})
