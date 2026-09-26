// Ad blocker: Ghostery's filter engine fed with uBlock Origin / EasyList lists.
//
// - Network filtering runs inside privacy.ts's webRequest hooks (Electron allows
//   one listener per event), through adblockBeforeRequest / adblockCSP.
// - Lists are downloaded to <userData>/adblock, refreshed daily, and compiled in
//   a worker thread; the compiled engine is cached so startup costs ~10 ms.
import { app, session as electronSession, type Session } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FiltersEngine, Request } from '@ghostery/adblocker'
import { FILTER_LISTS, LIST_MAX_AGE_MS, RESOURCES_URL, countRules, isAllowlisted, listMirrors, type AdblockStatus } from '@shared/adblock'
import { hostname } from '@shared/url'
import { broadcast, handle } from '../ipc'
import { createLogger } from '../logger'
import { getSetting, onSettingChanged } from './settings'
import createCompileWorker from './adblockWorker?nodeWorker'

const log = createLogger('adblock')

type RequestType = Parameters<typeof Request.fromRawDetails>[0]['type']
type Refresh = 'missing' | 'stale' | 'all'
interface Meta {
  files: Record<string, { updatedAt: number; rules: number }>
}

let engine: FiltersEngine | null = null
let engineKey = ''
let updating = false
let lastError: string | null = null
let blockedByFilters = 0
let building: Promise<void> | null = null
let queued: Refresh | null = null
let initialised = false

const dir = () => join(app.getPath('userData'), 'adblock')
const listFile = (url: string) => join(dir(), 'lists', createHash('sha1').update(url).digest('hex').slice(0, 16) + '.txt')
const metaFile = () => join(dir(), 'meta.json')
const engineFile = () => join(dir(), 'engine.bin')
const engineKeyFile = () => join(dir(), 'engine.key')

function readMeta(): Meta {
  try {
    const m = JSON.parse(readFileSync(metaFile(), 'utf8')) as Meta
    if (m && typeof m.files === 'object') return m
  } catch {
    /* first run or corrupt: start over */
  }
  return { files: {} }
}

function writeAtomic(path: string, data: string | Uint8Array): void {
  const tmp = path + '.tmp'
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

function enabledUrls(): string[] {
  const ids = new Set(getSetting('privacy.adblockLists'))
  return FILTER_LISTS.filter((l) => ids.has(l.id)).flatMap((l) => l.urls)
}

function customFilters(): string {
  return getSetting('privacy.adblockCustomFilters') ?? ''
}

function computeKey(meta: Meta, urls: string[]): string {
  const stamps = [...urls, RESOURCES_URL].map((u) => `${u}@${meta.files[u]?.updatedAt ?? 0}`)
  return createHash('sha1').update(JSON.stringify({ stamps, custom: customFilters() })).digest('hex')
}

let fetchSession: Session | null = null
async function download(url: string): Promise<string> {
  // A private in-memory session: list downloads carry no cookies and leave no cache.
  fetchSession ??= electronSession.fromPartition('specter-adblock-lists', { cache: false })
  let lastErr: unknown
  for (const u of listMirrors(url)) {
    try {
      const res = await fetchSession.fetch(u, { signal: AbortSignal.timeout(60_000), cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      // An HTML error page or an empty body is never a filter list.
      if (text.length < 64 || /^\s*<(!doctype|html)/i.test(text)) throw new Error('not a filter list')
      return text
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function compileInWorker(filters: string, resources: string | null): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = createCompileWorker({ workerData: { filters, resources } })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('Compiling filter lists timed out'))
    }, 120_000)
    worker.once('message', (m: { ok: true; bytes: Uint8Array } | { ok: false; error: string }) => {
      clearTimeout(timer)
      void worker.terminate()
      if (m.ok) resolve(new Uint8Array(m.bytes))
      else reject(new Error(m.error))
    })
    worker.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function loadCachedEngine(): boolean {
  try {
    if (!existsSync(engineFile()) || !existsSync(engineKeyFile())) return false
    const key = readFileSync(engineKeyFile(), 'utf8').trim()
    if (key !== computeKey(readMeta(), enabledUrls())) return false
    engine = FiltersEngine.deserialize(new Uint8Array(readFileSync(engineFile())))
    engineKey = key
    return true
  } catch (err) {
    // A library update can change the serialization format; recompile from the lists.
    log.info('cached engine unusable; recompiling', err)
    return false
  }
}

function isStale(meta: Meta, url: string): boolean {
  const f = meta.files[url]
  return !f || !existsSync(listFile(url)) || Date.now() - f.updatedAt > LIST_MAX_AGE_MS
}

/** Downloads what `refresh` asks for, then recompiles the engine if its inputs changed. */
function rebuild(refresh: Refresh): Promise<void> {
  if (building) {
    const rank = { missing: 0, stale: 1, all: 2 }
    if (!queued || rank[refresh] > rank[queued]) queued = refresh
    return building
  }
  building = (async () => {
    updating = true
    broadcastStatus()
    const errors: string[] = []
    try {
      mkdirSync(join(dir(), 'lists'), { recursive: true })
      const urls = enabledUrls()
      const meta = readMeta()
      const wanted = [...urls, RESOURCES_URL].filter((u) => refresh === 'all' || (refresh === 'stale' ? isStale(meta, u) : !meta.files[u] || !existsSync(listFile(u))))
      if (wanted.length) {
        const results = await Promise.allSettled(wanted.map(async (u) => ({ u, text: await download(u) })))
        for (const [i, r] of results.entries()) {
          if (r.status === 'fulfilled') {
            writeAtomic(listFile(r.value.u), r.value.text)
            meta.files[r.value.u] = { updatedAt: Date.now(), rules: r.value.u === RESOURCES_URL ? 0 : countRules(r.value.text) }
          } else {
            errors.push(`${new URL(wanted[i]).pathname.split('/').pop()}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
          }
        }
        writeAtomic(metaFile(), JSON.stringify(meta))
      }

      const key = computeKey(meta, urls)
      if (!engine || key !== engineKey) {
        const texts = urls.filter((u) => existsSync(listFile(u))).map((u) => readFileSync(listFile(u), 'utf8'))
        const resources = existsSync(listFile(RESOURCES_URL)) ? readFileSync(listFile(RESOURCES_URL), 'utf8') : null
        const t0 = performance.now()
        const bytes = await compileInWorker([...texts, customFilters()].join('\n'), resources)
        engine = FiltersEngine.deserialize(bytes)
        engineKey = key
        writeAtomic(engineFile(), bytes)
        writeAtomic(engineKeyFile(), key)
        log.info(`engine compiled from ${texts.length} lists in ${Math.round(performance.now() - t0)} ms`)
      }
      lastError = errors.length ? `${errors.length} list${errors.length === 1 ? '' : 's'} could not be downloaded (${errors[0]})` : null
      if (errors.length) log.warn('list download failed', errors)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      log.warn('rebuild failed', err)
    } finally {
      updating = false
      building = null
      broadcastStatus()
      if (queued) {
        const next = queued
        queued = null
        void rebuild(next)
      }
    }
  })()
  return building
}

let settingsTimer: ReturnType<typeof setTimeout> | undefined
export function initAdblock(): void {
  if (initialised) return
  initialised = true
  if (getSetting('privacy.adblock')) {
    if (loadCachedEngine()) setTimeout(() => void rebuild('stale'), 60_000)
    else void rebuild('stale')
  }
  // Hourly check; lists older than a day are refreshed in the background.
  setInterval(() => {
    if (getSetting('privacy.adblock') && !building) {
      const meta = readMeta()
      if ([...enabledUrls(), RESOURCES_URL].some((u) => isStale(meta, u))) void rebuild('stale')
    }
  }, 3600_000).unref()
  onSettingChanged((key) => {
    if (key === 'privacy.adblockLists' || key === 'privacy.adblockCustomFilters') {
      clearTimeout(settingsTimer)
      settingsTimer = setTimeout(() => getSetting('privacy.adblock') && void rebuild('missing'), 800)
    } else if (key === 'privacy.adblock') {
      if (getSetting('privacy.adblock') && !engine && !loadCachedEngine()) void rebuild('missing')
      broadcastStatus()
    } else if (key === 'privacy.adblockAllowlist') broadcastStatus()
  })
}

function active(topUrl: string): boolean {
  return !!engine && getSetting('privacy.adblock') && !isAllowlisted(hostname(topUrl), getSetting('privacy.adblockAllowlist'))
}

function sourceUrlOf(details: Electron.OnBeforeRequestListenerDetails | Electron.OnHeadersReceivedListenerDetails, topUrl: string): string {
  try {
    const f = details.frame
    if (f) {
      // A sub-frame request is judged in the context of the page that embeds it.
      const u = details.resourceType === 'subFrame' ? (f.parent?.url ?? f.url) : f.url
      if (u && /^https?:/.test(u)) return u
    }
  } catch {
    /* frame already gone */
  }
  return topUrl || details.referrer || ''
}

function toRequest(details: Electron.OnBeforeRequestListenerDetails | Electron.OnHeadersReceivedListenerDetails, topUrl: string): Request {
  const request = Request.fromRawDetails({
    requestId: String(details.id),
    url: details.url,
    sourceUrl: sourceUrlOf(details, topUrl),
    type: (details.resourceType || 'other') as RequestType,
    tabId: details.webContentsId
  })
  if (request.type === 'other') request.guessTypeOfRequest()
  return request
}

/** Network decision for one sub-resource request, or null to let it through. */
export function adblockBeforeRequest(details: Electron.OnBeforeRequestListenerDetails, topUrl: string): { cancel: true } | { redirectURL: string } | null {
  if (details.resourceType === 'mainFrame' || !active(topUrl) || !engine) return null
  const { match, redirect } = engine.match(toRequest(details, topUrl))
  if (redirect) {
    blockedByFilters++
    return { redirectURL: redirect.dataUrl }
  }
  if (match) {
    blockedByFilters++
    return { cancel: true }
  }
  return null
}

/** Extra Content-Security-Policy for a document ($csp filters), if any. */
export function adblockCSP(details: Electron.OnHeadersReceivedListenerDetails, topUrl: string): string | undefined {
  if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return undefined
  const top = details.resourceType === 'mainFrame' ? details.url : topUrl
  if (!active(top) || !engine) return undefined
  return engine.getCSPDirectives(toRequest(details, top))
}

// ------------------------------------------------------------------ status

export function adblockStatus(): AdblockStatus {
  const meta = readMeta()
  const ids = new Set(getSetting('privacy.adblockLists'))
  const lists = FILTER_LISTS.map((l) => {
    const files = l.urls.map((u) => meta.files[u])
    return {
      id: l.id,
      name: l.name,
      desc: l.desc,
      enabled: ids.has(l.id),
      rules: files.reduce((n, f) => n + (f?.rules ?? 0), 0),
      updatedAt: files.every(Boolean) ? Math.min(...files.map((f) => f!.updatedAt)) : 0
    }
  })
  const enabled = lists.filter((l) => l.enabled)
  return {
    enabled: getSetting('privacy.adblock'),
    ready: !!engine,
    updating,
    error: lastError,
    rules: enabled.reduce((n, l) => n + l.rules, 0),
    customRules: countRules(customFilters()),
    lastUpdated: enabled.length ? Math.min(...enabled.map((l) => l.updatedAt)) : 0,
    lists,
    allowlist: getSetting('privacy.adblockAllowlist'),
    blockedSession: blockedByFilters
  }
}

function broadcastStatus(): void {
  broadcast('adblock:status', adblockStatus())
}

export function registerAdblockIpc(): void {
  handle('adblock:status', () => adblockStatus())
  handle('adblock:update', async () => {
    await rebuild('all')
    return adblockStatus()
  })
}
