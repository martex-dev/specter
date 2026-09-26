// Font inspector. Evaluates the overlay (src/inject/fontInspector.ts, bundled next to this
// file) in a tab's isolated world and serves its requests. The overlay cannot call IPC, so
// the main process long-polls it: `next()` is a promise inside the page that resolves with
// the overlay's next event — no timers, and nothing a page script can reach.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { InspectorEvent } from '@shared/fontInspector'
import { handle, sendTo } from '../ipc'
import { guestById } from '../guest'
import { createLogger } from '../logger'

const log = createLogger('fonts')
// A world of its own, so the overlay's globals never meet the other page helpers'.
const WORLD = 1718
const sessions = new Map<number, () => void>()
let overlaySource: string | null = null

function overlay(): string {
  overlaySource ??= readFileSync(join(__dirname, 'fontInspector.js'), 'utf8')
  return overlaySource
}

function run<T>(wc: WebContents, code: string): Promise<T> {
  return wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]) as Promise<T>
}

async function enable(wc: WebContents): Promise<void> {
  await run(wc, `if (!window.__specterFonts) { (() => { ${overlay()} })() } window.__specterFonts.start(); true`)
  if (!sessions.has(wc.id)) serve(wc)
}

async function disable(wc: WebContents): Promise<void> {
  await run(wc, 'window.__specterFonts && window.__specterFonts.stop(); true').catch(() => undefined)
  sessions.get(wc.id)?.()
}

/** Answers the overlay's events until it exits or its document goes away. */
function serve(wc: WebContents): void {
  let end!: () => void
  const ended = new Promise<null>((resolve) => (end = () => resolve(null)))
  sessions.set(wc.id, end)
  // A new document drops the overlay (and leaves the pending next() unresolved).
  wc.on('did-navigate', end)
  wc.on('render-process-gone', end)
  wc.once('destroyed', end)
  void (async () => {
    try {
      for (;;) {
        const ev = await Promise.race([run<InspectorEvent | null>(wc, 'window.__specterFonts ? window.__specterFonts.next() : null'), ended])
        if (!ev || ev.type === 'exit') break
      }
    } catch (err) {
      log.info('font inspector ended', err instanceof Error ? err.message : String(err))
    } finally {
      sessions.delete(wc.id)
      if (!wc.isDestroyed()) {
        wc.off('did-navigate', end)
        wc.off('render-process-gone', end)
        wc.off('destroyed', end)
        const h = wc.hostWebContents
        if (h) sendTo(h.id, 'guest:fontInspector', { wcId: wc.id, active: false })
      }
    }
  })()
}

export function registerFontInspectorIpc(): void {
  handle('guest:fontInspector', async (_e, wcId, req) => {
    const wc = guestById(wcId)
    if (!(req?.enable ?? !sessions.has(wcId))) {
      await disable(wc)
      return false
    }
    await enable(wc)
    return true
  })
}
