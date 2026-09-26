// Widgets — small shared UI pieces.
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Cloudy,
  ExternalLink,
  Moon,
  RefreshCw,
  Snowflake,
  Sun,
  WifiOff,
  type LucideIcon
} from 'lucide-react'
import { WIDGET_COLORS, wmoInfo, type WeatherKind, type WidgetColor } from '@shared/modules/widgets'
import { timeAgo } from '../../lib/format'
import { newTab } from '../../stores/browser'
import { isOfflineError } from './store'

export function weatherIcon(kind: WeatherKind, isDay = true): LucideIcon {
  switch (kind) {
    case 'clear':
      return isDay ? Sun : Moon
    case 'partly':
      return isDay ? CloudSun : CloudMoon
    case 'cloudy':
      return Cloudy
    case 'fog':
      return CloudFog
    case 'drizzle':
      return CloudDrizzle
    case 'rain':
      return CloudRain
    case 'freezing':
      return CloudHail
    case 'snow':
      return CloudSnow
    case 'showers':
      return isDay ? CloudSunRain : CloudMoonRain
    case 'snow-showers':
      return Snowflake
    case 'thunder':
      return CloudLightning
    case 'hail':
      return CloudHail
    default:
      return Cloud
  }
}

/** Theme-aware tint for a weather condition (CSS variables only). */
export function weatherTint(kind: WeatherKind, isDay = true): string {
  switch (kind) {
    case 'clear':
    case 'partly':
      return isDay ? 'var(--warn)' : 'var(--accent-2)'
    case 'rain':
    case 'drizzle':
    case 'showers':
      return 'var(--info)'
    case 'snow':
    case 'snow-showers':
    case 'freezing':
    case 'hail':
      return 'var(--accent-2)'
    case 'thunder':
      return 'var(--accent-3)'
    default:
      return 'var(--fg-1)'
  }
}

export function WeatherGlyph({ code, isDay = true, size = 18 }: { code: number; isDay?: boolean; size?: number }) {
  const w = wmoInfo(code)
  const Icon = weatherIcon(w.kind, isDay)
  return <Icon size={size} style={{ color: weatherTint(w.kind, isDay), flex: 'none' }} aria-label={w.label} />
}

export const colorVar = (c: string): string => `var(--${(WIDGET_COLORS as readonly string[]).includes(c) ? c : 'accent'})`

export function ColorDots({ value, onChange, size = 14 }: { value: string; onChange: (c: WidgetColor) => void; size?: number }) {
  return (
    <div className="wg-dots" role="radiogroup" aria-label="Color">
      {WIDGET_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} className={'wg-dot' + (value === c ? ' on' : '')} style={{ width: size, height: size, background: colorVar(c) }} onClick={() => onChange(c)} />
      ))}
    </div>
  )
}

/** "Source · updated …" footer shown under every external-data widget. */
export function SourceLine({ source, href, updated, extra, onRefresh, busy }: { source: string; href?: string; updated?: number | null; extra?: ReactNode; onRefresh?: () => void; busy?: boolean }) {
  return (
    <div className="wg-source">
      <span className="ellipsis">
        {href ? (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault()
              newTab(href)
            }}
          >
            {source} <ExternalLink size={9} />
          </a>
        ) : (
          source
        )}
        {updated ? <> · updated {timeAgo(updated)}</> : null}
        {extra ? <> · {extra}</> : null}
      </span>
      <span className="spacer" />
      {onRefresh && (
        <button className="icon-btn sm" onClick={onRefresh} disabled={busy} data-tip="Refresh" aria-label="Refresh">
          <RefreshCw size={12} className={busy ? 'wg-spin' : ''} />
        </button>
      )}
    </div>
  )
}

export function ErrorState({ error, onRetry, compact }: { error: string; onRetry?: () => void; compact?: boolean }) {
  const offline = isOfflineError(error)
  const Icon = offline ? WifiOff : AlertTriangle
  return (
    <div className={'wg-state' + (compact ? ' compact' : '')} role="alert">
      <Icon size={compact ? 16 : 22} />
      <div>
        <div className="wg-state-t">{offline ? 'You appear to be offline' : 'Data unavailable'}</div>
        <div className="wg-state-d">{error}</div>
      </div>
      {onRetry && (
        <button className="btn sm" onClick={onRetry}>
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="wg-loading">
      <RefreshCw size={14} className="wg-spin" /> {label}
    </div>
  )
}

/** Origin favicon — fetched from the feed's own site only (no third-party favicon service). */
export function siteFavicon(siteUrl: string): string | undefined {
  try {
    const u = new URL(siteUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    return `${u.origin}/favicon.ico`
  } catch {
    return undefined
  }
}
