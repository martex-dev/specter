// Keeps the dock in sync with the user's apps: one keep-alive side panel per
// app in the dock's "apps" section. Component identities are cached per app so
// re-registering (rename, reorder) never remounts a live webview.
import { lazy, type ComponentType } from 'react'
import { Globe } from 'lucide-react'
import type { WebApp } from '@shared/modules/webapps'
import { sidePanels } from '../../lib/registry'
import { useUi } from '../../stores/ui'
import { AppIcon, DockBadge } from './AppIcon'
import { WebAppHeader } from './Header'
import { appMenuItems } from './menus'
import { panelIdOf, unloadApp } from './store'

const LazyPanel = lazy(() => import('./WebAppPanel'))

interface Parts {
  component: ComponentType<{ popout?: boolean }>
  Badge: ComponentType
  headerExtra: ComponentType
}
const parts = new Map<string, Parts>()

function partsFor(id: string): Parts {
  let p = parts.get(id)
  if (!p) {
    const component = () => <LazyPanel id={id} />
    const Badge = () => <DockBadge id={id} />
    const headerExtra = () => <WebAppHeader id={id} />
    p = { component, Badge, headerExtra }
    parts.set(id, p)
  }
  return p
}

const present = new Set<string>()
const registered = new Set<string>()

export function syncPanels(apps: WebApp[]): void {
  const next = new Set(apps.map((a) => a.id))
  // Apps that disappeared (removed here or in another window): hide + unload.
  for (const id of registered) {
    if (next.has(id) || !present.has(id)) continue
    present.delete(id)
    sidePanels.unregister(panelIdOf(id))
    unloadApp(id)
  }
  apps.forEach((app, i) => {
    const id = app.id
    present.add(id)
    registered.add(id)
    const p = partsFor(id)
    sidePanels.register({
      id: panelIdOf(id),
      title: app.name,
      icon: Globe,
      order: 10 + i / 100,
      section: 'apps',
      iconNode: <AppIcon id={id} size={20} />,
      Badge: p.Badge,
      keepAlive: true,
      width: app.width ?? 420,
      component: p.component,
      headerExtra: p.headerExtra,
      contextItems: () => appMenuItems(id),
      enabled: () => present.has(id)
    })
  })
  // An open panel whose app is gone closes.
  const open = useUi.getState().sidePanel
  if (open?.startsWith('webapp:') && !next.has(open.slice(7))) useUi.setState({ sidePanel: null })
}
