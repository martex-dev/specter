// Shared per-app menu (dock button context menu and the panel's "more" button).
import { AppWindow, ArrowUpRight, Bell, Hash, Home, LayoutGrid, Pencil, PowerOff, RotateCw, Smartphone, Trash2, Volume2, VolumeX, ZoomIn } from 'lucide-react'
import { WEBAPP_ZOOMS } from '@shared/modules/webapps'
import type { MenuItem } from '../../stores/ui'
import { newTab } from '../../stores/browser'
import { confirmAction, promptText } from '../../components/prompt'
import { getApp, goHome, openInTab, reloadApp, removeApp, runtimeOf, saveApp, setMobile, setMuted, setZoom, unloadApp } from './store'

export function appMenuItems(id: string, opts: { withHeader?: boolean } = {}): MenuItem[] {
  const app = getApp(id)
  if (!app) return []
  const rt = runtimeOf(id)
  return [
    ...(opts.withHeader ? [{ header: app.name }] : []),
    { label: 'Reload', icon: <RotateCw size={14} />, run: () => reloadApp(id) },
    { label: 'Go to home page', icon: <Home size={14} />, disabled: !rt.live, run: () => goHome(id) },
    { label: 'Open current page in a tab', icon: <ArrowUpRight size={14} />, run: () => openInTab(id) },
    { separator: true },
    { label: 'Mobile layout', icon: <Smartphone size={14} />, checked: app.mobile, run: () => void setMobile(id, !app.mobile) },
    { label: app.muted ? 'Unmute' : 'Mute', icon: app.muted ? <Volume2 size={14} /> : <VolumeX size={14} />, run: () => void setMuted(id, !app.muted) },
    {
      label: `Zoom (${Math.round(app.zoom * 100)}%)`,
      icon: <ZoomIn size={14} />,
      submenu: WEBAPP_ZOOMS.map((z) => ({ label: Math.round(z * 100) + '%', checked: Math.abs(app.zoom - z) < 0.001, run: () => void setZoom(id, z) }))
    },
    { label: 'Unread badge', icon: <Hash size={14} />, checked: app.badges, run: () => void saveApp({ id, badges: !app.badges }) },
    { label: 'Alert on new unread', icon: <Bell size={14} />, checked: app.notify, disabled: !app.badges, run: () => void saveApp({ id, notify: !app.notify }) },
    { separator: true },
    { label: 'Unload (free memory)', icon: <PowerOff size={14} />, disabled: !rt.live, run: () => unloadApp(id) },
    {
      label: 'Rename…',
      icon: <Pencil size={14} />,
      run: async () => {
        const name = await promptText({ title: 'Rename web app', initial: app.name, placeholder: 'Name' })
        if (name?.trim()) await saveApp({ id, name })
      }
    },
    { label: 'App options…', icon: <AppWindow size={14} />, run: () => newTab('specter://webapps#' + id) },
    { label: 'Manage web apps…', icon: <LayoutGrid size={14} />, run: () => newTab('specter://webapps') },
    {
      label: 'Remove from sidebar',
      icon: <Trash2 size={14} />,
      danger: true,
      run: async () => {
        if (await confirmAction(`Remove ${app.name}?`, 'The app leaves the sidebar. Your login for the site is kept, because it is shared with normal tabs.', 'Remove', true)) await removeApp(id)
      }
    }
  ]
}
