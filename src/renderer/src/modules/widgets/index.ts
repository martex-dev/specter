// Sidebar & new-tab widgets — renderer module entry.
//
// Weather, news/RSS, world clocks, calendar, speed test, currency, sticky
// notes and countdowns: each is a dock panel (section "widgets"), a command,
// and (optionally) a new-tab card. Everything heavy is lazy-loaded.
import { createElement, lazy, Suspense, type ComponentType } from 'react'
import { LayoutGrid } from 'lucide-react'
import { wmoInfo, type WidgetId } from '@shared/modules/widgets'
import { registerCommands } from '../../lib/commands'
import { invoke } from '../../lib/ipc'
import { newTabWidgets, sidePanels, type SidePanelDef } from '../../lib/registry'
import { registerOmniboxProvider, type OmniItem } from '../../lib/omnibox'
import { lazyPage, registerPage } from '../../pages/registry'
import { activeTab, loadUrl, newTab } from '../../stores/browser'
import { openSidePanel } from '../../stores/ui'
import { WIDGETS } from './catalog'
import { getConfig, kvRead, useNewTabEnabled, watchKv } from './store'
import { weatherIcon } from './ui'
import { defaultUnit, placeLabel, setPreview, temp, type WeatherPrefs } from './weatherState'
import { NewsBadge } from './badge'
import './widgets.css'

const PANELS: Record<WidgetId, () => Promise<{ default: ComponentType<{ popout?: boolean }> }>> = {
  weather: () => import('./WeatherPanel'),
  news: () => import('./NewsPanel'),
  clocks: () => import('./ClocksPanel'),
  calendar: () => import('./CalendarPanel'),
  speedtest: () => import('./SpeedPanel'),
  currency: () => import('./CurrencyPanel'),
  stickies: () => import('./StickiesPanel'),
  countdown: () => import('./CountdownPanel')
}

const CARD_EXPORT: Record<WidgetId, string> = {
  weather: 'NewTabWeather',
  news: 'NewTabNews',
  clocks: 'NewTabClocks',
  calendar: 'NewTabCalendar',
  speedtest: 'NewTabSpeed',
  currency: 'NewTabCurrency',
  stickies: 'NewTabStickies',
  countdown: 'NewTabCountdown'
}

/** New-tab card: checks the (tiny) config first so disabled cards never load their code. */
function newTabCard(id: WidgetId): ComponentType {
  const Lazy = lazy(() => import('./NewTabCards').then((m) => ({ default: (m as unknown as Record<string, ComponentType>)[CARD_EXPORT[id]] })))
  function Card() {
    const on = useNewTabEnabled(id)
    return on ? createElement(Suspense, { fallback: null }, createElement(Lazy)) : null
  }
  Card.displayName = 'WidgetCard_' + id
  return Card
}

export function openWidgetsPage(): void {
  const t = activeTab()
  if (t && t.url === 'specter://newtab') loadUrl(t.id, 'specter://widgets')
  else newTab('specter://widgets')
}

function panelDefs(): SidePanelDef[] {
  return WIDGETS.map((w, i) => ({
    id: w.panelId,
    title: w.title,
    icon: w.icon,
    order: 60 + i,
    section: 'widgets',
    component: lazy(PANELS[w.id]),
    popout: true,
    width: w.id === 'calendar' || w.id === 'weather' ? 380 : 360,
    shortcutCommand: w.command,
    enabled: () => getConfig().dock[w.id],
    Badge: w.id === 'news' ? NewsBadge : undefined,
    contextItems: () => [{ label: 'Manage widgets…', icon: createElement(LayoutGrid, { size: 14 }), run: openWidgetsPage }]
  }))
}

// ---------------------------------------------------------------- omnibox: "weather <city>"

let omniSeq = 0
async function weatherSuggestion(text: string): Promise<OmniItem[]> {
  const m = /^\s*weather\s+(.{2,60})$/i.exec(text)
  if (!m) return []
  const city = m[1].trim()
  if (city.length < 3) return []
  const my = ++omniSeq
  // Debounce keystrokes: only the latest query hits the (cached, rate-limited) API.
  await new Promise((r) => setTimeout(r, 350))
  if (my !== omniSeq) return []
  try {
    const places = await invoke('weather:search', city)
    const place = places[0]
    if (!place || my !== omniSeq) return []
    const data = await invoke('weather:forecast', place, false)
    if (my !== omniSeq) return []
    const prefs = await kvRead<Partial<WeatherPrefs> | null>('weather.prefs', null)
    const unit = prefs?.unit ?? defaultUnit()
    const w = wmoInfo(data.current.code)
    const today = data.daily[0]
    return [
      {
        id: 'widgets:weather',
        kind: 'other',
        title: `${temp(data.current.temp, unit)} ${w.label} — ${placeLabel(place)}`,
        subtitle: `Feels like ${temp(data.current.apparent, unit)}${today ? ` · H ${temp(today.tMax, unit)} L ${temp(today.tMin, unit)}` : ''} · Open-Meteo · Enter for forecast`,
        icon: createElement(weatherIcon(w.kind, data.current.isDay), { size: 15 }),
        score: 1050,
        run: () => {
          setPreview(place)
          openSidePanel('wg-weather')
        }
      }
    ]
  } catch {
    return []
  }
}

export function register(): void {
  const defs = panelDefs()
  defs.forEach((d) => sidePanels.register(d))
  // Let the dock re-evaluate `enabled` when the widget config changes.
  watchKv('config', () => sidePanels.refresh())

  WIDGETS.forEach((w, i) => {
    if (w.newtab) newTabWidgets.register({ id: 'widgets.' + w.id, title: w.title, order: 40 + i, component: newTabCard(w.id), defaultOn: getConfig().newtab[w.id] })
  })

  registerPage({ id: 'widgets', title: 'Widgets', icon: LayoutGrid, component: lazyPage(() => import('./WidgetsPage')), listed: true, category: 'Tools' })

  registerCommands([
    ...WIDGETS.map((w) => ({
      id: w.command,
      title: w.title,
      category: 'Tools' as const,
      icon: w.icon,
      keywords: ['widget', ...w.keywords],
      description: w.description,
      permissions: w.network.startsWith('None') ? undefined : (['network'] as ('network')[]),
      run: () => openSidePanel(w.panelId)
    })),
    {
      id: 'widgets.manage',
      title: 'Manage widgets',
      category: 'Tools',
      icon: LayoutGrid,
      keywords: ['widgets', 'dock', 'sidebar', 'new tab', 'weather', 'news', 'customize'],
      description: 'Choose which widgets appear in the dock and on the new tab page.',
      run: openWidgetsPage
    }
  ])

  registerOmniboxProvider({ id: 'widgets-weather', scopes: ['default'], provide: (text) => weatherSuggestion(text) })
}
