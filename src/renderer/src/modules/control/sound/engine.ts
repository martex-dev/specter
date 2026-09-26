// Browser sounds: synthesized with WebAudio from the voice schedules in
// schedule.ts (no audio files). Off by default. Hooks tab open/close window
// events, notifications and (optionally) clicks in SPECTER's own UI.
import type { SoundEvent, SoundThemeId } from '@shared/modules/control'
import { on } from '../../../lib/ipc'
import { useBrowser } from '../../../stores/browser'
import { useControl } from '../store'
import { resolveSoundTheme, SoundLimiter, soundFor, type ConcreteSoundTheme, type Voice } from './schedule'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
const limiter = new SoundLimiter()

function audio(): { ctx: AudioContext; master: GainNode } {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    master = ctx.createGain()
    // Gentle bus compression keeps overlapping voices subtle.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 4
    master.connect(comp).connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  return { ctx, master: master! }
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise) {
    noise = c.createBuffer(1, Math.round(c.sampleRate * 0.25), c.sampleRate)
    const d = noise.getChannelData(0)
    let seed = 1234567
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      d[i] = (seed / 0x7fffffff) * 2 - 1
    }
  }
  return noise
}

function playVoice(c: AudioContext, out: AudioNode, v: Voice, t0: number): void {
  const start = t0 + v.start
  const end = start + v.dur
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, start)
  env.gain.linearRampToValueAtTime(Math.max(0.0002, v.gain), start + Math.max(0.0005, v.attack))
  env.gain.exponentialRampToValueAtTime(0.0001, end)
  let src: AudioScheduledSourceNode
  if (v.wave === 'noise') {
    const b = c.createBufferSource()
    b.buffer = noiseBuffer(c)
    src = b
  } else {
    const o = c.createOscillator()
    o.type = v.wave
    o.frequency.setValueAtTime(v.freq, start)
    if (v.freqEnd) o.frequency.exponentialRampToValueAtTime(v.freqEnd, end)
    src = o
  }
  let node: AudioNode = src
  if (v.filter) {
    const f = c.createBiquadFilter()
    f.type = v.filter.type
    f.frequency.setValueAtTime(v.filter.freq, start)
    if (v.filter.freqEnd) f.frequency.exponentialRampToValueAtTime(v.filter.freqEnd, end)
    if (v.filter.q) f.Q.value = v.filter.q
    node.connect(f)
    node = f
  }
  node.connect(env).connect(out)
  src.start(start)
  src.stop(end + 0.02)
  src.onended = () => {
    try {
      env.disconnect()
    } catch {
      /* already gone */
    }
  }
}

/** Plays a sound now (used by previews too). Returns false when muted / limited. */
export function playSound(ev: SoundEvent, opts: { theme?: ConcreteSoundTheme; volume?: number; force?: boolean } = {}): boolean {
  const cfg = useControl.getState().config?.sounds
  if (!opts.force) {
    if (!cfg?.enabled) return false
    if (ev === 'click' || ev === 'toggle' ? !cfg.clicks : ev === 'notify' ? !cfg.notifications : !cfg.tabs) return false
    if (cfg.autoMute && audioPlaying()) return false
    if (!limiter.allow(ev, performance.now())) return false
  }
  const theme = opts.theme ?? resolveSoundTheme((cfg?.theme ?? 'auto') as SoundThemeId, document.documentElement.dataset.theme)
  const volume = opts.volume ?? cfg?.volume ?? 0.5
  if (volume <= 0) return false
  try {
    const { ctx: c, master: m } = audio()
    m.gain.setValueAtTime(volume * 0.35, c.currentTime)
    const t0 = c.currentTime + 0.005
    for (const v of soundFor(theme, ev)) playVoice(c, m, v, t0)
    return true
  } catch {
    return false
  }
}

/** Any tab in this window currently producing (unmuted) audio. */
export function audioPlaying(): boolean {
  for (const ws of Object.values(useBrowser.getState().open)) for (const t of ws.tabs) if (t.audible && !t.muted) return true
  return false
}

const CLICKABLE = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="radio"], a[href], .list-row, select'

export function startSounds(): void {
  window.addEventListener('specter:tab-created', () => playSound('tabOpen'))
  window.addEventListener('specter:tab-closed', () => playSound('tabClose'))
  // Notifications are broadcast to every window: only the focused one plays.
  on('notifications:new', () => {
    if (document.hasFocus()) playSound('notify')
  })
  document.addEventListener(
    'pointerdown',
    (e) => {
      const cfg = useControl.getState().config?.sounds
      if (!cfg?.enabled || !cfg.clicks || e.button !== 0) return
      const el = (e.target as HTMLElement | null)?.closest?.(`[role="switch"], ${CLICKABLE}`) as HTMLElement | null
      if (!el || (el as HTMLButtonElement).disabled) return
      playSound(el.getAttribute('role') === 'switch' ? 'toggle' : 'click')
    },
    true
  )
}
