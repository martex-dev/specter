import { describe, expect, it } from 'vitest'
import {
  SpeedMemory,
  clampSpeed,
  formatSpeed,
  isTypingTarget,
  parseVideoKey,
  rateChangeDecision,
  resetSpeed,
  resolveVideoKeys,
  siteKey,
  speedFor,
  stepSpeed,
  togglePreferred,
  videoActionFor,
  videoKeyMap
} from '@shared/video'

describe('speed stepping', () => {
  it('steps by 0.1 without floating-point drift', () => {
    expect(stepSpeed(1, 1)).toBe(1.1)
    expect(stepSpeed(1.1, 1)).toBe(1.2)
    expect(stepSpeed(0.2, 1)).toBe(0.3)
    expect(stepSpeed(1, -1)).toBe(0.9)
    expect(stepSpeed(1.25, 1)).toBe(1.35)
  })
  it('clamps to 0.07×–16×', () => {
    expect(stepSpeed(0.1, -1)).toBe(0.07)
    expect(stepSpeed(0.07, -1)).toBe(0.07)
    expect(stepSpeed(16, 1)).toBe(16)
    expect(stepSpeed(15.95, 1)).toBe(16)
    expect(clampSpeed(100)).toBe(16)
    expect(clampSpeed(0)).toBe(0.07)
    expect(clampSpeed(NaN)).toBe(1)
    expect(clampSpeed(Infinity)).toBe(1)
  })
  it('goes from the minimum up onto the step grid', () => {
    expect(stepSpeed(0.07, 1)).toBe(0.1)
  })
  it('honours a custom step and ignores nonsense ones', () => {
    expect(stepSpeed(1, 1, 0.25)).toBe(1.25)
    expect(stepSpeed(1, 1, 0)).toBe(1.1)
    expect(stepSpeed(1, 1, -3)).toBe(1.1)
  })
  it('treats an unusable current rate as 1×', () => {
    expect(stepSpeed(NaN, 1)).toBe(1.1)
    expect(stepSpeed(0, -1)).toBe(0.9)
  })
})

describe('reset and preferred speed', () => {
  it('R resets to 1×, and at 1× returns to the last speed', () => {
    expect(resetSpeed(1.8, 1.8)).toBe(1)
    expect(resetSpeed(1, 1.8)).toBe(1.8)
    expect(resetSpeed(1, null)).toBe(1)
    expect(resetSpeed(1, 1)).toBe(1)
  })
  it('G toggles between 1× and the preferred speed', () => {
    expect(togglePreferred(1, 1.8)).toBe(1.8)
    expect(togglePreferred(1.8, 1.8)).toBe(1)
    expect(togglePreferred(1.5, 1.8)).toBe(1.8)
    expect(togglePreferred(1, 99)).toBe(16)
  })
  it('maps actions to speeds; seeking actions have none', () => {
    const o = { preferred: 2, last: null }
    expect(speedFor('faster', 1, o)).toBe(1.1)
    expect(speedFor('slower', 1, o)).toBe(0.9)
    expect(speedFor('reset', 3, o)).toBe(1)
    expect(speedFor('preferred', 1, o)).toBe(2)
    expect(speedFor('rewind', 1, o)).toBeNull()
    expect(speedFor('advance', 1, o)).toBeNull()
  })
  it('formats speeds compactly', () => {
    expect(formatSpeed(1)).toBe('1×')
    expect(formatSpeed(1.5)).toBe('1.5×')
    expect(formatSpeed(0.07)).toBe('0.07×')
    expect(formatSpeed(1.2000000000000002)).toBe('1.2×')
  })
})

describe('key bindings', () => {
  it('parses user-entered keys', () => {
    expect(parseVideoKey('s')).toBe('S')
    expect(parseVideoKey(' d ')).toBe('D')
    expect(parseVideoKey('shift+d')).toBe('Shift+D')
    expect(parseVideoKey('ArrowLeft')).toBe('Left')
    expect(parseVideoKey('')).toBeNull()
    expect(parseVideoKey(undefined)).toBeNull()
    expect(parseVideoKey('Shift')).toBeNull()
    expect(parseVideoKey('Ctrl+')).toBeNull()
  })
  it('uses the Video Speed Controller defaults', () => {
    expect(resolveVideoKeys()).toEqual({ slower: 'S', faster: 'D', reset: 'R', rewind: 'Z', advance: 'X', preferred: 'G' })
  })
  it('applies overrides; an empty key turns an action off', () => {
    const keys = resolveVideoKeys({ faster: 'shift+.', rewind: '' })
    expect(keys.faster).toBe('Shift+.')
    expect(keys.rewind).toBeNull()
    const map = videoKeyMap({ faster: 'shift+.', rewind: '' })
    expect(map.get('Shift+.')).toBe('faster')
    expect(map.has('D')).toBe(false)
    expect(map.has('Z')).toBe(false)
  })
  it('keeps the first action when two share a key', () => {
    const map = videoKeyMap({ faster: 'S' })
    expect(map.get('S')).toBe('slower')
    expect([...map.values()]).not.toContain('faster')
  })
  it('matches key events, including modifiers and non-Latin layouts', () => {
    const map = videoKeyMap()
    expect(videoActionFor({ key: 's', code: 'KeyS' }, map)).toBe('slower')
    expect(videoActionFor({ key: 'D', code: 'KeyD', shift: true }, map)).toBeNull()
    expect(videoActionFor({ key: 'd', code: 'KeyD', ctrl: true }, map)).toBeNull()
    // Bulgarian / Russian layouts: the physical S key types "с" / "ы".
    expect(videoActionFor({ key: 'с', code: 'KeyS' }, map)).toBe('slower')
    expect(videoActionFor({ key: 'в', code: 'KeyD' }, map)).toBe('faster')
    expect(videoActionFor({ key: 'Shift', code: 'ShiftLeft', shift: true }, map)).toBeNull()
    expect(videoActionFor({ key: 'q', code: 'KeyQ' }, map)).toBeNull()
  })
})

describe('typing targets', () => {
  it('treats text fields and editors as typing', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTypingTarget({ tagName: 'input', type: '' })).toBe(true)
    expect(isTypingTarget({ tagName: 'INPUT', type: 'search' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', role: 'textbox' })).toBe(true)
  })
  it('leaves buttons, sliders and plain elements alone', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'range' })).toBe(false)
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget({ tagName: 'VIDEO' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('keeping the speed', () => {
  it('restores the chosen speed when the site resets it without user input', () => {
    expect(rateChangeDecision({ desired: 2, actual: 1, ours: false, msSinceUserInput: 60_000 })).toBe('restore')
  })
  it('adopts a change the user just made with the site’s own control', () => {
    expect(rateChangeDecision({ desired: 2, actual: 1.25, ours: false, msSinceUserInput: 200 })).toBe('adopt')
    expect(rateChangeDecision({ desired: null, actual: 1.25, ours: false, msSinceUserInput: 200 })).toBe('adopt')
  })
  it('ignores its own changes, matching rates, and sites adjusting speed when no speed was chosen', () => {
    expect(rateChangeDecision({ desired: 2, actual: 1, ours: true, msSinceUserInput: 60_000 })).toBe('ignore')
    expect(rateChangeDecision({ desired: 2, actual: 2, ours: false, msSinceUserInput: 60_000 })).toBe('ignore')
    expect(rateChangeDecision({ desired: null, actual: 1.05, ours: false, msSinceUserInput: 60_000 })).toBe('ignore')
    expect(rateChangeDecision({ desired: 2, actual: NaN, ours: false, msSinceUserInput: 60_000 })).toBe('ignore')
  })
})

describe('per-site memory', () => {
  it('keys speeds by host without www', () => {
    expect(siteKey('https://www.youtube.com/watch?v=x')).toBe('youtube.com')
    expect(siteKey('https://music.youtube.com/')).toBe('music.youtube.com')
    expect(siteKey('http://test.localhost:8080/a')).toBe('test.localhost')
    expect(siteKey('HTTPS://Example.COM')).toBe('example.com')
    expect(siteKey('file:///C:/video.mp4')).toBeNull()
    expect(siteKey('specter://settings')).toBeNull()
    expect(siteKey('not a url')).toBeNull()
  })
  it('remembers, updates and forgets speeds; 1× is not stored', () => {
    const m = new SpeedMemory()
    expect(m.set('youtube.com', 1.75, 1).changed).toBe(true)
    expect(m.get('youtube.com')).toBe(1.75)
    expect(m.set('youtube.com', 1.75, 2).changed).toBe(false)
    expect(m.set('youtube.com', 2, 3).changed).toBe(true)
    expect(m.set('youtube.com', 1, 4).changed).toBe(true)
    expect(m.get('youtube.com')).toBeNull()
    expect(m.set('vimeo.com', 1, 5).changed).toBe(false)
    expect(m.set(null, 2).changed).toBe(false)
    expect(m.get(null)).toBeNull()
    m.set('a.com', 1.5, 6)
    expect(m.forget('a.com')).toBe(true)
    expect(m.forget('a.com')).toBe(false)
  })
  it('clamps stored speeds and lists the most recent first', () => {
    const m = new SpeedMemory([
      { site: 'old.com', rate: 40, updatedAt: 1 },
      { site: 'new.com', rate: 1.5, updatedAt: 9 }
    ])
    expect(m.get('old.com')).toBe(16)
    expect(m.list().map((e) => e.site)).toEqual(['new.com', 'old.com'])
  })
  it('drops the least recently changed sites beyond the cap', () => {
    const m = new SpeedMemory([], 2)
    m.set('a.com', 1.5, 1)
    m.set('b.com', 1.5, 2)
    m.set('a.com', 2, 3)
    expect(m.set('c.com', 1.5, 4).dropped).toEqual(['b.com'])
    expect(m.list().map((e) => e.site)).toEqual(['c.com', 'a.com'])
  })
})
