// Timer, stopwatch and pomodoro views (state lives in clocks.ts).
import { useEffect, useState } from 'react'
import { Flag, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import {
  formatClock,
  pomodoro,
  pomodoroConfigure,
  pomodoroPhaseLength,
  pomodoroRemaining,
  pomodoroReset,
  pomodoroSkip,
  pomodoroToggle,
  stopwatch,
  stopwatchElapsed,
  stopwatchLap,
  stopwatchReset,
  stopwatchToggle,
  timer,
  timerAdd,
  timerPause,
  timerRemaining,
  timerReset,
  timerSet,
  timerStart,
  useClocks
} from './clocks'
import { NumberInput } from '../ui'

/** Re-render every animation frame while `active` (only while mounted). */
function useFrame(active: boolean): void {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const loop = () => {
      set((n) => n + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
}

const PRESETS = [1, 3, 5, 10, 15, 25, 30, 45, 60]

export function TimerView() {
  useClocks()
  const running = timer.endsAt !== null
  useFrame(running)
  const rem = timerRemaining()
  const [h, setH] = useState('0')
  const [m, setM] = useState('5')
  const [s, setS] = useState('0')
  const apply = () => timerSet(((Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)) * 1000)
  const pct = timer.duration ? 1 - rem / timer.duration : 0

  return (
    <>
      <div className="tkp-display" style={rem === 0 ? { color: 'var(--warn)' } : undefined}>
        {formatClock(Math.ceil(rem / 1000) * 1000)}
      </div>
      <div className="tkp-progress">
        <div style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <input className="input" value={timer.label} onChange={(e) => ((timer.label = e.target.value), timerAdd(0))} placeholder="Label (optional)" aria-label="Timer label" />
      <div className="tkp-row">
        <button className="btn primary" onClick={running ? timerPause : timerStart}>
          {running ? <Pause size={13} /> : <Play size={13} />} {running ? 'Pause' : rem < timer.duration && rem > 0 ? 'Resume' : 'Start'}
        </button>
        <button className="btn" onClick={timerReset}>
          <RotateCcw size={13} /> Reset
        </button>
        <button className="btn" onClick={() => timerAdd(60000)}>
          +1 min
        </button>
      </div>
      <div className="label">Set duration</div>
      <div className="row">
        {[
          [h, setH, 'h'],
          [m, setM, 'm'],
          [s, setS, 's']
        ].map(([v, set, u]) => (
          <label key={u as string} className="row" style={{ gap: 4 }}>
            <input className="input mono" style={{ width: 56 }} type="number" min={0} value={v as string} onChange={(e) => (set as (x: string) => void)(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} aria-label={`${u}`} />
            <span className="dim">{u as string}</span>
          </label>
        ))}
        <button className="btn sm" onClick={apply}>
          Set
        </button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {PRESETS.map((p) => (
          <button key={p} className="btn sm" onClick={() => (timerSet(p * 60000), timerStart())}>
            {p}m
          </button>
        ))}
      </div>
      <div className="tk-note">You’ll get a desktop notification when it ends — even with this panel closed.</div>
    </>
  )
}

export function StopwatchView() {
  useClocks()
  const running = stopwatch.startedAt !== null
  useFrame(running)
  const el = stopwatchElapsed()
  const laps = stopwatch.laps
  const splits = laps.map((t, i) => t - (laps[i - 1] ?? 0))
  const best = splits.length > 1 ? Math.min(...splits) : -1
  const worst = splits.length > 1 ? Math.max(...splits) : -1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName) || t.isContentEditable || e.ctrlKey || e.altKey || e.metaKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        stopwatchToggle()
      } else if (e.key.toLowerCase() === 'l') stopwatchLap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="tkp-display">
        {formatClock(el)}
        <span className="ms">.{String(Math.floor((el % 1000) / 10)).padStart(2, '0')}</span>
      </div>
      <div className="tkp-row">
        <button className="btn primary" onClick={stopwatchToggle} data-tip="Space">
          {running ? <Pause size={13} /> : <Play size={13} />} {running ? 'Stop' : el ? 'Resume' : 'Start'}
        </button>
        <button className="btn" onClick={stopwatchLap} disabled={!running} data-tip="L">
          <Flag size={13} /> Lap
        </button>
        <button className="btn" onClick={stopwatchReset} disabled={running || !el}>
          <RotateCcw size={13} /> Reset
        </button>
      </div>
      {laps.length > 0 && (
        <div className="tkp-list">
          {[...laps]
            .map((t, i) => ({ t, i, split: splits[i] }))
            .reverse()
            .map(({ t, i, split }) => (
              <div key={i} className="tkp-item mono" style={{ fontSize: 12 }}>
                <span className="dim" style={{ width: 44 }}>
                  #{i + 1}
                </span>
                <span className={'grow' + (split === best ? ' up' : split === worst ? ' down' : '')}>+{formatClock(split, true)}</span>
                <span>{formatClock(t, true)}</span>
              </div>
            ))}
        </div>
      )}
      <div className="tk-note">Space starts/stops, L records a lap.</div>
    </>
  )
}

export function PomodoroView() {
  useClocks()
  const running = pomodoro.endsAt !== null
  useFrame(running)
  const rem = pomodoroRemaining()
  const len = pomodoroPhaseLength()
  const cfg = pomodoro.config
  const label = pomodoro.phase === 'work' ? 'Focus' : pomodoro.phase === 'short' ? 'Short break' : 'Long break'

  const num = (k: 'work' | 'short' | 'long' | 'rounds', min: number, max: number) => (
    <label className="tkp-field" style={{ flex: 1 }}>
      <span className="label">{k === 'rounds' ? 'Rounds' : k === 'work' ? 'Focus min' : k === 'short' ? 'Short min' : 'Long min'}</span>
      <NumberInput className="input mono" min={min} max={max} value={cfg[k]} onValue={(v) => pomodoroConfigure({ [k]: v })} disabled={running} />
    </label>
  )

  return (
    <>
      <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
        <span className={'badge ' + (pomodoro.phase === 'work' ? 'accent' : 'ok')}>{label}</span>
        <span className="mono dim" style={{ fontSize: 11 }}>
          round {pomodoro.round}/{cfg.rounds} · {pomodoro.completed} done
        </span>
      </div>
      <div className="tkp-display">{formatClock(Math.ceil(rem / 1000) * 1000)}</div>
      <div className="tkp-progress">
        <div style={{ width: `${Math.min(100, (1 - rem / len) * 100)}%`, background: pomodoro.phase === 'work' ? 'var(--accent)' : 'var(--ok)' }} />
      </div>
      <div className="tkp-row">
        <button className="btn primary" onClick={pomodoroToggle}>
          {running ? <Pause size={13} /> : <Play size={13} />} {running ? 'Pause' : rem < len ? 'Resume' : 'Start'}
        </button>
        <button className="btn" onClick={pomodoroSkip} data-tip="Skip to the next phase">
          <SkipForward size={13} /> Skip
        </button>
        <button className="btn" onClick={pomodoroReset}>
          <RotateCcw size={13} /> Reset
        </button>
      </div>
      <div className="row">
        {num('work', 1, 180)}
        {num('short', 1, 60)}
        {num('long', 1, 120)}
        {num('rounds', 1, 12)}
      </div>
      <label className="row" style={{ gap: 6, fontSize: 12 }}>
        <input type="checkbox" checked={cfg.autoStart} onChange={(e) => pomodoroConfigure({ autoStart: e.target.checked })} /> Start the next phase automatically
      </label>
      <div className="tk-note">A notification marks the end of every phase.</div>
    </>
  )
}
