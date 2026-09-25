import { describe, expect, it } from 'vitest'
import {
  actionsMayEmit,
  commandAllowed,
  evalCondition,
  evalConditions,
  interpolate,
  LoopGuard,
  nextDaily,
  nextRunAt,
  ruleMatches,
  triggerMatches,
  urlMatches,
  validateAction,
  validateRule
} from '../../src/main/modules/automation/engine'

describe('trigger matching', () => {
  it('matches event names', () => {
    expect(triggerMatches({ type: 'event', event: 'TAB_CREATED' }, 'TAB_CREATED', { url: 'https://a.com' })).toBe(true)
    expect(triggerMatches({ type: 'event', event: 'TAB_CREATED' }, 'TAB_CLOSED', { url: 'https://a.com' })).toBe(false)
    expect(triggerMatches({ type: 'interval', minutes: 5 }, 'TAB_CREATED', {})).toBe(false)
  })

  it('filters url events by host, glob and substring', () => {
    expect(urlMatches('https://github.com/x', 'github.com')).toBe(true)
    expect(urlMatches('https://gist.github.com/x', 'github.com')).toBe(true)
    expect(urlMatches('https://www.github.com/x', 'github.com')).toBe(true)
    expect(urlMatches('https://notgithub.com/x', 'github.com')).toBe(false)
    expect(urlMatches('https://github.com/a/b/pulls', 'https://github.com/*/pulls*')).toBe(true)
    expect(urlMatches('https://github.com/a/b/issues', 'https://github.com/*/pulls*')).toBe(false)
    expect(urlMatches('https://example.com/watch?v=1', 'watch?v=')).toBe(true)
    expect(urlMatches(undefined, 'github.com')).toBe(false)
    expect(urlMatches('anything', '')).toBe(true)
    expect(triggerMatches({ type: 'event', event: 'PAGE_LOADED', match: 'youtube.com' }, 'PAGE_LOADED', { url: 'https://www.youtube.com/watch' })).toBe(true)
    expect(triggerMatches({ type: 'event', event: 'PAGE_LOADED', match: 'youtube.com' }, 'PAGE_LOADED', { url: 'https://vimeo.com' })).toBe(false)
  })
})

describe('conditions', () => {
  const payload = { mode: 'ML', nested: { name: 'Development' }, symbols: ['BTC', 'ETH'] }
  it('evaluates operators case-insensitively', () => {
    expect(evalCondition({ field: 'mode', op: 'equals', value: 'ml' }, payload)).toBe(true)
    expect(evalCondition({ field: 'mode', op: 'notEquals', value: 'ml' }, payload)).toBe(false)
    expect(evalCondition({ field: 'nested.name', op: 'contains', value: 'velop' }, payload)).toBe(true)
    expect(evalCondition({ field: 'nested.name', op: 'notContains', value: 'x' }, payload)).toBe(true)
    expect(evalCondition({ field: 'nested.name', op: 'startsWith', value: 'dev' }, payload)).toBe(true)
    expect(evalCondition({ field: 'nested.name', op: 'endsWith', value: 'ment' }, payload)).toBe(true)
    expect(evalCondition({ field: 'symbols', op: 'contains', value: 'eth' }, payload)).toBe(true)
    expect(evalCondition({ field: 'missing', op: 'equals', value: '' }, payload)).toBe(true)
  })
  it('requires all conditions', () => {
    expect(evalConditions([], payload)).toBe(true)
    expect(evalConditions([{ field: 'mode', op: 'equals', value: 'ml' }, { field: 'nested.name', op: 'equals', value: 'x' }], payload)).toBe(false)
  })
  it('combines trigger, conditions and enabled', () => {
    const rule = { enabled: true, trigger: { type: 'event' as const, event: 'SYSTEM_MODE_CHANGED' }, conditions: [{ field: 'mode', op: 'equals' as const, value: 'ml' }] }
    expect(ruleMatches(rule, 'SYSTEM_MODE_CHANGED', { mode: 'ml' })).toBe(true)
    expect(ruleMatches(rule, 'SYSTEM_MODE_CHANGED', { mode: 'normal' })).toBe(false)
    expect(ruleMatches({ ...rule, enabled: false }, 'SYSTEM_MODE_CHANGED', { mode: 'ml' })).toBe(false)
  })
  it('interpolates placeholders', () => {
    expect(interpolate('Opened {{url}} ({{settings.user}}) {{ missing }}', { url: 'https://a', settings: { user: 'me' } })).toBe('Opened https://a (me) ')
  })
})

describe('schedules', () => {
  it('computes the next daily run in local time', () => {
    const from = new Date(2026, 0, 5, 10, 0).getTime() // Monday 10:00
    expect(nextDaily('09:30', undefined, from)).toBe(new Date(2026, 0, 6, 9, 30).getTime())
    expect(nextDaily('10:30', undefined, from)).toBe(new Date(2026, 0, 5, 10, 30).getTime())
    expect(nextDaily('10:00', undefined, from)).toBe(new Date(2026, 0, 6, 10, 0).getTime())
    // Only Saturdays (6)
    expect(nextDaily('08:00', [6], from)).toBe(new Date(2026, 0, 10, 8, 0).getTime())
    expect(nextDaily('25:00', undefined, from)).toBeNull()
  })
  it('anchors intervals at the later of last run and startup', () => {
    const start = 1_000_000
    expect(nextRunAt({ type: 'interval', minutes: 5 }, undefined, start, start)).toBe(start + 300_000)
    expect(nextRunAt({ type: 'interval', minutes: 5 }, start + 60_000, start + 60_000, start)).toBe(start + 360_000)
    // A last run long before startup never causes an immediate burst.
    expect(nextRunAt({ type: 'interval', minutes: 5 }, start - 10_000_000, start, start)).toBe(start + 300_000)
    expect(nextRunAt({ type: 'event', event: 'APP_STARTED' }, undefined, start, start)).toBeNull()
  })
})

describe('loop protection', () => {
  const opts = { maxPerRule: 3, maxGlobal: 5, windowMs: 60_000, maxDepth: 2, causalMs: 1000 }

  it('blocks a rule from being re-triggered by its own side effects', () => {
    const g = new LoopGuard(opts)
    expect(g.check('r1', 'TAB_CREATED', 0)).toEqual({ ok: true, depth: 0 })
    g.begin('r1', 0, actionsMayEmit([{ type: 'openUrl', url: 'https://a.com' }]), 0)
    g.end('r1', 10)
    const v = g.check('r1', 'TAB_CREATED', 20)
    expect(v.ok).toBe(false)
    // After the causal window the same event is independent again.
    expect(g.check('r1', 'TAB_CREATED', 2000).ok).toBe(true)
  })

  it('does not attribute unrelated events', () => {
    const g = new LoopGuard(opts)
    g.begin('notify', 0, actionsMayEmit([{ type: 'notify', title: 'x' }]), 0)
    g.end('notify', 5)
    expect(g.check('notify', 'TAB_CREATED', 10)).toEqual({ ok: true, depth: 0 })
  })

  it('limits chain depth across rules', () => {
    const g = new LoopGuard(opts)
    const emits = actionsMayEmit([{ type: 'command', command: 'browser.newTab' }])
    g.begin('a', 0, emits, 0)
    const b = g.check('b', 'X', 1)
    expect(b).toEqual({ ok: true, depth: 1 })
    g.begin('b', 1, emits, 1)
    const c = g.check('c', 'X', 2)
    expect(c).toEqual({ ok: true, depth: 2 })
    g.begin('c', 2, emits, 2)
    const d = g.check('d', 'X', 3)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/depth/)
  })

  it('rate limits per rule and globally, but not manual runs', () => {
    const g = new LoopGuard(opts)
    for (let i = 0; i < 3; i++) {
      expect(g.check('r', null, i * 10).ok).toBe(true)
      g.begin('r', 0, [], i * 10)
      g.end('r', i * 10 + 1)
    }
    const v = g.check('r', null, 100)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/Rate limited/)
    expect(g.check('r', null, 100, { manual: true }).ok).toBe(true)
    g.begin('x', 0, [], 200)
    g.end('x', 201)
    g.begin('y', 0, [], 202)
    g.end('y', 203)
    const glob = g.check('z', null, 300)
    expect(glob.ok).toBe(false)
    // Limits reset once the window has passed.
    expect(g.check('r', null, 61_000).ok).toBe(true)
    expect(g.check('z', null, 61_000).ok).toBe(true)
  })

  it('refuses concurrent runs of the same rule', () => {
    const g = new LoopGuard(opts)
    g.begin('slow', 0, [], 0)
    const v = g.check('slow', null, 5000, { manual: true })
    expect(v.ok).toBe(false)
  })
})

describe('validation', () => {
  it('accepts the safe action types', () => {
    expect(validateAction({ type: 'openUrl', url: 'https://example.com' })).toBeNull()
    expect(validateAction({ type: 'openUrl', url: 'specter://cockpit' })).toBeNull()
    expect(validateAction({ type: 'notify', title: 'Hi', body: '{{url}}' })).toBeNull()
    expect(validateAction({ type: 'setting', key: 'research.indexPages', value: false })).toBeNull()
    expect(validateAction({ type: 'performanceMode', mode: 'ml' })).toBeNull()
    expect(validateAction({ type: 'wait', seconds: 2 })).toBeNull()
    expect(validateAction({ type: 'sidePanel', panel: 'media', popout: true })).toBeNull()
    expect(validateAction({ type: 'workspace', workspace: 'Development' })).toBeNull()
    expect(validateAction({ type: 'command', command: 'browser.newTab' })).toBeNull()
  })
  it('rejects destructive or unsafe actions', () => {
    expect(validateAction({ type: 'openUrl', url: 'file:///C:/x' })).not.toBeNull()
    expect(validateAction({ type: 'openUrl', url: 'javascript:alert(1)' })).not.toBeNull()
    expect(validateAction({ type: 'setting', key: 'privacy.blockTrackers', value: false })).not.toBeNull()
    expect(validateAction({ type: 'command', command: 'app.quit' })).not.toBeNull()
    expect(validateAction({ type: 'command', command: 'tabs.closeOthers' })).not.toBeNull()
    expect(validateAction({ type: 'command', command: 'plugin.x.y' })).not.toBeNull()
    expect(validateAction({ type: 'shell', command: 'rm -rf /' })).not.toBeNull()
    expect(validateAction({ type: 'wait', seconds: 3600 })).not.toBeNull()
    expect(validateAction({ type: 'notify', title: 'x', extra: 1 })).not.toBeNull()
    expect(commandAllowed('automation.openWorkspace')).toBe(true)
    expect(commandAllowed('automation.new')).toBe(false)
  })
  it('validates whole rules', () => {
    const ok = { name: 'x', enabled: true, trigger: { type: 'event', event: 'TAB_CREATED' }, conditions: [], actions: [{ type: 'notify', title: 'Tab' }] }
    expect(validateRule(ok)).toBeNull()
    expect(validateRule({ ...ok, actions: [] })).toMatch(/at least one/)
    expect(validateRule({ ...ok, trigger: { type: 'event', event: 'NOPE' } })).toMatch(/Unknown event/)
    expect(validateRule({ ...ok, trigger: { type: 'daily', time: '7:5' } })).toMatch(/HH:MM/)
    expect(validateRule({ ...ok, trigger: { type: 'interval', minutes: 0 } })).toMatch(/Interval/)
    expect(validateRule({ ...ok, conditions: [{ field: 'url', op: 'regex', value: '.*' }] })).toMatch(/operator/)
  })
})
