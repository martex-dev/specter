import {
  AppWindow,
  Bookmark,
  Camera,
  Clock,
  Code2,
  Command,
  Download,
  FileDown,
  Focus,
  HelpCircle,
  Keyboard,
  KeyRound,
  MapPinned,
  Layers,
  LogOut,
  Minus,
  Plus,
  Printer,
  ScanSearch,
  Search,
  Settings,
  Shield,
  Stethoscope,
  Wrench,
  Maximize,
  Link2,
  ImageIcon,
  Type,
  ScrollText,
  Info,
  Moon,
  Copy,
  RefreshCw
} from 'lucide-react'
import { runCommand, shortcutFor } from '../lib/commands'
import { newTab, useBrowser } from '../stores/browser'
import type { MenuItem } from '../stores/ui'
import { useUpdates } from '../stores/updates'

const cmd = (id: string, label: string, icon: JSX.Element, args?: unknown): MenuItem => ({ label, icon, shortcut: shortcutFor(id), run: () => runCommand(id, args) })

export function mainMenu(): MenuItem[] {
  const st = useBrowser.getState()
  const ws = st.open[st.activeWsId]
  const tab = ws?.tabs.find((t) => t.id === ws.activeTabId)
  const zoom = Math.round((tab?.zoom ?? 1) * 100)
  const update = useUpdates.getState().s
  const updateItems: MenuItem[] =
    update?.phase === 'ready' ? [{ label: `Restart to update (${update.latest})`, icon: <RefreshCw size={14} className="accent" />, run: () => runCommand('app.update.install') }, { separator: true }] : []
  return [
    ...updateItems,
    cmd('browser.newTab', 'New tab', <Plus size={14} />),
    cmd('browser.newWindow', 'New window', <AppWindow size={14} />),
    { separator: true },
    cmd('palette.open', 'Command palette', <Command size={14} />),
    cmd('workspace.switcher', 'Workspaces', <Layers size={14} />),
    cmd('browser.history', 'History', <Clock size={14} />),
    cmd('browser.downloads', 'Downloads', <Download size={14} />),
    { label: 'Bookmarks', icon: <Bookmark size={14} />, run: () => newTab('specter://bookmarks') },
    cmd('browser.passwords', 'Passwords', <KeyRound size={14} />),
    cmd('browser.addresses', 'Addresses', <MapPinned size={14} />),
    { separator: true },
    {
      label: `Zoom  ${zoom}%`,
      icon: <Search size={14} />,
      submenu: [cmd('browser.zoomIn', 'Zoom in', <Plus size={14} />), cmd('browser.zoomOut', 'Zoom out', <Minus size={14} />), cmd('browser.zoomReset', 'Reset to 100%', <Search size={14} />), cmd('browser.fullscreen', 'Full screen', <Maximize size={14} />)]
    },
    cmd('browser.find', 'Find in page', <ScanSearch size={14} />),
    cmd('browser.print', 'Print…', <Printer size={14} />),
    cmd('browser.savePage', 'Save page as…', <FileDown size={14} />),
    {
      label: 'Page tools',
      icon: <Wrench size={14} />,
      submenu: [
        cmd('page.screenshot', 'Screenshot (visible)', <Camera size={14} />),
        cmd('page.screenshotFull', 'Full-page capture', <Camera size={14} />),
        cmd('page.screenshotClipboard', 'Screenshot to clipboard', <Copy size={14} />),
        cmd('page.reader', 'Reader mode', <ScrollText size={14} />),
        cmd('page.info', 'Page information', <Info size={14} />),
        cmd('page.copyText', 'Copy clean text', <Type size={14} />),
        cmd('page.extractLinks', 'Extract links', <Link2 size={14} />),
        cmd('page.extractImages', 'Extract images', <ImageIcon size={14} />),
        cmd('page.translate', 'Translate page', <Type size={14} />),
        { separator: true },
        cmd('browser.devtools', 'Developer tools (window)', <Code2 size={14} />),
        cmd('browser.devtoolsDock', 'Developer tools (docked)', <Code2 size={14} />),
        cmd('browser.viewSource', 'View source', <Code2 size={14} />)
      ]
    },
    { separator: true },
    cmd('ui.focusMode', 'Focus mode', <Focus size={14} />),
    cmd('tabs.suspendAll', 'Sleep background tabs', <Moon size={14} />),
    { separator: true },
    { label: 'Privacy Center', icon: <Shield size={14} />, run: () => newTab('specter://privacy') },
    { label: 'Keyboard shortcuts', icon: <Keyboard size={14} />, run: () => newTab('specter://settings/keyboard') },
    { label: 'Settings', icon: <Settings size={14} />, run: () => newTab('specter://settings') },
    { label: 'Help', icon: <HelpCircle size={14} />, shortcut: shortcutFor('help.open'), run: () => newTab('specter://help') },
    { label: 'Diagnostics', icon: <Stethoscope size={14} />, run: () => newTab('specter://diagnostics') },
    { separator: true },
    { label: 'Exit SPECTER', icon: <LogOut size={14} />, run: () => runCommand('app.quit') }
  ]
}
