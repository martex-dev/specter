import { useEffect } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { bindingIndex, eventToAccelerator, isChord, resolveBindings } from '@shared/keys'
import { isInternal } from '@shared/url'
import { invoke, invokeRaw, on } from './lib/ipc'
import { runCommand } from './lib/commands'
import { applyTheme } from './lib/themes'
import { applyRestoreChoice, dismissRestorePrompt, flushAll, newTab, runSuspensionPass, useActiveTab, useBrowser, addPermissionRequest, updateTab } from './stores/browser'
import { useSetting, useSettingsStore } from './stores/settings'
import { closeOverlay, toast, useUi } from './stores/ui'
import { tabIdForWcId } from './lib/webviews'
import { TabStrip, WorkspacePill } from './chrome/TabStrip'
import { Toolbar } from './chrome/Toolbar'
import { BookmarkBar } from './chrome/BookmarkBar'
import { Hud, SidePanelHost, SideRail, StatusBar } from './chrome/Frame'
import { ContentArea } from './content/ContentArea'
import { handleGuestCrash, handleGuestUnresponsive } from './content/PaneBars'
import { CommandPalette } from './overlays/CommandPalette'
import { TabSearch } from './overlays/TabSearch'
import { WorkspaceSwitcher } from './overlays/WorkspaceSwitcher'
import { showPageContextMenu } from './overlays/PageContextMenu'
import { QuickCaptureDialog, SaveToDialog } from './overlays/SaveCapture'
import { MenuLayer, SpecterMark, Toasts, TooltipLayer } from './components/ui'
import { PromptLayer } from './components/prompt'
import { renderExtraOverlay } from './modules/overlays'
import { ErrorBoundary } from './components/ErrorBoundary'

export function App() {
  const overlay = useUi((s) => s.overlay)
  const focusMode = useUi((s) => s.focusMode)
  const fullscreen = useUi((s) => s.windowState.fullscreen)
  const hoverUrl = useUi((s) => s.hoverUrl)
  const showBookmarks = useSetting('appearance.showBookmarksBar')
  const showStatus = useSetting('appearance.showStatusBar')
  const showHud = useSetting('appearance.showHud')
  const showRail = useSetting('appearance.showSideRail')
  const theme = useSetting('appearance.theme')
  const accent = useSetting('appearance.accent')
  const font = useSetting('appearance.fontFamily')
  const motion = useSetting('appearance.motion')
  const density = useSetting('appearance.density')
  const perfMode = useSetting('performance.mode')
  const bindings = useSetting('keyboard.bindings')
  const tab = useActiveTab()
  const restorePrompt = useBrowser((s) => s.restorePrompt)
  const workspaces = useBrowser((s) => s.workspaces)

  // Theme, motion and density → document + native title bar.
  useEffect(() => {
    const t = applyTheme(theme, accent, font)
    invoke('window:setTitleBarOverlay', { color: t.bg0, symbolColor: t.fg1, height: density === 'compact' ? 36 : 40 }).catch(() => undefined)
  }, [theme, accent, font, density])
  useEffect(() => {
    // ML / battery modes reduce animation cost automatically.
    const effective = motion === 'full' && (perfMode === 'ml' || perfMode === 'battery' || perfMode === 'gaming') ? 'reduced' : motion
    document.documentElement.dataset.motion = effective
    document.documentElement.dataset.density = density
  }, [motion, density, perfMode])

  // Window title follows the active tab.
  useEffect(() => {
    invoke('window:setTitle', tab?.title ?? '').catch(() => undefined)
  }, [tab?.title])

  // Clear the hover-URL bubble when switching tabs.
  useEffect(() => useUi.setState({ hoverUrl: '' }), [tab?.id])

  // Keyboard shortcuts while focus is in SPECTER's own UI.
  useEffect(() => {
    const index = bindingIndex(resolveBindings(bindings))
    const onKey = (e: KeyboardEvent) => {
      const acc = eventToAccelerator({ key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey })
      if (!acc) return
      const cmd = index.get(acc)
      if (!cmd) return
      const target = e.target as HTMLElement
      const typing = target.closest('input, textarea, select, [contenteditable="true"]')
      if (!isChord(acc) && (typing || acc === 'Escape')) return
      // Let text fields keep their standard editing chords.
      if (typing && ['Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Alt+Left', 'Alt+Right'].includes(acc)) return
      if (useUi.getState().overlay && !['palette.open', 'tabs.search', 'workspace.switcher'].includes(cmd)) {
        if (cmd !== 'browser.closeTab') return
      }
      e.preventDefault()
      e.stopPropagation()
      if (useUi.getState().overlay && ['palette.open', 'tabs.search', 'workspace.switcher'].includes(cmd)) closeOverlay()
      runCommand(cmd)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [bindings])

  // Main-process events.
  useEffect(() => {
    const offs = [
      on('command:run', ({ id, args }) => runCommand(id, args)),
      on('guest:contextMenu', (p) => showPageContextMenu(p)),
      on('guest:openUrl', ({ url, disposition, sourceWcId }) => {
        const opener = tabIdForWcId(sourceWcId) ?? undefined
        if (disposition === 'new-window') invoke('window:new', { url })
        else newTab(url, { background: disposition === 'background-tab', openerId: opener })
      }),
      on('guest:crashed', ({ wcId, reason }) => handleGuestCrash(wcId, reason)),
      on('guest:unresponsive', ({ wcId, responsive }) => handleGuestUnresponsive(wcId, responsive)),
      on('permissions:request', (req) => {
        const tabId = tabIdForWcId(req.webContentsId)
        if (tabId) addPermissionRequest(req, tabId)
        else invoke('permissions:respond', req.requestId, 'deny', false)
      }),
      on('window:state', (ws) => useUi.setState({ windowState: ws })),
      on('privacy:blocked', ({ perTab }) => {
        if (!perTab) return
        for (const [wcId, n] of Object.entries(perTab)) {
          const tabId = tabIdForWcId(Number(wcId))
          if (tabId) updateTab(tabId, { blocked: n })
        }
      }),
      on('workspaces:changed', () => import('./stores/browser').then((m) => m.refreshWorkspaceList())),
      on('downloads:changed', (d) => {
        if (d.state === 'progressing' && d.receivedBytes === 0) toast({ kind: 'info', title: 'Download started', body: d.filename, ttl: 2500 })
      })
    ]
    // Automatic tab sleeping.
    const timer = window.setInterval(runSuspensionPass, 30_000)
    const beforeUnload = () => flushAll()
    window.addEventListener('beforeunload', beforeUnload)
    // Bridge renderer events onto the main event bus (automations / activity).
    const bridge = (name: string, map: (d: any) => unknown) => {
      const fn = (e: Event) => invokeRaw('bus:emit', name, map((e as CustomEvent).detail)).catch(() => undefined)
      window.addEventListener(bridgeEvents[name], fn)
      return () => window.removeEventListener(bridgeEvents[name], fn)
    }
    const bridges = [
      bridge('TAB_CREATED', (d) => ({ url: d.url, workspaceId: d.wsId })),
      bridge('TAB_CLOSED', (d) => ({ url: d.url, workspaceId: d.wsId })),
      bridge('WORKSPACE_CHANGED', (d) => ({ workspaceId: d.wsId, name: d.name })),
      bridge('PAGE_LOADED', (d) => ({ url: d.url, title: '' }))
    ]
    return () => {
      offs.forEach((o) => o())
      bridges.forEach((b) => b())
      clearInterval(timer)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [])

  useEffect(() => {
    if (restorePrompt?.crashed) {
      toast({ kind: 'warn', title: 'Session recovered', body: 'SPECTER did not shut down cleanly last time. Your windows and tabs were restored.', ttl: 8000 })
      dismissRestorePrompt()
    }
  }, [restorePrompt])

  const classes = ['app', focusMode && 'focus', fullscreen && 'fullscreen'].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <header className="titlebar">
        <button className="brand" onClick={() => runCommand('palette.open')} data-tip="SPECTER — command palette" data-kbd="Ctrl+K" aria-label="SPECTER menu">
          <SpecterMark size={18} />
        </button>
        <WorkspacePill />
        <TabStrip />
        {showHud && !focusMode && <Hud />}
      </header>
      <Toolbar />
      {showBookmarks && !focusMode ? <BookmarkBar /> : <div className="toolbar-bottom-line" />}
      <main className="main">
        <section className="content">
          {restorePrompt && !restorePrompt.crashed && (
            <div className="infobar" style={{ background: 'var(--bg-2)' }}>
              <RotateCcw size={15} className="accent" />
              <span className="grow">
                Restore your previous session? <span className="muted">{restorePrompt.tabCount} tabs across {restorePrompt.workspaceCount} workspace{restorePrompt.workspaceCount === 1 ? '' : 's'}</span>
              </span>
              <button className="btn sm primary" onClick={async () => applyRestoreChoice(await invoke('session:restoreChoice', 'all'))}>
                Restore everything
              </button>
              <select
                className="select"
                style={{ height: 24, fontSize: 11.5 }}
                value=""
                onChange={async (e) => e.target.value && applyRestoreChoice(await invoke('session:restoreChoice', { workspaceId: e.target.value }))}
                aria-label="Restore a workspace"
              >
                <option value="">Restore workspace…</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <button
                className="btn sm ghost"
                onClick={async () => {
                  await invoke('session:restoreChoice', 'clean')
                  dismissRestorePrompt()
                }}
              >
                Start clean
              </button>
              <button className="icon-btn sm" onClick={dismissRestorePrompt} aria-label="Dismiss">
                <X size={13} />
              </button>
            </div>
          )}
          <ContentArea />
          {hoverUrl && !isInternal(hoverUrl) && <div className="hover-url">{hoverUrl}</div>}
        </section>
        <SidePanelHost />
        {showRail && !focusMode && <SideRail />}
      </main>
      {showStatus && !focusMode && <StatusBar />}

      <ErrorBoundary name="Overlay" key={overlay ?? 'none'} fallback={null}>
        {overlay === 'palette' && <CommandPalette />}
        {overlay === 'tabSearch' && <TabSearch />}
        {overlay === 'workspaces' && <WorkspaceSwitcher />}
        {overlay === 'saveTo' && <SaveToDialog />}
        {overlay === 'capture' && <QuickCaptureDialog />}
        {renderExtraOverlay(overlay)}
      </ErrorBoundary>
      <MenuLayer />
      <PromptLayer />
      <Toasts />
      <TooltipLayer />
    </div>
  )
}

const bridgeEvents: Record<string, string> = {
  TAB_CREATED: 'specter:tab-created',
  TAB_CLOSED: 'specter:tab-closed',
  WORKSPACE_CHANGED: 'specter:workspace-changed',
  PAGE_LOADED: 'specter:page-navigated'
}

export function useSettingsLoaded(): boolean {
  return useSettingsStore((s) => s.loaded)
}
