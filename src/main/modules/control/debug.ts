// Shared DevTools-protocol attachment for tab guests. The CPU limiter and the
// network limiter both need `webContents.debugger`; this keeps one attachment
// per guest, reference-counted by purpose, and never takes over a guest that
// some other client (automation, extensions) already attached to.
import type { WebContents } from 'electron'
import { createLogger } from '../../logger'

export type Purpose = 'cpu' | 'net'

const log = createLogger('control')
const holders = new Map<number, { wc: WebContents; purposes: Set<Purpose> }>()
const detachListeners = new Set<(wcId: number) => void>()

export function holds(wcId: number, p: Purpose): boolean {
  return !!holders.get(wcId)?.purposes.has(p)
}

/** Attaches (if needed) for a purpose. Returns false when another client owns the debugger. */
export function acquire(wc: WebContents, p: Purpose): boolean {
  if (wc.isDestroyed()) return false
  const h = holders.get(wc.id)
  if (h) {
    h.purposes.add(p)
    return true
  }
  if (wc.debugger.isAttached()) return false
  wc.debugger.attach('1.3')
  const entry = { wc, purposes: new Set<Purpose>([p]) }
  holders.set(wc.id, entry)
  const id = wc.id
  const onDetach = () => {
    if (holders.get(id) !== entry) return
    holders.delete(id)
    detachListeners.forEach((l) => l(id))
  }
  wc.debugger.once('detach', onDetach)
  wc.once('destroyed', () => {
    if (holders.get(id) === entry) holders.delete(id)
  })
  return true
}

/** Drops a purpose; detaches once nothing needs the debugger. */
export function releasePurpose(wcId: number, p: Purpose): void {
  const h = holders.get(wcId)
  if (!h) return
  h.purposes.delete(p)
  if (h.purposes.size) return
  holders.delete(wcId)
  try {
    if (!h.wc.isDestroyed() && h.wc.debugger.isAttached()) h.wc.debugger.detach()
  } catch (err) {
    log.warn('debugger detach failed', err)
  }
}

export async function send(wc: WebContents, method: string, params: Record<string, unknown>): Promise<unknown> {
  return wc.debugger.sendCommand(method, params)
}

/** Called when a guest's debugger was detached from outside (e.g. the page crashed). */
export function onExternalDetach(fn: (wcId: number) => void): void {
  detachListeners.add(fn)
}

export function heldIds(p: Purpose): number[] {
  return [...holders].filter(([, h]) => h.purposes.has(p)).map(([id]) => id)
}
