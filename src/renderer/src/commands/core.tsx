import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Camera,
  Clock,
  Code2,
  Columns2,
  Command as CommandIcon,
  Copy,
  CopyX,
  Download,
  Eye,
  FileDown,
  Focus,
  Gauge,
  Grid2x2,
  HelpCircle,
  Home,
  Keyboard,
  Layers,
  Link2,
  LogOut,
  Maximize,
  Moon,
  PanelBottom,
  PanelRight,
  PanelTop,
  Palette,
  PictureInPicture2,
  Pin,
  Plus,
  Printer,
  RotateCcw,
  RotateCw,
  Save,
  ScanSearch,
  Search,
  Settings,
  Shield,
  Square,
  Stethoscope,
  Tags,
  Type,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Columns3,
  ImageIcon,
  ListTree,
  Languages,
  Upload,
  FileJson,
  ScrollText,
  Info,
  BookmarkPlus,
  ClipboardList,
  Activity,
  User,
  Minimize2,
  RefreshCw,
  CloudDownload
} from 'lucide-react'
import { resolveTheme, THEMES } from '../lib/themes'
import { switchTheme } from '../lib/fx'
import type { PerformanceMode } from '@shared/settings'
import { isInternal } from '@shared/url'
import { invoke } from '../lib/ipc'
import { checkForUpdatesNow, installUpdate, useUpdates } from '../stores/updates'
import { registerCommands, runCommand, type Command } from '../lib/commands'
import { webviewFor, wcIdFor } from '../lib/webviews'
import {
  activateTabIndex,
  activeTab,
  activeWs,
  closeDuplicateTabs,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  createGroup,
  createWorkspaceAndSwitch,
  cycleTab,
  duplicateTab,
  findTab,
  goBack,
  goForward,
  loadUrl,
  moveTabToNewWindow,
  muteAll,
  newTab,
  reload,
  reopenClosedTab,
  saveTabsAsWorkspace,
  setLayout,
  setMuted,
  setTabNote,
  stop,
  suspendAllBackground,
  togglePin,
  updateTab,
  useBrowser,
  flushAll,
  openWorkspacesInWindow
} from '../stores/browser'
import { getSetting, setSetting } from '../stores/settings'
import { openMenu, openOverlay, openSidePanel, setFindOpen, toast, toggleSidePanel, useUi, type MenuItem } from '../stores/ui'
import { promptText } from '../components/prompt'
import { WORKSPACE_COLORS } from '../lib/icons'
import { begin } from '../lib/perf'

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

function tabFromArgs(args: any) {
  if (args?.fromGuest) {
    // Shortcut pressed inside a web page: act on that page's tab.
    const st = useBrowser.getState()
    for (const ws of Object.values(st.open)) for (const t of ws.tabs) if (wcIdFor(t.id) === args.fromGuest) return t
  }
  if (args?.tabId) return findTab(args.tabId)?.tab
  return activeTab()
}

function requireWeb(t = activeTab()): number | null {
  if (!t || isInternal(t.url)) {
    toast({ kind: 'info', title: 'Not available on this page', body: 'This tool works on web pages.' })
    return null
  }
  const id = wcIdFor(t.id)
  if (id === null) toast({ kind: 'info', title: 'Page is still loading' })
  return id
}

function zoom(delta: 0 | 1 | -1) {
  const t = activeTab()
  const wv = t && webviewFor(t.id)
  if (!t || !wv) return
  const cur = wv.getZoomFactor()
  const next = delta === 0 ? 1 : delta > 0 ? (ZOOM_STEPS.find((s) => s > cur + 0.001) ?? 5) : ([...ZOOM_STEPS].reverse().find((s) => s < cur - 0.001) ?? 0.25)
  wv.setZoomFactor(next)
  updateTab(t.id, { zoom: next })
}

async function screenshot(fullPage: boolean, toClipboard: boolean) {
  const wcId = requireWeb()
  if (wcId === null) return
  const r = await invoke('guest:screenshot', wcId, { fullPage, toClipboard })
  if (r === 'clipboard') toast({ kind: 'ok', title: 'Screenshot copied to clipboard' })
  else if (r) toast({ kind: 'ok', title: fullPage ? 'Full-page capture saved' : 'Screenshot saved', body: r, action: { label: 'Show in folder', run: () => invoke('app:showItemInFolder', r) } })
}

export function performanceModeMenu(x: number, y: number) {
  const cur = getSetting('performance.mode')
  const modes: { id: PerformanceMode; label: string; desc: string }[] = [
    { id: 'normal', label: 'Normal', desc: 'Balanced defaults' },
    { id: 'coding', label: 'Coding', desc: 'Tabs stay awake 2× longer' },
    { id: 'ml', label: 'ML', desc: 'Reduced animations, GPU first in telemetry' },
    { id: 'research', label: 'Research', desc: 'Tabs stay awake 2× longer' },
    { id: 'trading', label: 'Trading', desc: 'Finance & trading pages never sleep' },
    { id: 'gaming', label: 'Gaming', desc: 'Tabs sleep after 5 min, slower telemetry, reduced motion' },
    { id: 'battery', label: 'Battery', desc: 'Tabs sleep after 5 min, slower telemetry, reduced motion' }
  ]
  openMenu({
    x,
    y,
    width: 300,
    items: [{ header: 'Performance mode — affects SPECTER only' }, ...modes.map((m) => ({ label: `${m.label} — ${m.desc}`, checked: cur === m.id, run: () => setPerformanceMode(m.id) }))]
  })
}

export function setPerformanceMode(mode: PerformanceMode) {
  // The main process emits SYSTEM_MODE_CHANGED on the event bus when this setting changes.
  setSetting('performance.mode', mode)
  toast({ kind: 'info', title: `${mode[0].toUpperCase() + mode.slice(1)} mode`, body: 'Adjusts SPECTER’s own background activity, polling and animations.' })
}

export function registerCoreCommands(): void {
  const cmds: Command[] = [
    // ---------------- tabs / navigation
    { id: 'browser.newTab', title: 'New tab', category: 'Tabs', icon: Plus, run: () => newTab() },
    { id: 'browser.newWindow', title: 'New window', category: 'Browser', icon: AppWindow, run: () => invoke('window:new', {}) },
    {
      id: 'tabs.newTemporary',
      title: 'New temporary tab (not saved to the workspace)',
      category: 'Tabs',
      icon: Plus,
      keywords: ['scratch', 'throwaway', 'ephemeral'],
      run: () => newTab('specter://newtab', { temporary: true })
    },
    {
      id: 'window.mergeAll',
      title: 'Merge all windows into this one',
      category: 'Browser',
      icon: AppWindow,
      run: async () => {
        const n = await invoke('window:mergeInto')
        toast({ kind: n ? 'ok' : 'info', title: n ? `Merged ${n} window${n > 1 ? 's' : ''}` : 'No other windows to merge' })
      }
    },
    {
      id: 'browser.closeTab',
      title: 'Close tab',
      category: 'Tabs',
      icon: Square,
      run: (a) => {
        const t = tabFromArgs(a)
        if (t) closeTab(t.id)
      }
    },
    { id: 'browser.reopenClosedTab', title: 'Reopen closed tab', category: 'Tabs', icon: RotateCcw, run: () => reopenClosedTab() },
    { id: 'browser.nextTab', title: 'Next tab', category: 'Tabs', hidden: true, run: () => cycleTab(1) },
    { id: 'browser.prevTab', title: 'Previous tab', category: 'Tabs', hidden: true, run: () => cycleTab(-1) },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `browser.tab${n}`, title: `Go to tab ${n}`, category: 'Tabs' as const, hidden: true, run: () => activateTabIndex(n - 1) })),
    { id: 'browser.tabLast', title: 'Go to last tab', category: 'Tabs', hidden: true, run: () => activateTabIndex(-1) },
    {
      id: 'browser.reload',
      title: 'Reload page',
      category: 'Navigation',
      icon: RotateCw,
      run: (a) => {
        const t = tabFromArgs(a)
        if (t) reload(t.id)
      }
    },
    { id: 'browser.reloadF5', title: 'Reload page (F5)', category: 'Navigation', hidden: true, run: (a) => runCommand('browser.reload', a) },
    {
      id: 'browser.hardReload',
      title: 'Hard reload (bypass cache)',
      category: 'Navigation',
      icon: RotateCw,
      run: (a) => {
        const t = tabFromArgs(a)
        if (t) reload(t.id, true)
      }
    },
    { id: 'browser.back', title: 'Back', category: 'Navigation', icon: ArrowLeft, run: (a) => ((t) => t && goBack(t.id))(tabFromArgs(a)) },
    { id: 'browser.forward', title: 'Forward', category: 'Navigation', icon: ArrowRight, run: (a) => ((t) => t && goForward(t.id))(tabFromArgs(a)) },
    { id: 'browser.home', title: 'Home page', category: 'Navigation', icon: Home, run: () => ((t) => t && loadUrl(t.id, getSetting('general.homepage') || 'specter://newtab'))(activeTab()) },
    { id: 'browser.stop', title: 'Stop loading', category: 'Navigation', hidden: true, run: () => ((t) => t && stop(t.id))(activeTab()) },
    { id: 'browser.focusAddressBar', title: 'Focus address bar', category: 'Navigation', icon: Search, run: () => window.dispatchEvent(new Event('specter:focus-omnibox')) },
    { id: 'browser.focusAddressBarAlt', title: 'Focus address bar', category: 'Navigation', hidden: true, run: () => window.dispatchEvent(new Event('specter:focus-omnibox')) },
    {
      id: 'browser.openUrl',
      title: 'Open URL',
      category: 'Navigation',
      hidden: true,
      run: (a: { url: string; background?: boolean }) => {
        if (a?.url) newTab(a.url, { background: a.background })
      }
    },
    {
      id: 'browser.find',
      title: 'Find in page',
      category: 'Page',
      icon: ScanSearch,
      run: (a) => {
        const t = tabFromArgs(a)
        if (!t || isInternal(t.url)) return
        if (useUi.getState().findOpen[t.id]) window.dispatchEvent(new Event('specter:focus-find'))
        else setFindOpen(t.id, true)
      }
    },
    {
      id: 'browser.bookmarkPage',
      title: 'Bookmark this page',
      category: 'Browser',
      icon: Bookmark,
      run: async (a) => {
        const t = tabFromArgs(a)
        if (!t || isInternal(t.url)) return
        const existing = await invoke('bookmarks:findByUrl', t.url)
        if (existing) {
          const title = await promptText({ title: 'Edit bookmark', label: 'Name', initial: existing.title, confirmLabel: 'Save' })
          if (title === null) return
          if (title === '') {
            await invoke('bookmarks:remove', existing.id)
            toast({ kind: 'info', title: 'Bookmark removed' })
          } else await invoke('bookmarks:update', existing.id, { title })
          return
        }
        await invoke('bookmarks:add', { kind: 'bookmark', title: t.title || t.url, url: t.url, favicon: t.favicon })
        toast({
          kind: 'ok',
          title: 'Bookmarked',
          body: t.title,
          action: {
            label: 'Edit',
            run: () => runCommand('browser.bookmarkPage', { tabId: t.id })
          }
        })
      }
    },
    { id: 'browser.history', title: 'History', category: 'Browser', icon: Clock, run: () => newTab('specter://history') },
    { id: 'browser.downloads', title: 'Downloads', category: 'Browser', icon: Download, run: () => toggleSidePanel('downloads') },
    {
      id: 'browser.devtools',
      title: 'Developer tools (separate window)',
      category: 'Developer',
      icon: Code2,
      run: (a) => {
        const wcId = requireWeb(tabFromArgs(a))
        if (wcId !== null) invoke('guest:devtools', wcId, 'toggle')
      }
    },
    { id: 'browser.devtoolsAlt', title: 'Developer tools', category: 'Developer', hidden: true, run: (a) => runCommand('browser.devtoolsDock', a) },
    {
      id: 'browser.devtoolsDock',
      title: 'Developer tools (docked)',
      category: 'Developer',
      icon: PanelBottom,
      run: (a) => {
        const t = tabFromArgs(a)
        if (!t || isInternal(t.url)) return
        // The dock attaches as soon as the page's webContents is ready (even if still loading).
        updateTab(t.id, { devtoolsDocked: !t.devtoolsDocked, suspended: false })
      }
    },
    { id: 'browser.zoomIn', title: 'Zoom in', category: 'View', icon: ZoomIn, run: () => zoom(1) },
    { id: 'browser.zoomOut', title: 'Zoom out', category: 'View', icon: ZoomOut, run: () => zoom(-1) },
    { id: 'browser.zoomReset', title: 'Reset zoom', category: 'View', icon: Search, run: () => zoom(0) },
    { id: 'browser.fullscreen', title: 'Toggle full screen', category: 'View', icon: Maximize, run: () => invoke('window:toggleFullscreen') },
    {
      id: 'browser.print',
      title: 'Print page',
      category: 'Page',
      icon: Printer,
      run: () => {
        const wcId = requireWeb()
        if (wcId !== null) invoke('guest:print', wcId)
      }
    },
    {
      id: 'browser.savePage',
      title: 'Save page as…',
      category: 'Page',
      icon: FileDown,
      run: async () => {
        const wcId = requireWeb()
        if (wcId === null) return
        const p = await invoke('guest:savePage', wcId)
        if (p) toast({ kind: 'ok', title: 'Page saved', body: p })
      }
    },
    {
      id: 'browser.viewSource',
      title: 'View page source',
      category: 'Developer',
      icon: Code2,
      run: () => {
        const t = activeTab()
        if (t && /^https?:/.test(t.url)) newTab('view-source:' + t.url)
      }
    },
    // ---------------- tab utilities
    { id: 'tabs.search', title: 'Search tabs', category: 'Tabs', icon: Search, keywords: ['find tab', 'switch'], run: () => openOverlay('tabSearch') },
    { id: 'tabs.duplicate', title: 'Duplicate tab', category: 'Tabs', icon: Copy, run: () => ((t) => t && duplicateTab(t.id))(activeTab()) },
    { id: 'tabs.pin', title: 'Pin / unpin tab', category: 'Tabs', icon: Pin, run: () => ((t) => t && togglePin(t.id))(activeTab()) },
    { id: 'tabs.mute', title: 'Mute / unmute tab', category: 'Tabs', icon: VolumeX, run: () => ((t) => t && setMuted(t.id, !t.muted))(activeTab()) },
    { id: 'tabs.muteAll', title: 'Mute all tabs', category: 'Tabs', icon: VolumeX, run: () => muteAll() },
    { id: 'tabs.unmuteAll', title: 'Unmute all tabs', category: 'Tabs', icon: Volume2, run: () => activeWs()?.tabs.forEach((t) => setMuted(t.id, false)) },
    { id: 'tabs.reloadAll', title: 'Reload all tabs', category: 'Tabs', icon: RotateCw, run: () => activeWs()?.tabs.forEach((t) => !t.suspended && reload(t.id)) },
    {
      id: 'tabs.suspendAll',
      title: 'Sleep all background tabs',
      category: 'Tabs',
      icon: Moon,
      keywords: ['suspend', 'discard', 'memory'],
      run: () => {
        suspendAllBackground()
        toast({ kind: 'ok', title: 'Background tabs put to sleep' })
      }
    },
    {
      id: 'tabs.closeDuplicates',
      title: 'Close duplicate tabs',
      category: 'Tabs',
      icon: CopyX,
      run: () => {
        const n = closeDuplicateTabs()
        toast({ kind: 'info', title: n ? `Closed ${n} duplicate tab${n > 1 ? 's' : ''}` : 'No duplicate tabs' })
      }
    },
    { id: 'tabs.closeOthers', title: 'Close other tabs', category: 'Tabs', icon: CopyX, run: () => ((t) => t && closeOtherTabs(t.id))(activeTab()) },
    { id: 'tabs.closeRight', title: 'Close tabs to the right', category: 'Tabs', icon: CopyX, run: () => ((t) => t && closeTabsToRight(t.id))(activeTab()) },
    {
      id: 'tabs.copyAllUrls',
      title: 'Copy all tab URLs',
      category: 'Tabs',
      icon: Link2,
      run: async () => {
        const ws = activeWs()
        if (!ws) return
        const urls = ws.tabs.filter((t) => !isInternal(t.url)).map((t) => t.url)
        await invoke('app:clipboardWrite', urls.join('\n'))
        toast({ kind: 'ok', title: `Copied ${urls.length} URLs` })
      }
    },
    {
      id: 'tabs.saveAsWorkspace',
      title: 'Save all tabs as new workspace…',
      category: 'Workspace',
      icon: Save,
      run: async () => {
        const name = await promptText({ title: 'Save tabs as workspace', placeholder: 'Workspace name' })
        if (!name) return
        await saveTabsAsWorkspace(name)
        toast({ kind: 'ok', title: `Workspace “${name}” created` })
      }
    },
    {
      id: 'tabs.export',
      title: 'Export tabs…',
      category: 'Tabs',
      icon: FileJson,
      run: (a?: { format?: 'json' | 'markdown' | 'html' }) => {
        const ws = activeWs()
        if (!ws) return
        const go = (format: 'json' | 'markdown' | 'html') => invoke('workspaces:export', ws.id, format).then((p) => p && toast({ kind: 'ok', title: 'Exported', body: p }))
        if (a?.format) return go(a.format)
        const r = document.querySelector('.toolbar')?.getBoundingClientRect()
        openMenu({
          x: (r?.right ?? 400) - 260,
          y: (r?.bottom ?? 80) + 4,
          items: [{ header: 'Export tabs as' }, { label: 'Markdown (.md)', run: () => go('markdown') }, { label: 'JSON (.json)', run: () => go('json') }, { label: 'HTML bookmarks (.html)', run: () => go('html') }]
        })
      }
    },
    {
      id: 'tabs.importList',
      title: 'Open a list of URLs…',
      category: 'Tabs',
      icon: Upload,
      run: async () => {
        const text = await promptText({ title: 'Open URLs', label: 'One URL per line', multiline: true, confirmLabel: 'Open all' })
        if (!text) return
        const urls = text
          .split(/\s+/)
          .map((s) => s.trim())
          .filter((s) => /^https?:\/\//.test(s))
        urls.slice(0, 100).forEach((u) => newTab(u, { background: true }))
        toast({ kind: 'ok', title: `Opened ${Math.min(100, urls.length)} tabs` })
      }
    },
    {
      id: 'tabs.group',
      title: 'Add tab to new group…',
      category: 'Tabs',
      icon: Tags,
      run: async () => {
        const t = activeTab()
        if (!t) return
        const name = await promptText({ title: 'New tab group', placeholder: 'Group name (optional)' })
        if (name !== null) createGroup([t.id], name.trim())
      }
    },
    { id: 'tabs.moveToNewWindow', title: 'Move tab to new window', category: 'Tabs', icon: AppWindow, run: () => ((t) => t && moveTabToNewWindow(t.id))(activeTab()) },
    {
      id: 'tabs.note',
      title: 'Add note to tab…',
      category: 'Tabs',
      icon: ClipboardList,
      run: async () => {
        const t = activeTab()
        if (!t) return
        const note = await promptText({ title: 'Tab note', initial: t.note, multiline: true, placeholder: 'e.g. Need to inspect this API later' })
        if (note !== null) setTabNote(t.id, note)
      }
    },
    { id: 'tabs.dashboard', title: 'Tab sleep & memory dashboard', category: 'Tabs', icon: Activity, run: () => openSidePanel('tabs') },
    // ---------------- palette / workspace / layout
    { id: 'palette.open', title: 'Command palette', category: 'Browser', icon: CommandIcon, hidden: true, run: () => (begin('palette'), openOverlay('palette')) },
    { id: 'palette.commands', title: 'Commands only', category: 'Browser', hidden: true, run: () => openOverlay('palette', undefined, '>') },
    { id: 'workspace.switcher', title: 'Switch workspace', category: 'Workspace', icon: Layers, run: () => openOverlay('workspaces') },
    {
      id: 'workspace.create',
      title: 'New workspace…',
      category: 'Workspace',
      icon: Plus,
      run: async () => {
        const name = await promptText({ title: 'New workspace', placeholder: 'Workspace name' })
        if (name?.trim()) await createWorkspaceAndSwitch(name.trim(), 'layers', WORKSPACE_COLORS[useBrowser.getState().workspaces.length % WORKSPACE_COLORS.length])
      }
    },
    {
      id: 'workspace.snapshot',
      title: 'Snapshot current workspace',
      category: 'Workspace',
      icon: Camera,
      run: async () => {
        const ws = activeWs()
        if (!ws) return
        flushAll()
        await new Promise((r) => setTimeout(r, 60))
        const snap = await invoke('workspaces:snapshot', ws.id, undefined)
        toast({ kind: 'ok', title: 'Snapshot saved', body: `${ws.name} · ${snap.tabCount} tabs` })
      }
    },
    { id: 'workspace.manage', title: 'Manage workspaces & snapshots', category: 'Workspace', icon: Layers, run: () => newTab('specter://workspaces') },
    {
      id: 'workspace.import',
      title: 'Import workspace from file…',
      category: 'Workspace',
      icon: Upload,
      run: async () => {
        const w = await invoke('workspaces:import')
        if (w) {
          toast({ kind: 'ok', title: `Imported “${w.name}”` })
          const { refreshWorkspaceList } = await import('../stores/browser')
          refreshWorkspaceList()
        }
      }
    },
    { id: 'layout.split', title: 'Split view 50 / 50', category: 'Layout', icon: Columns2, run: () => setLayout(activeWs()?.layout.preset !== 'single' ? 'single' : '50/50') },
    { id: 'layout.single', title: 'Exit split view', category: 'Layout', icon: Square, run: () => setLayout('single') },
    { id: 'layout.threeColumn', title: 'Three-column layout', category: 'Layout', icon: Columns3, run: () => setLayout('three-column') },
    { id: 'layout.quadrant', title: 'Quadrant layout (2 × 2)', category: 'Layout', icon: Grid2x2, run: () => setLayout('quadrant') },
    { id: 'layout.saved', title: 'Saved layouts', category: 'Layout', icon: Layers, run: () => newTab('specter://workspaces/layouts') },
    // ---------------- view
    {
      id: 'ui.focusMode',
      title: 'Toggle focus mode',
      category: 'View',
      icon: Focus,
      keywords: ['distraction free', 'zen'],
      run: () => useUi.setState((s) => ({ focusMode: !s.focusMode }))
    },
    { id: 'ui.toggleSidebar', title: 'Toggle side panel', category: 'View', icon: PanelRight, run: () => useUi.setState((s) => ({ sidePanel: s.sidePanel ? null : 'ai' })) },
    { id: 'ui.toggleBookmarksBar', title: 'Toggle bookmarks bar', category: 'View', icon: Bookmark, run: () => setSetting('appearance.showBookmarksBar', !getSetting('appearance.showBookmarksBar')) },
    { id: 'ui.toggleStatusBar', title: 'Toggle status bar', category: 'View', icon: PanelBottom, run: () => setSetting('appearance.showStatusBar', !getSetting('appearance.showStatusBar')) },
    { id: 'ui.toggleHud', title: 'Toggle title-bar telemetry (HUD)', category: 'View', icon: PanelTop, run: () => setSetting('appearance.showHud', !getSetting('appearance.showHud')) },
    { id: 'ui.toggleRail', title: 'Toggle tool rail', category: 'View', icon: PanelRight, run: () => setSetting('appearance.showSideRail', !getSetting('appearance.showSideRail')) },
    { id: 'ui.compactMode', title: 'Toggle compact mode', category: 'View', icon: Minimize2, run: () => setSetting('appearance.density', getSetting('appearance.density') === 'compact' ? 'comfortable' : 'compact') },
    ...THEMES.map((t) => ({
      id: `ui.theme.${t.id}`,
      title: `Theme: ${t.name}`,
      description: t.tagline,
      category: 'View' as const,
      icon: Palette,
      keywords: ['theme', 'appearance', ...t.palettes.map((p) => p.name)],
      run: () =>
        switchTheme(
          () => {
            setSetting('appearance.theme', t.id)
            setSetting('appearance.palette', '')
            setSetting('appearance.accent', '')
            setSetting('appearance.layout', {})
          },
          { theme: t.id },
          false
        )
    })),
    { id: 'ui.verticalTabs', title: 'Toggle vertical tabs', category: 'View', icon: PanelRight, keywords: ['sidebar', 'tab list'], run: () => setSetting('appearance.verticalTabs', !getSetting('appearance.verticalTabs')) },
    { id: 'ui.themes', title: 'Theme gallery…', category: 'View', icon: Palette, keywords: ['appearance', 'colors', 'palette'], run: () => newTab('specter://settings/appearance') },
    {
      id: 'ui.nextPalette',
      title: 'Next colour palette',
      category: 'View',
      icon: Palette,
      run: () => {
        const { theme, palette } = resolveTheme(getSetting('appearance.theme'), getSetting('appearance.palette'))
        const i = theme.palettes.findIndex((p) => p.id === palette.id)
        const next = theme.palettes[(i + 1) % theme.palettes.length]
        switchTheme(() => (setSetting('appearance.palette', next.id), setSetting('appearance.accent', '')), { palette: next.id }, false)
        toast({ kind: 'info', title: `${theme.name} · ${next.name}` })
      }
    },
    {
      id: 'ui.motion',
      title: 'Cycle animations (full / reduced / off)',
      category: 'View',
      icon: Eye,
      run: () => {
        const order = ['full', 'reduced', 'off'] as const
        const next = order[(order.indexOf(getSetting('appearance.motion')) + 1) % 3]
        setSetting('appearance.motion', next)
        toast({ kind: 'info', title: `Animations: ${next}` })
      }
    },
    // ---------------- page tools
    {
      id: 'page.reader',
      title: 'Toggle reader mode',
      category: 'Page',
      icon: BookOpen,
      run: (a) => {
        const t = tabFromArgs(a)
        if (!t || requireWeb(t) === null) return
        updateTab(t.id, { reader: !t.reader })
      }
    },
    { id: 'page.screenshot', title: 'Screenshot visible page', category: 'Page', icon: Camera, run: () => screenshot(false, false) },
    { id: 'page.screenshotFull', title: 'Full-page capture', category: 'Page', icon: Camera, run: () => screenshot(true, false) },
    { id: 'page.screenshotClipboard', title: 'Screenshot to clipboard', category: 'Page', icon: Copy, run: () => screenshot(false, true) },
    { id: 'page.info', title: 'Page information', category: 'Page', icon: Info, run: () => openSidePanel('pagetools') },
    {
      id: 'page.copyText',
      title: 'Copy clean page text',
      category: 'Page',
      icon: Type,
      run: async () => {
        const wcId = requireWeb()
        if (wcId === null) return
        const text = await invoke('guest:cleanText', wcId)
        await invoke('app:clipboardWrite', text)
        toast({ kind: 'ok', title: 'Page text copied', body: `${text.split(/\s+/).filter(Boolean).length} words` })
      }
    },
    { id: 'page.extractLinks', title: 'Extract links', category: 'Page', icon: Link2, run: () => (useUi.setState({ overlayArg: 'links' }), openSidePanel('pagetools')) },
    { id: 'page.extractImages', title: 'Extract images', category: 'Page', icon: ImageIcon, run: () => (useUi.setState({ overlayArg: 'images' }), openSidePanel('pagetools')) },
    { id: 'page.wordCount', title: 'Word count & reading time', category: 'Page', icon: ScrollText, run: () => openSidePanel('pagetools') },
    { id: 'page.headings', title: 'Page outline (headings)', category: 'Page', icon: ListTree, run: () => (useUi.setState({ overlayArg: 'outline' }), openSidePanel('pagetools')) },
    {
      id: 'page.translate',
      title: 'Translate page (opens translation service)',
      category: 'Page',
      icon: Languages,
      description: 'Opens the page in Google Translate — the page URL is sent to Google.',
      run: () => {
        const t = activeTab()
        if (!t || !/^https?:/.test(t.url)) return
        const lang = (navigator.language || 'en').split('-')[0]
        newTab(`https://translate.google.com/translate?sl=auto&tl=${lang}&u=${encodeURIComponent(t.url)}`)
      }
    },
    {
      id: 'page.pip',
      title: 'Picture-in-picture video',
      category: 'Page',
      icon: PictureInPicture2,
      run: () => {
        const wcId = requireWeb()
        if (wcId !== null) invoke('guest:mediaControl', wcId, 'pip')
      }
    },
    { id: 'save.toSpecter', title: 'Save to SPECTER…', category: 'Knowledge', icon: BookmarkPlus, run: () => openOverlay('saveTo') },
    { id: 'capture.quick', title: 'Quick capture selection', category: 'Knowledge', icon: ClipboardList, run: () => openOverlay('capture') },
    // ---------------- app
    { id: 'settings.open', title: 'Settings', category: 'Settings', icon: Settings, run: () => newTab('specter://settings') },
    { id: 'settings.keyboard', title: 'Keyboard shortcuts', category: 'Settings', icon: Keyboard, run: () => newTab('specter://settings/keyboard') },
    { id: 'privacy.open', title: 'Privacy Center', category: 'Privacy', icon: Shield, run: () => newTab('specter://privacy') },
    { id: 'security.open', title: 'Security dashboard', category: 'Privacy', icon: Shield, run: () => newTab('specter://security') },
    { id: 'diagnostics.open', title: 'SPECTER Diagnostics', category: 'Help', icon: Stethoscope, run: () => newTab('specter://diagnostics') },
    { id: 'logs.open', title: 'Log viewer', category: 'Developer', icon: ScrollText, run: () => newTab('specter://logs') },
    { id: 'help.open', title: 'Help', category: 'Help', icon: HelpCircle, run: () => newTab('specter://help') },
    { id: 'activity.open', title: 'Daily activity', category: 'Browser', icon: Activity, run: () => newTab('specter://activity') },
    { id: 'app.quit', title: 'Exit SPECTER', category: 'Browser', icon: LogOut, run: () => (flushAll(), invoke('app:quit')) },
    { id: 'app.update.check', title: 'Check for updates', category: 'Help', icon: CloudDownload, keywords: ['update', 'upgrade', 'version', 'release'], run: () => checkForUpdatesNow() },
    {
      id: 'app.update.install',
      title: 'Restart to update',
      category: 'Help',
      icon: RefreshCw,
      keywords: ['update', 'upgrade', 'install', 'relaunch'],
      when: () => useUpdates.getState().s?.phase === 'ready',
      run: () => installUpdate()
    },
    {
      id: 'system.modeMenu',
      title: 'Performance mode…',
      category: 'System',
      icon: Gauge,
      run: () => {
        const r = document.querySelector('.statusbar')?.getBoundingClientRect()
        performanceModeMenu((r?.right ?? 600) - 320, (r?.top ?? 500) - 290)
      }
    },
    {
      id: 'profiles.menu',
      title: 'Switch profile…',
      category: 'Browser',
      icon: User,
      run: async (a?: { x: number; y: number }) => {
        const [profiles, cur] = [await invoke('profiles:list'), useBrowser.getState().profile]
        const items: MenuItem[] = [
          { header: 'Profiles — isolated cookies, history & bookmarks' },
          ...profiles.map((p) => ({
            label: p.name,
            icon: <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, display: 'inline-block' }} />,
            checked: p.id === cur?.id,
            run: () => p.id !== cur?.id && (flushAll(), invoke('profiles:openWindow', p.id))
          })),
          { separator: true },
          {
            label: 'Add profile…',
            icon: <Plus size={14} />,
            run: async () => {
              const name = await promptText({ title: 'New profile', placeholder: 'e.g. Work, Research' })
              if (name?.trim()) {
                await invoke('profiles:create', name.trim(), WORKSPACE_COLORS[profiles.length % WORKSPACE_COLORS.length])
                toast({ kind: 'ok', title: `Profile “${name.trim()}” created`, body: 'Open it from this menu.' })
              }
            }
          },
          { label: 'Manage profiles', icon: <Settings size={14} />, run: () => newTab('specter://settings/profiles') }
        ]
        const r = document.querySelector('.toolbar')?.getBoundingClientRect()
        openMenu({ x: a?.x ?? (r?.right ?? 600) - 280, y: a?.y ?? (r?.bottom ?? 80) + 4, items, width: 280 })
      }
    },
    // ---------------- internal (hidden)
    { id: 'internal.flush', title: 'Flush state', category: 'Browser', hidden: true, run: () => flushAll() },
    {
      id: 'internal.openWorkspaces',
      title: 'Open workspaces in this window',
      category: 'Workspace',
      hidden: true,
      run: (a: { ids: string[] }) => openWorkspacesInWindow(a?.ids ?? [])
    },
    {
      id: 'internal.popupBlocked',
      title: 'Popup blocked',
      category: 'Browser',
      hidden: true,
      run: (a: { wcId: number; url: string; origin: string }) => {
        const st = useBrowser.getState()
        for (const ws of Object.values(st.open))
          for (const t of ws.tabs)
            if (wcIdFor(t.id) === a.wcId) {
              updateTab(t.id, { blockedPopups: [...(t.blockedPopups ?? []), { url: a.url, origin: a.origin }].slice(-10) })
              return
            }
      }
    },
    {
      id: 'internal.zoomChanged',
      title: 'Zoom changed',
      category: 'View',
      hidden: true,
      run: (a: { wcId: number; factor: number }) => {
        const st = useBrowser.getState()
        for (const ws of Object.values(st.open)) for (const t of ws.tabs) if (wcIdFor(t.id) === a.wcId) updateTab(t.id, { zoom: a.factor })
      }
    }
  ]
  registerCommands(cmds)
}
