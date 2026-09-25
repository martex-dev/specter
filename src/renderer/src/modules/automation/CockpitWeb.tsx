// A live web page inside a cockpit panel. Mirrors the essential attributes of
// content/WebviewTab.tsx; the core's will-attach-webview hardening applies.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { useBrowser } from '../../stores/browser'

export interface CockpitWebHandle {
  reload(): void
  back(): void
  currentUrl(): string
}

export const CockpitWeb = forwardRef<CockpitWebHandle, { url: string; onTitle?: (t: string) => void }>(function CockpitWeb({ url, onTitle }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const wvRef = useRef<WebviewTag | null>(null)
  const ready = useRef(false)
  const partition = useBrowser((s) => s.profile?.partition)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useImperativeHandle(ref, () => ({
    reload: () => ready.current && wvRef.current?.reload(),
    back: () => ready.current && wvRef.current?.canGoBack() && wvRef.current.goBack(),
    currentUrl: () => (ready.current ? wvRef.current?.getURL() ?? url : url)
  }))

  useEffect(() => {
    if (!partition || !host.current) return
    const wv = document.createElement('webview') as WebviewTag
    wv.setAttribute('partition', partition)
    wv.setAttribute('allowpopups', '')
    wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes')
    wv.setAttribute('src', url)
    wv.style.position = 'absolute'
    wv.style.inset = '0'
    wvRef.current = wv
    ready.current = false
    const onReady = () => (ready.current = true)
    const onStart = () => (setLoading(true), setError(''))
    const onStop = () => setLoading(false)
    const onFail = (e: Event) => {
      const ev = e as unknown as { isMainFrame: boolean; errorCode: number; errorDescription: string }
      if (ev.isMainFrame && ev.errorCode !== -3) setError(ev.errorDescription || 'Failed to load')
    }
    const onTitleEv = (e: Event) => onTitle?.((e as unknown as { title: string }).title)
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('page-title-updated', onTitleEv)
    host.current.appendChild(wv)
    return () => {
      ready.current = false
      wvRef.current = null
      wv.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, partition])

  return (
    <div className="cp-web" ref={host}>
      {loading && <div className="cp-web-loading" />}
      {error && (
        <div className="cp-web-error">
          Couldn't load {url} — {error}
        </div>
      )}
    </div>
  )
})
