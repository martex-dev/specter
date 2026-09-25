// System monitor — renderer module entry.
import { createElement, lazy, Suspense } from 'react'
import { Activity, Gauge, ListTree, Network, PanelRight } from 'lucide-react'
import { registerCommands } from '../../lib/commands'
import { hudItems, newTabWidgets, sidePanels } from '../../lib/registry'
import { lazyPage, registerPage } from '../../pages/registry'
import { newTab } from '../../stores/browser'
import { toggleSidePanel } from '../../stores/ui'
import SystemHud from './Hud'
import './system.css'

const LazyWidget = lazy(() => import('./NewTabWidget'))
function SystemWidget() {
  return createElement(Suspense, { fallback: null }, createElement(LazyWidget))
}

export function register(): void {
  sidePanels.register({ id: 'system', title: 'System monitor', icon: Activity, order: 50, component: lazy(() => import('./SystemPanel')), popout: true, shortcutCommand: 'system.panel' })

  registerPage({ id: 'system', title: 'System Monitor', icon: Activity, component: lazyPage(() => import('./SystemPage')), listed: true, category: 'System' })

  // The HUD component only mounts while appearance.showHud is on (App renders <Hud/> conditionally),
  // so the poller runs only when the readouts are actually visible.
  hudItems.register({ id: 'system', order: 20, component: SystemHud })

  newTabWidgets.register({ id: 'system', title: 'System', order: 30, component: SystemWidget, defaultOn: true })

  registerCommands([
    { id: 'system.openMonitor', title: 'System monitor', category: 'System', icon: Activity, keywords: ['cpu', 'ram', 'gpu', 'memory', 'task manager', 'performance', 'vram'], run: () => newTab('specter://system') },
    { id: 'system.processes', title: 'Processes', description: 'Read-only list of running processes', category: 'System', icon: ListTree, keywords: ['task manager', 'tasklist', 'process'], run: () => newTab('specter://system/processes') },
    { id: 'system.network', title: 'Network diagnostics', description: 'Connectivity, DNS, HTTPS latency, TLS certificate', category: 'System', icon: Network, keywords: ['dns', 'ping', 'latency', 'tls', 'ssl', 'certificate', 'throughput'], run: () => newTab('specter://system/network') },
    { id: 'system.performance', title: 'SPECTER performance', description: 'SPECTER’s own processes, memory and performance modes', category: 'System', icon: Gauge, keywords: ['memory', 'renderer', 'mode', 'battery', 'gaming'], run: () => newTab('specter://system/performance') },
    { id: 'system.panel', title: 'Toggle system monitor panel', category: 'System', icon: PanelRight, run: () => toggleSidePanel('system') }
  ])
}
