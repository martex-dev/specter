import { describe, expect, it } from 'vitest'
import { fuzzyBest, fuzzyFilter, fuzzyMatch } from '@shared/fuzzy'
import { bindingIndex, DEFAULT_KEYBINDINGS, eventToAccelerator, isChord, normalizeAccelerator, resolveBindings } from '@shared/keys'
import { searchUrl, DEFAULT_SETTINGS } from '@shared/settings'

describe('fuzzy', () => {
  it('ranks prefix and contiguous matches higher', () => {
    const a = fuzzyMatch('rel', 'Reload page')!
    const b = fuzzyMatch('rel', 'Reopen closed tab list')
    expect(a.score).toBeGreaterThan(b?.score ?? -Infinity)
  })
  it('matches subsequences and rejects impossible orderings', () => {
    expect(fuzzyMatch('nwt', 'New tab')).not.toBeNull()
    expect(fuzzyMatch('twn', 'New tab')).toBeNull()
  })
  it('matches word-start subsequences', () => {
    expect(fuzzyMatch('ntab', 'New tab')).not.toBeNull()
    expect(fuzzyMatch('xyz', 'New tab')).toBeNull()
  })
  it('reports positions for highlighting', () => {
    expect(fuzzyMatch('tab', 'New tab')!.positions).toEqual([4, 5, 6])
  })
  it('filters and sorts', () => {
    const items = ['Split view 50 / 50', 'Exit split view', 'Search tabs', 'Settings']
    const out = fuzzyFilter('split', items, (x) => [x])
    expect(out[0]).toBe('Split view 50 / 50')
    expect(out).toContain('Exit split view')
    expect(out).not.toContain('Settings')
  })
  it('weights earlier fields', () => {
    expect(fuzzyBest('abc', ['abc', undefined])!).toBeGreaterThan(fuzzyBest('abc', [undefined, 'abc'])!)
  })
})

describe('keys', () => {
  it('normalises accelerators', () => {
    expect(normalizeAccelerator('shift+ctrl+t')).toBe('Ctrl+Shift+T')
    expect(normalizeAccelerator('CmdOrCtrl+K')).toBe('Ctrl+K')
    expect(normalizeAccelerator('Alt+Left')).toBe('Alt+Left')
    expect(normalizeAccelerator('Ctrl++')).toBe('Ctrl+=')
  })
  it('converts events to accelerators', () => {
    expect(eventToAccelerator({ key: 'k', ctrl: true })).toBe('Ctrl+K')
    expect(eventToAccelerator({ key: 'T', control: true, shift: true })).toBe('Ctrl+Shift+T')
    expect(eventToAccelerator({ key: 'ArrowLeft', alt: true })).toBe('Alt+Left')
    expect(eventToAccelerator({ key: ' ', alt: true })).toBe('Alt+Space')
    expect(eventToAccelerator({ key: 'F12' })).toBe('F12')
    expect(eventToAccelerator({ key: 'Control', ctrl: true })).toBeNull()
  })
  it('resolves default bindings and overrides', () => {
    const b = resolveBindings({ 'palette.open': 'Ctrl+Shift+Space', 'tabs.search': '' })
    expect(b['palette.open']).toBe('Ctrl+Shift+Space')
    expect(b['tabs.search']).toBeUndefined()
    expect(b['browser.newTab']).toBe('Ctrl+T')
    const idx = bindingIndex(b)
    expect(idx.get('Ctrl+T')).toBe('browser.newTab')
  })
  it('has no duplicate default accelerators', () => {
    const accs = Object.values(resolveBindings({}))
    expect(new Set(accs).size).toBe(accs.length)
    expect(Object.keys(DEFAULT_KEYBINDINGS)).toContain('ai.toggle')
  })
  it('identifies chords', () => {
    expect(isChord('Ctrl+K')).toBe(true)
    expect(isChord('F5')).toBe(true)
    expect(isChord('Escape')).toBe(false)
  })
})

describe('search engines', () => {
  it('builds search URLs', () => {
    expect(searchUrl(DEFAULT_SETTINGS, 'hello world')).toBe('https://duckduckgo.com/?q=hello%20world')
    expect(searchUrl({ 'search.engine': 'google', 'search.customTemplate': '' }, 'a&b')).toBe('https://www.google.com/search?q=a%26b')
    expect(searchUrl({ 'search.engine': 'custom', 'search.customTemplate': 'https://x.test/?s=%s' }, 'q')).toBe('https://x.test/?s=q')
  })
})

import { compareVersions } from '../../src/main/services/updates'
describe('update version comparison', () => {
  it('compares semver-ish tags', () => {
    expect(compareVersions('v0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('1.0', '1.0.1')).toBe(-1)
    expect(compareVersions('v2.0.0-beta.1', '1.9.9')).toBe(1)
  })
})
