// Pure sound design: which synthesized voices each UI event plays in each
// sound theme, plus rate limiting. No DOM / WebAudio here (unit-tested).
import type { SoundEvent, SoundThemeId } from '@shared/modules/control'

export type ConcreteSoundTheme = Exclude<SoundThemeId, 'auto'>
export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise'

export interface Voice {
  wave: Wave
  /** Start frequency, Hz (ignored for noise unless a filter uses it). */
  freq: number
  /** Optional exponential glide target, Hz. */
  freqEnd?: number
  /** Offset from the event time, seconds. */
  start: number
  /** Total length, seconds (attack + exponential decay). */
  dur: number
  /** Peak gain before the master volume, 0..1. */
  gain: number
  attack: number
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; freq: number; freqEnd?: number; q?: number }
}

export const SOUND_THEMES: { id: ConcreteSoundTheme; name: string; blurb: string; pairs: string }[] = [
  { id: 'neon', name: 'Neon synth', blurb: 'Filtered saw blips and rising arps', pairs: 'Neon · Synthwave' },
  { id: 'terminal', name: 'Terminal clicks', blurb: 'Relay clicks and square-wave beeps', pairs: 'Terminal' },
  { id: 'glass', name: 'Soft glass', blurb: 'Airy sine chimes with bell partials', pairs: 'Specter · Aurora' },
  { id: 'paper', name: 'Paper', blurb: 'Muted wooden taps, barely there', pairs: 'Paper' }
]

const THEME_PAIRING: Record<string, ConcreteSoundTheme> = {
  specter: 'glass',
  aurora: 'glass',
  neon: 'neon',
  synthwave: 'neon',
  terminal: 'terminal',
  paper: 'paper',
  blueprint: 'paper',
  brutal: 'paper',
  retro: 'terminal',
  holo: 'glass',
  glitch: 'neon'
}

export function resolveSoundTheme(pref: SoundThemeId, visualTheme: string | undefined): ConcreteSoundTheme {
  if (pref !== 'auto') return pref
  return THEME_PAIRING[visualTheme ?? ''] ?? 'glass'
}

const note = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12)
// Handy pitches
const C5 = note(3)
const E5 = note(7)
const G5 = note(10)
const B5 = note(14)
const C6 = note(15)
const E6 = note(19)
const G6 = note(22)

function chime(freq: number, start: number, gain: number, dur = 0.45): Voice[] {
  // Sine fundamental plus a quiet inharmonic bell partial.
  return [
    { wave: 'sine', freq, start, dur, gain, attack: 0.006 },
    { wave: 'sine', freq: freq * 2.76, start, dur: dur * 0.5, gain: gain * 0.22, attack: 0.003 }
  ]
}

export function soundFor(theme: ConcreteSoundTheme, ev: SoundEvent): Voice[] {
  switch (theme) {
    case 'neon':
      switch (ev) {
        case 'tabOpen':
          return [
            { wave: 'sawtooth', freq: E5, start: 0, dur: 0.09, gain: 0.35, attack: 0.004, filter: { type: 'lowpass', freq: 900, freqEnd: 4200, q: 6 } },
            { wave: 'sawtooth', freq: B5, start: 0.06, dur: 0.14, gain: 0.3, attack: 0.004, filter: { type: 'lowpass', freq: 1400, freqEnd: 5200, q: 6 } }
          ]
        case 'tabClose':
          return [
            { wave: 'sawtooth', freq: B5, start: 0, dur: 0.08, gain: 0.3, attack: 0.004, filter: { type: 'lowpass', freq: 4200, freqEnd: 900, q: 5 } },
            { wave: 'sawtooth', freq: E5, freqEnd: E5 / 2, start: 0.05, dur: 0.14, gain: 0.28, attack: 0.004, filter: { type: 'lowpass', freq: 3000, freqEnd: 500, q: 5 } }
          ]
        case 'notify':
          return [C5, E5, G5, C6].map((f, i) => ({ wave: 'square' as const, freq: f, start: i * 0.055, dur: 0.12, gain: 0.16, attack: 0.003, filter: { type: 'lowpass' as const, freq: 3500 } }))
        case 'click':
          return [{ wave: 'square', freq: 1760, freqEnd: 1320, start: 0, dur: 0.028, gain: 0.12, attack: 0.001, filter: { type: 'lowpass', freq: 5000 } }]
        case 'toggle':
          return [
            { wave: 'square', freq: 1320, start: 0, dur: 0.03, gain: 0.12, attack: 0.001, filter: { type: 'lowpass', freq: 5000 } },
            { wave: 'square', freq: 1760, start: 0.035, dur: 0.04, gain: 0.12, attack: 0.001, filter: { type: 'lowpass', freq: 5000 } }
          ]
      }
      break
    case 'terminal':
      switch (ev) {
        case 'tabOpen':
          return [
            { wave: 'noise', freq: 0, start: 0, dur: 0.012, gain: 0.5, attack: 0.0005, filter: { type: 'highpass', freq: 3000 } },
            { wave: 'square', freq: 880, start: 0.018, dur: 0.05, gain: 0.14, attack: 0.001 }
          ]
        case 'tabClose':
          return [
            { wave: 'noise', freq: 0, start: 0, dur: 0.012, gain: 0.5, attack: 0.0005, filter: { type: 'highpass', freq: 2500 } },
            { wave: 'square', freq: 440, start: 0.018, dur: 0.05, gain: 0.14, attack: 0.001 }
          ]
        case 'notify':
          return [
            { wave: 'square', freq: 1000, start: 0, dur: 0.06, gain: 0.14, attack: 0.001 },
            { wave: 'square', freq: 1000, start: 0.1, dur: 0.06, gain: 0.14, attack: 0.001 }
          ]
        case 'click':
          return [{ wave: 'noise', freq: 0, start: 0, dur: 0.008, gain: 0.45, attack: 0.0005, filter: { type: 'highpass', freq: 3500 } }]
        case 'toggle':
          return [
            { wave: 'noise', freq: 0, start: 0, dur: 0.008, gain: 0.45, attack: 0.0005, filter: { type: 'highpass', freq: 3500 } },
            { wave: 'noise', freq: 0, start: 0.03, dur: 0.008, gain: 0.35, attack: 0.0005, filter: { type: 'highpass', freq: 2500 } }
          ]
      }
      break
    case 'glass':
      switch (ev) {
        case 'tabOpen':
          return [...chime(C6, 0, 0.22, 0.4), ...chime(G6, 0.05, 0.14, 0.45)]
        case 'tabClose':
          return [...chime(G5, 0, 0.18, 0.35), ...chime(C5, 0.05, 0.14, 0.4)]
        case 'notify':
          return [...chime(E5, 0, 0.18, 0.6), ...chime(G5, 0.08, 0.16, 0.6), ...chime(E6, 0.16, 0.12, 0.7)]
        case 'click':
          return [{ wave: 'sine', freq: 2400, start: 0, dur: 0.018, gain: 0.09, attack: 0.001 }]
        case 'toggle':
          return [...chime(B5, 0, 0.1, 0.18)]
      }
      break
    case 'paper':
      switch (ev) {
        case 'tabOpen':
          return [{ wave: 'triangle', freq: 520, freqEnd: 360, start: 0, dur: 0.07, gain: 0.26, attack: 0.002, filter: { type: 'lowpass', freq: 1800 } }]
        case 'tabClose':
          return [{ wave: 'triangle', freq: 380, freqEnd: 250, start: 0, dur: 0.07, gain: 0.24, attack: 0.002, filter: { type: 'lowpass', freq: 1400 } }]
        case 'notify':
          return [
            { wave: 'triangle', freq: 660, start: 0, dur: 0.12, gain: 0.2, attack: 0.003, filter: { type: 'lowpass', freq: 2200 } },
            { wave: 'triangle', freq: 880, start: 0.09, dur: 0.16, gain: 0.18, attack: 0.003, filter: { type: 'lowpass', freq: 2200 } }
          ]
        case 'click':
          return [{ wave: 'noise', freq: 0, start: 0, dur: 0.01, gain: 0.3, attack: 0.0005, filter: { type: 'bandpass', freq: 1200, q: 1.2 } }]
        case 'toggle':
          return [{ wave: 'noise', freq: 0, start: 0, dur: 0.014, gain: 0.32, attack: 0.0005, filter: { type: 'bandpass', freq: 900, q: 1.4 } }]
      }
  }
  return []
}

/** Total length of a voice list, seconds. */
export function soundLength(voices: Voice[]): number {
  return voices.reduce((m, v) => Math.max(m, v.start + v.dur), 0)
}

/**
 * Rate limiter: the same event within `sameGapMs` plays once (closing ten tabs
 * at once makes one sound), and at most `maxBurst` sounds start per `windowMs`.
 */
export class SoundLimiter {
  private last = new Map<SoundEvent, number>()
  private recent: number[] = []
  constructor(
    private sameGapMs: Record<SoundEvent, number> = { tabOpen: 90, tabClose: 90, notify: 400, click: 35, toggle: 35 },
    private maxBurst = 4,
    private windowMs = 300
  ) {}

  allow(ev: SoundEvent, now: number): boolean {
    const prev = this.last.get(ev)
    if (prev !== undefined && now - prev < this.sameGapMs[ev]) return false
    this.recent = this.recent.filter((t) => now - t < this.windowMs)
    if (this.recent.length >= this.maxBurst) return false
    this.recent.push(now)
    this.last.set(ev, now)
    return true
  }
}
