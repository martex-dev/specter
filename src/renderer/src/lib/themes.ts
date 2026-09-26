// Theme engine v2. A theme is a complete design pack — layout (tab shape,
// frame, dock side, omnibox placement), typography, background effects and a
// set of colour palettes. The user picks a theme, then a palette, then may
// override the accent colour and individual layout choices.
import type { ThemeId } from '@shared/settings'

export type TabStyle = 'chrome' | 'pill' | 'angled' | 'bracket' | 'underline' | 'block' | 'sheet' | 'sticker' | 'bevel' | 'holo' | 'notch'
export type FrameStyle = 'flush' | 'floating'
export type OmniboxStyle = 'standard' | 'centered'

export interface ThemeLayout {
  tabs: TabStyle
  frame: FrameStyle
  rail: 'left' | 'right'
  omnibox: OmniboxStyle
}

export interface Palette {
  id: string
  name: string
  dark: boolean
  bg0: string // window frame / tab strip
  bg1: string // toolbar / active tab
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
  accent2: string
  accent3?: string
  accentFg: string
  ok?: string
  warn?: string
  bad?: string
  up?: string
  down?: string
}

export interface ThemeDef {
  id: ThemeId
  name: string
  tagline: string
  layout: ThemeLayout
  fonts: { ui: string; display: string; mono: string }
  radius: number
  palettes: Palette[]
}

const MONO = "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', Consolas, monospace"
const SEGOE = "'Segoe UI Variable Text', 'Segoe UI', 'Inter', system-ui, sans-serif"
const SEGOE_DISPLAY = "'Segoe UI Variable Display', 'Segoe UI', 'Inter', system-ui, sans-serif"
const DIN = "'Bahnschrift', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
const SERIF_DISPLAY = "'Sitka Heading', 'Sitka Display', 'Iowan Old Style', Georgia, serif"
const DIN_CONDENSED = "'Bahnschrift Condensed', 'Bahnschrift', 'Arial Narrow', system-ui, sans-serif"
const HEAVY = "'Arial Black', 'Segoe UI Black', 'Segoe UI', Impact, sans-serif"
const GROTESK = "'Segoe UI', 'Arial', 'Helvetica Neue', sans-serif"
const TAHOMA = "Tahoma, 'MS Sans Serif', 'Segoe UI', Verdana, sans-serif"

const dark = (p: Omit<Palette, 'dark' | 'accentFg'> & { accentFg?: string }): Palette => ({ dark: true, accentFg: '#0b0b0f', ...p })
const light = (p: Omit<Palette, 'dark' | 'accentFg'> & { accentFg?: string }): Palette => ({
  dark: false,
  accentFg: '#ffffff',
  ok: '#1f8a4c',
  warn: '#a86b12',
  bad: '#c62f3b',
  up: '#1f8a4c',
  down: '#c62f3b',
  ...p
})

const graphite = { line: 'rgba(255,255,255,0.065)', lineStrong: 'rgba(255,255,255,0.12)' }

export const THEMES: ThemeDef[] = [
  {
    id: 'specter',
    name: 'Specter',
    tagline: 'Refined graphite. Quiet, precise, professional.',
    layout: { tabs: 'chrome', frame: 'flush', rail: 'right', omnibox: 'standard' },
    fonts: { ui: SEGOE, display: SEGOE_DISPLAY, mono: MONO },
    radius: 7,
    palettes: [
      dark({ id: 'specter', name: 'Specter', bg0: '#0c0d10', bg1: '#14161b', bg2: '#191c22', bg3: '#20242c', bg4: '#2a2f39', ...graphite, fg0: '#e9ebf0', fg1: '#b3b8c3', fg2: '#7d8391', fg3: '#545a67', accent: '#a3b1ff', accent2: '#7dd3fc' }),
      dark({ id: 'obsidian', name: 'Obsidian', bg0: '#0e0e10', bg1: '#161618', bg2: '#1b1b1e', bg3: '#232327', bg4: '#2d2d32', ...graphite, fg0: '#ececee', fg1: '#b6b6bc', fg2: '#808088', fg3: '#56565e', accent: '#d9c69a', accent2: '#e8a86d' }),
      dark({ id: 'midnight', name: 'Midnight', bg0: '#0a0f1c', bg1: '#0f1627', bg2: '#131b2f', bg3: '#1a2440', bg4: '#22304f', line: 'rgba(160,190,255,0.08)', lineStrong: 'rgba(160,190,255,0.15)', fg0: '#e6ecfa', fg1: '#aab6d3', fg2: '#7483a6', fg3: '#4c5a7a', accent: '#6fb3ff', accent2: '#a78bfa' }),
      dark({ id: 'ember', name: 'Ember', bg0: '#110c0a', bg1: '#191310', bg2: '#1f1814', bg3: '#29201a', bg4: '#352921', line: 'rgba(255,200,160,0.07)', lineStrong: 'rgba(255,200,160,0.13)', fg0: '#f4e9e2', fg1: '#c7b4a8', fg2: '#8e7a6e', fg3: '#5e4f46', accent: '#ff8a4c', accent2: '#ffc46b' }),
      dark({ id: 'jade', name: 'Jade', bg0: '#08100e', bg1: '#0d1714', bg2: '#111d19', bg3: '#172621', bg4: '#1f322b', line: 'rgba(160,255,220,0.07)', lineStrong: 'rgba(160,255,220,0.13)', fg0: '#e3f4ee', fg1: '#a9c8bd', fg2: '#6f8f84', fg3: '#48605a', accent: '#34d399', accent2: '#5eead4' }),
      dark({ id: 'void', name: 'Void', bg0: '#000000', bg1: '#08080a', bg2: '#0e0e11', bg3: '#17171b', bg4: '#222228', ...graphite, fg0: '#f2f2f4', fg1: '#a9a9b2', fg2: '#72727c', fg3: '#4a4a52', accent: '#ffffff', accent2: '#9ca3af', accentFg: '#000000' })
    ]
  },
  {
    id: 'neon',
    name: 'Neon',
    tagline: 'Gamer HUD. Angular tabs, glowing edges, left dock.',
    layout: { tabs: 'angled', frame: 'flush', rail: 'left', omnibox: 'standard' },
    fonts: { ui: DIN, display: DIN, mono: MONO },
    radius: 3,
    palettes: [
      dark({ id: 'havoc', name: 'Havoc', bg0: '#070709', bg1: '#0e0e12', bg2: '#131318', bg3: '#1b1b22', bg4: '#26262f', line: 'rgba(255,60,90,0.12)', lineStrong: 'rgba(255,60,90,0.24)', fg0: '#f4f4f8', fg1: '#bdbdc9', fg2: '#80808f', fg3: '#50505c', accent: '#ff2d55', accent2: '#ff7a2d' }),
      dark({ id: 'cyber', name: 'Cyber', bg0: '#07060b', bg1: '#0e0c15', bg2: '#13101c', bg3: '#1c1728', bg4: '#282036', line: 'rgba(255,43,214,0.12)', lineStrong: 'rgba(255,43,214,0.25)', fg0: '#f7f2ff', fg1: '#c4b8d6', fg2: '#85799a', fg3: '#554a66', accent: '#ff2bd6', accent2: '#00e5ff' }),
      dark({ id: 'toxic', name: 'Toxic', bg0: '#060806', bg1: '#0c100c', bg2: '#111611', bg3: '#182018', bg4: '#222c21', line: 'rgba(163,255,18,0.11)', lineStrong: 'rgba(163,255,18,0.22)', fg0: '#f1fbe9', fg1: '#bcccb0', fg2: '#7d8c73', fg3: '#4f5b48', accent: '#a3ff12', accent2: '#12ffb0' }),
      dark({ id: 'ultraviolet', name: 'Ultraviolet', bg0: '#08060e', bg1: '#0f0c19', bg2: '#141022', bg3: '#1d1730', bg4: '#291f43', line: 'rgba(157,77,255,0.13)', lineStrong: 'rgba(157,77,255,0.26)', fg0: '#f4efff', fg1: '#c1b5dc', fg2: '#82779e', fg3: '#534a6c', accent: '#9d4dff', accent2: '#ff4dd8', accentFg: '#ffffff' }),
      dark({ id: 'frost', name: 'Frost', bg0: '#05080c', bg1: '#0a1017', bg2: '#0e151e', bg3: '#141e2a', bg4: '#1c2938', line: 'rgba(52,216,255,0.11)', lineStrong: 'rgba(52,216,255,0.23)', fg0: '#edf8ff', fg1: '#b1c6d6', fg2: '#728698', fg3: '#475766', accent: '#34d8ff', accent2: '#7c9cff' }),
      dark({ id: 'goldrush', name: 'Gold Rush', bg0: '#090805', bg1: '#110f0a', bg2: '#16140d', bg3: '#201c12', bg4: '#2c2618', line: 'rgba(255,196,0,0.11)', lineStrong: 'rgba(255,196,0,0.22)', fg0: '#fbf6e8', fg1: '#cdc3a6', fg2: '#8d8469', fg3: '#5c5643', accent: '#ffc400', accent2: '#ff7a00' })
    ]
  },
  {
    id: 'aurora',
    name: 'Aurora',
    tagline: 'Frosted glass over living light. Floating everything.',
    layout: { tabs: 'pill', frame: 'floating', rail: 'right', omnibox: 'centered' },
    fonts: { ui: SEGOE, display: SEGOE_DISPLAY, mono: MONO },
    radius: 12,
    palettes: [
      dark({ id: 'borealis', name: 'Borealis', bg0: '#070b17', bg1: 'rgba(18,24,44,0.55)', bg2: 'rgba(255,255,255,0.06)', bg3: 'rgba(255,255,255,0.10)', bg4: 'rgba(255,255,255,0.16)', line: 'rgba(255,255,255,0.10)', lineStrong: 'rgba(255,255,255,0.18)', fg0: '#f1f5ff', fg1: '#c3cce6', fg2: '#8792b3', fg3: '#5b6585', accent: '#5ef2c2', accent2: '#7a5cff', accent3: '#1fb6ff' }),
      dark({ id: 'sunset', name: 'Sunset', bg0: '#120812', bg1: 'rgba(40,16,34,0.55)', bg2: 'rgba(255,255,255,0.06)', bg3: 'rgba(255,255,255,0.10)', bg4: 'rgba(255,255,255,0.16)', line: 'rgba(255,255,255,0.10)', lineStrong: 'rgba(255,255,255,0.18)', fg0: '#fff3f1', fg1: '#e4c3c8', fg2: '#a98690', fg3: '#735a63', accent: '#ff9a5c', accent2: '#ff4f8b', accent3: '#8f5bff' }),
      dark({ id: 'lagoon', name: 'Lagoon', bg0: '#04101a', bg1: 'rgba(10,32,48,0.55)', bg2: 'rgba(255,255,255,0.06)', bg3: 'rgba(255,255,255,0.10)', bg4: 'rgba(255,255,255,0.16)', line: 'rgba(255,255,255,0.10)', lineStrong: 'rgba(255,255,255,0.18)', fg0: '#effbff', fg1: '#bcd8e4', fg2: '#7e9cab', fg3: '#546e7c', accent: '#4fd1ff', accent2: '#2f6bff', accent3: '#19e3c4' }),
      dark({ id: 'rose', name: 'Rosé', bg0: '#140a12', bg1: 'rgba(42,20,34,0.55)', bg2: 'rgba(255,255,255,0.06)', bg3: 'rgba(255,255,255,0.10)', bg4: 'rgba(255,255,255,0.16)', line: 'rgba(255,255,255,0.10)', lineStrong: 'rgba(255,255,255,0.18)', fg0: '#fff2f7', fg1: '#e6c4d2', fg2: '#a98797', fg3: '#745b67', accent: '#ff8fb8', accent2: '#ffb38a', accent3: '#c77dff' }),
      dark({ id: 'nebula', name: 'Nebula', bg0: '#0a0714', bg1: 'rgba(28,18,50,0.55)', bg2: 'rgba(255,255,255,0.06)', bg3: 'rgba(255,255,255,0.10)', bg4: 'rgba(255,255,255,0.16)', line: 'rgba(255,255,255,0.10)', lineStrong: 'rgba(255,255,255,0.18)', fg0: '#f6f1ff', fg1: '#cdc2e8', fg2: '#8f84ae', fg3: '#615980', accent: '#d946ef', accent2: '#6366f1', accent3: '#22d3ee' }),
      dark({ id: 'canopy', name: 'Canopy', bg0: '#06110c', bg1: 'rgba(14,38,26,0.55)', bg2: 'rgba(255,255,255,0.06)', bg3: 'rgba(255,255,255,0.10)', bg4: 'rgba(255,255,255,0.16)', line: 'rgba(255,255,255,0.10)', lineStrong: 'rgba(255,255,255,0.18)', fg0: '#effff4', fg1: '#bddcc8', fg2: '#7f9f8a', fg3: '#56705f', accent: '#7ee081', accent2: '#2dd4bf', accent3: '#d9f99d' })
    ]
  },
  {
    id: 'terminal',
    name: 'Terminal',
    tagline: 'Phosphor CRT. Monospace, brackets, scanlines.',
    layout: { tabs: 'bracket', frame: 'flush', rail: 'left', omnibox: 'standard' },
    fonts: { ui: MONO, display: MONO, mono: MONO },
    radius: 0,
    palettes: [
      dark({ id: 'phosphor', name: 'Phosphor', bg0: '#020402', bg1: '#040904', bg2: '#071007', bg3: '#0c1a0c', bg4: '#122812', line: 'rgba(80,255,120,0.14)', lineStrong: 'rgba(80,255,120,0.3)', fg0: '#b9ffbf', fg1: '#7fd88a', fg2: '#4f9a5a', fg3: '#2f6038', accent: '#39ff6a', accent2: '#b9ffbf', ok: '#39ff6a', up: '#39ff6a' }),
      dark({ id: 'amber', name: 'Amber', bg0: '#050302', bg1: '#0a0604', bg2: '#110a05', bg3: '#1b1208', bg4: '#2a1b0b', line: 'rgba(255,176,0,0.15)', lineStrong: 'rgba(255,176,0,0.3)', fg0: '#ffdda0', fg1: '#e0ab5c', fg2: '#9a7338', fg3: '#5f4722', accent: '#ffb000', accent2: '#ffdda0' }),
      dark({ id: 'ibm', name: 'IBM 3270', bg0: '#02040a', bg1: '#040812', bg2: '#070d1b', bg3: '#0c1629', bg4: '#12213c', line: 'rgba(90,169,255,0.15)', lineStrong: 'rgba(90,169,255,0.3)', fg0: '#d4e6ff', fg1: '#94b8e6', fg2: '#5b7ba3', fg3: '#384d68', accent: '#5aa9ff', accent2: '#d4e6ff' }),
      dark({ id: 'matrix', name: 'Matrix', bg0: '#000300', bg1: '#010601', bg2: '#020b03', bg3: '#041606', bg4: '#07230a', line: 'rgba(0,255,65,0.12)', lineStrong: 'rgba(0,255,65,0.28)', fg0: '#8dffa5', fg1: '#35d65b', fg2: '#1f8a39', fg3: '#135a24', accent: '#00ff41', accent2: '#d0ffd8' }),
      dark({ id: 'synth', name: 'Hot Pink', bg0: '#060207', bg1: '#0c040d', bg2: '#140715', bg3: '#200b22', bg4: '#321135', line: 'rgba(255,95,210,0.15)', lineStrong: 'rgba(255,95,210,0.3)', fg0: '#ffd0f4', fg1: '#e08ccb', fg2: '#9a5a8a', fg3: '#5f3856', accent: '#ff5fd2', accent2: '#ffd0f4' }),
      dark({ id: 'paperwhite', name: 'Paper White', bg0: '#030303', bg1: '#070707', bg2: '#0d0d0d', bg3: '#161616', bg4: '#222222', line: 'rgba(255,255,255,0.13)', lineStrong: 'rgba(255,255,255,0.28)', fg0: '#eeeeee', fg1: '#b0b0b0', fg2: '#727272', fg3: '#474747', accent: '#ffffff', accent2: '#bbbbbb', accentFg: '#000000' })
    ]
  },
  {
    id: 'paper',
    name: 'Paper',
    tagline: 'Editorial light. Serif type, hairlines, calm.',
    layout: { tabs: 'underline', frame: 'flush', rail: 'right', omnibox: 'centered' },
    fonts: { ui: SEGOE, display: SERIF_DISPLAY, mono: MONO },
    radius: 4,
    palettes: [
      light({ id: 'ivory', name: 'Ivory', bg0: '#efe9dd', bg1: '#f8f4ec', bg2: '#fffdf8', bg3: '#efe8da', bg4: '#e4dbc9', line: 'rgba(40,30,15,0.10)', lineStrong: 'rgba(40,30,15,0.18)', fg0: '#1d1a14', fg1: '#4a4336', fg2: '#7b7263', fg3: '#a99f8e', accent: '#b3261e', accent2: '#1d1a14' }),
      light({ id: 'newsprint', name: 'Newsprint', bg0: '#e6e6e2', bg1: '#f2f2ef', bg2: '#fbfbf9', bg3: '#e9e9e5', bg4: '#dcdcd7', line: 'rgba(0,0,0,0.10)', lineStrong: 'rgba(0,0,0,0.2)', fg0: '#111111', fg1: '#3f3f3f', fg2: '#6f6f6f', fg3: '#a0a0a0', accent: '#111111', accent2: '#555555' }),
      light({ id: 'blueprint', name: 'Blueprint', bg0: '#dfe8f3', bg1: '#edf3fa', bg2: '#f8fbfe', bg3: '#e2ebf6', bg4: '#d3e0ef', line: 'rgba(20,60,120,0.12)', lineStrong: 'rgba(20,60,120,0.22)', fg0: '#0f2340', fg1: '#35507a', fg2: '#6680a6', fg3: '#9bb0cc', accent: '#1f5fbf', accent2: '#0f2340' }),
      light({ id: 'sage', name: 'Sage', bg0: '#e3eae1', bg1: '#f0f4ee', bg2: '#fafcf9', bg3: '#e5ece2', bg4: '#d6e0d2', line: 'rgba(30,60,35,0.11)', lineStrong: 'rgba(30,60,35,0.2)', fg0: '#172418', fg1: '#3d523f', fg2: '#6c806d', fg3: '#9eae9f', accent: '#3f7d4e', accent2: '#172418' }),
      light({ id: 'blush', name: 'Blush', bg0: '#f1e4e0', bg1: '#f9f0ed', bg2: '#fffaf8', bg3: '#f3e6e2', bg4: '#e8d6d0', line: 'rgba(90,30,40,0.10)', lineStrong: 'rgba(90,30,40,0.19)', fg0: '#2a1519', fg1: '#5a3a40', fg2: '#8c6a70', fg3: '#b89ca0', accent: '#c2416b', accent2: '#2a1519' }),
      light({ id: 'sepia', name: 'Sepia', bg0: '#e6d7bd', bg1: '#f1e5cf', bg2: '#faf2e2', bg3: '#eadcc2', bg4: '#dccab0', line: 'rgba(70,45,15,0.12)', lineStrong: 'rgba(70,45,15,0.22)', fg0: '#2e2012', fg1: '#5c4630', fg2: '#8a7258', fg3: '#b4a084', accent: '#8a4b1f', accent2: '#2e2012' })
    ]
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    tagline: 'Outrun nights. Sunset gradients, neon grid, chunky tabs.',
    layout: { tabs: 'block', frame: 'floating', rail: 'left', omnibox: 'centered' },
    fonts: { ui: DIN, display: DIN, mono: MONO },
    radius: 10,
    palettes: [
      dark({ id: 'outrun', name: 'Outrun', bg0: '#12041f', bg1: '#1b0830', bg2: '#230c3e', bg3: '#2e1150', bg4: '#3c1766', line: 'rgba(255,46,151,0.16)', lineStrong: 'rgba(255,46,151,0.3)', fg0: '#fff0fb', fg1: '#e3c2f0', fg2: '#a585c7', fg3: '#6d528f', accent: '#ff2e97', accent2: '#00f0ff', accent3: '#ffb347' }),
      dark({ id: 'miami', name: 'Miami', bg0: '#08121f', bg1: '#0d1a2e', bg2: '#12223b', bg3: '#182d4d', bg4: '#213b63', line: 'rgba(51,224,255,0.15)', lineStrong: 'rgba(51,224,255,0.3)', fg0: '#effcff', fg1: '#bfd9ea', fg2: '#7f9cb5', fg3: '#526a82', accent: '#ff5fa2', accent2: '#33e0ff', accent3: '#ffd166' }),
      dark({ id: 'vaporwave', name: 'Vaporwave', bg0: '#1a1030', bg1: '#221541', bg2: '#2a1a4f', bg3: '#352162', bg4: '#432a7a', line: 'rgba(255,156,230,0.16)', lineStrong: 'rgba(255,156,230,0.3)', fg0: '#fff5fd', fg1: '#e6cdf2', fg2: '#ad92c8', fg3: '#7a6497', accent: '#ff9ce6', accent2: '#9cf6ff', accent3: '#fff59c' }),
      dark({ id: 'cyberpunk', name: 'Cyberpunk', bg0: '#08080d', bg1: '#0e0e16', bg2: '#13131e', bg3: '#1b1b2a', bg4: '#262639', line: 'rgba(252,238,10,0.13)', lineStrong: 'rgba(252,238,10,0.26)', fg0: '#fbfaeb', fg1: '#c9c6b0', fg2: '#8a8773', fg3: '#5a5848', accent: '#fcee0a', accent2: '#00f0ff', accent3: '#ff003c' }),
      dark({ id: 'nightdrive', name: 'Night Drive', bg0: '#0a0918', bg1: '#110f24', bg2: '#17142f', bg3: '#201b3f', bg4: '#2b2454', line: 'rgba(255,107,61,0.15)', lineStrong: 'rgba(255,107,61,0.28)', fg0: '#fff4ef', fg1: '#dac5d0', fg2: '#9c89a3', fg3: '#675a73', accent: '#ff6b3d', accent2: '#7b5cff', accent3: '#ffd23d' }),
      dark({ id: 'laser', name: 'Laser Grid', bg0: '#050510', bg1: '#0a0a1a', bg2: '#0f0f24', bg3: '#161633', bg4: '#202047', line: 'rgba(57,255,20,0.14)', lineStrong: 'rgba(57,255,20,0.28)', fg0: '#f4fff0', fg1: '#bfe0c2', fg2: '#7ea384', fg3: '#526b56', accent: '#39ff14', accent2: '#ff00ff', accent3: '#00e5ff' })
    ]
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    tagline: 'Technical drawing. Grid paper, dimension lines, title blocks.',
    layout: { tabs: 'sheet', frame: 'flush', rail: 'left', omnibox: 'standard' },
    fonts: { ui: DIN, display: DIN_CONDENSED, mono: MONO },
    radius: 0,
    palettes: [
      dark({ id: 'cyanotype', name: 'Cyanotype', bg0: '#0b2a4a', bg1: '#0e3259', bg2: '#113a66', bg3: '#164678', bg4: '#1c548c', line: 'rgba(190,225,255,0.16)', lineStrong: 'rgba(190,225,255,0.34)', fg0: '#eef7ff', fg1: '#b9d6f2', fg2: '#7fa6cc', fg3: '#557ca3', accent: '#ffffff', accent2: '#7fd4ff', accent3: '#ffd166', accentFg: '#0b2a4a' }),
      dark({ id: 'cad', name: 'CAD Night', bg0: '#14161a', bg1: '#1a1d22', bg2: '#20242a', bg3: '#282d34', bg4: '#323841', line: 'rgba(255,255,255,0.1)', lineStrong: 'rgba(255,255,255,0.22)', fg0: '#eef1f5', fg1: '#b7bec8', fg2: '#7d8591', fg3: '#555c67', accent: '#ffb000', accent2: '#4fc3f7', accent3: '#ff5d5d' }),
      light({ id: 'whiteprint', name: 'Whiteprint', bg0: '#e6edf4', bg1: '#f2f6fa', bg2: '#ffffff', bg3: '#e3ebf4', bg4: '#d3dfec', line: 'rgba(13,42,82,0.14)', lineStrong: 'rgba(13,42,82,0.3)', fg0: '#0d2a52', fg1: '#2f4f7a', fg2: '#617ea3', fg3: '#97abc6', accent: '#1f5fbf', accent2: '#e0452b', accent3: '#0d2a52' }),
      dark({ id: 'redline', name: 'Redline', bg0: '#0a2744', bg1: '#0d2e51', bg2: '#10365e', bg3: '#15426f', bg4: '#1b4f82', line: 'rgba(190,225,255,0.15)', lineStrong: 'rgba(190,225,255,0.32)', fg0: '#eef7ff', fg1: '#b9d6f2', fg2: '#7fa6cc', fg3: '#557ca3', accent: '#ff5a5a', accent2: '#ffffff', accent3: '#ffd166', accentFg: '#ffffff' }),
      dark({ id: 'vellum', name: 'Mint Vellum', bg0: '#0c2926', bg1: '#0f322e', bg2: '#123b36', bg3: '#174842', bg4: '#1d5750', line: 'rgba(184,255,233,0.14)', lineStrong: 'rgba(184,255,233,0.3)', fg0: '#effffa', fg1: '#b6e0d4', fg2: '#78a99b', fg3: '#507b6f', accent: '#b8ffe9', accent2: '#ffd27a', accent3: '#ff8f70' }),
      dark({ id: 'plotter', name: 'Plotter', bg0: '#000a16', bg1: '#00111f', bg2: '#001829', bg3: '#002238', bg4: '#002d49', line: 'rgba(0,229,255,0.14)', lineStrong: 'rgba(0,229,255,0.3)', fg0: '#e6fdff', fg1: '#a6dce4', fg2: '#6b9ea8', fg3: '#466f78', accent: '#00e5ff', accent2: '#ff3dfb', accent3: '#fff275' })
    ]
  },
  {
    id: 'brutal',
    name: 'Brutal',
    tagline: 'Neo-brutalist. Thick borders, hard shadows, loud colour.',
    layout: { tabs: 'sticker', frame: 'flush', rail: 'right', omnibox: 'standard' },
    fonts: { ui: GROTESK, display: HEAVY, mono: MONO },
    radius: 0,
    palettes: [
      light({ id: 'concrete', name: 'Concrete', bg0: '#e8e4da', bg1: '#f4f1ea', bg2: '#ffffff', bg3: '#ece8de', bg4: '#dcd7ca', line: 'rgba(0,0,0,0.55)', lineStrong: '#000000', fg0: '#000000', fg1: '#161616', fg2: '#474747', fg3: '#777777', accent: '#ffde03', accent2: '#ff4911', accent3: '#2b59ff', accentFg: '#000000' }),
      light({ id: 'bubblegum', name: 'Bubblegum', bg0: '#ffc6e5', bg1: '#ffe3f2', bg2: '#ffffff', bg3: '#ffd6ec', bg4: '#ffb8dd', line: 'rgba(0,0,0,0.55)', lineStrong: '#000000', fg0: '#000000', fg1: '#1c1020', fg2: '#4d3a52', fg3: '#806c85', accent: '#2b59ff', accent2: '#ffde03', accent3: '#00c46a', accentFg: '#ffffff' }),
      light({ id: 'mintcondition', name: 'Mint', bg0: '#b8f2d8', bg1: '#dcf9ec', bg2: '#ffffff', bg3: '#c9f5e2', bg4: '#a3ebca', line: 'rgba(0,0,0,0.55)', lineStrong: '#000000', fg0: '#000000', fg1: '#0f1f18', fg2: '#3b5248', fg3: '#6d8479', accent: '#ff4911', accent2: '#7b3cff', accent3: '#ffde03', accentFg: '#000000' }),
      light({ id: 'sky', name: 'Sky', bg0: '#a8d8ff', bg1: '#d6ecff', bg2: '#ffffff', bg3: '#bfe2ff', bg4: '#92cdff', line: 'rgba(0,0,0,0.55)', lineStrong: '#000000', fg0: '#000000', fg1: '#0c1a26', fg2: '#384b5c', fg3: '#6a7d8e', accent: '#ff3cac', accent2: '#ffde03', accent3: '#00c46a', accentFg: '#000000' }),
      light({ id: 'tabloid', name: 'Tabloid', bg0: '#f2eee3', bg1: '#faf8f2', bg2: '#ffffff', bg3: '#eeeade', bg4: '#e0dbcc', line: 'rgba(0,0,0,0.55)', lineStrong: '#000000', fg0: '#000000', fg1: '#161616', fg2: '#474747', fg3: '#777777', accent: '#e10600', accent2: '#000000', accent3: '#ffde03', accentFg: '#ffffff' }),
      dark({ id: 'tar', name: 'Tar', bg0: '#0a0a0a', bg1: '#141414', bg2: '#1c1c1c', bg3: '#262626', bg4: '#333333', line: 'rgba(255,255,255,0.55)', lineStrong: '#ffffff', fg0: '#ffffff', fg1: '#e0e0e0', fg2: '#a8a8a8', fg3: '#777777', accent: '#c6ff00', accent2: '#ff3cac', accent3: '#00e1ff', accentFg: '#000000' })
    ]
  },
  {
    id: 'retro',
    name: 'Retro',
    tagline: 'Classic desktop. Bevelled buttons, title bars, teal wallpaper.',
    layout: { tabs: 'bevel', frame: 'flush', rail: 'left', omnibox: 'standard' },
    fonts: { ui: TAHOMA, display: TAHOMA, mono: "'Lucida Console', Consolas, monospace" },
    radius: 0,
    palettes: [
      light({ id: 'classic', name: 'Classic', bg0: '#c0c0c0', bg1: '#c0c0c0', bg2: '#ffffff', bg3: '#d4d0c8', bg4: '#a9a9a9', line: '#808080', lineStrong: '#404040', fg0: '#000000', fg1: '#000000', fg2: '#404040', fg3: '#808080', accent: '#000080', accent2: '#1084d0', accent3: '#008080', accentFg: '#ffffff' }),
      light({ id: 'teal', name: 'Teal', bg0: '#c0c0c0', bg1: '#c0c0c0', bg2: '#ffffff', bg3: '#d4d0c8', bg4: '#a9a9a9', line: '#808080', lineStrong: '#404040', fg0: '#000000', fg1: '#000000', fg2: '#404040', fg3: '#808080', accent: '#008080', accent2: '#20b2aa', accent3: '#004040', accentFg: '#ffffff' }),
      light({ id: 'plum', name: 'Plum', bg0: '#d8c8d0', bg1: '#d8c8d0', bg2: '#ffffff', bg3: '#e6dae0', bg4: '#bda8b3', line: '#8c7080', lineStrong: '#483040', fg0: '#000000', fg1: '#000000', fg2: '#483040', fg3: '#8c7080', accent: '#582a58', accent2: '#b07aa8', accent3: '#402040', accentFg: '#ffffff' }),
      light({ id: 'storm', name: 'Storm', bg0: '#a8b0c0', bg1: '#a8b0c0', bg2: '#ffffff', bg3: '#bcc3d1', bg4: '#8f98aa', line: '#606878', lineStrong: '#303848', fg0: '#000000', fg1: '#000000', fg2: '#303848', fg3: '#606878', accent: '#102050', accent2: '#4a6aae', accent3: '#3a6ea5', accentFg: '#ffffff' }),
      light({ id: 'desert', name: 'Desert', bg0: '#d5ccbb', bg1: '#d5ccbb', bg2: '#ffffff', bg3: '#e3dccf', bg4: '#bcb19b', line: '#8e8266', lineStrong: '#4a4230', fg0: '#000000', fg1: '#000000', fg2: '#4a4230', fg3: '#8e8266', accent: '#8a3a1e', accent2: '#c8764a', accent3: '#a28c5a', accentFg: '#ffffff' }),
      dark({ id: 'contrast', name: 'High Contrast', bg0: '#000000', bg1: '#000000', bg2: '#000000', bg3: '#1c1c1c', bg4: '#333333', line: '#808080', lineStrong: '#ffffff', fg0: '#ffffff', fg1: '#ffffff', fg2: '#ffff00', fg3: '#00ff00', accent: '#800080', accent2: '#c000c0', accent3: '#000000', accentFg: '#ffffff' })
    ]
  },
  {
    id: 'holo',
    name: 'Holo',
    tagline: 'Iridescent chrome. Pearl surfaces, prism borders, shimmer.',
    layout: { tabs: 'holo', frame: 'floating', rail: 'right', omnibox: 'centered' },
    fonts: { ui: SEGOE, display: SEGOE_DISPLAY, mono: MONO },
    radius: 16,
    palettes: [
      light({ id: 'pearl', name: 'Pearl', bg0: '#eceef7', bg1: '#f6f6fc', bg2: '#ffffff', bg3: '#eceef8', bg4: '#e0e3f3', line: 'rgba(80,80,150,0.12)', lineStrong: 'rgba(80,80,150,0.22)', fg0: '#15142b', fg1: '#44436a', fg2: '#76759c', fg3: '#a4a3c4', accent: '#7b61ff', accent2: '#ff6ec7', accent3: '#3de0ff' }),
      dark({ id: 'chrome', name: 'Dark Chrome', bg0: '#0b0b11', bg1: '#13131b', bg2: '#191923', bg3: '#22222e', bg4: '#2d2d3c', line: 'rgba(200,200,255,0.09)', lineStrong: 'rgba(200,200,255,0.18)', fg0: '#f4f3ff', fg1: '#c3c1dd', fg2: '#8583a0', fg3: '#595772', accent: '#b69cff', accent2: '#6ef3ff', accent3: '#ff8ad8' }),
      light({ id: 'opal', name: 'Opal', bg0: '#e7f4f2', bg1: '#f3fbfa', bg2: '#ffffff', bg3: '#e4f3f1', bg4: '#d3ebe8', line: 'rgba(20,90,90,0.12)', lineStrong: 'rgba(20,90,90,0.22)', fg0: '#10302d', fg1: '#3a5c58', fg2: '#6a8a86', fg3: '#9fb8b4', accent: '#00a99b', accent2: '#b16cff', accent3: '#ffb86b' }),
      light({ id: 'y2k', name: 'Y2K', bg0: '#e5eaff', bg1: '#f2f4ff', bg2: '#ffffff', bg3: '#e6ebff', bg4: '#d5ddff', line: 'rgba(40,60,160,0.13)', lineStrong: 'rgba(40,60,160,0.24)', fg0: '#0e1440', fg1: '#384070', fg2: '#6a71a0', fg3: '#9ea4c8', accent: '#2f6bff', accent2: '#ff49db', accent3: '#8aff3b' }),
      dark({ id: 'oilslick', name: 'Oil Slick', bg0: '#07080c', bg1: '#0e1016', bg2: '#13161e', bg3: '#1b1f2a', bg4: '#262b39', line: 'rgba(140,255,220,0.09)', lineStrong: 'rgba(140,255,220,0.18)', fg0: '#effff9', fg1: '#bcd6d0', fg2: '#7e9892', fg3: '#546a65', accent: '#39ffb6', accent2: '#8c5bff', accent3: '#ff5c8a' }),
      light({ id: 'champagne', name: 'Champagne', bg0: '#f4eee5', bg1: '#faf6f0', bg2: '#ffffff', bg3: '#f2ebe0', bg4: '#e7dccb', line: 'rgba(110,80,40,0.12)', lineStrong: 'rgba(110,80,40,0.22)', fg0: '#2a1f12', fg1: '#5a4a36', fg2: '#8b7a64', fg3: '#b8a992', accent: '#b27a2e', accent2: '#e58fb4', accent3: '#8fcbea' })
    ]
  },
  {
    id: 'glitch',
    name: 'Glitch',
    tagline: 'Corrupted signal. RGB split, notched panels, tearing scanlines.',
    layout: { tabs: 'notch', frame: 'flush', rail: 'left', omnibox: 'standard' },
    fonts: { ui: DIN, display: DIN_CONDENSED, mono: MONO },
    radius: 0,
    palettes: [
      dark({ id: 'rgb', name: 'RGB', bg0: '#050505', bg1: '#0b0b0c', bg2: '#111113', bg3: '#19191c', bg4: '#232327', line: 'rgba(255,255,255,0.08)', lineStrong: 'rgba(255,255,255,0.17)', fg0: '#f5f5f5', fg1: '#b8b8bd', fg2: '#7a7a82', fg3: '#4d4d55', accent: '#ff1f4b', accent2: '#00fff0', accent3: '#f7ff00' }),
      dark({ id: 'corrupt', name: 'Corrupt', bg0: '#030603', bg1: '#080c08', bg2: '#0d120d', bg3: '#141b14', bg4: '#1d271d', line: 'rgba(57,255,20,0.1)', lineStrong: 'rgba(57,255,20,0.2)', fg0: '#effff0', fg1: '#b5cdb6', fg2: '#78907a', fg3: '#4c5e4d', accent: '#39ff14', accent2: '#ff00e6', accent3: '#ffffff' }),
      dark({ id: 'vhs', name: 'VHS', bg0: '#0b0716', bg1: '#120c21', bg2: '#18102b', bg3: '#221739', bg4: '#2e1f4b', line: 'rgba(255,106,213,0.1)', lineStrong: 'rgba(255,106,213,0.2)', fg0: '#fff3fc', fg1: '#d4c1dc', fg2: '#9583a0', fg3: '#645670', accent: '#ff6ad5', accent2: '#6af2ff', accent3: '#ffe66a' }),
      dark({ id: 'deadpixel', name: 'Dead Pixel', bg0: '#000000', bg1: '#080808', bg2: '#0e0e0e', bg3: '#171717', bg4: '#222222', line: 'rgba(255,255,255,0.1)', lineStrong: 'rgba(255,255,255,0.22)', fg0: '#ffffff', fg1: '#bdbdbd', fg2: '#7d7d7d', fg3: '#4f4f4f', accent: '#ffffff', accent2: '#ff1f1f', accent3: '#1f7bff', accentFg: '#000000' }),
      dark({ id: 'bluescreen', name: 'Bluescreen', bg0: '#001a8c', bg1: '#0020a6', bg2: '#0026ba', bg3: '#1a3ec8', bg4: '#3354d6', line: 'rgba(255,255,255,0.16)', lineStrong: 'rgba(255,255,255,0.32)', fg0: '#ffffff', fg1: '#dde5ff', fg2: '#a9b7f0', fg3: '#7486d0', accent: '#ffffff', accent2: '#00fff0', accent3: '#ffea00', accentFg: '#0020a6' }),
      dark({ id: 'infrared', name: 'Infrared', bg0: '#0c0303', bg1: '#140606', bg2: '#1b0909', bg3: '#260e0e', bg4: '#351414', line: 'rgba(255,90,40,0.12)', lineStrong: 'rgba(255,90,40,0.24)', fg0: '#fff1ea', fg1: '#dcbcb0', fg2: '#9c7c70', fg3: '#6a4f47', accent: '#ff3b00', accent2: '#ffb800', accent3: '#7a2cff' })
    ]
  }
]

/** Old theme ids (v0.1) → theme + palette. */
const LEGACY: Record<string, [ThemeId, string]> = {
  'specter-dark': ['specter', 'specter'],
  obsidian: ['specter', 'obsidian'],
  midnight: ['specter', 'midnight'],
  void: ['specter', 'void'],
  minimal: ['paper', 'newsprint'],
  light: ['paper', 'ivory']
}

export function resolveTheme(id: string, paletteId?: string): { theme: ThemeDef; palette: Palette } {
  const legacy = LEGACY[id]
  const themeId = legacy ? legacy[0] : id
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]
  const pid = paletteId || (legacy ? legacy[1] : '')
  const palette = theme.palettes.find((p) => p.id === pid) ?? theme.palettes[0]
  return { theme, palette }
}

/** Native window-controls overlay colour (must be opaque on Windows). */
export function overlayColor(bg0: string): string {
  return solid(bg0)
}

/** Colours for the native window buttons, matched to the theme's title bar. */
export function titleBarColors(t: { theme: ThemeDef; palette: Palette }): { color: string; symbolColor: string } {
  // Retro draws a gradient caption bar; the buttons sit on its right-hand end.
  if (t.theme.id === 'retro' && t.palette.dark === false) return { color: solid(t.palette.accent2), symbolColor: t.palette.accentFg }
  return { color: solid(t.palette.bg0), symbolColor: t.palette.fg1 }
}

export function themeLayout(id: string): ThemeLayout {
  return resolveTheme(id).theme.layout
}

const BASE_STATUS = { ok: '#5fd39a', warn: '#f2c14e', bad: '#ff6b73', info: '#79c0ff', up: '#3fcf8e', down: '#f0616d' }

export function applyTheme(
  id: string,
  paletteId?: string,
  accentOverride?: string,
  fontOverride?: string,
  layoutOverride?: Partial<ThemeLayout>
): { theme: ThemeDef; palette: Palette; layout: ThemeLayout } {
  const { theme, palette: p } = resolveTheme(id, paletteId)
  const layout: ThemeLayout = { ...theme.layout, ...stripUndefined(layoutOverride ?? {}) }
  const accent = accentOverride || p.accent
  const r = document.documentElement.style
  const vars: Record<string, string> = {
    '--bg-0': p.bg0,
    '--bg-1': p.bg1,
    '--bg-2': p.bg2,
    '--bg-3': p.bg3,
    '--bg-4': p.bg4,
    '--line': p.line,
    '--line-strong': p.lineStrong,
    '--fg-0': p.fg0,
    '--fg-1': p.fg1,
    '--fg-2': p.fg2,
    '--fg-3': p.fg3,
    '--accent': accent,
    '--accent-2': accentOverride ? mix(accentOverride, p.accent2) : p.accent2,
    '--accent-3': p.accent3 ?? p.accent2,
    '--accent-fg': accentOverride ? readableOn(accentOverride) : p.accentFg,
    '--accent-dim': hexA(accent, p.dark ? 0.15 : 0.11),
    '--accent-line': hexA(accent, 0.5),
    '--accent-glow': hexA(accent, 0.55),
    '--ok': p.ok ?? BASE_STATUS.ok,
    '--warn': p.warn ?? BASE_STATUS.warn,
    '--bad': p.bad ?? BASE_STATUS.bad,
    '--info': BASE_STATUS.info,
    '--up': p.up ?? BASE_STATUS.up,
    '--down': p.down ?? BASE_STATUS.down,
    '--glass': p.dark ? 'rgba(14,16,22,0.82)' : 'rgba(255,255,255,0.9)',
    '--shadow-pop': p.dark ? '0 18px 50px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)' : '0 14px 40px rgba(20,20,40,0.14), 0 1px 3px rgba(20,20,40,0.08)',
    '--radius': theme.radius + 'px',
    '--radius-s': Math.max(0, theme.radius - 2) + 'px',
    '--radius-l': (theme.radius ? theme.radius + 3 : 0) + 'px',
    '--font-ui': fontOverride || theme.fonts.ui,
    '--font-display': fontOverride || theme.fonts.display,
    '--font-mono': theme.fonts.mono,
    '--solid-0': solid(p.bg0),
    '--solid-1': solid(p.bg1, p.bg0),
    '--solid-2': solid(p.bg2, p.bg0)
  }
  for (const [k, v] of Object.entries(vars)) r.setProperty(k, v)
  const d = document.documentElement.dataset
  d.theme = theme.id
  d.palette = p.id
  d.scheme = p.dark ? 'dark' : 'light'
  d.tabs = layout.tabs
  d.frame = layout.frame
  d.omnibox = layout.omnibox
  return { theme, palette: p, layout }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>
}

export function hexA(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Opaque version of a (possibly translucent) colour, for native surfaces. */
function solid(c: string, under = '#000000'): string {
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (!m) return c
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim())
  const base = rgb(under) ?? [0, 0, 0]
  const al = Number(a)
  const ch = (v: string, i: number) => Math.round(Number(v) * al + base[i] * (1 - al))
  return '#' + [ch(r, 0), ch(g, 1), ch(b, 2)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function mix(a: string, b: string): string {
  const x = rgb(a)
  const y = rgb(b)
  if (!x || !y) return a
  return '#' + x.map((v, i) => Math.round(v * 0.6 + y[i] * 0.4).toString(16).padStart(2, '0')).join('')
}

function readableOn(hex: string): string {
  const c = rgb(hex)
  if (!c) return '#000000'
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#0b0b0f' : '#ffffff'
}
