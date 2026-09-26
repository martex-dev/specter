// Registry of live <webview> elements keyed by tab id.
import type { WebviewTag } from 'electron'

const views = new Map<string, WebviewTag>()
const ready = new Set<string>()

export function registerWebview(tabId: string, wv: WebviewTag): void {
  views.set(tabId, wv)
}

export function unregisterWebview(tabId: string): void {
  views.delete(tabId)
  ready.delete(tabId)
}

export function markReady(tabId: string): void {
  ready.add(tabId)
}

/** Returns the webview only once it's attached (methods usable). */
export function webviewFor(tabId: string | undefined): WebviewTag | null {
  if (!tabId || !ready.has(tabId)) return null
  return views.get(tabId) ?? null
}

/** The mounted webview element even before its first dom-ready (only its src may be set). */
export function webviewElementFor(tabId: string): WebviewTag | null {
  return views.get(tabId) ?? null
}

export function wcIdFor(tabId: string | undefined): number | null {
  const wv = webviewFor(tabId)
  if (!wv) return null
  try {
    return wv.getWebContentsId()
  } catch {
    return null
  }
}

export function tabIdForWcId(wcId: number): string | null {
  for (const [tabId, wv] of views) {
    try {
      if (ready.has(tabId) && wv.getWebContentsId() === wcId) return tabId
    } catch {
      /* not attached */
    }
  }
  return null
}

export function allLiveTabIds(): string[] {
  return [...ready]
}
