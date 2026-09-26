import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { resolveSoundTheme, SoundLimiter, soundFor, soundLength, SOUND_THEMES } from '../../src/renderer/src/modules/control/sound/schedule'
// @ts-ignore -- pure renderer lib
import { parseWallpaper, topoPaths, wavePath } from '../../src/renderer/src/modules/control/wallpaper/art'

const EVENTS = ['tabOpen', 'tabClose', 'notify', 'click', 'toggle'] as const

describe('sound scheduling', () => {
  it('every theme defines short, quiet voices for every event', () => {
    for (const t of SOUND_THEMES) {
      for (const ev of EVENTS) {
        const voices = soundFor(t.id, ev)
        expect(voices.length, `${t.id}/${ev}`).toBeGreaterThan(0)
        for (const v of voices) {
          expect(v.start).toBeGreaterThanOrEqual(0)
          expect(v.dur).toBeGreaterThan(v.attack)
          expect(v.gain).toBeGreaterThan(0)
          expect(v.gain).toBeLessThanOrEqual(0.5)
          if (v.wave !== 'noise') expect(v.freq).toBeGreaterThan(20)
        }
        // UI sounds stay subtle and brief
        expect(soundLength(voices)).toBeLessThanOrEqual(ev === 'notify' ? 0.9 : 0.55)
        if (ev === 'click') expect(soundLength(voices)).toBeLessThanOrEqual(0.05)
      }
    }
  })

  it('open rises and close falls in the synth theme', () => {
    const open = soundFor('neon', 'tabOpen')
    const close = soundFor('neon', 'tabClose')
    expect(open[open.length - 1].freq).toBeGreaterThan(open[0].freq)
    expect(close[close.length - 1].freq).toBeLessThan(close[0].freq)
  })

  it('pairs sound themes with visual themes', () => {
    expect(resolveSoundTheme('auto', 'neon')).toBe('neon')
    expect(resolveSoundTheme('auto', 'synthwave')).toBe('neon')
    expect(resolveSoundTheme('auto', 'terminal')).toBe('terminal')
    expect(resolveSoundTheme('auto', 'paper')).toBe('paper')
    expect(resolveSoundTheme('auto', 'unknown')).toBe('glass')
    expect(resolveSoundTheme('terminal', 'aurora')).toBe('terminal')
  })

  it('rate-limits bursts (closing many tabs at once makes one sound)', () => {
    const l = new SoundLimiter()
    expect(l.allow('tabClose', 0)).toBe(true)
    for (let i = 1; i < 10; i++) expect(l.allow('tabClose', i * 5)).toBe(false)
    expect(l.allow('tabClose', 200)).toBe(true)
  })

  it('caps the number of sounds per window', () => {
    const l = new SoundLimiter(undefined, 3, 300)
    expect(l.allow('click', 0)).toBe(true)
    expect(l.allow('tabOpen', 1)).toBe(true)
    expect(l.allow('notify', 2)).toBe(true)
    expect(l.allow('toggle', 3)).toBe(false)
    expect(l.allow('toggle', 400)).toBe(true)
  })
})

describe('wallpaper values and art', () => {
  it('parses the appearance.wallpaper setting', () => {
    expect(parseWallpaper('')).toEqual({ kind: 'none' })
    expect(parseWallpaper('builtin:aurora')).toEqual({ kind: 'builtin', id: 'aurora' })
    expect(parseWallpaper('builtin:nope')).toEqual({ kind: 'none' })
    expect(parseWallpaper('file:C:\\x\\wallpaper-1.png')).toEqual({ kind: 'file', path: 'C:\\x\\wallpaper-1.png' })
  })

  it('generates deterministic contour lines and seamless waves', () => {
    const a = topoPaths()
    expect(a).toHaveLength(14)
    expect(a.every((p: { d: string }) => p.d.startsWith('M'))).toBe(true)
    expect(topoPaths()[3].d).toBe(a[3].d)
    const d = wavePath(960, 600, 400, 20, 2, 0.5)
    const pts = [...d.matchAll(/L(\d+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
    const y0 = pts.find((p) => p[0] === 0)?.[1] ?? Number(d.match(/^M0 600L0 ([\d.]+)/)?.[1])
    const yW = pts.find((p) => p[0] === 960)?.[1]
    expect(yW).toBeCloseTo(y0, 0)
  })
})
