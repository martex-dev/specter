// Cockpit presets. Side panels from optional modules fall back to a web page
// or widget when that module isn't installed, so a preset never shows a dead panel.
import type { CockpitLayout, CockpitPanel } from '@shared/modules/automation'
import { sidePanels } from '../../lib/registry'

type PresetPanel = { candidates: Omit<CockpitPanel, 'key' | 'colSpan' | 'rowSpan'>[]; colSpan: number; rowSpan: number }

export interface CockpitPreset {
  id: string
  name: string
  description: string
  columns: number
  rows: number
  panels: PresetPanel[]
}

const panel = (id: string) => ({ kind: 'panel' as const, ref: id })
const web = (url: string, title?: string) => ({ kind: 'web' as const, ref: url, title })
const widget = (id: string) => ({ kind: 'widget' as const, ref: id })

export const PRESETS: CockpitPreset[] = [
  {
    id: 'trading',
    name: 'Trading',
    description: 'Chart, market panel, clock with a second market time zone',
    columns: 3,
    rows: 2,
    panels: [
      { candidates: [web('https://www.tradingview.com/chart/', 'TradingView')], colSpan: 2, rowSpan: 2 },
      { candidates: [panel('markets'), panel('market'), web('https://www.coingecko.com/', 'CoinGecko')], colSpan: 1, rowSpan: 1 },
      { candidates: [widget('clock')], colSpan: 1, rowSpan: 1 }
    ]
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Reference, news and your task list side by side',
    columns: 3,
    rows: 2,
    panels: [
      { candidates: [web('https://en.wikipedia.org/wiki/Main_Page', 'Wikipedia')], colSpan: 1, rowSpan: 2 },
      { candidates: [web('https://news.ycombinator.com/', 'Hacker News')], colSpan: 1, rowSpan: 2 },
      { candidates: [panel('research'), panel('notes'), widget('tasks')], colSpan: 1, rowSpan: 1 },
      { candidates: [widget('quicklinks')], colSpan: 1, rowSpan: 1 }
    ]
  },
  {
    id: 'developer',
    name: 'Developer',
    description: 'GitHub, docs, downloads and tasks',
    columns: 3,
    rows: 2,
    panels: [
      { candidates: [web('https://github.com/', 'GitHub')], colSpan: 2, rowSpan: 1 },
      { candidates: [panel('developer'), panel('git'), widget('tasks')], colSpan: 1, rowSpan: 1 },
      { candidates: [web('https://developer.mozilla.org/', 'MDN')], colSpan: 2, rowSpan: 1 },
      { candidates: [widget('downloads')], colSpan: 1, rowSpan: 1 }
    ]
  },
  {
    id: 'monitoring',
    name: 'Monitoring',
    description: 'Notifications, media, downloads, automation activity and a clock',
    columns: 3,
    rows: 2,
    panels: [
      { candidates: [panel('notifications')], colSpan: 1, rowSpan: 2 },
      { candidates: [panel('media')], colSpan: 1, rowSpan: 1 },
      { candidates: [widget('clock')], colSpan: 1, rowSpan: 1 },
      { candidates: [widget('automations')], colSpan: 1, rowSpan: 1 },
      { candidates: [panel('downloads')], colSpan: 1, rowSpan: 1 }
    ]
  }
]

export const newKey = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/** Resolves a preset against the panels installed right now. */
export function layoutFromPreset(p: CockpitPreset): CockpitLayout {
  const panels: CockpitPanel[] = p.panels.map((pp) => {
    const c = pp.candidates.find((x) => x.kind !== 'panel' || !!sidePanels.get(x.ref)) ?? pp.candidates[pp.candidates.length - 1]
    return { key: newKey(), ...c, colSpan: pp.colSpan, rowSpan: pp.rowSpan }
  })
  return { id: 'c' + Date.now().toString(36), name: p.name, columns: p.columns, rows: p.rows, panels, preset: p.id, updatedAt: Date.now() }
}
