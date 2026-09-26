// Media controls: every tab with media in this window, with transport,
// volume, speed, picture-in-picture, mute and "go to tab".
import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, FastForward, Minus, Music, Pause, PictureInPicture2, Play, Plus, Rewind, Volume2, VolumeX } from 'lucide-react'
import type { MediaState } from '@shared/ipc'
import { formatSpeed, sameSpeed, stepSpeed } from '@shared/video'
import { invoke } from '../../lib/ipc'
import { wcIdFor } from '../../lib/webviews'
import { Favicon } from '../../components/ui'
import { activateTab, activeTab, setMuted, useBrowser } from '../../stores/browser'
import { useSetting } from '../../stores/settings'
import { toast, toggleSidePanel } from '../../stores/ui'

interface MediaTab {
  id: string
  title: string
  url: string
  favicon?: string
  audible: boolean
  muted: boolean
  suspended: boolean
  wsName: string
}

/** Tabs that have played media (stable across unrelated store updates). */
function useMediaTabs(): MediaTab[] {
  const key = useBrowser((s) => {
    const out: MediaTab[] = []
    for (const wsId of s.openOrder) {
      const ws = s.open[wsId]
      if (!ws) continue
      for (const t of ws.tabs)
        if ((t.hasMedia || t.audible) && !t.url.startsWith('specter://'))
          out.push({ id: t.id, title: t.title, url: t.url, favicon: t.favicon, audible: !!t.audible, muted: !!t.muted, suspended: !!t.suspended, wsName: ws.name })
    }
    return JSON.stringify(out)
  })
  return useMemo(() => JSON.parse(key) as MediaTab[], [key])
}

function fmt(sec?: number): string {
  if (sec === undefined || !isFinite(sec)) return '--:--'
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3]

function MediaCard({ tab, compact }: { tab: MediaTab; compact?: boolean }) {
  const [state, setState] = useState<MediaState | null>(null)
  const [missing, setMissing] = useState(false)
  const wcId = tab.suspended ? null : wcIdFor(tab.id)
  const step = useSetting('video.step')

  useEffect(() => {
    if (wcId === null) return
    let alive = true
    const poll = () =>
      invoke('guest:media', wcId)
        .then((s) => {
          if (!alive) return
          setState(s)
          setMissing(!s)
        })
        .catch(() => alive && setMissing(true))
    poll()
    const t = window.setInterval(poll, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [wcId])

  const control = async (action: 'play' | 'pause' | 'toggle' | 'seek' | 'rate' | 'volume' | 'pip', value?: number) => {
    if (wcId === null) return
    // Controlled inputs: show the new value right away, or the volume slider snaps back
    // to the old value on every drag step until the IPC round trip completes.
    if ((action === 'volume' || action === 'rate') && value !== undefined) setState((s) => (s ? { ...s, [action]: value } : s))
    try {
      await invoke('guest:mediaControl', wcId, action, value)
      // While dragging, re-reading after each step would jump back to an older value; the poll catches up.
      if (action === 'volume') return
      const s = await invoke('guest:media', wcId)
      setState(s)
    } catch (err) {
      toast({ kind: 'error', title: 'Media control failed', body: String((err as Error)?.message ?? err) })
    }
  }

  const title = state?.title || tab.title || tab.url
  const dur = state?.duration
  const pos = state?.currentTime ?? 0
  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0
  const disabled = wcId === null || !state

  return (
    <div className={'am-card' + (compact ? ' compact' : '')}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Favicon src={tab.favicon} url={tab.url} size={16} />
        <div className="grow">
          <div className="ellipsis am-title" title={title}>
            {title}
          </div>
          <div className="ellipsis dim" style={{ fontSize: 11 }}>
            {state?.artist ? `${state.artist} · ` : ''}
            {tab.wsName}
            {tab.audible && !tab.muted ? ' · playing audio' : tab.muted ? ' · muted' : ''}
          </div>
        </div>
        <button className="icon-btn sm" onClick={() => activateTab(tab.id)} data-tip="Go to tab" aria-label="Go to tab">
          <ArrowUpRight size={13} />
        </button>
      </div>

      {wcId === null ? (
        <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
          Tab is asleep — go to the tab to wake it.
        </div>
      ) : missing ? (
        <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
          No media element found on this page (it may use a custom player or be inside a frame from another site). Use “Mute tab” or go to the tab.
        </div>
      ) : (
        <>
          <div
            className={'am-progress' + (dur ? '' : ' live')}
            onClick={(e) => {
              if (!dur) return
              const r = e.currentTarget.getBoundingClientRect()
              const target = ((e.clientX - r.left) / r.width) * dur
              control('seek', target - pos)
            }}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={dur ?? 0}
            aria-valuenow={pos}
          >
            <div style={{ width: pct + '%' }} />
          </div>
          <div className="row mono dim" style={{ fontSize: 10.5, marginTop: 4 }}>
            <span>{fmt(pos)}</span>
            <span className="spacer" />
            <span>{dur ? fmt(dur) : 'LIVE'}</span>
          </div>
        </>
      )}

      <div className="row am-controls">
        <button className="icon-btn sm" disabled={disabled} onClick={() => control('seek', -10)} data-tip="Back 10 s" aria-label="Back 10 seconds">
          <Rewind size={14} />
        </button>
        <button className="icon-btn am-play" disabled={disabled} onClick={() => control('toggle')} data-tip={state?.playing ? 'Pause' : 'Play'} aria-label={state?.playing ? 'Pause' : 'Play'}>
          {state?.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="icon-btn sm" disabled={disabled} onClick={() => control('seek', 10)} data-tip="Forward 10 s" aria-label="Forward 10 seconds">
          <FastForward size={14} />
        </button>
        <span className="spacer" />
        <button className={'icon-btn sm' + (tab.muted ? ' on' : '')} onClick={() => setMuted(tab.id, !tab.muted)} data-tip={tab.muted ? 'Unmute tab' : 'Mute tab'} aria-label="Mute tab">
          {tab.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        {!compact && (
          <input
            type="range"
            className="am-range"
            min={0}
            max={100}
            disabled={disabled}
            value={Math.round((state?.volume ?? 1) * 100)}
            onChange={(e) => control('volume', Number(e.target.value) / 100)}
            aria-label="Volume"
            data-tip="Player volume"
          />
        )}
        <div className="am-speed">
          <button className="icon-btn sm" disabled={disabled || (state?.rate ?? 1) <= 0.07} onClick={() => control('rate', stepSpeed(state?.rate ?? 1, -1, step))} data-tip="Slower" aria-label="Slower">
            <Minus size={12} />
          </button>
          <select className="select am-rate" disabled={disabled} value={String(state?.rate ?? 1)} onChange={(e) => control('rate', Number(e.target.value))} aria-label="Playback speed">
            {!RATES.some((r) => sameSpeed(r, state?.rate ?? 1)) && <option value={String(state?.rate)}>{formatSpeed(state?.rate ?? 1)}</option>}
            {RATES.map((r) => (
              <option key={r} value={String(r)}>
                {formatSpeed(r)}
              </option>
            ))}
          </select>
          <button className="icon-btn sm" disabled={disabled || (state?.rate ?? 1) >= 16} onClick={() => control('rate', stepSpeed(state?.rate ?? 1, 1, step))} data-tip="Faster" aria-label="Faster">
            <Plus size={12} />
          </button>
        </div>
        <button className="icon-btn sm" disabled={disabled || !state?.hasVideo} onClick={() => control('pip')} data-tip={state?.hasVideo ? 'Picture-in-picture' : 'Picture-in-picture (video only)'} aria-label="Picture in picture">
          <PictureInPicture2 size={14} />
        </button>
      </div>
    </div>
  )
}

export function MediaList({ compact }: { compact?: boolean }) {
  const tabs = useMediaTabs()
  const sorted = [...tabs].sort((a, b) => Number(b.audible) - Number(a.audible))
  if (!sorted.length)
    return (
      <div className="empty" style={{ padding: compact ? '18px 10px' : undefined }}>
        <Music size={compact ? 18 : 24} />
        <div>Nothing playing</div>
        {!compact && <div className="dim" style={{ fontSize: 11.5 }}>Tabs that play audio or video in this window appear here.</div>}
      </div>
    )
  return (
    <div className="col" style={{ gap: 8, padding: compact ? 0 : 10 }}>
      {sorted.map((t) => (
        <MediaCard key={t.id} tab={t} compact={compact} />
      ))}
    </div>
  )
}

export default function MediaPanel({ popout }: { popout?: boolean }) {
  if (popout) return <div className="empty">Media controls work inside a browser window.</div>
  return <MediaList />
}

/** Status bar: "▶ Title" while any tab in this window plays audio. */
export function MediaStatus() {
  const playing = useBrowser((s) => {
    let first = ''
    let n = 0
    for (const wsId of s.openOrder)
      for (const t of s.open[wsId]?.tabs ?? [])
        if (t.audible && !t.muted) {
          n++
          if (!first) first = t.title || t.url
        }
    return n ? `${n}\u0000${first}` : ''
  })
  if (!playing) return null
  const [n, title] = playing.split('\u0000')
  return (
    <button className="sb-item" onClick={() => toggleSidePanel('media')} data-tip="Media controls">
      <Play size={10} className="accent" />
      <span className="ellipsis" style={{ maxWidth: 220 }}>
        {title}
      </span>
      {Number(n) > 1 && <span className="dim">+{Number(n) - 1}</span>}
    </button>
  )
}

export async function playPauseActive(): Promise<void> {
  const t = activeTab()
  const wcId = t ? wcIdFor(t.id) : null
  if (!t || wcId === null) return void toast({ kind: 'info', title: 'No media in this tab' })
  const s = await invoke('guest:media', wcId).catch(() => null)
  if (!s) return void toast({ kind: 'info', title: 'No media in this tab' })
  await invoke('guest:mediaControl', wcId, 'toggle')
}
