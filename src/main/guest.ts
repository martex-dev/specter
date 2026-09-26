// Tab guest (webview) hardening and event plumbing.
import { app, BrowserWindow, shell, webContents, type WebContents } from 'electron'
import { bindingIndex, eventToAccelerator, isChord, resolveBindings } from '@shared/keys'
import { sendTo } from './ipc'
import { createLogger } from './logger'
import { getSetting, onSettingChanged } from './services/settings'
import { activeProfile } from './services/profiles'
import { getDecision } from './services/permissions'
import { markHttpOnly, wasUpgraded } from './services/privacy'
import { ctxForSender } from './windows'

const log = createLogger('guest')
let keyIndex = bindingIndex(resolveBindings(getSettingSafe()))
const lastInput = new Map<number, number>()
const guestTabs = new Map<number, string>()

function getSettingSafe(): Record<string, string> {
  try {
    return getSetting('keyboard.bindings')
  } catch {
    return {}
  }
}

export function refreshKeyBindings(): void {
  keyIndex = bindingIndex(resolveBindings(getSettingSafe()))
}

export function registerGuestTab(wcId: number, tabId: string): void {
  guestTabs.set(wcId, tabId)
}

export function tabIdForGuest(wcId: number): string | undefined {
  return guestTabs.get(wcId)
}

/** Shortcuts that act on the page itself and must leave keyboard focus in it. */
const KEEP_PAGE_FOCUS = new Set([
  'browser.reload', 'browser.hardReload', 'browser.reloadF5', 'browser.back', 'browser.forward', 'browser.stop',
  'browser.zoomIn', 'browser.zoomOut', 'browser.zoomReset', 'browser.fullscreen', 'browser.print',
  'browser.devtoolsDock', 'browser.devtoolsAlt', 'browser.devtools', 'browser.viewSource'
])

const SAFE_WEBVIEW_SRC = /^(https?:|about:blank|file:|data:text\/html|view-source:)/i

export function installGuestHardening(): void {
  onSettingChanged((key) => {
    if (key === 'keyboard.bindings') refreshKeyBindings()
  })

  app.on('web-contents-created', (_e, contents) => {
    // Enforce safe webPreferences on every <webview> the chrome tries to attach.
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const host = ctxForSender(contents.id)
      if (!host) {
        log.warn('blocked webview attach from non-chrome contents')
        event.preventDefault()
        return
      }
      delete (webPreferences as any).preload
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
      webPreferences.experimentalFeatures = false
      webPreferences.spellcheck = getSetting('browser.spellcheck')
      webPreferences.enableBlinkFeatures = undefined
      webPreferences.disableBlinkFeatures = undefined
      ;(webPreferences as any).javascript = true
      // Chromium's built-in PDF viewer is the only "plugin" left in modern Chromium.
      webPreferences.plugins = true
      // DevTools-dock webviews use a dedicated partition; tabs use the active profile.
      if (params.partition !== 'specter-devtools') params.partition = activeProfile().partition
      if (params.src && !SAFE_WEBVIEW_SRC.test(params.src)) {
        log.warn('blocked webview src', params.src)
        params.src = 'about:blank'
      }
    })

    if (contents.getType() === 'webview') setupGuest(contents)
  })
}

function setupGuest(wc: WebContents): void {
  const host = () => wc.hostWebContents

  wc.on('input-event', (_e, input) => {
    if (input.type === 'mouseDown' || input.type === 'keyDown' || input.type === 'gestureTap' || input.type === 'touchStart') lastInput.set(wc.id, Date.now())
  })

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const acc = eventToAccelerator({ key: input.key, code: input.code, control: input.control, shift: input.shift, alt: input.alt, meta: input.meta })
    if (!acc) return
    const cmd = keyIndex.get(acc)
    if (cmd && isChord(acc)) {
      const h = host()
      if (!h) return
      event.preventDefault()
      // Commands that move keyboard focus into SPECTER's UI must run after Chromium has
      // finished dispatching this key event inside the page; otherwise the page keeps
      // native keyboard focus. Page-level commands run immediately.
      const send = () => sendTo(h.id, 'command:run', { id: cmd, args: { fromGuest: wc.id } })
      if (KEEP_PAGE_FOCUS.has(cmd)) send()
      else setTimeout(send, 30)
    }
  })

  wc.setWindowOpenHandler((details) => {
    const h = host()
    const { url, disposition, features } = details
    if (!h) return { action: 'deny' }
    const openerOrigin = (() => {
      try {
        return new URL(wc.getURL()).origin
      } catch {
        return ''
      }
    })()
    const recentGesture = Date.now() - (lastInput.get(wc.id) ?? 0) < 2000
    const popupsDecision = getDecision(openerOrigin, 'popups')

    if (!recentGesture && popupsDecision !== 'allow') {
      log.info('popup blocked', { url, opener: openerOrigin })
      sendTo(h.id, 'command:run', { id: 'internal.popupBlocked', args: { wcId: wc.id, url, origin: openerOrigin } })
      return { action: 'deny' }
    }
    if (popupsDecision === 'deny') return { action: 'deny' }

    if (/^(mailto|tel|sms|magnet|steam|zoommtg|slack|discord|spotify|vscode):/i.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }

    // Real popups (window.open with size features, e.g. OAuth flows) keep window.opener semantics.
    if (disposition === 'new-window' && (features.includes('width') || features.includes('height') || url === 'about:blank' || url === '')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: activeProfile().partition }
        }
      }
    }
    if (/^(https?|about|file|data|blob):/i.test(url) || url === '') {
      sendTo(h.id, 'guest:openUrl', { url, disposition: disposition === 'background-tab' ? 'background-tab' : disposition === 'new-window' && features ? 'new-window' : 'foreground-tab', sourceWcId: wc.id })
    }
    return { action: 'deny' }
  })

  wc.on('did-create-window', (child) => {
    child.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'w') child.close()
    })
  })

  wc.on('context-menu', (_e, params) => {
    const h = host()
    if (!h) return
    sendTo(h.id, 'guest:contextMenu', {
      webContentsId: wc.id,
      x: params.x,
      y: params.y,
      linkURL: params.linkURL,
      linkText: params.linkText,
      srcURL: params.srcURL,
      mediaType: params.mediaType,
      selectionText: params.selectionText,
      isEditable: params.isEditable,
      pageURL: params.pageURL,
      frameURL: params.frameURL,
      titleText: params.titleText,
      hasImageContents: params.hasImageContents,
      editFlags: {
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
        canSelectAll: params.editFlags.canSelectAll,
        canUndo: params.editFlags.canUndo,
        canRedo: params.editFlags.canRedo
      },
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions ?? []
    })
  })

  wc.on('render-process-gone', (_e, details) => {
    log.warn('tab renderer gone', { reason: details.reason, url: safeUrl(wc) })
    const h = host()
    if (h && details.reason !== 'clean-exit') sendTo(h.id, 'guest:crashed', { wcId: wc.id, reason: details.reason })
  })
  wc.on('unresponsive', () => {
    const h = host()
    if (h) sendTo(h.id, 'guest:unresponsive', { wcId: wc.id, responsive: false })
  })
  wc.on('responsive', () => {
    const h = host()
    if (h) sendTo(h.id, 'guest:unresponsive', { wcId: wc.id, responsive: true })
  })

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return // -3 = aborted (normal)
    // Exact host (privacy.ts keys upgrades by URL.hostname; the shared hostname() drops "www.").
    let h = ''
    try {
      h = new URL(validatedURL).hostname
    } catch {
      /* invalid URL */
    }
    // HTTPS-upgrade fallback: the site does not speak HTTPS, retry over HTTP once.
    if (validatedURL.startsWith('https://') && wasUpgraded(h) && (errorCode <= -100 && errorCode > -400)) {
      log.info('https upgrade failed, falling back to http', { host: h, errorCode })
      markHttpOnly(h)
      wc.loadURL('http://' + validatedURL.slice(8))
      return
    }
    log.info('load failed', { errorCode, errorDescription, url: validatedURL })
  })

  wc.on('certificate-error', () => {
    // Default Chromium behaviour (reject) is kept; the renderer shows the error page.
  })

  wc.on('zoom-changed', (_e, direction) => {
    const cur = wc.getZoomFactor()
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
    const next =
      direction === 'in'
        ? (steps.find((s) => s > cur + 0.001) ?? steps[steps.length - 1])
        : ([...steps].reverse().find((s) => s < cur - 0.001) ?? steps[0])
    wc.setZoomFactor(next)
    const h = host()
    if (h) sendTo(h.id, 'command:run', { id: 'internal.zoomChanged', args: { wcId: wc.id, factor: next } })
  })

  wc.on('destroyed', () => {
    lastInput.delete(wc.id)
    guestTabs.delete(wc.id)
  })
}

function safeUrl(wc: WebContents): string {
  try {
    return wc.getURL()
  } catch {
    return ''
  }
}

export function guestById(id: number): WebContents {
  const wc = webContents.fromId(id)
  if (!wc || wc.isDestroyed()) throw new Error('Tab is not available')
  if (wc.getType() !== 'webview') throw new Error('Not a tab')
  return wc
}

export function hostWindowOf(wc: WebContents): BrowserWindow | null {
  const h = wc.hostWebContents
  return h ? BrowserWindow.fromWebContents(h) : null
}
