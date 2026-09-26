// Widget catalogue: ids, dock panel ids, commands and data-source disclosures.
import { ArrowLeftRight, CalendarDays, CloudSun, Gauge, Globe, Hourglass, Newspaper, StickyNote, type LucideIcon } from 'lucide-react'
import type { WidgetId } from '@shared/modules/widgets'

export interface WidgetMeta {
  id: WidgetId
  panelId: string
  command: string
  title: string
  icon: LucideIcon
  description: string
  /** Where data comes from / what leaves the device. */
  network: string
  keywords: string[]
  /** New-tab card available. */
  newtab: boolean
}

export const WIDGETS: WidgetMeta[] = [
  {
    id: 'weather',
    panelId: 'wg-weather',
    command: 'widgets.weather',
    title: 'Weather',
    icon: CloudSun,
    description: 'Current conditions, next 24 hours and 7-day forecast for your saved places.',
    network: 'Open-Meteo (api.open-meteo.com) — place coordinates only; cached 10 min.',
    keywords: ['weather', 'forecast', 'temperature', 'rain', 'open-meteo'],
    newtab: true
  },
  {
    id: 'news',
    panelId: 'wg-news',
    command: 'widgets.news',
    title: 'News',
    icon: Newspaper,
    description: 'RSS & Atom reader with unread tracking. Bring your own feeds.',
    network: 'Each feed’s own server, only while the reader or news card is open.',
    keywords: ['news', 'rss', 'atom', 'feeds', 'reader', 'headlines'],
    newtab: true
  },
  {
    id: 'clocks',
    panelId: 'wg-clocks',
    command: 'widgets.clocks',
    title: 'World clocks',
    icon: Globe,
    description: 'Analog or digital clocks for any time zone, with day/night and offsets.',
    network: 'None — computed locally.',
    keywords: ['clock', 'time zone', 'world clock', 'utc', 'timezone'],
    newtab: true
  },
  {
    id: 'calendar',
    panelId: 'wg-calendar',
    command: 'widgets.calendar',
    title: 'Calendar',
    icon: CalendarDays,
    description: 'Month view, local events with reminders, today’s agenda and .ics import.',
    network: 'None — events are stored on this device.',
    keywords: ['calendar', 'events', 'agenda', 'ics', 'schedule', 'reminder'],
    newtab: true
  },
  {
    id: 'speedtest',
    panelId: 'wg-speedtest',
    command: 'widgets.speedtest',
    title: 'Speed test',
    icon: Gauge,
    description: 'Download, upload, ping and jitter with a history of your results.',
    network: 'Cloudflare (speed.cloudflare.com) — only when you press Start.',
    keywords: ['speed test', 'internet speed', 'bandwidth', 'ping', 'latency', 'mbps'],
    newtab: true
  },
  {
    id: 'currency',
    panelId: 'wg-currency',
    command: 'widgets.currency',
    title: 'Currency',
    icon: ArrowLeftRight,
    description: 'Convert between 160+ currencies and pin favourite pairs.',
    network: 'open.er-api.com (fallback: Frankfurter/ECB) — cached 1 hour.',
    keywords: ['currency', 'exchange rate', 'fx', 'convert', 'money', 'forex'],
    newtab: true
  },
  {
    id: 'stickies',
    panelId: 'wg-stickies',
    command: 'widgets.stickies',
    title: 'Sticky notes',
    icon: StickyNote,
    description: 'Quick coloured notes, saved as you type.',
    network: 'None — stored on this device.',
    keywords: ['sticky', 'notes', 'scratchpad', 'memo', 'post-it'],
    newtab: true
  },
  {
    id: 'countdown',
    panelId: 'wg-countdown',
    command: 'widgets.countdown',
    title: 'Countdowns',
    icon: Hourglass,
    description: 'Count down to dates that matter, with an optional notification.',
    network: 'None — stored on this device.',
    keywords: ['countdown', 'days until', 'event', 'deadline', 'timer'],
    newtab: true
  }
]

export const widgetMeta = (id: WidgetId): WidgetMeta => WIDGETS.find((w) => w.id === id)!
