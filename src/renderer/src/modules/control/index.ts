// GX-style Control: limiters, sounds, wallpapers — renderer module entry.
import { lazy } from 'react'
import { Flame, Gauge, ImageIcon, MemoryStick, SlidersHorizontal, Volume2, Wifi } from 'lucide-react'
import { NET_PRESETS, type NetPresetId, type WallpaperId } from '@shared/modules/control'
import { registerCommands } from '../../lib/commands'
import { newTabBackgrounds, sidePanels } from '../../lib/registry'
import { setSetting } from '../../stores/settings'
import { openSidePanel, toast } from '../../stores/ui'
import { initControlStore, patchConfig, setSection, type ControlSection } from './store'
import { startTabSync } from './tabsync'
import { startSounds } from './sound/engine'
import { BUILTIN_WALLPAPERS } from './wallpaper/art'
import NewTabWallpaper from './wallpaper/NewTabWallpaper'
import './control.css'

function open(section: ControlSection): void {
  setSection(section)
  openSidePanel('control')
}

export function register(): void {
  const isPopout = !!new URLSearchParams(location.hash.slice(1)).get('panel')
  initControlStore()

  sidePanels.register({
    id: 'control',
    title: 'GX Control',
    icon: Gauge,
    order: 40,
    section: 'widgets',
    width: 400,
    popout: true,
    component: lazy(() => import('./ControlPanel')),
    shortcutCommand: 'control.open'
  })

  // Full-bleed wallpaper behind the new tab page (renders nothing when unset).
  newTabBackgrounds.register({ id: 'control-wallpaper', order: 0, component: NewTabWallpaper })

  if (!isPopout) {
    // Services that act on this window's tabs / UI (a pop-out panel window has no tabs).
    startTabSync()
    startSounds()
  }

  registerCommands([
    { id: 'control.open', title: 'GX Control', description: 'RAM, network and CPU limiters, hot tabs, sounds and wallpaper', category: 'System', icon: SlidersHorizontal, keywords: ['gx', 'control', 'limiter', 'performance', 'memory'], run: () => open('limiters') },
    {
      id: 'control.ramLimit',
      title: 'RAM limiter',
      description: 'Cap SPECTER’s memory by sleeping background tabs',
      category: 'System',
      icon: MemoryStick,
      keywords: ['memory', 'ram', 'limit', 'gx'],
      run: (args?: { enabled?: boolean; limitGB?: number; hard?: boolean }) => {
        if (args && (args.enabled !== undefined || args.limitGB !== undefined || args.hard !== undefined))
          void patchConfig({ ram: { ...(args.enabled !== undefined ? { enabled: !!args.enabled } : {}), ...(args.limitGB ? { limitMB: Math.round(args.limitGB * 1024) } : {}), ...(args.hard !== undefined ? { hard: !!args.hard } : {}) } })
        open('limiters')
      }
    },
    {
      id: 'control.networkLimit',
      title: 'Network limiter',
      description: 'Cap SPECTER’s bandwidth (web pages in this profile)',
      category: 'System',
      icon: Wifi,
      keywords: ['bandwidth', 'throttle', 'network', 'speed', 'gx'],
      run: (args?: { preset?: NetPresetId | number }) => {
        if (args?.preset !== undefined) {
          const id = String(args.preset) as NetPresetId
          if (NET_PRESETS.some((p) => p.id === id)) void patchConfig({ net: { preset: id } })
        }
        open('limiters')
      }
    },
    {
      id: 'control.sounds',
      title: 'Browser sounds',
      description: 'Subtle synthesized UI sounds',
      category: 'View',
      icon: Volume2,
      keywords: ['sound', 'audio', 'click', 'gx'],
      run: (args?: { enabled?: boolean }) => {
        if (args?.enabled !== undefined) {
          void patchConfig({ sounds: { enabled: !!args.enabled } })
          toast({ kind: 'info', title: args.enabled ? 'Browser sounds on' : 'Browser sounds off' })
        }
        open('sound')
      }
    },
    {
      id: 'control.wallpaper',
      title: 'New tab wallpaper',
      description: 'Procedural theme-coloured wallpapers or your own image',
      category: 'View',
      icon: ImageIcon,
      keywords: ['background', 'wallpaper', 'new tab', 'aurora', 'stars'],
      run: (args?: { id?: WallpaperId | 'none' }) => {
        if (args?.id === 'none') void setSetting('appearance.wallpaper', '')
        else if (args?.id && BUILTIN_WALLPAPERS.some((w) => w.id === args.id)) void setSetting('appearance.wallpaper', 'builtin:' + args.id)
        open('wallpaper')
      }
    },
    { id: 'control.hotTabs', title: 'Hot tabs killer', description: 'Tabs by measured memory and CPU; sleep the heavy ones', category: 'Tabs', icon: Flame, keywords: ['heavy', 'memory', 'cpu', 'sleep', 'kill', 'gx'], run: () => open('hot') }
  ])
}
