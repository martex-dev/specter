// Pure update logic shared by the main process (state machine, mode detection)
// and the renderer (status text). No Electron imports — unit tested.

/**
 * How this copy of SPECTER can be updated.
 * - `nsis`: installed with the Windows NSIS installer → electron-updater downloads and installs.
 * - `portable`: the single-file portable build → notify-only (it can't replace itself).
 * - `unpacked`: a packaged build that wasn't installed (e.g. release/win-unpacked) → notify-only.
 * - `other`: packaged on another platform (AppImage/dmg aren't wired up) → notify-only.
 * - `dev`: not packaged (electron-vite dev / preview) → inert.
 */
export type UpdateMode = 'dev' | 'nsis' | 'portable' | 'unpacked' | 'other'

export interface UpdateModeInput {
  isPackaged: boolean
  platform: string
  /** `process.env.PORTABLE_EXECUTABLE_DIR` — set by electron-builder's portable launcher. */
  portableDir?: string
  /** `resources/app-update.yml` exists (written by electron-builder when `publish` is configured). */
  hasUpdateConfig: boolean
  /** The NSIS uninstaller sits next to the executable (only true for installed copies). */
  hasUninstaller: boolean
}

export function detectUpdateMode(i: UpdateModeInput): UpdateMode {
  if (!i.isPackaged) return 'dev'
  if (i.platform !== 'win32') return 'other'
  if (i.portableDir) return 'portable'
  if (i.hasUpdateConfig && i.hasUninstaller) return 'nsis'
  return 'unpacked'
}

/** Whether the mode uses the real (download + install) updater. */
export const canAutoInstall = (mode: UpdateMode): boolean => mode === 'nsis'

export type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateState {
  mode: UpdateMode
  current: string
  /** Automatic checks are on (advanced.autoUpdate for nsis, advanced.checkUpdates otherwise). */
  auto: boolean
  phase: UpdatePhase
  /** Newest version the server reported (set once a check succeeded). */
  latest?: string
  releaseName?: string
  releaseDate?: string
  /** Release page for notes (GitHub). */
  releaseUrl?: string
  progress?: UpdateProgress
  /** Raw error message of the last failed check/download. */
  error?: string
  /** Timestamp of the last check that completed (successfully or not). */
  lastCheck?: number
}

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'up-to-date'; latest?: string; at: number }
  | { type: 'available'; version: string; releaseName?: string; releaseDate?: string; releaseUrl?: string; at: number }
  | { type: 'progress'; progress: UpdateProgress }
  | { type: 'downloaded'; version: string; releaseName?: string; releaseDate?: string; releaseUrl?: string }
  | { type: 'installing' }
  | { type: 'install-failed'; message: string }
  | { type: 'error'; message: string; at: number }
  | { type: 'auto'; auto: boolean }
  /** Forget a downloaded update (e.g. its installer vanished from the cache) so a new check can run. */
  | { type: 'reset'; message?: string }

export function initialUpdateState(mode: UpdateMode, current: string, auto: boolean): UpdateState {
  return { mode, current, auto, phase: 'idle' }
}

/**
 * Update state machine. Key rule: once an update is downloaded (`ready`) it
 * stays ready — a later periodic check or a network error must not hide an
 * installer that's already verified on disk.
 */
export function updateReducer(s: UpdateState, e: UpdateEvent): UpdateState {
  const locked = s.phase === 'ready' || s.phase === 'installing'
  switch (e.type) {
    case 'auto':
      return { ...s, auto: e.auto }
    case 'reset':
      return { mode: s.mode, current: s.current, auto: s.auto, lastCheck: s.lastCheck, phase: e.message ? 'error' : 'idle', error: e.message }
    case 'checking':
      if (locked || s.phase === 'downloading') return s
      return { ...s, phase: 'checking', error: undefined }
    case 'up-to-date':
      if (locked) return s
      return { ...s, phase: 'up-to-date', latest: e.latest ?? s.latest, error: undefined, progress: undefined, lastCheck: e.at }
    case 'available':
      if (locked) return s
      return { ...s, phase: 'available', latest: e.version, releaseName: e.releaseName, releaseDate: e.releaseDate, releaseUrl: e.releaseUrl, error: undefined, lastCheck: e.at }
    case 'progress':
      if (locked) return s
      return { ...s, phase: 'downloading', progress: e.progress }
    case 'downloaded':
      return {
        ...s,
        phase: 'ready',
        latest: e.version,
        releaseName: e.releaseName ?? s.releaseName,
        releaseDate: e.releaseDate ?? s.releaseDate,
        releaseUrl: e.releaseUrl ?? s.releaseUrl,
        progress: undefined,
        error: undefined
      }
    case 'installing':
      return s.phase === 'ready' ? { ...s, phase: 'installing' } : s
    case 'install-failed':
      return s.phase === 'installing' ? { ...s, phase: 'ready', error: e.message } : s
    case 'error':
      // A failed background check while an installer is waiting is recorded, not surfaced as the phase.
      if (locked) return { ...s, error: e.message }
      return { ...s, phase: 'error', error: e.message, progress: undefined, lastCheck: e.at }
  }
}

/** Short, human explanation for common updater errors; the raw message is still shown alongside. */
export function summarizeUpdateError(message: string): string {
  const m = message || ''
  if (/latest\.yml|Cannot find .*\.yml|app-update\.yml/i.test(m) && /404|not found|cannot find/i.test(m)) return 'The latest release has no update metadata (latest.yml) yet'
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|getaddrinfo/i.test(m)) return 'You appear to be offline'
  if (/ETIMEDOUT|ERR_TIMED_OUT|timed? ?out/i.test(m)) return 'The update server did not respond in time'
  if (/rate limit|\b429\b|\b403\b/i.test(m)) return 'GitHub rate limit reached — try again later'
  if (/sha512 checksum mismatch|checksum/i.test(m)) return 'The download was corrupted (checksum mismatch)'
  if (/not signed by the application owner|ERR_UPDATER_INVALID_SIGNATURE/i.test(m)) return 'The downloaded installer failed signature verification'
  if (/No published versions|Unable to find latest version|ERR_UPDATER_LATEST_VERSION_NOT_FOUND|\b404\b/i.test(m)) return 'No release was found on GitHub'
  if (/ECONNREFUSED|ECONNRESET|ERR_CONNECTION/i.test(m)) return 'Could not connect to the update server'
  return 'Update check failed'
}

const pct = (p?: UpdateProgress) => (p ? Math.max(0, Math.min(100, Math.floor(p.percent))) : 0)

/** One-line status for Settings → About and the command palette. Never claims more than the state says. */
export function describeUpdateState(s: UpdateState): string {
  if (s.mode === 'dev') return 'Development build — automatic updates are disabled.'
  switch (s.phase) {
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return `Up to date — SPECTER ${s.current} is the latest version.`
    case 'available':
      return canAutoInstall(s.mode) ? `SPECTER ${s.latest} is available — starting download…` : `SPECTER ${s.latest} is available (you have ${s.current}).`
    case 'downloading':
      return `Downloading SPECTER ${s.latest ?? ''} — ${pct(s.progress)}%`.replace('  ', ' ')
    case 'ready':
      return `SPECTER ${s.latest} is ready — restart to update.`
    case 'installing':
      return `Installing SPECTER ${s.latest}…`
    case 'error':
      return `${summarizeUpdateError(s.error ?? '')}.`
    case 'idle':
    default:
      return s.auto ? 'Not checked yet this session.' : 'Automatic checks are off.'
  }
}

/** Compares dotted versions (ignores leading "v" and pre-release suffixes). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/** Only loopback feeds may override the update source (used for local end-to-end tests). */
export function isLoopbackFeed(url: string | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]')
  } catch {
    return false
  }
}
