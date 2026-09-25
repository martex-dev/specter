// Tiny AI readouts: HUD ("AI ●/○") and status bar ("AI LOCAL · model" / "AI OFFLINE").
import { useEffect } from 'react'
import { runCommand, shortcutFor } from '../../lib/commands'
import { useSetting } from '../../stores/settings'
import { addStatusInterest, useAi } from './store'

/** HUD polls at most once a minute (and never while the window is hidden). */
function useHudPolling(enabled: boolean): void {
  const hudPollMs = useSetting('performance.hudPollMs')
  useEffect(() => (enabled ? addStatusInterest(Math.max(60_000, hudPollMs || 0), true) : undefined), [enabled, hudPollMs])
}

export function AiHudItem() {
  const enabled = useSetting('ai.enabled')
  useHudPolling(enabled)
  const st = useAi((s) => s.status)
  const busy = useAi((s) => !!s.activeRequestId)
  if (!enabled) return null
  const on = !!st?.running && st.models.length > 0
  const tip = !st ? 'Local AI · checking' : on ? `Local AI connected · ${st.model}${busy ? ' · generating' : ''}` : (st.error ?? 'Local AI offline')
  return (
    <button className="hud-item" onClick={() => runCommand('ai.toggle')} data-tip={tip} data-kbd={shortcutFor('ai.toggle')} aria-label="AI status">
      AI <b className={on ? 'ok' : 'dim'}>{on ? (busy ? '◉' : '●') : '○'}</b>
    </button>
  )
}

export function AiStatusItem() {
  const enabled = useSetting('ai.enabled')
  const st = useAi((s) => s.status)
  if (!enabled || !st) return null
  const on = st.running && st.models.length > 0
  const label = on ? `AI ${st.local ? 'LOCAL' : 'REMOTE'} · ${(st.model ?? '').toUpperCase()}` : 'AI OFFLINE'
  return (
    <button className="sb-item" onClick={() => runCommand('ai.toggle')} data-tip={on ? (st.local ? 'Prompts are processed on this computer' : `Prompts are sent to ${st.url}`) : (st.error ?? 'Local AI unavailable')}>
      <span className={on ? (st.local ? '' : 'warn') : 'dim'}>{label}</span>
    </button>
  )
}
