// Automation, plugins, media, widgets & cockpit — renderer module entry.
import { lazy } from 'react'
import { Gauge, LayoutGrid, Music, Play, Plus, Puzzle, Workflow } from 'lucide-react'
import { registerCommands } from '../../lib/commands'
import { lazyPage, registerPage } from '../../pages/registry'
import { newTabWidgets, sidePanels, statusItems } from '../../lib/registry'
import { toggleSidePanel } from '../../stores/ui'
import { newTab } from '../../stores/browser'
import { openWorkspace, startBridge } from './bridge'
import { MediaStatus, playPauseActive } from './media'
import { NewTabWidgets } from './Dashboard'
import { OWN_NEWTAB_WIDGET } from './widgets'
import { openPage } from './util'
import './automation.css'

export function register(): void {
  registerCommands([
    { id: 'automation.open', title: 'Open automations', category: 'Tools', icon: Workflow, keywords: ['rules', 'triggers', 'workflow'], run: () => openPage('specter://automations') },
    { id: 'automation.new', title: 'New automation', category: 'Tools', icon: Plus, keywords: ['rule', 'trigger'], run: () => newTab('specter://automations?new=1') },
    { id: 'plugins.open', title: 'Open plugins', category: 'Tools', icon: Puzzle, keywords: ['extensions', 'manifest'], run: () => openPage('specter://plugins') },
    { id: 'media.panel', title: 'Media controls', category: 'View', icon: Music, keywords: ['audio', 'video', 'playing'], run: () => toggleSidePanel('media') },
    { id: 'media.playPause', title: 'Play / pause media in this tab', category: 'Page', icon: Play, keywords: ['media', 'pause', 'video'], run: () => playPauseActive() },
    { id: 'cockpit.open', title: 'Open cockpit', category: 'View', icon: Gauge, keywords: ['multi monitor', 'dashboard', 'panels', 'trading'], run: () => openPage('specter://cockpit') },
    { id: 'widgets.edit', title: 'Edit widgets dashboard', category: 'View', icon: LayoutGrid, keywords: ['widgets', 'dashboard'], run: () => openPage('specter://cockpit/dashboard?edit=1') },
    {
      id: 'automation.openWorkspace',
      title: 'Open workspace (automation)',
      category: 'Workspace',
      hidden: true,
      run: (a?: { name?: string; id?: string; create?: boolean }) => openWorkspace(a?.id ?? a?.name ?? '', !!a?.create)
    }
  ])

  registerPage({ id: 'automations', title: 'Automations', icon: Workflow, component: lazyPage(() => import('./AutomationsPage')), listed: true, category: 'Tools' })
  registerPage({ id: 'plugins', title: 'Plugins', icon: Puzzle, component: lazyPage(() => import('./PluginsPage')), listed: true, category: 'Tools' })
  registerPage({ id: 'cockpit', title: 'Cockpit', icon: Gauge, component: lazyPage(() => import('./CockpitPage')), listed: true, category: 'Tools' })

  sidePanels.register({ id: 'media', title: 'Media', icon: Music, order: 80, component: lazy(() => import('./media')), shortcutCommand: 'media.panel' })
  statusItems.register({ id: 'media', side: 'right', order: 40, component: MediaStatus })
  newTabWidgets.register({ id: OWN_NEWTAB_WIDGET, title: 'Widgets', order: 5, component: NewTabWidgets })

  startBridge()
}
