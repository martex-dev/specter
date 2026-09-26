// Web app icons (the page's own favicon, cached; letter tile fallback) and the
// dock badge (unread count + "playing" dot).
import { useEffect, useState } from 'react'
import { appLetter, badgeLabel, iconKey, UNREAD_DOT } from '@shared/modules/webapps'
import { useRuntime, useWebApps } from './store'

export function IconTile({ name, color, icon, size = 18 }: { name: string; color: string; icon?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [icon])
  if (icon && !broken)
    return (
      <span className="wa-icon" style={{ width: size, height: size }}>
        <img src={icon} width={size} height={size} alt="" draggable={false} onError={() => setBroken(true)} referrerPolicy="no-referrer" />
      </span>
    )
  return (
    <span className="wa-icon wa-tile" style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.56) }} aria-hidden="true">
      {appLetter(name)}
    </span>
  )
}

/** Icon of an installed app (reactive to favicon updates). */
export function AppIcon({ id, size = 18 }: { id: string; size?: number }) {
  const app = useWebApps((s) => s.apps.find((a) => a.id === id))
  const cached = useWebApps((s) => (app ? s.icons[iconKey(app.url)] : undefined))
  if (!app) return <IconTile name="?" color="var(--bg-3)" size={size} />
  return <IconTile name={app.name} color={app.color} icon={app.icon ?? cached} size={size} />
}

/** Icon for a catalog entry (uses a favicon learned earlier, if any). */
export function CatalogIcon({ name, url, color, size = 28 }: { name: string; url: string; color: string; size?: number }) {
  const cached = useWebApps((s) => s.icons[iconKey(url)])
  return <IconTile name={name} color={color} icon={cached} size={size} />
}

export function DockBadge({ id }: { id: string }) {
  const rt = useRuntime(id)
  const badges = useWebApps((s) => s.apps.find((a) => a.id === id)?.badges ?? false)
  const unread = badges ? rt.unread : 0
  if (!unread && !rt.audible && !rt.crashed && !rt.error) return null
  return (
    <span className="wa-dock-badges" aria-hidden="true">
      {unread === UNREAD_DOT && <span className="wa-dock-unread dot" />}
      {unread > 0 && <span className="wa-dock-unread">{badgeLabel(unread)}</span>}
      {rt.audible && <span className="wa-dock-playing" />}
      {(rt.crashed || rt.error) && <span className="wa-dock-error" />}
    </span>
  )
}
