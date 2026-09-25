// Network-level privacy: tracker blocking (built-in list, third-party requests
// only), HTTPS upgrade for top-level navigations, GPC/DNT headers, per-site
// cookie and JavaScript blocking, approximate third-party cookie blocking.
//
// Electron allows only one listener per webRequest event per session, so all
// request hooks live here.
import { session as electronSession, type Session } from 'electron'
import { hostname, origin as originOf } from '@shared/url'
import { all, get } from '../db'
import { broadcast, handle } from '../ipc'
import { getSetting } from './settings'
import { getDecision } from './permissions'
import { activeProfile, activeSession } from './profiles'
import { historyCount } from './history'
import { TRACKER_DOMAINS } from './trackers'
import { makeTrackerMatcher, registrableDomain } from '@shared/domains'
import { createLogger } from '../logger'

const log = createLogger('privacy')
const trackerSet = new Set(TRACKER_DOMAINS)
const isTracker = makeTrackerMatcher(TRACKER_DOMAINS)
export { registrableDomain, isTracker }
const attached = new WeakSet<Session>()
const httpOnlyHosts = new Set<string>()
const blockedLog: { url: string; host: string; ts: number; tabUrl: string }[] = []
let blockedSession = 0
const blockedPerTab = new Map<number, number>()
let lastBroadcast = 0

function topLevelUrl(details: Electron.OnBeforeRequestListenerDetails | Electron.OnBeforeSendHeadersListenerDetails | Electron.OnHeadersReceivedListenerDetails): string {
  if (details.resourceType === 'mainFrame') return details.url
  try {
    return details.webContents?.getURL() || details.referrer || ''
  } catch {
    return details.referrer || ''
  }
}

function isLocalHost(h: string): boolean {
  return h === 'localhost' || h.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.endsWith('.local') || h.endsWith('.lan') || h.startsWith('[')
}

const upgradedHosts = new Map<string, number>()

export function markHttpOnly(host: string): void {
  httpOnlyHosts.add(host)
}

/** True if SPECTER upgraded a navigation to this host to HTTPS in the last 30s. */
export function wasUpgraded(host: string): boolean {
  const ts = upgradedHosts.get(host)
  return ts !== undefined && Date.now() - ts < 30_000
}

export function attachPrivacy(ses: Session): void {
  if (attached.has(ses)) return
  attached.add(ses)

  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = details.url
      if (!/^https?:/.test(url)) return callback({})
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        return callback({})
      }

      if (details.resourceType === 'mainFrame' && details.webContentsId !== undefined) blockedPerTab.set(details.webContentsId, 0)

      // HTTPS upgrade for top-level navigations.
      if (details.resourceType === 'mainFrame' && url.startsWith('http://') && getSetting('privacy.httpsUpgrade') && !isLocalHost(host) && !httpOnlyHosts.has(host)) {
        upgradedHosts.set(host, Date.now())
        return callback({ redirectURL: 'https://' + url.slice(7) })
      }

      if (details.resourceType !== 'mainFrame' && getSetting('privacy.blockTrackers')) {
        const top = topLevelUrl(details)
        const topHost = hostname(top)
        if (isTracker(host) && registrableDomain(host) !== registrableDomain(topHost || host)) {
          blockedSession++
          const wcId = details.webContentsId
          if (wcId !== undefined) blockedPerTab.set(wcId, (blockedPerTab.get(wcId) ?? 0) + 1)
          blockedLog.push({ url: url.slice(0, 300), host, ts: Date.now(), tabUrl: top.slice(0, 300) })
          if (blockedLog.length > 500) blockedLog.shift()
          const now = Date.now()
          if (now - lastBroadcast > 1000) {
            lastBroadcast = now
            broadcast('privacy:blocked', { count: blockedSession, total: blockedSession, perTab: Object.fromEntries(blockedPerTab) })
          }
          return callback({ cancel: true })
        }
      }
    } catch (err) {
      log.error('onBeforeRequest failed', err)
    }
    callback({})
  })

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    try {
      if (getSetting('privacy.sendGPC')) headers['Sec-GPC'] = '1'
      if (getSetting('privacy.sendDNT')) headers['DNT'] = '1'
      if (/^https?:/.test(details.url)) {
        const reqOrigin = originOf(details.url)
        const top = topLevelUrl(details)
        const cookiesBlockedForSite = getDecision(reqOrigin, 'cookies') === 'deny' || (top && getDecision(originOf(top), 'cookies') === 'deny')
        const thirdParty = top && details.resourceType !== 'mainFrame' && registrableDomain(hostname(details.url)) !== registrableDomain(hostname(top))
        if (cookiesBlockedForSite || (thirdParty && getSetting('privacy.blockThirdPartyCookies'))) {
          delete headers['Cookie']
          delete headers['cookie']
        }
      }
    } catch (err) {
      log.error('onBeforeSendHeaders failed', err)
    }
    callback({ requestHeaders: headers })
  })

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {}
    try {
      if (/^https?:/.test(details.url)) {
        const reqOrigin = originOf(details.url)
        const top = topLevelUrl(details)
        const thirdParty = top && details.resourceType !== 'mainFrame' && registrableDomain(hostname(details.url)) !== registrableDomain(hostname(top))
        const cookiesBlocked = getDecision(reqOrigin, 'cookies') === 'deny' || (top && getDecision(originOf(top), 'cookies') === 'deny') || (thirdParty && getSetting('privacy.blockThirdPartyCookies'))
        if (cookiesBlocked) {
          for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') delete headers[k]
        }
        // Per-site JavaScript blocking via CSP on documents.
        if ((details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') && getDecision(reqOrigin, 'javascript') === 'deny') {
          headers['Content-Security-Policy'] = [...(headers['Content-Security-Policy'] ?? []), "script-src 'none'"]
        }
      }
    } catch (err) {
      log.error('onHeadersReceived failed', err)
    }
    callback({ responseHeaders: headers })
  })
}

export function trackersBlockedThisSession(): number {
  return blockedSession
}

export async function clearBrowsingData(o: import('@shared/ipc').ClearDataOptions): Promise<void> {
  const ses = activeSession()
  const since = o.since ?? 0
  if (o.cache) await ses.clearCache()
  const storages: ('cookies' | 'localstorage' | 'indexdb' | 'serviceworkers' | 'cachestorage' | 'shadercache' | 'filesystem')[] = []
  if (o.cookies) storages.push('cookies')
  if (o.storage) storages.push('localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache')
  if (storages.length) await ses.clearStorageData({ storages })
  const { run } = await import('../db')
  if (o.history) {
    run('DELETE FROM history WHERE visited_at >= ? AND profile_id = ?', since, activeProfile().id)
    run('DELETE FROM searches WHERE ts >= ?', since)
    run('DELETE FROM closed_tabs WHERE closed_at >= ?', since)
  }
  if (o.downloads) run("DELETE FROM downloads WHERE started_at >= ? AND state != 'progressing'", since)
  if (o.permissions) run('DELETE FROM permissions')
  log.info('browsing data cleared', o)
}

export function registerPrivacyIpc(): void {
  handle('privacy:summary', async () => {
    const ses = activeSession()
    let cookieCount = 0
    try {
      cookieCount = (await ses.cookies.get({})).length
    } catch {
      /* ignore */
    }
    const cacheBytes = await ses.getCacheSize().catch(() => 0)
    return {
      trackersBlocked: blockedSession,
      trackersBlockedSession: blockedSession,
      cookieCount,
      sitePermissions: get<{ c: number }>('SELECT COUNT(*) AS c FROM permissions')?.c ?? 0,
      historyEntries: historyCount(),
      downloads: get<{ c: number }>('SELECT COUNT(*) AS c FROM downloads')?.c ?? 0,
      cacheBytes,
      blocklistSize: trackerSet.size
    }
  })
  handle('privacy:clear', (_e, o) => clearBrowsingData(o))
  handle('privacy:clearOrigin', async (_e, origin) => {
    if (!/^https?:\/\//.test(origin)) return
    await activeSession().clearStorageData({ origin, storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem'] })
    log.info('cleared site data', { origin })
  })
  handle('privacy:cookies', async (_e, origin) => {
    const ses = activeSession()
    const filter: Electron.CookiesGetFilter = {}
    if (origin) filter.url = origin
    const cookies = await ses.cookies.get(filter)
    return cookies.slice(0, 2000).map((c) => ({ domain: c.domain ?? '', name: c.name, secure: !!c.secure, httpOnly: !!c.httpOnly, expires: c.expirationDate }))
  })
  handle('privacy:blockedLog', () => [...blockedLog].reverse())
}

/** Clears data on exit when the user enabled it. */
export async function clearOnExitIfEnabled(): Promise<void> {
  if (!getSetting('privacy.clearOnExit')) return
  await clearBrowsingData({ cookies: true, cache: true, storage: true, history: true })
}

export function allSessions(): Session[] {
  return all<{ partition: string }>('SELECT partition FROM profiles').map((p) => electronSession.fromPartition(p.partition))
}
