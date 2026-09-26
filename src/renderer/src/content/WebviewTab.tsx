import { useEffect, useRef } from 'react'
import type { WebviewTag } from 'electron'
import { invoke } from '../lib/ipc'
import { markReady, registerWebview, unregisterWebview } from '../lib/webviews'
import { closeTab, findTab, updateTab, useBrowser, activateTab } from '../stores/browser'
import { useUi } from '../stores/ui'
import { emitFound } from './findEvents'
import { hostname } from '@shared/url'
import { begin, end } from '../lib/perf'

interface Props {
  tabId: string
  initialUrl: string
  partition: string
  visible: boolean
}

/**
 * Hosts a single <webview>. The element is created imperatively and never
 * re-parented (moving a webview in the DOM reloads it).
 */
export function WebviewTab({ tabId, initialUrl, partition, visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const wvRef = useRef<WebviewTag | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    const host = hostRef.current!
    const wv = document.createElement('webview') as WebviewTag
    wv.setAttribute('partition', partition)
    wv.setAttribute('allowpopups', '')
    wv.setAttribute('plugins', '') // built-in PDF viewer
    wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes')
    wv.setAttribute('src', initialUrl)
    wv.style.position = 'absolute'
    wv.style.inset = '0'
    wv.style.width = '100%'
    wv.style.height = '100%'
    wvRef.current = wv
    registerWebview(tabId, wv)

    let attached = false
    begin('tab:' + tabId)
    const nav = () => {
      try {
        updateTab(tabId, { canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() })
      } catch {
        /* not ready */
      }
    }
    const wsIdOf = () => findTab(tabId)?.ws.id

    const on = (ev: string, fn: (e: any) => void) => wv.addEventListener(ev, fn)
    on('dom-ready', () => {
      if (!attached) {
        attached = true
        end('tab:' + tabId, 'tabCreate')
        markReady(tabId)
        const wcId = wv.getWebContentsId()
        invoke('guest:register', wcId, tabId).catch(() => undefined)
        const t = findTab(tabId)?.tab
        if (t?.muted) wv.setAudioMuted(true)
        if (t?.zoom && t.zoom !== 1) wv.setZoomFactor(t.zoom)
        window.dispatchEvent(new CustomEvent('specter:webview-ready', { detail: { tabId } }))
      }
      nav()
    })
    let navStart = 0
    let committedUrl = ''
    on('did-start-navigation', (e) => {
      if (e.isMainFrame && !e.isInPlace) navStart = performance.now()
    })
    on('did-finish-load', () => {
      if (navStart) updateTab(tabId, { loadMs: Math.round(performance.now() - navStart) })
      navStart = 0
    })
    on('did-start-loading', () => updateTab(tabId, { loading: true, error: undefined }))
    on('did-stop-loading', () => {
      updateTab(tabId, { loading: false })
      nav()
      const t = findTab(tabId)?.tab
      if (t?.pendingScrollY) {
        const y = t.pendingScrollY
        updateTab(tabId, { pendingScrollY: undefined })
        invoke('guest:setScrollY', wv.getWebContentsId(), y).catch(() => undefined)
      }
    })
    on('did-navigate', (e) => {
      // Untitled documents never fire page-title-updated and sites without an icon link never
      // fire page-favicon-updated, so drop the previous page's title and (cross-site) favicon.
      let title: string | undefined
      try {
        title = wv.getTitle() || undefined
      } catch {
        /* not ready */
      }
      const siteChanged = !!committedUrl && hostname(committedUrl) !== hostname(e.url)
      committedUrl = e.url
      updateTab(tabId, {
        url: e.url,
        error: undefined,
        crashed: undefined,
        reader: false,
        blockedPopups: undefined,
        permissionRequests: undefined,
        ...(title ? { title } : {}),
        ...(siteChanged ? { favicon: undefined } : {})
      })
      nav()
      invoke('history:add', { url: e.url, title: wv.getTitle(), workspaceId: wsIdOf() }).catch(() => undefined)
      window.dispatchEvent(new CustomEvent('specter:page-navigated', { detail: { tabId, url: e.url } }))
    })
    on('did-navigate-in-page', (e) => {
      if (!e.isMainFrame) return
      updateTab(tabId, { url: e.url })
      nav()
      invoke('history:add', { url: e.url, title: wv.getTitle(), workspaceId: wsIdOf() }).catch(() => undefined)
    })
    on('page-title-updated', (e) => {
      updateTab(tabId, { title: e.title })
      try {
        invoke('history:updateTitle', wv.getURL(), e.title).catch(() => undefined)
      } catch {
        /* ignore */
      }
    })
    on('page-favicon-updated', (e) => {
      const fav = (e.favicons as string[]).find((f) => /\.(svg|png|ico)(\?|$)/i.test(f)) ?? e.favicons[0]
      if (fav) updateTab(tabId, { favicon: fav })
    })
    on('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3) return
      // HTTPS-upgrade fallback is handled in the main process; skip transient error flashes.
      setTimeout(() => {
        const t = findTab(tabId)?.tab
        if (t && !t.loading) updateTab(tabId, { error: { code: e.errorCode, description: e.errorDescription, url: e.validatedURL } })
      }, 300)
      updateTab(tabId, { loading: false })
    })
    on('did-change-theme-color', (e) => updateTab(tabId, { themeColor: e.themeColor ?? undefined }))
    on('update-target-url', (e) => {
      if (visibleRef.current) useUi.setState({ hoverUrl: e.url })
    })
    on('found-in-page', (e) => emitFound(tabId, e.result))
    on('media-started-playing', () => {
      updateTab(tabId, { hasMedia: true, audible: safeAudible(wv) })
      setTimeout(() => updateTab(tabId, { audible: safeAudible(wv) }), 800)
    })
    on('media-paused', () => setTimeout(() => updateTab(tabId, { audible: safeAudible(wv) }), 300))
    on('close', () => closeTab(tabId))
    on('focus', () => {
      const s = useBrowser.getState()
      const ws = s.open[s.activeWsId]
      if (ws && ws.activeTabId !== tabId && ws.tabs.some((t) => t.id === tabId)) activateTab(tabId)
    })
    on('enter-html-full-screen', () => document.documentElement.classList.add('html-fullscreen'))
    on('leave-html-full-screen', () => document.documentElement.classList.remove('html-fullscreen'))

    host.appendChild(wv)

    // Audio indicator: poll only while the tab has had media.
    const audioTimer = window.setInterval(() => {
      const t = findTab(tabId)?.tab
      if (!attached || !t?.hasMedia) return
      const a = safeAudible(wv)
      if (a !== !!t.audible) updateTab(tabId, { audible: a })
    }, 1500)

    return () => {
      clearInterval(audioTimer)
      unregisterWebview(tabId)
      wvRef.current = null
      wv.remove()
    }
    // The webview is created once per mount; later URL changes go through loadURL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, partition])

  return <div ref={hostRef} className="webview-host" style={{ position: 'absolute', inset: 0 }} />
}

function safeAudible(wv: WebviewTag): boolean {
  try {
    return wv.isCurrentlyAudible()
  } catch {
    return false
  }
}
