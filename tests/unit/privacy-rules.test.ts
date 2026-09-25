import { describe, expect, it } from 'vitest'
import { TRACKER_DOMAINS } from '../../src/main/services/trackers'
import { isThirdParty, makeTrackerMatcher, registrableDomain } from '@shared/domains'

describe('tracker list', () => {
  it('contains well-known trackers and no paths', () => {
    expect(TRACKER_DOMAINS).toContain('doubleclick.net')
    expect(TRACKER_DOMAINS).toContain('google-analytics.com')
    expect(TRACKER_DOMAINS.every((d) => !d.includes('/'))).toBe(true)
  })
  it('has no duplicates', () => {
    expect(new Set(TRACKER_DOMAINS).size).toBe(TRACKER_DOMAINS.length)
  })
})

describe('tracker matcher', () => {
  const isTracker = makeTrackerMatcher(TRACKER_DOMAINS)
  it('matches exact and subdomains', () => {
    expect(isTracker('doubleclick.net')).toBe(true)
    expect(isTracker('stats.g.doubleclick.net')).toBe(true)
    expect(isTracker('www.google-analytics.com')).toBe(true)
  })
  it('does not match unrelated or look-alike hosts', () => {
    expect(isTracker('example.com')).toBe(false)
    expect(isTracker('notdoubleclick.net')).toBe(false)
    expect(isTracker('github.com')).toBe(false)
  })
})

describe('registrable domain approximation', () => {
  it('groups subdomains', () => {
    expect(registrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk')
    expect(registrableDomain('static.cdn.example.com')).toBe('example.com')
    expect(registrableDomain('user.github.io')).toBe('user.github.io')
    expect(registrableDomain('example.com')).toBe('example.com')
    expect(registrableDomain('Example.COM.')).toBe('example.com')
  })
  it('detects third-party relationships', () => {
    expect(isThirdParty('cdn.example.com', 'www.example.com')).toBe(false)
    expect(isThirdParty('ads.tracker.net', 'www.example.com')).toBe(true)
    expect(isThirdParty('a.github.io', 'b.github.io')).toBe(true)
    expect(isThirdParty('x.com', '')).toBe(false)
  })
})
