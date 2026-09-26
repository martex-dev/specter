// Network limiter: caps the bandwidth of every web page SPECTER shows in the
// active profile (tabs and web panels) with Chromium's DevTools-protocol
// network throttling (Network.emulateNetworkConditions) on each guest.
//
// Electron's session.enableNetworkEmulation() was measured to have no effect
// on page requests in this Electron version, so the cap is applied per guest,
// including guests created while the cap is on. Other applications, the OS and
// SPECTER's own main-process requests are not affected.
import { app, webContents, type WebContents } from 'electron'
import { netEmulationFor, type NetEmulation, type NetState } from '@shared/modules/control'
import { createLogger } from '../../logger'
import { activeSession } from '../../services/profiles'
import { getConfig } from './config'
import { acquire, heldIds, holds, onExternalDetach, releasePurpose, send } from './debug'

const log = createLogger('control')
let state: NetState = { active: false, downBps: 0, upBps: 0, latencyMs: 0 }
let current: NetEmulation | null = null
const applied = new Map<number, string>()
let lastError: string | undefined
const hooked = new WeakSet<WebContents>()

onExternalDetach((id) => applied.delete(id))

export function netState(): NetState {
  return { ...state, guests: heldIds('net').length, ...(lastError && state.active ? { error: lastError } : {}) }
}

function isProfileGuest(wc: WebContents): boolean {
  try {
    return !wc.isDestroyed() && wc.getType() === 'webview' && wc.session === activeSession()
  } catch {
    return false
  }
}

async function emulate(wc: WebContents, em: NetEmulation | null): Promise<void> {
  const params = em
    ? { offline: false, latency: em.latency, downloadThroughput: em.downloadThroughput, uploadThroughput: em.uploadThroughput }
    : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
  try {
    await send(wc, 'Network.emulateNetworkConditions', params)
  } catch {
    // Newer protocol revisions: rule-based variant.
    await send(wc, 'Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: em ? [{ urlPattern: '', latency: em.latency, downloadThroughput: em.downloadThroughput, uploadThroughput: em.uploadThroughput }] : [] })
  }
}

async function applyTo(wc: WebContents): Promise<void> {
  const em = current
  const key = em ? JSON.stringify(em) : ''
  if (!em) {
    if (!holds(wc.id, 'net')) return
    applied.delete(wc.id)
    await emulate(wc, null).catch(() => undefined)
    releasePurpose(wc.id, 'net')
    return
  }
  if (!isProfileGuest(wc)) return
  if (!hooked.has(wc)) {
    hooked.add(wc)
    const id = wc.id
    wc.once('destroyed', () => applied.delete(id))
  }
  if (holds(wc.id, 'net') && applied.get(wc.id) === key) return
  if (!acquire(wc, 'net')) {
    lastError = 'A tab is being debugged by another client and could not be capped'
    return
  }
  try {
    await emulate(wc, em)
    applied.set(wc.id, key)
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    releasePurpose(wc.id, 'net')
  }
}

let running: Promise<void> = Promise.resolve()

export function reconcileNet(): Promise<void> {
  running = running.then(doReconcile).catch((err) => log.warn('network limiter failed', err))
  return running
}

async function doReconcile(): Promise<void> {
  current = netEmulationFor(getConfig().net)
  lastError = undefined
  state = current ? { active: true, downBps: current.downloadThroughput, upBps: current.uploadThroughput, latencyMs: current.latency } : { active: false, downBps: 0, upBps: 0, latencyMs: 0 }
  const ids = new Set([...heldIds('net'), ...webContents.getAllWebContents().map((w) => w.id)])
  for (const id of ids) {
    const wc = webContents.fromId(id)
    if (!wc || wc.isDestroyed()) continue
    await applyTo(wc)
  }
}

/** Cap guests created while the limiter is on, before their first request. */
export function watchNewGuests(): void {
  app.on('web-contents-created', (_e, wc) => {
    if (!current || wc.getType() !== 'webview') return
    void applyTo(wc).catch(() => undefined)
  })
}
