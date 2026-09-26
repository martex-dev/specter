// SPECTER updates.
//
// Installed Windows builds (NSIS) use electron-updater against the GitHub
// Releases of martex-dev/specter (fixed by `publish` in electron-builder.yml,
// baked into resources/app-update.yml): check 30 s after startup and every
// 6 h, download in the background, install on "Restart to update" or quietly
// when the app quits.
//
// Every other packaged build (portable exe, an unpacked folder, non-Windows)
// can't replace itself, so it falls back to the opt-in notify-only checker
// that asks the GitHub Releases API for the newest tag. Development builds
// are inert.
import { app } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppUpdater } from 'electron-updater'
import {
  canAutoInstall,
  compareVersions,
  describeUpdateState,
  detectUpdateMode,
  initialUpdateState,
  isLoopbackFeed,
  updateReducer,
  type UpdateEvent,
  type UpdateMode,
  type UpdateState
} from '@shared/updates'
import { broadcast, handle } from '../ipc'
import { fetchJson } from './net'
import { getSetting, onSettingChanged } from './settings'
import { notify } from './notifications'
import { registerDiagnostic } from './diagnostics'
import { metaGet, metaSet } from '../db'
import { createLogger } from '../logger'
import { cancelShutdownCleanup, runShutdownCleanup } from '../shutdown'

export { compareVersions }

const log = createLogger('updates')
const RELEASE_REPO = 'martex-dev/specter'
const FIRST_CHECK_MS = 30_000
const CHECK_EVERY_MS = 6 * 3600_000
/** Notify-only mode: don't hit the GitHub API more than once a day automatically. */
const NOTIFY_ONLY_MIN_GAP_MS = 24 * 3600_000

let mode: UpdateMode = 'dev'
let state: UpdateState = initialUpdateState('dev', '0.0.0', false)
let updater: AppUpdater | null = null
let downloadedFile: string | undefined
let firstTimer: ReturnType<typeof setTimeout> | null = null
let everyTimer: ReturnType<typeof setInterval> | null = null

function detect(): UpdateMode {
  const exeDir = dirname(process.execPath)
  let hasUninstaller = false
  try {
    hasUninstaller = readdirSync(exeDir).some((f) => /^Uninstall .+\.exe$/i.test(f))
  } catch {
    /* unreadable install dir */
  }
  return detectUpdateMode({
    isPackaged: app.isPackaged,
    platform: process.platform,
    portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
    hasUpdateConfig: !!process.resourcesPath && existsSync(join(process.resourcesPath, 'app-update.yml')),
    hasUninstaller
  })
}

const autoSetting = (): boolean => (canAutoInstall(mode) ? getSetting('advanced.autoUpdate') : getSetting('advanced.checkUpdates'))

function dispatch(e: UpdateEvent): void {
  const prev = state
  state = updateReducer(state, e)
  if (state === prev) return
  broadcast('updates:state', state)
  if (state.phase === 'ready' && prev.phase !== 'ready' && state.latest && metaGet('updates:readyNotified') !== state.latest) {
    metaSet('updates:readyNotified', state.latest)
    notify({ category: 'browser', title: `SPECTER ${state.latest} is ready`, body: 'Restart SPECTER to update. Your tabs and workspaces are restored afterwards.' })
  }
}

export function getUpdateState(): UpdateState {
  return state
}

export function isUpdateReady(): boolean {
  return state.phase === 'ready' && !!updater
}

const releasePage = (version: string) => `https://github.com/${RELEASE_REPO}/releases/tag/v${version.replace(/^v/, '')}`
const errText = (err: unknown) => String((err as Error)?.message ?? err ?? 'Unknown error').split('\n')[0].slice(0, 400)

// ------------------------------------------------------------ installed (NSIS)

async function startInstalledUpdater(): Promise<void> {
  // electron-updater is CommonJS and defines `autoUpdater` as a lazy getter that
  // Node's import() can't see as a named export: read it off module.exports.
  const mod = (await import('electron-updater')) as typeof import('electron-updater') & { default?: typeof import('electron-updater') }
  const autoUpdater = mod.default?.autoUpdater ?? mod.autoUpdater
  if (!autoUpdater) throw new Error('electron-updater did not provide an updater for this platform')
  updater = autoUpdater
  autoUpdater.logger = {
    info: (m?: unknown) => log.info(String(m)),
    warn: (m?: unknown) => log.warn(String(m)),
    error: (m?: unknown) => log.error(String(m)),
    debug: () => undefined
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = getSetting('advanced.autoUpdate')
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.disableWebInstaller = true
  // electron-updater sends a random per-install "staging id" header for staged
  // rollouts. SPECTER doesn't stage releases, so send a constant instead of a
  // persistent identifier: a check reveals nothing but the running version.
  autoUpdater.requestHeaders = { 'x-user-staging-id': '00000000-0000-0000-0000-000000000000' }
  // Code-signature verification: electron-updater only verifies when
  // app-update.yml carries a `publisherName`, which electron-builder writes
  // only for signed builds. SPECTER's builds are unsigned, so updates are
  // accepted on the strength of HTTPS + the sha512 in latest.yml; once builds
  // are signed, verification switches on automatically. Nothing to override.

  // Local end-to-end testing only: point at a loopback `generic` feed.
  const feed = process.env.SPECTER_UPDATE_FEED
  if (feed) {
    if (isLoopbackFeed(feed)) {
      log.warn(`using local update feed ${feed}`)
      autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    } else log.warn('ignoring SPECTER_UPDATE_FEED: only loopback URLs are accepted')
  }

  autoUpdater.on('checking-for-update', () => dispatch({ type: 'checking' }))
  autoUpdater.on('update-not-available', (i) => dispatch({ type: 'up-to-date', latest: i?.version, at: Date.now() }))
  autoUpdater.on('update-available', (i) =>
    dispatch({ type: 'available', version: i.version, releaseName: i.releaseName ?? undefined, releaseDate: i.releaseDate, releaseUrl: releasePage(i.version), at: Date.now() })
  )
  autoUpdater.on('download-progress', (p) => dispatch({ type: 'progress', progress: { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond } }))
  autoUpdater.on('update-downloaded', (e) => {
    downloadedFile = e.downloadedFile
    log.info(`update ${e.version} downloaded`)
    dispatch({ type: 'downloaded', version: e.version, releaseName: e.releaseName ?? undefined, releaseDate: e.releaseDate, releaseUrl: releasePage(e.version) })
  })
  autoUpdater.on('error', (err) => {
    const message = errText(err)
    if (state.phase === 'installing') {
      // The installer didn't start: we're not quitting after all.
      cancelShutdownCleanup()
      dispatch({ type: 'install-failed', message })
    } else dispatch({ type: 'error', message, at: Date.now() })
  })
}

async function checkInstalled(): Promise<void> {
  if (!updater) return
  if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'installing') return
  try {
    await updater.checkForUpdates()
  } catch (err) {
    // electron-updater emits 'error' before rejecting; make sure the UI never stays on "checking".
    if (getUpdateState().phase === 'checking') dispatch({ type: 'error', message: errText(err), at: Date.now() })
  }
}

/** Restart to update: flush and clean up first, then hand over to the installer. */
export async function installUpdate(): Promise<void> {
  if (!updater || state.phase !== 'ready') throw new Error('No downloaded update is ready to install')
  if (downloadedFile && !existsSync(downloadedFile)) {
    dispatch({ type: 'reset', message: 'The downloaded installer is missing — check for updates again' })
    throw new Error(state.error)
  }
  dispatch({ type: 'installing' })
  // Run the before-quit cleanup now (workspace flush, clear-on-exit, clean-exit
  // marker): the installer force-closes SPECTER ~2 s after it starts, so it
  // must not race with it. The before-quit handler then finds it done.
  await runShutdownCleanup()
  log.info(`restarting to install ${state.latest}`)
  // Silent install into the existing location, then relaunch SPECTER.
  // quitAndInstall spawns the (detached) installer synchronously, then calls app.quit().
  updater.quitAndInstall(true, true)
}

// ------------------------------------------------------------ notify-only fallback

interface ReleaseInfo {
  current: string
  latest?: string
  url?: string
  name?: string
  publishedAt?: string
  newer: boolean
  error?: string
}

async function queryReleaseApi(): Promise<ReleaseInfo> {
  const repo = getSetting('advanced.updateRepo').trim()
  const current = app.getVersion()
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { current, newer: false, error: 'No release repository configured' }
  try {
    const r = await fetchJson<{ tag_name: string; html_url: string; name: string; published_at: string }>(`https://api.github.com/repos/${repo}/releases/latest`, {
      timeoutMs: 8000,
      retries: 1,
      ttl: 10 * 60_000,
      headers: { Accept: 'application/vnd.github+json' }
    })
    metaSet('updates:lastCheck', String(Date.now()))
    return { current, latest: r.tag_name.replace(/^v/, ''), url: r.html_url, name: r.name, publishedAt: r.published_at, newer: compareVersions(r.tag_name, current) > 0 }
  } catch (err) {
    log.warn('update check failed', errText(err))
    return { current, newer: false, error: errText(err) }
  }
}

async function checkNotifyOnly(): Promise<void> {
  if (state.phase === 'checking') return
  dispatch({ type: 'checking' })
  const info = await queryReleaseApi()
  const at = Date.now()
  if (info.error) return dispatch({ type: 'error', message: info.error, at })
  if (!info.newer) return dispatch({ type: 'up-to-date', latest: info.latest, at })
  dispatch({ type: 'available', version: info.latest!, releaseName: info.name, releaseDate: info.publishedAt, releaseUrl: info.url, at })
  if (metaGet('updates:notified') !== info.latest) {
    metaSet('updates:notified', info.latest!)
    notify({
      category: 'browser',
      title: `SPECTER ${info.latest} is available`,
      body: mode === 'portable' ? 'Download the new portable build from Settings → About.' : 'Open Settings → About to view the release.'
    })
  }
}

// ------------------------------------------------------------ scheduling

/** Manual check (Settings → About, command palette). Resolves with the state after the check. */
export async function checkForUpdates(): Promise<UpdateState> {
  if (mode === 'dev') return state
  if (canAutoInstall(mode)) await checkInstalled()
  else await checkNotifyOnly()
  return state
}

function automaticCheck(): void {
  if (!state.auto || mode === 'dev') return
  if (!canAutoInstall(mode)) {
    const last = Number(metaGet('updates:lastCheck') ?? 0)
    if (Date.now() - last < NOTIFY_ONLY_MIN_GAP_MS) return
  }
  checkForUpdates().catch((err) => log.warn('automatic update check failed', errText(err)))
}

function schedule(): void {
  if (firstTimer) clearTimeout(firstTimer)
  if (everyTimer) clearInterval(everyTimer)
  firstTimer = everyTimer = null
  if (mode === 'dev' || !state.auto) return
  firstTimer = setTimeout(automaticCheck, FIRST_CHECK_MS)
  everyTimer = setInterval(automaticCheck, CHECK_EVERY_MS)
  everyTimer.unref?.()
}

const MODE_LABEL: Record<UpdateMode, string> = {
  dev: 'Development build',
  nsis: 'Installed build · automatic updates',
  portable: 'Portable build · notify only',
  unpacked: 'Unpacked build · notify only',
  other: 'Notify only'
}

export function registerUpdatesIpc(): void {
  mode = detect()
  state = initialUpdateState(mode, app.getVersion(), mode !== 'dev' && autoSetting())
  log.info(`update mode: ${mode}`)

  handle('updates:state', () => state)
  handle('updates:check', () => checkForUpdates())
  handle('updates:install', () => installUpdate())

  if (canAutoInstall(mode)) {
    startInstalledUpdater()
      .then(schedule)
      .catch((err) => {
        log.error('updater failed to start', errText(err))
        dispatch({ type: 'error', message: `Updater failed to start: ${errText(err)}`, at: Date.now() })
      })
  } else schedule()

  onSettingChanged((key) => {
    if (mode === 'dev') return
    if (canAutoInstall(mode) && key === 'advanced.autoUpdate') {
      const on = getSetting('advanced.autoUpdate')
      if (updater) updater.autoInstallOnAppQuit = on
      dispatch({ type: 'auto', auto: on })
      schedule()
    }
    if (!canAutoInstall(mode) && (key === 'advanced.checkUpdates' || key === 'advanced.updateRepo')) {
      metaSet('updates:lastCheck', '0')
      dispatch({ type: 'auto', auto: getSetting('advanced.checkUpdates') })
      schedule()
    }
  })

  registerDiagnostic(() => {
    const s = state
    const status = mode === 'dev' ? 'unknown' : s.phase === 'error' ? 'warn' : s.phase === 'idle' ? (s.auto ? 'unknown' : 'warn') : 'ok'
    const last = s.lastCheck ? ` · last check ${new Date(s.lastCheck).toLocaleString()}` : ''
    const raw = s.error ? ` (${s.error})` : ''
    const prefix = mode === 'dev' ? '' : `${MODE_LABEL[mode]} · `
    return { id: 'updates', label: 'Updates', status, detail: `${prefix}${describeUpdateState(s)}${raw}${last}` }
  })
}
