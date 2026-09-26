import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { allZones, zoneOffsetMin } from '../../src/renderer/src/modules/widgets/clocks'

describe('widgets world clocks', () => {
  it('offers UTC and current zone names in the zone list', () => {
    const zones = allZones()
    expect(zones).toContain('UTC')
    expect(zones).toContain('Asia/Kolkata')
    expect(zones).toContain('Europe/Kyiv')
    expect(zones).not.toContain('Asia/Calcutta')
    expect(new Set(zones).size).toBe(zones.length)
    for (const z of zones) expect(() => new Intl.DateTimeFormat('en-US', { timeZone: z })).not.toThrow()
    expect(zoneOffsetMin(Date.UTC(2026, 0, 1), 'Asia/Kolkata')).toBe(330)
  })
})
