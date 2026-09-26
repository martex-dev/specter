// A side panel rendered alone in a floating window.
import { Suspense, useEffect, useState } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { sidePanels } from '../lib/registry'
import { applyTheme, titleBarColors } from '../lib/themes'
import { useSetting } from '../stores/settings'
import { invoke } from '../lib/ipc'
import { MenuLayer, PromptLayerless, Toasts, TooltipLayer } from './popoutUi'

export function PopoutPanel({ id }: { id: string }) {
  const def = sidePanels.get(id)
  const theme = useSetting('appearance.theme')
  const palette = useSetting('appearance.palette')
  const accent = useSetting('appearance.accent')
  const [onTop, setOnTop] = useState(false)
  useEffect(() => {
    const t = applyTheme(theme, palette, accent)
    invoke('window:setTitleBarOverlay', { ...titleBarColors(t), height: 32 }).catch(() => undefined)
  }, [theme, palette, accent])
  if (!def) return <div className="empty">Unknown panel “{id}”.</div>
  const C = def.component
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-1)' }}>
      <div className="drag row" style={{ height: 32, padding: '0 150px 0 12px', background: 'var(--bg-0)', borderBottom: '1px solid var(--line)', flex: 'none' }}>
        <def.icon size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{def.title}</span>
        <span className="spacer" />
        <button
          className={'icon-btn sm no-drag' + (onTop ? ' on' : '')}
          onClick={async () => {
            setOnTop(!onTop)
            await invoke('window:popout', id, { alwaysOnTop: !onTop })
          }}
          data-tip={onTop ? 'Stop keeping on top' : 'Keep on top'}
          aria-label="Always on top"
        >
          {onTop ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Suspense fallback={<div className="empty">Loading…</div>}>
          <C popout />
        </Suspense>
      </div>
      <MenuLayer />
      <PromptLayerless />
      <Toasts />
      <TooltipLayer />
    </div>
  )
}
