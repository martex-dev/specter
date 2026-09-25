import { describe, expect, it } from 'vitest'
import { detectPageKind, displayUrl, hostname, internalRoute, interpretInput, parseScope, toUrl } from '@shared/url'

describe('toUrl', () => {
  it('recognises plain domains', () => {
    expect(toUrl('youtube.com')).toBe('https://youtube.com')
    expect(toUrl('github.com/electron/electron')).toBe('https://github.com/electron/electron')
    expect(toUrl('sub.example.co.uk')).toBe('https://sub.example.co.uk')
  })
  it('keeps explicit schemes', () => {
    expect(toUrl('http://example.com')).toBe('http://example.com')
    expect(toUrl('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d')
    expect(toUrl('file:///C:/x.html')).toBe('file:///C:/x.html')
    expect(toUrl('about:blank')).toBe('about:blank')
  })
  it('handles localhost, IPs and ports', () => {
    expect(toUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(toUrl('127.0.0.1')).toBe('http://127.0.0.1')
    expect(toUrl('192.168.1.10:8080/api')).toBe('http://192.168.1.10:8080/api')
    expect(toUrl('myhost.internal:8443')).toBe('https://myhost.internal:8443')
  })
  it('treats search-like input as search', () => {
    expect(toUrl('best pytorch tutorials')).toBeNull()
    expect(toUrl('node.js')).toBeNull()
    expect(toUrl('file.txt')).toBeNull()
    expect(toUrl('hello')).toBeNull()
    expect(toUrl('3.14')).toBeNull()
  })
  it('handles Windows paths', () => {
    expect(toUrl('C:\\Users\\me\\a.html')).toBe('file:///C:/Users/me/a.html')
  })
  it('keeps internal pages', () => {
    expect(toUrl('specter://settings')).toBe('specter://settings')
  })
})

describe('scopes', () => {
  it('parses @ scopes and shorthands', () => {
    expect(parseScope('@tabs BTC')).toEqual({ scope: 'tabs', query: 'BTC' })
    expect(parseScope('@history github')).toEqual({ scope: 'history', query: 'github' })
    expect(parseScope('@workspace trading')).toEqual({ scope: 'workspace', query: 'trading' })
    expect(parseScope('@command screenshot')).toEqual({ scope: 'command', query: 'screenshot' })
    expect(parseScope('> reload')).toEqual({ scope: 'command', query: 'reload' })
    expect(parseScope('@ai explain this')).toEqual({ scope: 'ai', query: 'explain this' })
    expect(parseScope('$BTC')).toEqual({ scope: 'market', query: 'BTC' })
  })
  it('does not treat normal text or emails as scopes', () => {
    expect(parseScope('@tabsfoo')).toBeNull()
    expect(parseScope('costs $5')).toBeNull()
    expect(parseScope('user@example.com')).toBeNull()
  })
  it('interprets full input', () => {
    expect(interpretInput('youtube.com')).toEqual({ kind: 'url', url: 'https://youtube.com' })
    expect(interpretInput('best pytorch tutorials')).toEqual({ kind: 'search', query: 'best pytorch tutorials' })
    expect(interpretInput('@tabs BTC')).toEqual({ kind: 'scoped', scope: 'tabs', query: 'BTC' })
  })
})

describe('helpers', () => {
  it('routes internal pages', () => {
    const r = internalRoute('specter://settings/privacy?x=1')
    expect(r.page).toBe('settings')
    expect(r.sub).toBe('privacy')
    expect(r.query.get('x')).toBe('1')
    expect(internalRoute('specter://').page).toBe('newtab')
  })
  it('formats display URLs', () => {
    expect(displayUrl('https://www.example.com/')).toBe('example.com')
    expect(displayUrl('https://example.com/a/b?c=1')).toBe('example.com/a/b?c=1')
    expect(displayUrl('specter://newtab')).toBe('')
  })
  it('extracts hostnames', () => {
    expect(hostname('https://www.github.com/x')).toBe('github.com')
    expect(hostname('not a url')).toBe('')
  })
  it('detects page kinds', () => {
    expect(detectPageKind('https://github.com/electron/electron')).toBe('github-repo')
    expect(detectPageKind('https://github.com/settings/profile')).toBe('github')
    expect(detectPageKind('https://arxiv.org/abs/1706.03762')).toBe('paper')
    expect(detectPageKind('https://www.youtube.com/watch?v=abc')).toBe('video')
    expect(detectPageKind('https://www.coingecko.com/en/coins/bitcoin')).toBe('finance')
    expect(detectPageKind('https://developer.mozilla.org/en-US/docs/Web')).toBe('docs')
    expect(detectPageKind('https://example.com/paper.pdf')).toBe('pdf')
    expect(detectPageKind('https://example.com')).toBe('generic')
  })
})
