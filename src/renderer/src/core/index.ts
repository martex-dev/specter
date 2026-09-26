// Registers SPECTER's core (tier 1/2) UI: commands, panels, pages, HUD, status.
import { lazy } from 'react'
import { Activity, Bell, Bookmark, Clock, Download, FileSearch, HelpCircle, KeyRound, Layers, Moon, ScrollText, Settings, Shield, ShieldCheck, Sparkles, Stethoscope, Hexagon } from 'lucide-react'
import { registerCoreCommands } from '../commands/core'
import { registerCoreOmniboxProviders } from '../chrome/omniboxProviders'
import { registerCoreHud, registerCoreStatus } from '../chrome/Frame'
import { sidePanels } from '../lib/registry'
import { lazyPage, registerPage } from '../pages/registry'

export function registerCore(): void {
  registerCoreCommands()
  registerCoreOmniboxProviders()
  registerCoreHud()
  registerCoreStatus()

  sidePanels.register({ id: 'downloads', title: 'Downloads', icon: Download, order: 110, component: lazy(() => import('../panels/DownloadsPanel')), popout: true, shortcutCommand: 'browser.downloads' })
  sidePanels.register({ id: 'tabs', title: 'Tabs & memory', icon: Moon, order: 120, component: lazy(() => import('../panels/TabsPanel')), popout: true })
  sidePanels.register({ id: 'pagetools', title: 'Page tools', icon: FileSearch, order: 130, component: lazy(() => import('../panels/PageToolsPanel')) })
  sidePanels.register({ id: 'notifications', title: 'Notifications', icon: Bell, order: 140, component: lazy(() => import('../panels/NotificationsPanel')), popout: true })

  registerPage({ id: 'newtab', title: 'New Tab', icon: Hexagon, component: lazyPage(() => import('../pages/NewTab')) })
  registerPage({ id: 'welcome', title: 'Welcome', icon: Sparkles, component: lazyPage(() => import('../pages/Welcome')) })
  registerPage({ id: 'settings', title: 'Settings', icon: Settings, component: lazyPage(() => import('../pages/Settings')), listed: true, category: 'Browser' })
  registerPage({ id: 'history', title: 'History', icon: Clock, component: lazyPage(() => import('../pages/History')), listed: true, category: 'Browser' })
  registerPage({ id: 'bookmarks', title: 'Bookmarks', icon: Bookmark, component: lazyPage(() => import('../pages/Bookmarks')), listed: true, category: 'Browser' })
  registerPage({ id: 'passwords', title: 'Passwords', icon: KeyRound, component: lazyPage(() => import('../pages/Passwords')), listed: true, category: 'Browser' })
  registerPage({ id: 'downloads', title: 'Downloads', icon: Download, component: lazyPage(() => import('../pages/Downloads')), listed: true, category: 'Browser' })
  registerPage({ id: 'workspaces', title: 'Workspaces', icon: Layers, component: lazyPage(() => import('../pages/Workspaces')), listed: true, category: 'Browser' })
  registerPage({ id: 'privacy', title: 'Privacy Center', icon: Shield, component: lazyPage(() => import('../pages/Privacy')), listed: true, category: 'Privacy' })
  registerPage({ id: 'security', title: 'Security', icon: ShieldCheck, component: lazyPage(() => import('../pages/Security')), listed: true, category: 'Privacy' })
  registerPage({ id: 'diagnostics', title: 'Diagnostics', icon: Stethoscope, component: lazyPage(() => import('../pages/Diagnostics')), listed: true, category: 'System' })
  registerPage({ id: 'logs', title: 'Logs', icon: ScrollText, component: lazyPage(() => import('../pages/Logs')), listed: true, category: 'Developer' })
  registerPage({ id: 'help', title: 'Help', icon: HelpCircle, component: lazyPage(() => import('../pages/Help')), listed: true, category: 'Help' })
  registerPage({ id: 'activity', title: 'Activity', icon: Activity, component: lazyPage(() => import('../pages/Activity')), listed: true, category: 'Browser' })
}
