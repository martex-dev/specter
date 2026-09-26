// Countdowns to user dates (optional notification when reached).
import { useState } from 'react'
import { Bell, BellOff, Hourglass, Plus, Trash2 } from 'lucide-react'
import type { Countdown, WidgetColor } from '@shared/modules/widgets'
import { useKv, useNow } from './store'
import { ColorDots, colorVar } from './ui'
import './widgets.css'

const EMPTY: Countdown[] = []
export function useCountdowns(): [Countdown[], (c: Countdown[]) => void, boolean] {
  return useKv<Countdown[]>('countdowns', EMPTY)
}

export function remaining(target: number, now: number): { past: boolean; d: number; h: number; m: number; s: number } {
  const diff = target - now
  const a = Math.abs(diff)
  return { past: diff < 0, d: Math.floor(a / 86_400_000), h: Math.floor((a % 86_400_000) / 3_600_000), m: Math.floor((a % 3_600_000) / 60_000), s: Math.floor((a % 60_000) / 1000) }
}

export function CountdownCard({ c, now, onToggleNotify, onDelete, compact }: { c: Countdown; now: number; onToggleNotify?: () => void; onDelete?: () => void; compact?: boolean }) {
  const r = remaining(c.target, now)
  const total = Math.max(1, c.target - c.createdAt)
  const pct = r.past ? 100 : Math.min(100, Math.max(0, ((now - c.createdAt) / total) * 100))
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <div className={'wg-cd' + (r.past ? ' past' : '') + (compact ? ' compact' : '')} style={{ ['--c' as string]: colorVar(c.color) }}>
      <div className="row">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="wg-cd-t ellipsis">{c.title}</div>
          <div className="wg-cd-d">{new Date(c.target).toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        {onToggleNotify && (
          <button className={'icon-btn sm' + (c.notify ? ' on' : '')} onClick={onToggleNotify} aria-label={c.notify ? 'Disable notification' : 'Notify when reached'} data-tip={c.notify ? 'Will notify when reached' : 'Notify when reached'}>
            {c.notify ? <Bell size={12} /> : <BellOff size={12} />}
          </button>
        )}
        {onDelete && (
          <button className="icon-btn sm" onClick={onDelete} aria-label="Delete countdown" data-tip="Delete">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {r.past ? (
        <div className="wg-cd-big">
          <span className="num">{r.d ? `${r.d}d ago` : r.h ? `${r.h}h ${r.m}m ago` : `${r.m}m ago`}</span>
        </div>
      ) : (
        <div className="wg-cd-big num">
          {r.d > 0 && (
            <>
              <b>{r.d}</b>
              <small>d</small>{' '}
            </>
          )}
          <b>{pad(r.h)}</b>
          <small>h</small> <b>{pad(r.m)}</b>
          <small>m</small> <b>{pad(r.s)}</b>
          <small>s</small>
        </div>
      )}
      <div className="wg-cd-bar">
        <span style={{ width: pct + '%' }} />
      </div>
    </div>
  )
}

export default function CountdownPanel() {
  const [list, setList] = useCountdowns()
  const now = useNow(1000)
  const [adding, setAdding] = useState(false)
  const tomorrow = new Date(Date.now() + 86_400_000)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(`${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`)
  const [time, setTime] = useState('09:00')
  const [color, setColor] = useState<WidgetColor>('accent')
  const [notify, setNotify] = useState(true)
  const sorted = [...list].sort((a, b) => Number(a.target < now) - Number(b.target < now) || (a.target < now ? b.target - a.target : a.target - b.target))

  const add = () => {
    const [y, mo, d] = date.split('-').map(Number)
    const [h, mi] = time.split(':').map(Number)
    const target = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0).getTime()
    if (!Number.isFinite(target)) return
    setList([...list, { id: 'c' + Date.now().toString(36), title: title.trim() || 'Countdown', target, createdAt: Date.now(), color, notify }])
    setTitle('')
    setAdding(false)
  }

  return (
    <div className="wg wg-countdown">
      <div className="wg-toolbar">
        <span className="dim" style={{ fontSize: 12 }}>
          {list.filter((c) => c.target > now).length} upcoming
        </span>
        <span className="spacer" />
        <button className={'btn sm' + (adding ? '' : ' primary')} onClick={() => setAdding(!adding)}>
          <Plus size={12} /> Countdown
        </button>
      </div>
      <div className="wg-pad">
        {adding && (
          <div className="wg-editor" style={{ marginBottom: 12 }}>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="What are you counting down to?" aria-label="Title" />
            <div className="wg-form-row">
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
            </div>
            <div className="wg-form-row">
              <ColorDots value={color} onChange={setColor} size={13} />
              <span className="spacer" />
              <button className={'icon-btn sm' + (notify ? ' on' : '')} onClick={() => setNotify(!notify)} aria-pressed={notify} aria-label="Notify when reached" data-tip="Notify when reached">
                {notify ? <Bell size={12} /> : <BellOff size={12} />}
              </button>
              <button className="btn sm primary" onClick={add}>
                Add
              </button>
            </div>
          </div>
        )}
        {!list.length && !adding && (
          <div className="empty">
            <Hourglass size={22} />
            <div>Count down to trips, launches, deadlines…</div>
          </div>
        )}
        <div className="wg-cds">
          {sorted.map((c) => (
            <CountdownCard
              key={c.id}
              c={c}
              now={now}
              onToggleNotify={() => setList(list.map((x) => (x.id === c.id ? { ...x, notify: !x.notify } : x)))}
              onDelete={() => setList(list.filter((x) => x.id !== c.id))}
            />
          ))}
        </div>
        <p className="wg-fine">Stored on this device. Notifications fire while SPECTER is running.</p>
      </div>
    </div>
  )
}
