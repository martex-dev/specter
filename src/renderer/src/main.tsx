import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/chrome.css'
import './styles/overlays.css'
import './styles/pages.css'
import { invoke } from './lib/ipc'
import { applyTheme } from './lib/themes'
import { useSettingsStore } from './stores/settings'
import { activeTab, initBrowser, loadUrl, newTab, useBrowser } from './stores/browser'
import { useUi } from './stores/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { registerCore } from './core'
import { registerModules } from './modules'
import { App } from './App'
import { record } from './lib/perf'
import { PopoutPanel } from './core/PopoutPanel'

// Chromium keeps native keyboard focus inside a <webview> guest when SPECTER's UI
// calls element.focus(); typing would then still go to the page. Blurring the
// focused webview first hands keyboard focus back to the UI. Applied globally so
// every input (address bar, palette, dialogs, modules) behaves correctly.
const nativeFocus = HTMLElement.prototype.focus
HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
  const active = document.activeElement as HTMLElement | null
  if (active && active !== this && active.tagName === 'WEBVIEW' && this.tagName !== 'WEBVIEW') active.blur()
  return nativeFocus.call(this, options)
}

// Read-only state accessor for SPECTER's own end-to-end tests (UI renderer only; web pages can't see it).
Object.defineProperty(window, '__specterDebug', {
  value: Object.freeze({ browser: () => useBrowser.getState(), ui: () => useUi.getState() }),
  enumerable: false
})

async function boot() {
  await useSettingsStore.getState().load()
  const s = useSettingsStore.getState().s
  applyTheme(s['appearance.theme'], s['appearance.accent'], s['appearance.fontFamily'])
  document.documentElement.dataset.motion = s['appearance.motion']
  document.documentElement.dataset.density = s['appearance.density']
  registerCore()
  registerModules()

  const root = createRoot(document.getElementById('root')!)
  const panel = new URLSearchParams(location.hash.slice(1)).get('panel')
  if (panel) {
    root.render(<PopoutPanel id={panel} />)
    return
  }
  const init = await invoke('session:initial')
  initBrowser(init)
  const hasWelcome = Object.values(useBrowser.getState().open).some((w) => w.tabs.some((t) => t.url === 'specter://welcome'))
  if (!s['general.onboarded'] && !hasWelcome) {
    const t = activeTab()
    if (t && t.url === 'specter://newtab') loadUrl(t.id, 'specter://welcome')
    else newTab('specter://welcome')
  }
  requestAnimationFrame(() => record('startup', performance.now()))
  root.render(
    <StrictMode>
      <ErrorBoundary name="SPECTER interface">
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}

boot().catch((err) => {
  console.error('SPECTER failed to start', err)
  document.body.innerHTML = `<pre style="color:#f88;padding:24px;font:12px Consolas">SPECTER failed to start\n\n${String(err?.stack ?? err)}</pre>`
})
