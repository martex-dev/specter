// Timer, stopwatch and pomodoro state kept outside React so they keep running
// while the side panel is closed. A single interval ticks only while at least
// one of them is running.
import { useSyncExternalStore } from 'react'
import { invoke } from '../../../lib/ipc'
import { toast } from '../../../stores/ui'

type Listener = () => void
const listeners = new Set<Listener>()
let version = 0
function emit(): void {
  version++
  listeners.forEach((l) => l())
}
export function useClocks(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version
  )
}

function notify(title: string, body: string): void {
  invoke('app:notify', { title, body, category: 'browser' }).catch(() => undefined)
  toast({ kind: 'info', title, body, ttl: 8000 })
  chime()
}

/** Short, quiet two-tone chime via WebAudio (no audio files needed). */
function chime(): void {
  try {
    const Ctx = window.AudioContext
    const ctx = new Ctx()
    const now = ctx.currentTime
    ;[880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = f
      o.type = 'sine'
      g.gain.setValueAtTime(0.0001, now + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.12, now + i * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.5)
      o.connect(g).connect(ctx.destination)
      o.start(now + i * 0.18)
      o.stop(now + i * 0.18 + 0.55)
    })
    setTimeout(() => ctx.close().catch(() => undefined), 1200)
  } catch {
    /* audio unavailable */
  }
}

let ticker: number | undefined
function ensureTicker(): void {
  const running = timer.endsAt !== null || stopwatch.startedAt !== null || pomodoro.endsAt !== null
  if (running && ticker === undefined) ticker = window.setInterval(tick, 250)
  else if (!running && ticker !== undefined) {
    clearInterval(ticker)
    ticker = undefined
  }
}

function tick(): void {
  const now = Date.now()
  if (timer.endsAt !== null && now >= timer.endsAt) {
    timer.endsAt = null
    timer.remaining = 0
    notify('Timer finished', timer.label || formatClock(timer.duration))
  }
  if (pomodoro.endsAt !== null && now >= pomodoro.endsAt) advancePomodoro()
  ensureTicker()
  emit()
}

export function formatClock(ms: number, withMs = false): string {
  const neg = ms < 0
  const t = Math.abs(ms)
  const h = Math.floor(t / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const cs = Math.floor((t % 1000) / 10)
  const base = (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0')
  return (neg ? '-' : '') + base + (withMs ? '.' + String(cs).padStart(2, '0') : '')
}

// ---------------------------------------------------------------- timer

export const timer = {
  duration: 5 * 60000,
  /** Remaining ms while paused/idle. */
  remaining: 5 * 60000,
  endsAt: null as number | null,
  label: ''
}

export function timerRemaining(): number {
  return timer.endsAt !== null ? Math.max(0, timer.endsAt - Date.now()) : timer.remaining
}
export function timerSet(ms: number, label = timer.label): void {
  timer.duration = Math.max(1000, ms)
  timer.remaining = timer.duration
  timer.endsAt = null
  timer.label = label
  ensureTicker()
  emit()
}
export function timerStart(): void {
  if (timer.endsAt !== null) return
  if (timer.remaining <= 0) timer.remaining = timer.duration
  timer.endsAt = Date.now() + timer.remaining
  ensureTicker()
  emit()
}
export function timerPause(): void {
  if (timer.endsAt === null) return
  timer.remaining = Math.max(0, timer.endsAt - Date.now())
  timer.endsAt = null
  ensureTicker()
  emit()
}
export function timerReset(): void {
  timer.endsAt = null
  timer.remaining = timer.duration
  ensureTicker()
  emit()
}
export function timerAdd(ms: number): void {
  if (timer.endsAt !== null) timer.endsAt += ms
  else timer.remaining = Math.max(0, timer.remaining + ms)
  timer.duration = Math.max(timer.duration, timerRemaining())
  emit()
}

// ---------------------------------------------------------------- stopwatch

export const stopwatch = {
  startedAt: null as number | null,
  accumulated: 0,
  /** Cumulative elapsed time at each lap. */
  laps: [] as number[]
}

export function stopwatchElapsed(): number {
  return stopwatch.accumulated + (stopwatch.startedAt !== null ? performance.now() - stopwatch.startedAt : 0)
}
export function stopwatchToggle(): void {
  if (stopwatch.startedAt === null) stopwatch.startedAt = performance.now()
  else {
    stopwatch.accumulated += performance.now() - stopwatch.startedAt
    stopwatch.startedAt = null
  }
  ensureTicker()
  emit()
}
export function stopwatchLap(): void {
  if (stopwatch.startedAt === null) return
  stopwatch.laps = [...stopwatch.laps, stopwatchElapsed()]
  emit()
}
export function stopwatchReset(): void {
  stopwatch.startedAt = null
  stopwatch.accumulated = 0
  stopwatch.laps = []
  ensureTicker()
  emit()
}

// ---------------------------------------------------------------- pomodoro

export interface PomodoroConfig {
  work: number // minutes
  short: number
  long: number
  rounds: number // work sessions before a long break
  autoStart: boolean
}

const POMO_KEY = 'specter.toolkit.pomodoro'
function loadConfig(): PomodoroConfig {
  const def: PomodoroConfig = { work: 25, short: 5, long: 15, rounds: 4, autoStart: false }
  try {
    return { ...def, ...(JSON.parse(localStorage.getItem(POMO_KEY) ?? '{}') as Partial<PomodoroConfig>) }
  } catch {
    return def
  }
}

export type Phase = 'work' | 'short' | 'long'

export const pomodoro = {
  config: loadConfig(),
  phase: 'work' as Phase,
  /** 1-based index of the current work session within the cycle. */
  round: 1,
  completed: 0,
  endsAt: null as number | null,
  remaining: loadConfig().work * 60000
}

const phaseMs = (p: Phase) => (p === 'work' ? pomodoro.config.work : p === 'short' ? pomodoro.config.short : pomodoro.config.long) * 60000

export function pomodoroRemaining(): number {
  return pomodoro.endsAt !== null ? Math.max(0, pomodoro.endsAt - Date.now()) : pomodoro.remaining
}
export function pomodoroPhaseLength(): number {
  return phaseMs(pomodoro.phase)
}
export function pomodoroConfigure(patch: Partial<PomodoroConfig>): void {
  pomodoro.config = { ...pomodoro.config, ...patch }
  try {
    localStorage.setItem(POMO_KEY, JSON.stringify(pomodoro.config))
  } catch {
    /* ignore */
  }
  if (pomodoro.endsAt === null) pomodoro.remaining = phaseMs(pomodoro.phase)
  emit()
}
export function pomodoroToggle(): void {
  if (pomodoro.endsAt === null) pomodoro.endsAt = Date.now() + (pomodoro.remaining > 0 ? pomodoro.remaining : phaseMs(pomodoro.phase))
  else {
    pomodoro.remaining = Math.max(0, pomodoro.endsAt - Date.now())
    pomodoro.endsAt = null
  }
  ensureTicker()
  emit()
}
export function pomodoroReset(): void {
  pomodoro.phase = 'work'
  pomodoro.round = 1
  pomodoro.endsAt = null
  pomodoro.remaining = phaseMs('work')
  ensureTicker()
  emit()
}
export function pomodoroSkip(): void {
  advancePomodoro(true)
  ensureTicker()
  emit()
}

function advancePomodoro(skipped = false): void {
  const wasRunning = pomodoro.endsAt !== null
  const cfg = pomodoro.config
  let next: Phase
  if (pomodoro.phase === 'work') {
    if (!skipped) pomodoro.completed++
    next = pomodoro.round >= cfg.rounds ? 'long' : 'short'
  } else {
    next = 'work'
    pomodoro.round = pomodoro.phase === 'long' ? 1 : pomodoro.round + 1
  }
  if (!skipped) {
    if (pomodoro.phase === 'work') notify(next === 'long' ? 'Time for a long break' : 'Time for a break', `Focus session ${pomodoro.completed} done — ${next === 'long' ? cfg.long : cfg.short} min break.`)
    else notify('Break over', `Back to focus for ${cfg.work} min.`)
  }
  pomodoro.phase = next
  pomodoro.remaining = phaseMs(next)
  pomodoro.endsAt = (skipped ? wasRunning : cfg.autoStart) ? Date.now() + pomodoro.remaining : null
}
