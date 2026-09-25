// Tiny pub/sub for webview 'found-in-page' results.
type FoundResult = { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean }
const listeners = new Map<string, (r: FoundResult) => void>()

export function onFound(tabId: string, fn: (r: FoundResult) => void): () => void {
  listeners.set(tabId, fn)
  return () => {
    if (listeners.get(tabId) === fn) listeners.delete(tabId)
  }
}

export function emitFound(tabId: string, r: FoundResult): void {
  listeners.get(tabId)?.(r)
}
