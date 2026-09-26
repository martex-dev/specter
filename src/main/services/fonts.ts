// Font inspector. Evaluates the overlay (src/inject/fontInspector.ts, bundled next to this
// file) in a tab's isolated world and serves its requests. The overlay cannot call IPC, so
// the main process long-polls it: `next()` is a promise inside the page that resolves with
// the overlay's next event — no timers, and nothing a page script can reach.
//
// For a pinned element it asks Chromium, over the DevTools protocol, which platform fonts
// actually drew the text (the overlay alone can only estimate from the font stack).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clipboard, type WebContents } from 'electron'
import type { FontInspectorRequest, InspectorEvent, NodeTarget, PlatformFont, PlatformResult, StartOptions } from '@shared/fontInspector'
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

async function enable(wc: WebContents, req: FontInspectorRequest): Promise<void> {
  // The UI measures in the zoomed view; the overlay works in CSS pixels.
  const zoom = wc.getZoomFactor() || 1
  const opts: StartOptions = { panel: !!req.panel }
  if (req.at) opts.at = { x: Number(req.at.x) / zoom, y: Number(req.at.y) / zoom }
  await run(wc, `if (!window.__specterFonts) { (() => { ${overlay()} })() } window.__specterFonts.start(${JSON.stringify(opts)}); true`)
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
        // The page's clipboard would need a permission and a user gesture in the right world.
        if (ev.type === 'copy') await clipboard.writeText(String(ev.text))
        if (ev.type === 'pin') {
          const [fonts] = (await platformFonts(wc, [ev.target])) ?? [undefined]
          const result: PlatformResult = fonts === undefined ? { error: 'unavailable' } : fonts ? { fonts } : { error: 'not-found' }
          await run(wc, `window.__specterFonts && window.__specterFonts.platform(${Number(ev.card)}, ${JSON.stringify(result)})`)
        }
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

type Send = (method: string, params?: object) => Promise<any>

/**
 * The platform fonts Chromium used for each target's own text (null where the node wasn't
 * found), or null if the debugger is unavailable. Attaches only for the duration of the call
 * and always detaches, so DevTools keeps working.
 */
async function platformFonts(wc: WebContents, targets: NodeTarget[]): Promise<(PlatformFont[] | null)[] | null> {
  const dbg = wc.debugger
  if (dbg.isAttached()) return null // someone else (a full-page capture) is using it
  try {
    dbg.attach('1.3')
  } catch (err) {
    log.info('debugger unavailable for font inspection', err instanceof Error ? err.message : String(err))
    return null
  }
  const send: Send = (method, params) => dbg.sendCommand(method, params)
  try {
    await send('DOM.enable')
    await send('CSS.enable')
    const { root } = await send('DOM.getDocument', { depth: 0 })
    const out: (PlatformFont[] | null)[] = []
    for (const t of targets) out.push(await fontsFor(send, root.nodeId, t).catch(() => null))
    return out
  } catch (err) {
    log.info('font inspection over the DevTools protocol failed', err instanceof Error ? err.message : String(err))
    return null
  } finally {
    try {
      dbg.detach()
    } catch {
      /* already detached */
    }
  }
}

async function fontsFor(send: Send, rootId: number, t: NodeTarget): Promise<PlatformFont[] | null> {
  let nodeId = 0
  if (t.selector) nodeId = (await send('DOM.querySelector', { nodeId: rootId, selector: t.selector })).nodeId
  else {
    const hit = await send('DOM.getNodeForLocation', { x: Math.round(t.x), y: Math.round(t.y), includeUserAgentShadowDOM: false })
    nodeId = hit.nodeId || (await send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [hit.backendNodeId] })).nodeIds[0]
    // Hit-testing can land on something else (the page moved); never report another element's fonts.
    if (nodeId && (await send('DOM.describeNode', { nodeId })).node.localName !== t.localName) return null
  }
  if (!nodeId) return null
  const { fonts } = await send('CSS.getPlatformFontsForNode', { nodeId })
  return (fonts as { familyName: string; postScriptName: string; isCustomFont: boolean; glyphCount: number }[]).map((f) => ({
    family: f.familyName,
    postScriptName: f.postScriptName,
    custom: f.isCustomFont,
    glyphs: f.glyphCount
  }))
}

export function registerFontInspectorIpc(): void {
  handle('guest:fontInspector', async (_e, wcId, req) => {
    const wc = guestById(wcId)
    if (!(req?.enable ?? (req?.at || req?.panel ? true : !sessions.has(wcId)))) {
      await disable(wc)
      return false
    }
    await enable(wc, req ?? {})
    return true
  })
}
