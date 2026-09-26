// Per-site permission management. Stored decisions are consulted first;
// otherwise the tab shows an inline prompt and the user decides.
import type { Session, WebContents } from 'electron'
import type { PermissionDecision, SitePermission } from '@shared/types'
import { origin as originOf } from '@shared/url'
import { all, get, run, uid } from '../db'
import { handle, sendTo } from '../ipc'
import { createLogger } from '../logger'

const log = createLogger('permissions')

/** Always granted — low risk and required for normal browsing. */
const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'speaker-selection', 'keyboardLock', 'storage-access', 'top-level-storage-access'])
/** Never granted in v1 (device-level access with high abuse potential). */
const AUTO_DENY = new Set(['midiSysex', 'hid', 'serial', 'usb', 'unknown'])

const pending = new Map<string, { resolve: (ok: boolean) => void; origin: string; permissions: string[]; timer: NodeJS.Timeout; wcId: number }>()
const attached = new WeakSet<Session>()

export function getDecision(origin: string, permission: string): PermissionDecision {
  return (get<{ decision: PermissionDecision }>('SELECT decision FROM permissions WHERE origin = ? AND permission = ?', origin, permission)?.decision ?? 'ask') as PermissionDecision
}

export function setDecision(origin: string, permission: string, decision: PermissionDecision): void {
  if (decision === 'ask') run('DELETE FROM permissions WHERE origin = ? AND permission = ?', origin, permission)
  else
    run(
      'INSERT INTO permissions(origin, permission, decision, updated_at) VALUES(?,?,?,?) ON CONFLICT(origin, permission) DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at',
      origin,
      permission,
      decision,
      Date.now()
    )
}

export function listPermissions(): SitePermission[] {
  return all<{ origin: string; permission: string; decision: PermissionDecision; updated_at: number }>('SELECT * FROM permissions ORDER BY origin, permission').map((r) => ({
    origin: r.origin,
    permission: r.permission,
    decision: r.decision,
    updatedAt: r.updated_at
  }))
}

function expand(permission: string, details: any): string[] {
  if (permission === 'media') {
    const types: string[] = details?.mediaTypes ?? []
    const out: string[] = []
    if (types.includes('video')) out.push('camera')
    if (types.includes('audio')) out.push('microphone')
    return out.length ? out : ['camera', 'microphone']
  }
  return [permission]
}

function hostOf(wc: WebContents): WebContents | null {
  return wc.hostWebContents ?? null
}

function ask(wc: WebContents, origin: string, perms: string[], details?: string): Promise<boolean> {
  const host = hostOf(wc)
  if (!host) return Promise.resolve(false)
  return new Promise((resolve) => {
    const requestId = uid('perm_')
    // Only a real page change cancels the prompt: iframes loading and SPA
    // pushState/hash navigations must not auto-deny it.
    const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (details.isMainFrame && !details.isSameDocument) finish(requestId, false)
    }
    const onDestroyed = () => finish(requestId, false)
    const done = (ok: boolean) => {
      if (!wc.isDestroyed()) {
        wc.off('did-start-navigation', onNavigate)
        wc.off('destroyed', onDestroyed)
      }
      resolve(ok)
    }
    const timer = setTimeout(() => finish(requestId, false), 120_000)
    pending.set(requestId, { resolve: done, origin, permissions: perms, timer, wcId: wc.id })
    sendTo(host.id, 'permissions:request', { requestId, webContentsId: wc.id, origin, permission: perms.join('+'), details })
    wc.on('did-start-navigation', onNavigate)
    wc.once('destroyed', onDestroyed)
  })
}

function finish(requestId: string, ok: boolean): void {
  const p = pending.get(requestId)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(requestId)
  p.resolve(ok)
}

export function attachPermissions(ses: Session): void {
  if (attached.has(ses)) return
  attached.add(ses)

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = originOf((details as any)?.requestingUrl || wc.getURL())
    if (AUTO_ALLOW.has(permission)) return callback(true)
    if (AUTO_DENY.has(permission)) return callback(false)
    if (permission === 'openExternal') {
      const ext = (details as any)?.externalURL as string | undefined
      const decision = getDecision(origin, 'openExternal')
      if (decision === 'allow') return callback(true)
      // A remembered "block" must stick too (it used to prompt again on every attempt).
      if (decision === 'deny') return callback(false)
      ask(wc, origin, ['openExternal'], ext).then(callback)
      return
    }
    const perms = expand(permission, details)
    const decisions = perms.map((p) => getDecision(origin, p))
    if (decisions.every((d) => d === 'allow')) return callback(true)
    if (decisions.some((d) => d === 'deny')) return callback(false)
    ask(wc, origin, perms).then((ok) => callback(ok))
  })

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true
    if (AUTO_DENY.has(permission)) return false
    const origin = originOf(requestingOrigin)
    if (permission === 'media') return getDecision(origin, 'camera') === 'allow' || getDecision(origin, 'microphone') === 'allow'
    return getDecision(origin, permission) === 'allow'
  })

  // Device pickers (WebHID / WebSerial / WebUSB / Bluetooth) are denied in v1.
  ses.setDevicePermissionHandler(() => false)
}

export function registerPermissionsIpc(): void {
  handle('permissions:list', () => listPermissions())
  handle('permissions:set', (_e, origin, permission, decision) => setDecision(origin, permission, decision))
  handle('permissions:remove', (_e, origin, permission) => {
    if (permission) run('DELETE FROM permissions WHERE origin = ? AND permission = ?', origin, permission)
    else run('DELETE FROM permissions WHERE origin = ?', origin)
  })
  handle('permissions:respond', (_e, requestId, decision, remember) => {
    const p = pending.get(requestId)
    if (!p) return
    if (remember) for (const perm of p.permissions) setDecision(p.origin, perm, decision)
    log.info(`permission ${p.permissions.join('+')} for ${p.origin}: ${decision}${remember ? ' (remembered)' : ''}`)
    finish(requestId, decision === 'allow')
  })
}
