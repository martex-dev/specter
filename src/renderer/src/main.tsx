import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/chrome.css'
import './styles/overlays.css'
import './styles/pages.css'
import './styles/dock.css'
import './styles/layouts.css'
import './styles/themes.css'
import './styles/themes-2.css'
import './styles/fx.css'
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
import { installFx } from './lib/fx'
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

function splash(): void {
  // Brief logo reveal on the first window of a launch (skipped with reduced motion).
  if (document.documentElement.dataset.motion !== 'full') return
  const el = document.createElement('div')
  el.className = 'fx-splash'
  el.innerHTML = `<div class="fx-splash-mark"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M17 6.5c-1.2-1.3-3-2-5-2-3 0-5 1.6-5 3.8 0 5 10 2.6 10 7.6 0 2.3-2.2 4.1-5.2 4.1-2.2 0-4.2-.9-5.5-2.4"/></svg></div><div class="fx-splash-word">SPECTER</div>`
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1300)
}

async function boot() {
  await useSettingsStore.getState().load()
  const s = useSettingsStore.getState().s
  applyTheme(s['appearance.theme'], s['appearance.palette'], s['appearance.accent'], s['appearance.fontFamily'], s['appearance.layout'])
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
  if (init.windowId === 1) splash()
  installFx()
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
