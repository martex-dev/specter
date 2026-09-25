// Theme engine. Themes are token maps applied as CSS custom properties.
import type { ThemeId } from '@shared/settings'

export interface ThemeTokens {
  name: string
  dark: boolean
  bg0: string // window frame / tab strip
  bg1: string // toolbar / active tab / page chrome
  bg2: string // panels, inputs
  bg3: string // hover
  bg4: string // pressed / selected
  line: string
  lineStrong: string
  fg0: string
  fg1: string
  fg2: string
  fg3: string
  accent: string
  accentFg: string
  ok: string
  warn: string
  bad: string
  info: string
  up: string
  down: string
  glass: string
  shadow: string
  radius: number
  font?: string
}

const base = {
  ok: '#5fd39a',
  warn: '#f2c14e',
  bad: '#ff6b73',
  info: '#79c0ff',
  up: '#3fcf8e',
  down: '#f0616d'
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  'specter-dark': {
    name: 'SPECTER Dark',
    dark: true,
    bg0: '#0c0d10',
    bg1: '#14161b',
    bg2: '#191c22',
    bg3: '#20242c',
    bg4: '#2a2f39',
    line: 'rgba(255,255,255,0.065)',
    lineStrong: 'rgba(255,255,255,0.12)',
    fg0: '#e9ebf0',
    fg1: '#b3b8c3',
    fg2: '#7d8391',
    fg3: '#545a67',
    accent: '#a3b1ff',
    accentFg: '#0c0d10',
    glass: 'rgba(20,22,27,0.82)',
    shadow: '0 18px 50px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)',
    radius: 7,
    ...base
  },
  obsidian: {
    name: 'Obsidian',
    dark: true,
    bg0: '#0e0e10',
    bg1: '#161618',
    bg2: '#1b1b1e',
    bg3: '#232327',
    bg4: '#2d2d32',
    line: 'rgba(255,255,255,0.06)',
    lineStrong: 'rgba(255,255,255,0.11)',
    fg0: '#ececee',
    fg1: '#b6b6bc',
    fg2: '#808088',
    fg3: '#56565e',
    accent: '#d6c7a1',
    accentFg: '#111',
    glass: 'rgba(22,22,24,0.85)',
    shadow: '0 18px 50px rgba(0,0,0,0.6)',
    radius: 6,
    ...base
  },
  midnight: {
    name: 'Midnight',
    dark: true,
    bg0: '#0a0f1c',
    bg1: '#0f1627',
    bg2: '#131b2f',
    bg3: '#1a2440',
    bg4: '#22304f',
    line: 'rgba(160,190,255,0.08)',
    lineStrong: 'rgba(160,190,255,0.15)',
    fg0: '#e6ecfa',
    fg1: '#aab6d3',
    fg2: '#7483a6',
    fg3: '#4c5a7a',
    accent: '#6fb3ff',
    accentFg: '#07101f',
    glass: 'rgba(15,22,39,0.85)',
    shadow: '0 18px 50px rgba(0,5,20,0.6)',
    radius: 7,
    ...base
  },
  void: {
    name: 'Void',
    dark: true,
    bg0: '#000000',
    bg1: '#08080a',
    bg2: '#0e0e11',
    bg3: '#17171b',
    bg4: '#222228',
    line: 'rgba(255,255,255,0.07)',
    lineStrong: 'rgba(255,255,255,0.13)',
    fg0: '#f2f2f4',
    fg1: '#a9a9b2',
    fg2: '#72727c',
    fg3: '#4a4a52',
    accent: '#ffffff',
    accentFg: '#000',
    glass: 'rgba(8,8,10,0.88)',
    shadow: '0 18px 50px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)',
    radius: 5,
    ...base
  },
  terminal: {
    name: 'Terminal',
    dark: true,
    bg0: '#050805',
    bg1: '#0a0f0a',
    bg2: '#0d140d',
    bg3: '#132013',
    bg4: '#1b2d1b',
    line: 'rgba(120,255,140,0.09)',
    lineStrong: 'rgba(120,255,140,0.17)',
    fg0: '#c8f5cc',
    fg1: '#8fcf96',
    fg2: '#5f9a66',
    fg3: '#3d6642',
    accent: '#5dff7a',
    accentFg: '#031005',
    glass: 'rgba(8,14,8,0.9)',
    shadow: '0 18px 50px rgba(0,0,0,0.7)',
    radius: 3,
    font: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
    ...base
  },
  minimal: {
    name: 'Minimal',
    dark: false,
    bg0: '#fafafa',
    bg1: '#ffffff',
    bg2: '#f4f4f5',
    bg3: '#ececee',
    bg4: '#e2e2e5',
    line: 'rgba(0,0,0,0.07)',
    lineStrong: 'rgba(0,0,0,0.12)',
    fg0: '#18181b',
    fg1: '#4a4a52',
    fg2: '#7a7a84',
    fg3: '#a8a8b0',
    accent: '#18181b',
    accentFg: '#ffffff',
    glass: 'rgba(255,255,255,0.9)',
    shadow: '0 14px 40px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)',
    radius: 6,
    ...base,
    ok: '#16a34a',
    warn: '#b7791f',
    bad: '#dc2626',
    info: '#2563eb',
    up: '#16a34a',
    down: '#dc2626'
  },
  light: {
    name: 'Light',
    dark: false,
    bg0: '#e9ebef',
    bg1: '#f7f8fa',
    bg2: '#ffffff',
    bg3: '#eef0f4',
    bg4: '#e1e4ea',
    line: 'rgba(15,23,42,0.08)',
    lineStrong: 'rgba(15,23,42,0.14)',
    fg0: '#161a22',
    fg1: '#454b58',
    fg2: '#737a88',
    fg3: '#a2a8b4',
    accent: '#4f5bd5',
    accentFg: '#ffffff',
    glass: 'rgba(247,248,250,0.9)',
    shadow: '0 14px 40px rgba(15,23,42,0.14), 0 1px 3px rgba(15,23,42,0.08)',
    radius: 7,
    ...base,
    ok: '#15924f',
    warn: '#b7791f',
    bad: '#d92d3a',
    info: '#2563eb',
    up: '#15924f',
    down: '#d92d3a'
  }
}

export function applyTheme(id: ThemeId, accentOverride?: string, fontOverride?: string): ThemeTokens {
  const t = THEMES[id] ?? THEMES['specter-dark']
  const r = document.documentElement.style
  const accent = accentOverride || t.accent
  const vars: Record<string, string> = {
    '--bg-0': t.bg0,
    '--bg-1': t.bg1,
    '--bg-2': t.bg2,
    '--bg-3': t.bg3,
    '--bg-4': t.bg4,
    '--line': t.line,
    '--line-strong': t.lineStrong,
    '--fg-0': t.fg0,
    '--fg-1': t.fg1,
    '--fg-2': t.fg2,
    '--fg-3': t.fg3,
    '--accent': accent,
    '--accent-fg': t.accentFg,
    '--accent-dim': hexA(accent, t.dark ? 0.14 : 0.1),
    '--accent-line': hexA(accent, 0.45),
    '--ok': t.ok,
    '--warn': t.warn,
    '--bad': t.bad,
    '--info': t.info,
    '--up': t.up,
    '--down': t.down,
    '--glass': t.glass,
    '--shadow-pop': t.shadow,
    '--radius': t.radius + 'px',
    '--radius-s': Math.max(2, t.radius - 2) + 'px',
    '--radius-l': t.radius + 3 + 'px'
  }
  for (const [k, v] of Object.entries(vars)) r.setProperty(k, v)
  const font = fontOverride || t.font
  if (font) r.setProperty('--font-ui', font)
  else r.removeProperty('--font-ui')
  document.documentElement.dataset.theme = id
  document.documentElement.dataset.scheme = t.dark ? 'dark' : 'light'
  return t
}

export function hexA(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
