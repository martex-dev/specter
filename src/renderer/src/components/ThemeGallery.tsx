// Theme picker: live mini-mockups of each theme pack in its own layout,
// palette swatches, custom accent, and mix-and-match layout overrides.
import { Check, Image, RotateCcw, Sparkles } from 'lucide-react'
import type { ThemeId } from '@shared/settings'
import { THEMES, resolveTheme, type Palette, type TabStyle, type ThemeDef } from '../lib/themes'
import { setSetting, useSetting } from '../stores/settings'
import { Seg, Switch } from './ui'
import { getCommand } from '../lib/commands'

function MiniTabs({ style, p }: { style: TabStyle; p: Palette }) {
  const tab = (active: boolean, i: number) => {
    const base: React.CSSProperties = { height: 12, width: 34, flex: 'none', fontSize: 0 }
    const on = active ? p.accent : p.fg3
    switch (style) {
      case 'angled':
        return <i key={i} style={{ ...base, background: active ? p.bg1 : 'transparent', clipPath: 'polygon(12% 0,100% 0,88% 100%,0 100%)', borderBottom: `2px solid ${active ? on : 'transparent'}`, boxShadow: active ? `0 2px 8px ${hexGlow(p.accent)}` : undefined }} />
      case 'pill':
        return <i key={i} style={{ ...base, height: 10, borderRadius: 6, background: active ? p.bg3 : p.bg2, border: `1px solid ${p.line}`, marginTop: 1 }} />
      case 'bracket':
        return (
          <i key={i} style={{ ...base, width: 32, height: 10, fontFamily: 'Consolas, monospace', fontSize: 8, lineHeight: '10px', color: active ? p.bg0 : on, background: active ? p.accent : 'transparent', fontStyle: 'normal', textAlign: 'center' }}>
            [{i}:tab]
          </i>
        )
      case 'underline':
        return <i key={i} style={{ ...base, height: 10, borderBottom: `2px solid ${active ? p.accent : 'transparent'}`, background: 'transparent', boxShadow: `inset 0 -5px 0 -4px ${p.fg3}` }} />
      case 'block':
        return <i key={i} style={{ ...base, height: 11, borderRadius: 5, background: active ? `linear-gradient(90deg, ${p.accent}, ${p.accent2})` : p.bg3, boxShadow: active ? `0 0 10px ${hexGlow(p.accent)}` : undefined }} />
      default:
        return <i key={i} style={{ ...base, borderRadius: '5px 5px 0 0', background: active ? p.bg1 : 'transparent' }} />
    }
  }
  return <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 14 }}>{[0, 1, 2].map((i) => tab(i === 0, i + 1))}</div>
}

function hexGlow(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.6)`
}

function backdrop(t: ThemeDef, p: Palette): string {
  if (t.id === 'aurora') return `radial-gradient(120% 90% at 10% 0%, ${p.accent}55, transparent 60%), radial-gradient(90% 90% at 100% 20%, ${p.accent2}66, transparent 60%), radial-gradient(90% 70% at 50% 110%, ${p.accent3 ?? p.accent}55, transparent 60%), ${p.bg0}`
  if (t.id === 'synthwave') return `linear-gradient(180deg, ${p.bg0} 0%, ${p.bg2} 55%, ${p.accent}44 100%)`
  if (t.id === 'terminal') return `repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0 1px, transparent 1px 3px), ${p.bg0}`
  return p.bg0
}

export function ThemePreview({ theme, palette, selected, onClick }: { theme: ThemeDef; palette: Palette; selected: boolean; onClick: () => void }) {
  const p = palette
  const L = theme.layout
  const floating = L.frame === 'floating'
  const rail = (
    <div style={{ width: 12, display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 2px', background: theme.id === 'aurora' ? 'rgba(255,255,255,0.06)' : p.bg0, borderRadius: floating ? 6 : 0 }}>
      {[p.accent, p.fg3, p.fg3, p.fg3].map((c, i) => (
        <i key={i} style={{ height: 6, borderRadius: theme.radius ? 2 : 0, background: c, opacity: i ? 0.5 : 1, boxShadow: i === 0 && theme.id === 'neon' ? `0 0 6px ${p.accent}` : undefined }} />
      ))}
    </div>
  )
  return (
    <button className={'theme-card' + (selected ? ' on' : '')} onClick={onClick} style={{ fontFamily: theme.fonts.ui }} aria-pressed={selected}>
      <div className="theme-mock" style={{ background: backdrop(theme, p), borderRadius: theme.radius ? 8 : 0 }}>
        <div style={{ padding: '6px 8px 0', display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <MiniTabs style={L.tabs} p={p} />
        </div>
        <div style={{ height: 14, margin: floating ? '3px 6px 0' : 0, background: p.bg1, display: 'flex', alignItems: 'center', padding: '0 6px', borderRadius: floating ? 6 : 0, justifyContent: L.omnibox === 'centered' ? 'center' : 'flex-start', borderBottom: theme.id === 'neon' ? `1px solid ${p.accent}` : undefined }}>
          <i style={{ height: 6, width: L.omnibox === 'centered' ? '55%' : '75%', borderRadius: theme.radius ? 4 : 0, background: p.bg3 }} />
        </div>
        <div style={{ flex: 1, display: 'flex', gap: floating ? 4 : 0, padding: floating ? 5 : 0, flexDirection: L.rail === 'left' ? 'row' : 'row-reverse' }}>
          {rail}
          <div style={{ flex: 1, background: p.dark ? p.bg1 : p.bg2, borderRadius: floating ? 7 : 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 4, boxShadow: floating ? '0 6px 18px rgba(0,0,0,0.35)' : undefined, border: theme.id === 'aurora' ? `1px solid ${p.lineStrong}` : undefined }}>
            <i style={{ height: 7, width: '45%', borderRadius: 3, background: p.fg1, opacity: 0.8, fontFamily: theme.fonts.display }} />
            <i style={{ height: 5, width: '80%', borderRadius: 3, background: p.fg3 }} />
            <i style={{ height: 5, width: '65%', borderRadius: 3, background: p.fg3 }} />
            <i style={{ height: 8, width: 36, marginTop: 'auto', borderRadius: theme.radius ? 4 : 0, background: theme.id === 'synthwave' ? `linear-gradient(90deg, ${p.accent}, ${p.accent2})` : p.accent }} />
          </div>
        </div>
      </div>
      <div className="theme-meta">
        <div className="row" style={{ gap: 6 }}>
          <b style={{ fontFamily: theme.fonts.display }}>{theme.name}</b>
          {selected && <Check size={13} className="accent" />}
        </div>
        <div className="theme-tag">{theme.tagline}</div>
      </div>
    </button>
  )
}

export function ThemeGallery({ compact = false }: { compact?: boolean }) {
  const themeId = useSetting('appearance.theme')
  const paletteId = useSetting('appearance.palette')
  const accent = useSetting('appearance.accent')
  const layout = useSetting('appearance.layout')
  const effects = useSetting('appearance.effects')
  const verticalTabs = useSetting('appearance.verticalTabs')
  const { theme, palette } = resolveTheme(themeId, paletteId)

  const pickTheme = (id: ThemeId) => {
    setSetting('appearance.theme', id)
    setSetting('appearance.palette', '')
    setSetting('appearance.accent', '')
    setSetting('appearance.layout', {})
  }

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <ThemePreview key={t.id} theme={t} palette={t.id === theme.id ? palette : t.palettes[0]} selected={t.id === theme.id} onClick={() => pickTheme(t.id)} />
        ))}
      </div>

      <div>
        <div className="label" style={{ marginBottom: 8 }}>
          {theme.name} palettes
        </div>
        <div className="palette-row">
          {theme.palettes.map((p) => (
            <button key={p.id} className={'palette-chip' + (p.id === palette.id ? ' on' : '')} onClick={() => (setSetting('appearance.palette', p.id), setSetting('appearance.accent', ''))} aria-pressed={p.id === palette.id}>
              <span className="palette-sw" style={{ background: `linear-gradient(135deg, ${p.bg0} 0 45%, ${p.accent} 45% 72%, ${p.accent2} 72%)` }} />
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {!compact && (
        <div className="card setting-group">
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Accent colour</div>
              <div className="st-desc">Overrides the palette’s accent everywhere — glows, highlights, active tabs.</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {['', '#ff2d55', '#ff8a4c', '#ffc400', '#a3ff12', '#34d399', '#34d8ff', '#6f8bff', '#9d4dff', '#ff2bd6', '#ffffff'].map((c) => (
                <button key={c || 'default'} onClick={() => setSetting('appearance.accent', c)} aria-label={c || 'Palette default'} data-tip={c || 'Palette default'} className={'accent-dot' + (accent === c ? ' on' : '')} style={{ background: c || `conic-gradient(${palette.accent} 0 50%, ${palette.accent2} 0)` }} />
              ))}
              <input type="color" value={accent || palette.accent} onChange={(e) => setSetting('appearance.accent', e.target.value)} className="accent-picker" aria-label="Custom accent colour" />
            </div>
          </div>
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Tab style</div>
              <div className="st-desc">Mix and match — defaults to the theme’s own style.</div>
            </div>
            <select className="select" value={layout.tabs ?? ''} onChange={(e) => setSetting('appearance.layout', { ...layout, tabs: (e.target.value || undefined) as never })}>
              <option value="">Theme default ({theme.layout.tabs})</option>
              <option value="chrome">Connected</option>
              <option value="pill">Floating pills</option>
              <option value="angled">Angled</option>
              <option value="block">Chunky blocks</option>
              <option value="bracket">[ Brackets ]</option>
              <option value="underline">Underlined text</option>
            </select>
          </div>
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Vertical tabs</div>
              <div className="st-desc">Tabs in a sidebar that collapses to icons and expands on hover.</div>
            </div>
            <Switch on={verticalTabs} onChange={(v) => setSetting('appearance.verticalTabs', v)} />
          </div>
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Frame</div>
              <div className="st-desc">Floating insets the page as a card with rounded corners.</div>
            </div>
            <Seg value={layout.frame ?? 'theme'} options={[{ value: 'theme', label: 'Theme' }, { value: 'flush', label: 'Flush' }, { value: 'floating', label: 'Floating' }]} onChange={(v) => setSetting('appearance.layout', { ...layout, frame: v === 'theme' ? undefined : (v as 'flush' | 'floating') })} />
          </div>
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Address bar</div>
            </div>
            <Seg value={layout.omnibox ?? 'theme'} options={[{ value: 'theme', label: 'Theme' }, { value: 'standard', label: 'Full width' }, { value: 'centered', label: 'Centered' }]} onChange={(v) => setSetting('appearance.layout', { ...layout, omnibox: v === 'theme' ? undefined : (v as 'standard' | 'centered') })} />
          </div>
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Sidebar side</div>
            </div>
            <Seg value={layout.rail ?? 'theme'} options={[{ value: 'theme', label: 'Theme' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={(v) => setSetting('appearance.layout', { ...layout, rail: v === 'theme' ? undefined : (v as 'left' | 'right') })} />
          </div>
          <div className="setting">
            <div className="st-text">
              <div className="st-title">
                <Sparkles size={13} /> Ambient effects
              </div>
              <div className="st-desc">Animated gradients, glows and scanlines. Turned off automatically with reduced motion.</div>
            </div>
            <Switch on={effects} onChange={(v) => setSetting('appearance.effects', v)} />
          </div>
          {getCommand('control.wallpaper') && (
            <div className="setting">
              <div className="st-text">
                <div className="st-title">
                  <Image size={13} /> New tab wallpaper
                </div>
                <div className="st-desc">Animated scenes or your own image behind the new tab page.</div>
              </div>
              <button className="btn" onClick={() => getCommand('control.wallpaper')?.run()}>
                Choose…
              </button>
            </div>
          )}
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Reset to theme defaults</div>
            </div>
            <button className="btn" onClick={() => (setSetting('appearance.layout', {}), setSetting('appearance.accent', ''), setSetting('appearance.palette', ''))}>
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
