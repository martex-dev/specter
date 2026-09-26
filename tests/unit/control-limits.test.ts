import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTROL_CONFIG,
  heavyTabs,
  mbpsToBytesPerSec,
  mergeControlConfig,
  netEmulationFor,
  ramLimitRange
} from '../../src/shared/modules/control'
import { attribute, cpuPercent, excessKB, isSleepable, selectTabsToSleep, type SleepCandidate } from '../../src/main/modules/control/logic'

const GB = 1024 * 1024 // KB

function tab(id: string, p: Partial<SleepCandidate> = {}): SleepCandidate {
  return { tabId: id, visible: false, suspended: false, internal: false, live: true, pinned: false, audible: false, lastActive: 0, memKB: 100 * 1024, ...p }
}

const soft = { hard: false, excludePinned: true, excludeAudible: true, now: 1_000_000, minIdleMs: 30_000 }

describe('RAM limit math', () => {
  it('computes the excess over the limit in KB', () => {
    expect(excessKB(3 * GB, 4096)).toBe(0)
    expect(excessKB(4 * GB, 4096)).toBe(0)
    expect(excessKB(4.5 * GB, 4096)).toBe(0.5 * GB)
  })

  it('derives the slider range from installed RAM', () => {
    expect(ramLimitRange(16 * 1024 ** 3)).toEqual({ min: 1024, max: 16384, step: 256 })
    // 15.9 GB usable rounds down to a step
    expect(ramLimitRange(15.9 * 1024 ** 3).max).toBe(16128)
    // tiny machines still get a valid range
    expect(ramLimitRange(512 * 1024 ** 2)).toEqual({ min: 1024, max: 1024, step: 256 })
  })

  it('sanitizes stored config and ignores wrong types', () => {
    const c = mergeControlConfig(DEFAULT_CONTROL_CONFIG, { ram: { limitMB: 10, enabled: 'yes' }, net: { preset: 'bogus' }, cpu: { rate: 999 }, sounds: { volume: 7 } })
    expect(c.ram.limitMB).toBe(1024)
    expect(c.ram.enabled).toBe(false)
    expect(c.net.preset).toBe('off')
    expect(c.cpu.rate).toBe(20)
    expect(c.sounds.volume).toBe(1)
    // defaults untouched
    expect(DEFAULT_CONTROL_CONFIG.ram.limitMB).toBe(4096)
  })
})

describe('LRU selection of tabs to sleep', () => {
  it('sleeps least recently used tabs first until the excess is covered', () => {
    const tabs = [tab('a', { lastActive: 500 }), tab('b', { lastActive: 100 }), tab('c', { lastActive: 300 }), tab('d', { lastActive: 900 })]
    expect(selectTabsToSleep(tabs, 150 * 1024, soft)).toEqual(['b', 'c'])
    expect(selectTabsToSleep(tabs, 1, soft)).toEqual(['b'])
    expect(selectTabsToSleep(tabs, 0, soft)).toEqual([])
  })

  it('never selects visible, suspended, internal or unloaded tabs', () => {
    const tabs = [tab('v', { visible: true }), tab('s', { suspended: true }), tab('i', { internal: true }), tab('n', { live: false }), tab('ok', { lastActive: 5 })]
    expect(selectTabsToSleep(tabs, 10 * GB, { ...soft, hard: true })).toEqual(['ok'])
  })

  it('respects pinned / audible / recently-used exclusions in soft mode only', () => {
    const tabs = [tab('pinned', { pinned: true }), tab('audio', { audible: true }), tab('recent', { lastActive: soft.now - 5_000 }), tab('old', { lastActive: 10 })]
    expect(selectTabsToSleep(tabs, 10 * GB, soft)).toEqual(['old'])
    expect(selectTabsToSleep(tabs, 10 * GB, { ...soft, excludePinned: false })).toEqual(['pinned', 'old'])
    expect(new Set(selectTabsToSleep(tabs, 10 * GB, { ...soft, hard: true }))).toEqual(new Set(['pinned', 'audio', 'recent', 'old']))
    expect(isSleepable(tab('p', { pinned: true }), { ...soft, excludePinned: false })).toBe(true)
  })

  it('takes tabs with their own process before tabs whose processes are shared', () => {
    const tabs = [tab('shared-old', { lastActive: 1, memKB: 0 }), tab('own-new', { lastActive: 50, memKB: 200 * 1024 })]
    expect(selectTabsToSleep(tabs, 100 * 1024, soft)).toEqual(['own-new'])
    // when own-process tabs are not enough, shared ones follow
    expect(selectTabsToSleep(tabs, 300 * 1024, soft)).toEqual(['own-new', 'shared-old'])
  })
})

describe('process attribution', () => {
  it('counts exclusive processes and reports shared ones separately', () => {
    const procs = new Map([
      [1, { pid: 1, memKB: 100, cpu: 5 }],
      [2, { pid: 2, memKB: 50, cpu: 1 }],
      [3, { pid: 3, memKB: 300, cpu: null }]
    ])
    const u = attribute(
      [
        { tabId: 'a', pids: [1, 3] },
        { tabId: 'b', pids: [2, 3] },
        { tabId: 'c', pids: [] }
      ],
      procs
    )
    expect(u.get('a')).toEqual({ memKB: 100, sharedKB: 300, cpu: 5, sharedWith: 1 })
    expect(u.get('b')).toEqual({ memKB: 50, sharedKB: 300, cpu: 1, sharedWith: 1 })
    expect(u.get('c')).toEqual({ memKB: null, sharedKB: 0, cpu: null, sharedWith: 0 })
  })

  it('computes CPU % of one core from cumulative seconds', () => {
    expect(cpuPercent(10, 10.5, 1000)).toBeCloseTo(50)
    expect(cpuPercent(10, 12, 1000)).toBeCloseTo(200)
    expect(cpuPercent(10, 9, 1000)).toBe(0)
    expect(cpuPercent(10, 11, 0)).toBe(0)
  })

  it('lists heavy background tabs, heaviest first', () => {
    const tabs = [
      { tabId: 'light', visible: false, memKB: 50 * 1024, cpu: 1 },
      { tabId: 'big', visible: false, memKB: 900 * 1024, cpu: 0 },
      { tabId: 'busy', visible: false, memKB: 80 * 1024, cpu: 45 },
      { tabId: 'shown', visible: true, memKB: 2000 * 1024, cpu: 90 }
    ]
    expect(heavyTabs(tabs).map((t) => t.tabId)).toEqual(['big', 'busy'])
  })
})

describe('network presets', () => {
  it('converts megabits per second to bytes per second', () => {
    expect(mbpsToBytesPerSec(1)).toBe(125_000)
    expect(mbpsToBytesPerSec(8)).toBe(1_000_000)
    expect(mbpsToBytesPerSec(0.5)).toBe(62_500)
  })

  it('maps presets to Chromium emulation options', () => {
    const net = DEFAULT_CONTROL_CONFIG.net
    expect(netEmulationFor({ ...net, preset: 'off' })).toBeNull()
    expect(netEmulationFor({ ...net, preset: '5' })).toEqual({ downloadThroughput: 625_000, uploadThroughput: 625_000, latency: 0 })
    expect(netEmulationFor({ ...net, preset: '50', latencyMs: 150 })).toEqual({ downloadThroughput: 6_250_000, uploadThroughput: 6_250_000, latency: 150 })
    expect(netEmulationFor({ ...net, preset: 'custom', customDownMbps: 20, customUpMbps: 2 })).toEqual({ downloadThroughput: 2_500_000, uploadThroughput: 250_000, latency: 0 })
    expect(netEmulationFor({ ...net, preset: 'custom', customDownMbps: 0, customUpMbps: 2 })).toBeNull()
  })
})
